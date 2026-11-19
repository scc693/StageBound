import {muscleRoutes} from './muscles';
import {hevyRoutes,scheduledHevySync} from './hevy';
import { prepRoutes } from './prep';
import { backupRoutes, preservePhoto, scheduledBackup } from './backup';
import { createRemoteJWKSet, jwtVerify } from 'jose';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: D1Database;
  PHOTOS: R2Bucket;
  BACKUPS: R2Bucket;
  HEVY_API_KEY?: string;
  Hevy_API?: string;
  ACCESS_AUD: string;
  ACCESS_TEAM_DOMAIN: string;
}

const json = (data: unknown, status = 200) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
const max = (v: unknown, length: number): string => typeof v === 'string' ? v.slice(0, length) : '';
const validDate = (v: string) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
type Row = Record<string, unknown>;
const defaultGoal = 'Bodybuilding + Classic Physique';
async function identity(request: Request, env: Env): Promise<string | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  try {
    const origin = 'https://' + env.ACCESS_TEAM_DOMAIN;
    const keys = createRemoteJWKSet(new URL(origin + '/cdn-cgi/access/certs'));
    const { payload } = await jwtVerify(token, keys, {
      issuer: origin,
      audience: env.ACCESS_AUD,
      algorithms: ['RS256']
    });
    const email = payload.email;
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return email.toLowerCase();
  } catch {
    return null;
  }
}
async function getState(db: D1Database, owner: string) {
  const [checkins,events,tasks,prefs] = await db.batch([
    db.prepare('SELECT id,date,weight,bf,training,nutrition,cardio,posing,notes FROM checkins WHERE owner=? ORDER BY date DESC').bind(owner),
    db.prepare('SELECT id,name,date,location,division,status,url,notes FROM competitions WHERE owner=? ORDER BY date').bind(owner),
    db.prepare('SELECT id,title,due,done FROM tasks WHERE owner=?').bind(owner),
    db.prepare('SELECT goal,goal_weight AS goalWeight FROM preferences WHERE owner=?').bind(owner)
  ]);
  const p = prefs.results[0] as Row | undefined;
  return {
    checkins: checkins.results,
    events: events.results,
    tasks: (tasks.results as Row[]).map(t => ({ ...t, done: Boolean(t.done) })),
    goal: p?.goal ?? defaultGoal,
    goalWeight: p?.goalWeight ?? ''
  };
}
async function saveState(request: Request, db: D1Database, owner: string): Promise<Response> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('application/json')) return json({ error: 'JSON body required' }, 415);
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 250000) return json({ error: 'Payload too large' }, 413);
  let body: any;
  try {
    const raw = await request.text();
    if (raw.length > 250000) return json({ error: 'Payload too large' }, 413);
    body = JSON.parse(raw);
  } catch { return json({ error: 'Malformed JSON' }, 400); }
  if (!body || !Array.isArray(body.checkins) || !Array.isArray(body.events) || !Array.isArray(body.tasks)) return json({ error: 'Invalid state' }, 400);
  if (body.checkins.length > 5000 || body.events.length > 500 || body.tasks.length > 2000) return json({ error: 'Too many entries' }, 413);
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM checkins WHERE owner=?').bind(owner),
    db.prepare('DELETE FROM competitions WHERE owner=?').bind(owner),
    db.prepare('DELETE FROM tasks WHERE owner=?').bind(owner)
  ];
  const seen = new Set<string>();
  for (const c of body.checkins) {
    const id = max(c?.id,100), date = max(c?.date,10);
    if (!id || !date || !validDate(date) || seen.has('c'+id)) return json({error:'Invalid check-in'},400);
    seen.add('c'+id);
    statements.push(db.prepare('INSERT INTO checkins(owner,id,date,weight,bf,training,nutrition,cardio,posing,notes) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(owner,id,date,max(c.weight,30),max(c.bf,30),max(c.training,500),max(c.nutrition,500),max(c.cardio,500),max(c.posing,500),max(c.notes,5000)));
  }
  for (const e of body.events) {
    const id = max(e?.id,100), name=max(e?.name,300), date=max(e?.date,10), status=max(e?.status,16);
    if (!id || !name || !validDate(date) || !['Confirmed','Estimated','Unknown'].includes(status) || seen.has('e'+id)) return json({error:'Invalid competition'},400);
    seen.add('e'+id);
    statements.push(db.prepare('INSERT INTO competitions(owner,id,name,date,location,division,status,url,notes) VALUES(?,?,?,?,?,?,?,?,?)').bind(owner,id,name,date,max(e.location,300),max(e.division,50),status,max(e.url,1000),max(e.notes,5000)));
  }
  for (const t of body.tasks) {
    const id=max(t?.id,100),title=max(t?.title,500),due=max(t?.due,10);
    if (!id || !title || !validDate(due) || seen.has('t'+id)) return json({error:'Invalid task'},400);
    seen.add('t'+id);
    statements.push(db.prepare('INSERT INTO tasks(owner,id,title,due,done) VALUES(?,?,?,?,?)').bind(owner,id,title,due,t.done===true?1:0));
  }
  statements.push(db.prepare('INSERT INTO preferences(owner,goal,goal_weight) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET goal=excluded.goal,goal_weight=excluded.goal_weight').bind(owner,max(body.goal,300)||defaultGoal,max(body.goalWeight,30)));
  try { await db.batch(statements); return json({ok:true}); }
  catch { return json({error:'Database write failed'},500); }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.DB || !env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) return json({error:'Server configuration incomplete'},503);
    const owner = await identity(request,env);
    if (!owner) return json({error:'Unauthenticated'},401);
    // Independently versioned physique records: existing /api/state saves never overwrite measurements.
    if (url.pathname === '/api/measurements') {
      if (request.method === 'GET') {
        try {
          const rows = await env.DB.prepare('SELECT id,date,waist,chest,shoulders,arm_left AS armLeft,arm_right AS armRight,thigh_left AS thighLeft,thigh_right AS thighRight,hips,neck,notes FROM measurements WHERE owner=? ORDER BY date DESC').bind(owner).all();
          return json({ measurements: rows.results });
        } catch { return json({error:'Could not load measurements'},500); }
      }
      if (request.method === 'POST') {
        let m: Record<string,unknown>;
        try { m = await request.json() as Record<string,unknown>; } catch { return json({error:'Invalid JSON'},400); }
        const rowId=max(m.id,100), date=max(m.date,10);
        if (!rowId || !date || !validDate(date)) return json({error:'Invalid measurement id or date'},400);
        const fields=['waist','chest','shoulders','armLeft','armRight','thighLeft','thighRight','hips','neck'] as const;
        const values:(number|null)[]=[];
        for(const field of fields) {
          const v=m[field];
          if(v===null || v==='' || v===undefined){values.push(null);continue;}
          const n=Number(v);
          if(!Number.isFinite(n)||n<=0||n>500) return json({error:'Measurement out of range: '+field},400);
          values.push(n);
        }
        try {
          await env.DB.prepare('INSERT INTO measurements(owner,id,date,waist,chest,shoulders,arm_left,arm_right,thigh_left,thigh_right,hips,neck,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET date=excluded.date,waist=excluded.waist,chest=excluded.chest,shoulders=excluded.shoulders,arm_left=excluded.arm_left,arm_right=excluded.arm_right,thigh_left=excluded.thigh_left,thigh_right=excluded.thigh_right,hips=excluded.hips,neck=excluded.neck,notes=excluded.notes')
          .bind(owner,rowId,date,...values,max(m.notes,2000)).run();
          return json({ok:true});
        } catch {return json({error:'Could not save measurement'},500);}
      }
      return json({error:'Method not allowed'},405);
    }
    if(url.pathname.startsWith('/api/measurements/') && request.method==='DELETE'){
      const rowId=decodeURIComponent(url.pathname.slice('/api/measurements/'.length));
      if(!rowId || rowId.length>100)return json({error:'Invalid id'},400);
      await env.DB.prepare('DELETE FROM measurements WHERE owner=? AND id=?').bind(owner,rowId).run();
      return json({ok:true});
    }
    // R2 remains private. These endpoints return 503 until the user enables the R2 service.
    if(url.pathname==='/api/photos' && request.method==='GET'){
      if(!env.PHOTOS)return json({photos:[],storageEnabled:false});
      const rows=await env.DB.prepare('SELECT id,date,pose,content_type AS contentType,bytes FROM progress_photos WHERE owner=? ORDER BY date DESC').bind(owner).all();
      return json({photos:rows.results,storageEnabled:true});
    }
    if(url.pathname==='/api/photos' && request.method==='POST'){
      if(!env.PHOTOS)return json({error:'Private R2 photo storage is not enabled'},503);
      const len=Number(request.headers.get('content-length')||0);
      if(len>12*1024*1024)return json({error:'Image exceeds 12 MB request limit'},413);
      const type=(request.headers.get('content-type')||'').split(';')[0].toLowerCase();
      if(!['image/jpeg','image/png','image/webp'].includes(type))return json({error:'Upload a JPEG, PNG or WebP image'},415);
      const date=url.searchParams.get('date')||'';
      const pose=url.searchParams.get('pose')||'';
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !['front','side','back','other'].includes(pose))return json({error:'Valid photo date and pose required'},400);
      const bytes=await request.arrayBuffer();
      if(bytes.byteLength===0 || bytes.byteLength>10*1024*1024)return json({error:'File must be 10 MB or smaller'},413);
      const magic=new Uint8Array(bytes.slice(0,12));
      const jpeg=magic[0]===255&&magic[1]===216&&magic[2]===255;
      const png=magic[0]===137&&magic[1]===80&&magic[2]===78&&magic[3]===71;
      const webp=String.fromCharCode(...magic.slice(0,4))==='RIFF'&&String.fromCharCode(...magic.slice(8,12))==='WEBP';
      if(!((type==='image/jpeg'&&jpeg)||(type==='image/png'&&png)||(type==='image/webp'&&webp)))return json({error:'Image format does not match file contents'},415);
      const ownerHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner)))).map(x=>x.toString(16).padStart(2,'0')).join('');
      const photoId=crypto.randomUUID();
      const ext=type==='image/jpeg'?'jpg':type==='image/png'?'png':'webp';
      const objectKey=ownerHash+'/'+photoId+'.'+ext;
      try{
        await env.PHOTOS.put(objectKey,bytes,{httpMetadata:{contentType:type}});
        await preservePhoto(env,owner,{id:photoId,date,pose,object_key:objectKey,content_type:type,bytes:bytes.byteLength});
        await env.DB.prepare('INSERT INTO progress_photos(owner,id,date,pose,object_key,content_type,bytes) VALUES(?,?,?,?,?,?,?)').bind(owner,photoId,date,pose,objectKey,type,bytes.byteLength).run();
        return json({id:photoId,ok:true},201);
      }catch{
        await env.PHOTOS.delete(objectKey).catch(()=>{});
        return json({error:'Unable to store photo'},500);
      }
    }
    if(url.pathname.startsWith('/api/photos/')){
      if(!env.PHOTOS)return json({error:'Photo storage is not enabled'},503);
      const photoId=url.pathname.slice('/api/photos/'.length);
      if(!/^[0-9a-f-]{36}$/i.test(photoId))return json({error:'Invalid photo id'},400);
      const photo=await env.DB.prepare('SELECT object_key AS objectKey,content_type AS contentType FROM progress_photos WHERE owner=? AND id=?').bind(owner,photoId).first<{objectKey:string,contentType:string}>();
      if(!photo)return json({error:'Photo not found'},404);
      if(request.method==='GET'){
        const object=await env.PHOTOS.get(photo.objectKey);
        if(!object)return json({error:'Photo not found'},404);
        return new Response(object.body,{headers:{'Content-Type':photo.contentType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
      }
      if(request.method==='DELETE'){
        const photoMetadata=await env.DB.prepare('SELECT id,date,pose,object_key,content_type,bytes FROM progress_photos WHERE owner=? AND id=?').bind(owner,photoId).first<Record<string,string|number|null>>();
        if(!photoMetadata)return json({error:'Photo not found'},404);
        try{await preservePhoto(env,owner,photoMetadata);}catch{return json({error:'Photo backup failed; deletion blocked to protect your data'},503);}
        await env.PHOTOS.delete(photo.objectKey);
        await env.DB.prepare('DELETE FROM progress_photos WHERE owner=? AND id=?').bind(owner,photoId).run();
        return json({ok:true});
      }
      return json({error:'Method not allowed'},405);
    }
    if(url.pathname==='/api/muscles'){
      const result=await muscleRoutes(request,env,owner);
      if(result)return result;
    }
    if(url.pathname.startsWith('/api/hevy')){
      const reply=await hevyRoutes(request,env,owner);
      if(reply)return reply;
    }
    if(url.pathname.startsWith('/api/prep')){
      const answer=await prepRoutes(request,env,owner);
      if(answer)return answer;
    }
    if(url.pathname.startsWith('/api/backups')){
      if(!env.BACKUPS)return json({error:'Backup storage is not configured'},503);
      const reply=await backupRoutes(request,env,owner);
      if(reply)return reply;
    }
    if (url.pathname === '/api/health' && request.method === 'GET') return json({status:'ok',database:'configured'});
    if (url.pathname === '/api/state') {
      if (request.method === 'GET') {
        try { return json(await getState(env.DB,owner)); }
        catch { return json({error:'Unable to read saved data'},500); }
      }
      if (request.method === 'PUT') return saveState(request,env.DB,owner);
      return json({error:'Method not allowed'},405);
    }
    return json({error:'Not found'},404);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if(!env.DB||!env.PHOTOS||!env.BACKUPS)throw Error('Backup services are not configured');
    if(_controller.cron==='17 */6 * * *') ctx.waitUntil(scheduledHevySync(env));
    else ctx.waitUntil(scheduledBackup(env));
  }
};
