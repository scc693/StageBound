/**
 * Stagebound backups: all exports and recovery operations are scoped to the
 * verified Cloudflare Access email passed by the authenticated Worker.
 * Backups are private R2 objects in a separate bucket, not public URLs.
 */
export interface BackupEnv {
  DB: D1Database;
  PHOTOS: R2Bucket;
  BACKUPS: R2Bucket;
}
type Row = Record<string, string | number | null>;
const tables = ['checkins','competitions','tasks','preferences','measurements','progress_photos','training_sessions','exercise_sets','nutrition_days','prep_plan','nutrition_targets','hevy_connections','hevy_workouts','exercise_muscle_map'] as const;
type Table = typeof tables[number];
type Records = Record<Table,Row[]>;
interface Snapshot { version:number; createdAt:string; owner:string; records:Records; }
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function sha(input:string):Promise<string>{
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const prefix=(hash:string)=>'users/'+hash+'/';
const safePhotoId=(s:string)=>/^[0-9a-f-]{36}$/i.test(s);
const typeExt=(type:string)=>type==='image/jpeg'?'jpg':type==='image/png'?'png':'webp';
const photoBackupKey=(hash:string,id:string,type:string)=>prefix(hash)+'photos/'+id+'.'+typeExt(type);
const photoMetaKey=(hash:string,id:string)=>prefix(hash)+'photos/'+id+'.json';
async function recordsForOwner(db:D1Database,owner:string):Promise<Records>{
 const results=await db.batch(tables.map(t=>db.prepare('SELECT * FROM '+t+' WHERE owner=?').bind(owner)));
 return Object.fromEntries(tables.map((t,i)=>[t,results[i].results])) as Records;
}
async function photoCopy(env:BackupEnv,hash:string,p:Row):Promise<void>{
 const id=String(p.id||''),key=String(p.object_key||''),type=String(p.content_type||'');
 if(!safePhotoId(id)||!key.startsWith(hash+'/')||!['image/png','image/jpeg','image/webp'].includes(type))throw Error('Invalid photo metadata');
 const target=photoBackupKey(hash,id,type);
 if(!await env.BACKUPS.head(target)){
   const original=await env.PHOTOS.get(key);
   if(!original)throw Error('Cannot back up missing original photo '+id);
   await env.BACKUPS.put(target,original.body,{httpMetadata:{contentType:type}});
 }
 await env.BACKUPS.put(photoMetaKey(hash,id),JSON.stringify(p),{httpMetadata:{contentType:'application/json'}});
}
export async function preservePhoto(env:BackupEnv,owner:string,photo:Row){
 const hash=await sha(owner);
 await photoCopy(env,hash,photo);
}
function dateKey(kind:'daily'|'manual',timestamp:string){
 const date=timestamp.slice(0,10);
 return kind==='daily'?date+'.json':timestamp.replace(/[:.]/g,'-')+'-'+crypto.randomUUID()+'.json';
}
async function pruneDaily(env:BackupEnv,hash:string){
 const root=prefix(hash)+'snapshots/daily/';
 const cutoff=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
 let cursor:string|undefined;
 do{
  const result=await env.BACKUPS.list({prefix:root,cursor,limit:1000});
  const toDelete=result.objects.filter(x=>x.key.slice(root.length,root.length+10)<cutoff).map(x=>x.key);
  if(toDelete.length)await env.BACKUPS.delete(toDelete);
  cursor=result.truncated?result.cursor:undefined;
 }while(cursor);
}
export async function takeSnapshot(env:BackupEnv,owner:string,kind:'daily'|'manual'='manual'){
 const hash=await sha(owner);
 const records=await recordsForOwner(env.DB,owner);
 // Preserve every photo before reporting a backup success.
 for(const p of records.progress_photos) await photoCopy(env,hash,p);
 const createdAt=new Date().toISOString();
 const content=JSON.stringify({version:1,createdAt,owner,records} satisfies Snapshot);
 const digest=await sha(content);
 const key=prefix(hash)+'snapshots/'+kind+'/'+dateKey(kind,createdAt);
 await env.BACKUPS.put(key,content,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:digest}});
 if(kind==='daily')await pruneDaily(env,hash);
 return {key:key.slice(prefix(hash).length),createdAt,sha256:digest,counts:Object.fromEntries(tables.map(t=>[t,records[t].length]))};
}
async function listKeys(env:BackupEnv,hash:string){
 let cursor:string|undefined;const objects:R2Object[]=[];
 do{
  const result=await env.BACKUPS.list({prefix:prefix(hash)+'snapshots/',cursor,limit:1000});
  objects.push(...result.objects);
  cursor=result.truncated?result.cursor:undefined;
 }while(cursor);
 return objects.sort((a,b)=>b.key.localeCompare(a.key));
}
async function loadSnapshot(env:BackupEnv,owner:string,relative:string){
 const hash=await sha(owner);
 if(!/^snapshots\/(daily|manual)\/[a-zA-Z0-9_.-]+\.json$/.test(relative))throw Error('Invalid backup ID');
 const object=await env.BACKUPS.get(prefix(hash)+relative);
 if(!object)throw Error('Backup not found');
 const content=await object.text();
 const expected=object.customMetadata?.sha256;
 const actual=await sha(content);
 if(!expected||actual!==expected)throw Error('Snapshot integrity check failed');
 const snapshot=JSON.parse(content) as Snapshot;
 if(snapshot.version!==1||snapshot.owner!==owner||!snapshot.records)throw Error('Snapshot schema invalid');
 // Historical v1 snapshots predate training and nutrition tables; they remain valid.
 for(const t of tables){if(snapshot.records[t]===undefined)(snapshot.records as unknown as Record<string,Row[]>)[t]=[];else if(!Array.isArray(snapshot.records[t]))throw Error('Snapshot schema invalid: '+t)}
 return {snapshot,sha256:actual};
}
export async function backupStatus(env:BackupEnv,owner:string){
 const hash=await sha(owner);
 const keys=await listKeys(env,hash);
 return keys.map(k=>({id:k.key.slice(prefix(hash).length),createdAt:k.uploaded.toISOString(),bytes:k.size,sha256:k.customMetadata?.sha256||null,kind:k.key.includes('/daily/')?'daily':'manual'}));
}
export async function verifySnapshot(env:BackupEnv,owner:string,relative:string){
 const hash=await sha(owner);
 const {snapshot,sha256}=await loadSnapshot(env,owner,relative);
 const missing:string[]=[];
 for(const p of snapshot.records.progress_photos){
  const id=String(p.id),type=String(p.content_type);
  if(!safePhotoId(id)||!await env.BACKUPS.head(photoBackupKey(hash,id,type)))missing.push(id);
 }
 return {ok:missing.length===0,sha256,createdAt:snapshot.createdAt,counts:Object.fromEntries(tables.map(t=>[t,snapshot.records[t].length])),missingPhotos:missing};
}
function recordKey(table:Table,row:Row):string {
 if(table==='nutrition_days')return String(row.date);
 if(table==='hevy_workouts')return String(row.hevy_id);
 if(table==='exercise_muscle_map')return String(row.exercise_key);
 return String(row.id??row.owner);
}
async function missingRecords(env:BackupEnv,owner:string,records:Records){
 const current=await recordsForOwner(env.DB,owner);
 return Object.fromEntries(tables.map(t=>{
  const ids=new Set(current[t].map(x=>recordKey(t,x)));
  return [t,records[t].filter(x=>!ids.has(recordKey(t,x))).length];
 }));
}
export async function restoreMissing(env:BackupEnv,owner:string,relative:string,apply:boolean){
 const hash=await sha(owner);
 const {snapshot}=await loadSnapshot(env,owner,relative);
 const integrity=await verifySnapshot(env,owner,relative);
 if(!integrity.ok)throw Error('Photo backup verification failed; nothing was restored');
 const missing=await missingRecords(env,owner,snapshot.records);
 if(!apply)return {dryRun:true,missing,sourceCreatedAt:snapshot.createdAt};
 // A pre-recovery checkpoint makes a recovery itself reversible.
 await takeSnapshot(env,owner,'manual');
 const inserts:D1PreparedStatement[]=[];
 for(const t of tables){
  const rows=snapshot.records[t];
  for(const row of rows){
   const keys=Object.keys(row).filter(k=>/^[a-z_]+$/.test(k)&&k!=='owner');
   const columns=['owner',...keys];
   inserts.push(env.DB.prepare('INSERT OR IGNORE INTO '+t+' ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').bind(owner,...keys.map(k=>row[k])));
  }
 }
 // Recover deleted originals before restoring their database metadata.
 for(const p of snapshot.records.progress_photos){
  const type=String(p.content_type),id=String(p.id),objectKey=String(p.object_key);
  if(!objectKey.startsWith(hash+'/'))throw Error('Photo owner mismatch');
  if(!await env.PHOTOS.head(objectKey)){
   const source=await env.BACKUPS.get(photoBackupKey(hash,id,type));
   if(!source)throw Error('Missing archived photo');
   await env.PHOTOS.put(objectKey,source.body,{httpMetadata:{contentType:type}});
  }
 }
 for(let offset=0;offset<inserts.length;offset+=75)await env.DB.batch(inserts.slice(offset,offset+75));
 return {restored:true,missing,sourceCreatedAt:snapshot.createdAt};
}
export async function exportRecords(env:BackupEnv,owner:string){
 return {version:1,exportedAt:new Date().toISOString(),records:await recordsForOwner(env.DB,owner)};
}
export async function scheduledBackup(env:BackupEnv){
 const query='SELECT owner FROM checkins UNION SELECT owner FROM competitions UNION SELECT owner FROM tasks UNION SELECT owner FROM preferences UNION SELECT owner FROM measurements UNION SELECT owner FROM progress_photos UNION SELECT owner FROM training_sessions UNION SELECT owner FROM exercise_sets UNION SELECT owner FROM nutrition_days UNION SELECT owner FROM prep_plan UNION SELECT owner FROM nutrition_targets UNION SELECT owner FROM hevy_connections UNION SELECT owner FROM hevy_workouts UNION SELECT owner FROM exercise_muscle_map';
 const results=await env.DB.prepare(query).all<{owner:string}>();
 const failures:string[]=[];
 for(const item of results.results){
  try{await takeSnapshot(env,item.owner,'daily')}catch(e){failures.push(item.owner+': '+String(e))}
 }
 if(failures.length)throw Error('Backup failed for '+failures.length+' owner(s): '+failures.join('; '));
 return results.results.length;
}
export async function backupRoutes(request:Request,env:BackupEnv,owner:string):Promise<Response|null>{
 const u=new URL(request.url),path=u.pathname;
 try{
  if(path==='/api/backups'&&request.method==='GET')return response({backups:await backupStatus(env,owner)});
  if(path==='/api/backups/run'&&request.method==='POST')return response(await takeSnapshot(env,owner,'manual'),201);
  if(path==='/api/backups/verify'&&request.method==='GET'){
   const selected=u.searchParams.get('id');
   if(!selected)return response({error:'Select a snapshot'},400);
   return response(await verifySnapshot(env,owner,selected));
  }
  if(path==='/api/backups/restore'&&request.method==='POST'){
   const body=await request.json() as {id?:string,apply?:boolean};
   if(typeof body?.id!=='string')return response({error:'Select a snapshot'},400);
   return response(await restoreMissing(env,owner,body.id,body.apply===true));
  }
  if(path==='/api/backups/export'&&request.method==='GET')return response(await exportRecords(env,owner));
  if(path==='/api/backups/archive'&&request.method==='GET'){
   const selected=u.searchParams.get('id');
   if(!selected)return response({error:'Select a snapshot'},400);
   const {snapshot}=await loadSnapshot(env,owner,selected);
   return response(snapshot);
  }
  return null;
 }catch(e){
  return response({error:e instanceof Error?e.message:'Backup operation failed'},400);
 }
}
