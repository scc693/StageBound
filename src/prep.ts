/** Authenticated Stagebound training, nutrition and prep plan API.
 * Owner is derived only from verified Cloudflare Access JWT in main Worker.
 * All D1 statements are parameterized; no API accepts an owner field.
 */
type DBEnv={DB:D1Database};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const str=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):'';
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'));
const num=(v:unknown,min:number,max:number)=>v==null||v===''?null:typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:NaN;
const idOK=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const integer=(v:unknown,min:number,max:number)=>{const x=num(v,min,max);return x===null||Number.isInteger(x)?x:NaN};
const okNums=(...v:(number|null)[])=>v.every(n=>n===null||Number.isFinite(n));
const read=async(db:D1Database,owner:string)=>{
 const [sessions,sets,days,plans,targets]=await db.batch([
  db.prepare('SELECT id,date,focus,duration,recovery,effort,notes FROM training_sessions WHERE owner=? ORDER BY date DESC').bind(owner),
  db.prepare('SELECT id,session_id AS sessionId,exercise,sets,reps,load,rpe,notes FROM exercise_sets WHERE owner=?').bind(owner),
  db.prepare('SELECT date,calories,protein,carbs,fat,adherence,notes FROM nutrition_days WHERE owner=? ORDER BY date DESC LIMIT 400').bind(owner),
  db.prepare('SELECT id,title,start_date AS startDate,end_date AS endDate,phase,notes FROM prep_plan WHERE owner=? ORDER BY start_date').bind(owner),
  db.prepare('SELECT calories,protein,carbs,fat,weekly_training_target AS weeklyTrainingTarget FROM nutrition_targets WHERE owner=?').bind(owner)
 ]);
 return {sessions:sessions.results,sets:sets.results,days:days.results,phases:plans.results,targets:targets.results[0]||{calories:null,protein:null,carbs:null,fat:null,weeklyTrainingTarget:null}};
};
async function save(db:D1Database,owner:string,data:any){
 const kind=str(data?.kind,30),v=data?.value;
 if(!v||typeof v!=='object')return reply({error:'Invalid record'},400);
 let q:D1PreparedStatement|undefined;
 if(kind==='session'){
  const duration=integer(v.duration,0,600),recovery=integer(v.recovery,1,5),effort=integer(v.effort,1,10);
  if(!idOK(v.id)||!date(v.date)||!okNums(duration,recovery,effort))return reply({error:'Invalid training session'},400);
  q=db.prepare('INSERT INTO training_sessions(owner,id,date,focus,duration,recovery,effort,notes) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET date=excluded.date,focus=excluded.focus,duration=excluded.duration,recovery=excluded.recovery,effort=excluded.effort,notes=excluded.notes')
    .bind(owner,v.id,v.date,str(v.focus,120),duration,recovery,effort,str(v.notes,3000));
 } else if(kind==='set'){
  const sets=integer(v.sets,1,30),reps=integer(v.reps,1,100),load=num(v.load,0,2000),rpe=num(v.rpe,1,10);
  if(!idOK(v.id)||!idOK(v.sessionId)||!str(v.exercise,160)||sets===null||reps===null||load===null||!okNums(sets,reps,load,rpe))return reply({error:'Invalid exercise entry'},400);
  const found=await db.prepare('SELECT 1 AS existsFlag FROM training_sessions WHERE owner=? AND id=?').bind(owner,v.sessionId).first();
  if(!found)return reply({error:'Session not found'},404);
  q=db.prepare('INSERT INTO exercise_sets(owner,id,session_id,exercise,sets,reps,load,rpe,notes) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET session_id=excluded.session_id,exercise=excluded.exercise,sets=excluded.sets,reps=excluded.reps,load=excluded.load,rpe=excluded.rpe,notes=excluded.notes')
   .bind(owner,v.id,v.sessionId,str(v.exercise,160),sets,reps,load,rpe,str(v.notes,1000));
 } else if(kind==='day'){
  const calories=integer(v.calories,0,10000),protein=num(v.protein,0,1000),carbs=num(v.carbs,0,1500),fat=num(v.fat,0,600),adherence=integer(v.adherence,1,5);
  if(!date(v.date)||!okNums(calories,protein,carbs,fat,adherence))return reply({error:'Invalid nutrition entry'},400);
  q=db.prepare('INSERT INTO nutrition_days(owner,date,calories,protein,carbs,fat,adherence,notes) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,date) DO UPDATE SET calories=excluded.calories,protein=excluded.protein,carbs=excluded.carbs,fat=excluded.fat,adherence=excluded.adherence,notes=excluded.notes')
    .bind(owner,v.date,calories,protein,carbs,fat,adherence,str(v.notes,2000));
 } else if(kind==='targets'){
  const calories=integer(v.calories,0,10000),protein=num(v.protein,0,1000),carbs=num(v.carbs,0,1500),fat=num(v.fat,0,600),weeklyTrainingTarget=integer(v.weeklyTrainingTarget,0,14);
  if(!okNums(calories,protein,carbs,fat,weeklyTrainingTarget))return reply({error:'Invalid targets'},400);
  q=db.prepare('INSERT INTO nutrition_targets(owner,calories,protein,carbs,fat,weekly_training_target) VALUES(?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET calories=excluded.calories,protein=excluded.protein,carbs=excluded.carbs,fat=excluded.fat,weekly_training_target=excluded.weekly_training_target')
    .bind(owner,calories,protein,carbs,fat,weeklyTrainingTarget);
 } else if(kind==='phase'){
  if(!idOK(v.id)||!str(v.title,200)||!date(v.startDate)||!date(v.endDate)||v.endDate<v.startDate)return reply({error:'Invalid preparation phase'},400);
  if(!['Improvement','Cutting','Maintenance','Posing','Show week','Other'].includes(v.phase))return reply({error:'Unknown phase type'},400);
  q=db.prepare('INSERT INTO prep_plan(owner,id,title,start_date,end_date,phase,notes) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET title=excluded.title,start_date=excluded.start_date,end_date=excluded.end_date,phase=excluded.phase,notes=excluded.notes')
    .bind(owner,v.id,str(v.title,200),v.startDate,v.endDate,v.phase,str(v.notes,2000));
 } else return reply({error:'Unknown record type'},400);
 await q.run();return reply({ok:true});
}
export async function prepRoutes(request:Request,env:DBEnv,owner:string):Promise<Response|null>{
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/api/prep'))return null;
 try{
  if(path==='/api/prep'&&request.method==='GET')return reply(await read(env.DB,owner));
  if(path==='/api/prep'&&request.method==='POST'){
   if(!(request.headers.get('content-type')||'').includes('application/json'))return reply({error:'JSON required'},415);
   if(Number(request.headers.get('content-length')||'0')>24000)return reply({error:'Payload too large'},413);
   const raw=await request.text();if(raw.length>24000)return reply({error:'Payload too large'},413);
   let body:any;try{body=JSON.parse(raw)}catch{return reply({error:'Malformed JSON'},400)}
   return await save(env.DB,owner,body);
  }
  if(path==='/api/prep'&&request.method==='DELETE'){
   const u=new URL(request.url),kind=u.searchParams.get('kind')||'',id=u.searchParams.get('id')||'';
   const allowed:{[k:string]:{table:string,column:string}}={session:{table:'training_sessions',column:'id'},set:{table:'exercise_sets',column:'id'},day:{table:'nutrition_days',column:'date'},phase:{table:'prep_plan',column:'id'}};
   if(!allowed[kind]||(kind==='day'?!date(id):!idOK(id)))return reply({error:'Invalid delete request'},400);
   const {table,column}=allowed[kind];
   if(kind==='session'){
    await env.DB.batch([env.DB.prepare('DELETE FROM exercise_sets WHERE owner=? AND session_id=?').bind(owner,id),env.DB.prepare('DELETE FROM training_sessions WHERE owner=? AND id=?').bind(owner,id)]);
   }else await env.DB.prepare('DELETE FROM '+table+' WHERE owner=? AND '+column+'=?').bind(owner,id).run();
   return reply({ok:true});
  }
  return reply({error:'Method not allowed'},405);
 }catch{return reply({error:'Preparation database operation failed'},500)}
}
