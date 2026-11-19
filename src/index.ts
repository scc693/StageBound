import { createRemoteJWKSet, jwtVerify } from 'jose';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: D1Database;
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
  }
};
