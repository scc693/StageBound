/** Read-only Hevy Pro integration. The API key is a Worker secret, never returned to the browser. */
export interface HevyEnv { DB:D1Database; HEVY_API_KEY?:string; }
const out=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
type HevyWorkout={id:string,title?:string,start_time?:string,updated_at?:string,end_time?:string,exercises?:unknown[]};
type Page={page?:number,page_count?:number,workouts?:HevyWorkout[]};
type Connection={owner:string,enabled:number,last_synced_at:string|null,last_error:string|null,last_import_page:number,history_complete:number};
const safeError=(error:unknown)=>error instanceof Error?error.message.slice(0,160):'Sync request failed';
async function fetchPage(key:string,page:number):Promise<Page>{
 const endpoint=new URL('https://api.hevyapp.com/v1/workouts');
 endpoint.searchParams.set('page',String(page));endpoint.searchParams.set('pageSize','10');
 const reply=await fetch(endpoint.href,{method:'GET',headers:{'api-key':key,'Accept':'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
 if(reply.status===429)throw Error('Hevy rate limit reached. Try syncing later.');
 if(reply.status===401||reply.status===403)throw Error('Hevy API key was rejected. Update the Worker secret.');
 if(!reply.ok)throw Error('Hevy returned HTTP '+reply.status);
 const body:unknown=await reply.json();
 if(!body||typeof body!=='object'||!Array.isArray((body as Page).workouts)||!Number.isInteger((body as Page).page_count))throw Error('Unexpected Hevy API response');
 return body as Page;
}
const getConnection=async(db:D1Database,owner:string)=>db.prepare('SELECT * FROM hevy_connections WHERE owner=?').bind(owner).first<Connection>();
export async function syncHevy(env:HevyEnv,owner:string,history=false){
 if(!env.HEVY_API_KEY)throw Error('Hevy secret not configured in Cloudflare');
 const previous=await getConnection(env.DB,owner);
 if(!previous?.enabled)throw Error('Hevy not connected for this Stagebound login');
 const start=history?Math.max(previous.last_import_page||1,1):1;
 let imported=0,pages=0,foundEnd=false;
 try{
  for(let page=start;page<start+5;page++){
   const data=await fetchPage(env.HEVY_API_KEY,page);
   if(!Number.isInteger(data.page_count)||data.page_count!<0||data.page_count!>10000)throw Error('Invalid Hevy page count');
   if(page>data.page_count!||data.workouts?.length===0){foundEnd=true;break;}
   const workouts=data.workouts||[];
   const statements:D1PreparedStatement[]=[];
   for(const w of workouts){
    if(typeof w.id!=='string'||!w.id||!w.start_time||typeof w.start_time!=='string')continue;
    const title=typeof w.title==='string'?w.title.slice(0,250):'Hevy workout';
    const content=JSON.stringify(w);
    if(content.length>200000)continue;
    statements.push(env.DB.prepare('INSERT INTO hevy_workouts(owner,hevy_id,start_time,updated_at,title,json) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,hevy_id) DO UPDATE SET start_time=excluded.start_time,updated_at=excluded.updated_at,title=excluded.title,json=excluded.json').bind(owner,w.id,w.start_time,w.updated_at||null,title,content));
   }
   if(statements.length)await env.DB.batch(statements);
   imported+=statements.length;pages++;
   if(page>=data.page_count!){foundEnd=true;break;}
  }
  const nextPage=history?start+pages:start===1?Math.max(previous.last_import_page,6):previous.last_import_page;
  await env.DB.prepare('UPDATE hevy_connections SET last_synced_at=?,last_error=NULL,last_import_page=?,history_complete=? WHERE owner=?').bind(new Date().toISOString(),foundEnd&&history?nextPage:Math.max(previous.last_import_page,nextPage),history&&foundEnd?1:previous.history_complete,owner).run();
  return {ok:true,imported,pages,historyComplete:Boolean((history&&foundEnd)||previous.history_complete),nextHistoryPage:Math.max(previous.last_import_page,nextPage)};
 }catch(e){
  await env.DB.prepare('UPDATE hevy_connections SET last_error=? WHERE owner=?').bind(safeError(e),owner).run();
  throw e;
 }
}
export async function scheduledHevySync(env:HevyEnv):Promise<number>{
 if(!env.HEVY_API_KEY)return 0;
 const conn=await env.DB.prepare('SELECT owner FROM hevy_connections WHERE enabled=1').all<{owner:string}>();
 let successes=0;
 for(const c of conn.results){
  try{await syncHevy(env,c.owner,false);successes++;}
  catch{ /* Error persisted in D1; one owner failing must not block other owners. */ }
 }
 return successes;
}
export async function hevyRoutes(request:Request,env:HevyEnv,owner:string):Promise<Response|null>{
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/api/hevy'))return null;
 try{
  const conn=await getConnection(env.DB,owner);
  if(url.pathname==='/api/hevy'&&request.method==='GET'){
   const rows=await env.DB.prepare('SELECT hevy_id AS id,start_time AS startTime,title,json FROM hevy_workouts WHERE owner=? ORDER BY start_time DESC LIMIT 1000').bind(owner).all<{id:string,startTime:string,title:string,json:string}>();
   return out({configured:!!env.HEVY_API_KEY,connected:!!conn?.enabled,lastSynced:conn?.last_synced_at||null,lastError:conn?.last_error||null,historyComplete:!!conn?.history_complete,nextHistoryPage:conn?.last_import_page||1,workouts:rows.results.map(r=>{try{return JSON.parse(r.json)}catch{return null}}).filter(Boolean)});
  }
  if(url.pathname==='/api/hevy/connect'&&request.method==='POST'){
   if(!env.HEVY_API_KEY)return out({error:'Set HEVY_API_KEY in the Stagebound Worker secret settings first'},503);
   // Verify the secret before associating an identity.
   await fetchPage(env.HEVY_API_KEY,1);
   await env.DB.prepare('INSERT INTO hevy_connections(owner,enabled,last_import_page,history_complete) VALUES(?,1,1,0) ON CONFLICT(owner) DO UPDATE SET enabled=1').bind(owner).run();
   return out({connected:true});
  }
  if(url.pathname==='/api/hevy/sync'&&request.method==='POST'){
   if(!conn?.enabled)return out({error:'Connect Hevy first'},409);
   const history=url.searchParams.get('history')==='1';
   return out(await syncHevy(env,owner,history));
  }
  if(url.pathname==='/api/hevy/disconnect'&&request.method==='POST'){
   await env.DB.prepare('UPDATE hevy_connections SET enabled=0 WHERE owner=?').bind(owner).run();
   // Imported history remains for archive/backup until explicitly removed.
   return out({connected:false});
  }
  return out({error:'Method not allowed'},405);
 }catch(e){return out({error:safeError(e)},502)}
}
