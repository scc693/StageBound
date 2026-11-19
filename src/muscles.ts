/** Muscle group assignments are user-confirmed, not inferred from exercise titles on the server. */
export interface MapEnv {DB:D1Database}
const groups=['Chest','Back','Front delts','Side delts','Rear delts','Biceps','Triceps','Quads','Hamstrings','Glutes','Calves','Abs','Other'] as const;
const send=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function muscleRoutes(request:Request,env:MapEnv,owner:string):Promise<Response|null>{
 const url=new URL(request.url);
 if(url.pathname!=='/api/muscles')return null;
 if(request.method==='GET'){
  try{
   const x=await env.DB.prepare('SELECT exercise_key AS exerciseKey,exercise_name AS exerciseName,primary_muscle AS primaryMuscle,secondary_muscle AS secondaryMuscle FROM exercise_muscle_map WHERE owner=? ORDER BY exercise_name').bind(owner).all();
   return send({mappings:x.results,groups});
  }catch{return send({error:'Unable to load muscle assignments'},500)}
 }
 if(request.method==='PUT'){
  if(!(request.headers.get('content-type')||'').includes('application/json'))return send({error:'JSON expected'},415);
  const raw=await request.text();if(raw.length>3000)return send({error:'Payload too large'},413);
  let v:Record<string,unknown>;
  try{v=JSON.parse(raw)}catch{return send({error:'Invalid JSON'},400)}
  const key=v.exerciseKey,name=v.exerciseName,primary=v.primaryMuscle,secondary=v.secondaryMuscle;
  if(typeof key!=='string'||!key||key.length>180||typeof name!=='string'||!name.trim()||name.length>200||typeof primary!=='string'||!groups.includes(primary as typeof groups[number])||(secondary!=null&&(typeof secondary!=='string'||(secondary!==''&&!groups.includes(secondary as typeof groups[number])))))return send({error:'Invalid muscle assignment'},400);
  try{
   await env.DB.prepare('INSERT INTO exercise_muscle_map(owner,exercise_key,exercise_name,primary_muscle,secondary_muscle) VALUES(?,?,?,?,?) ON CONFLICT(owner,exercise_key) DO UPDATE SET exercise_name=excluded.exercise_name,primary_muscle=excluded.primary_muscle,secondary_muscle=excluded.secondary_muscle,updated_at=CURRENT_TIMESTAMP').bind(owner,key,name.trim(),primary,secondary||null).run();
   return send({ok:true});
  }catch{return send({error:'Unable to save assignment'},500)}
 }
 if(request.method==='DELETE'){
  const key=url.searchParams.get('exerciseKey');
  if(!key||key.length>180)return send({error:'Invalid exercise key'},400);
  await env.DB.prepare('DELETE FROM exercise_muscle_map WHERE owner=? AND exercise_key=?').bind(owner,key).run();
  return send({ok:true});
 }
 return send({error:'Method not allowed'},405);
}
