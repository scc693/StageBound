import type {HevyWorkout} from './HevyPanel';

export const MUSCLES=['Chest','Back','Front delts','Side delts','Rear delts','Biceps','Triceps','Quads','Hamstrings','Glutes','Calves','Abs','Other'] as const;
export type Muscle=typeof MUSCLES[number];
export type Mapping={exerciseKey:string,exerciseName:string,primaryMuscle:Muscle,secondaryMuscle:string|null};
export type SetRow={workoutId:string,workoutTitle:string,date:string,exerciseKey:string,exerciseName:string,type:string,reps:number|null,weightKg:number|null,rpe:number|null,index:number,exerciseIndex:number};
export type Week={start:string,workouts:number,workingSets:number,unassignedSets:number,groups:Record<string,number>,exerciseCount:number};
export const monday=(date:string)=>{
 const dt=new Date(date+'T12:00:00');
 const offset=(dt.getDay()+6)%7;dt.setDate(dt.getDate()-offset);
 const y=dt.getFullYear(),m=String(dt.getMonth()+1).padStart(2,'0'),d=String(dt.getDate()).padStart(2,'0');
 return y+'-'+m+'-'+d;
};
export const fmt=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
export const exerciseKey=(e:{exercise_template_id?:string,title?:string})=>e.exercise_template_id?.trim()?'hevy:'+e.exercise_template_id:'name:'+(e.title||'Unnamed exercise').trim().toLowerCase();
export function flatten(workouts:HevyWorkout[]):SetRow[]{
 const output:SetRow[]=[];const seen=new Set<string>();
 for(const w of workouts){
  if(!w.id||!w.start_time||seen.has(w.id))continue;seen.add(w.id);
  for(const [exerciseIndex,e] of (w.exercises||[]).entries()){
   const key=exerciseKey(e);
   for(const [index,s] of (e.sets||[]).entries()){
    if(s.type==='warmup')continue;
    const reps=typeof s.reps==='number'&&Number.isFinite(s.reps)&&s.reps>0?s.reps:null;
    const weightKg=typeof s.weight_kg==='number'&&Number.isFinite(s.weight_kg)&&s.weight_kg>=0?s.weight_kg:null;
    // Duration-only and distance-only sets are excluded from hypertrophy set counts.
    if(reps===null)continue;
    output.push({workoutId:w.id,workoutTitle:w.title||'Workout',date:w.start_time.slice(0,10),exerciseKey:key,exerciseName:e.title||'Unnamed exercise',type:s.type||'normal',reps,weightKg,rpe:typeof s.rpe==='number'&&Number.isFinite(s.rpe)?s.rpe:null,index,exerciseIndex});
   }
  }
 }
 return output;
}
export function weeks(workouts:HevyWorkout[],rows:SetRow[],assignments:Mapping[]):Week[]{
 const mapped=new Map(assignments.map(x=>[x.exerciseKey,x.primaryMuscle]));
 const grouped=new Map<string,Week>();
 const ensure=(start:string):Week=>{
  const previous=grouped.get(start);
  if(previous)return previous;
  const next:Week={start,workouts:0,workingSets:0,unassignedSets:0,groups:{},exerciseCount:0};
  grouped.set(start,next);return next;
 };
 const seen=new Set<string>();
 for(const w of workouts){
  if(!w.id||!w.start_time||seen.has(w.id))continue;seen.add(w.id);
  ensure(monday(w.start_time.slice(0,10))).workouts++;
 }
 const exerciseCounts=new Map<string,Set<string>>();
 for(const row of rows){
  const start=monday(row.date),week=ensure(start);
  week.workingSets++;
  const muscle=mapped.get(row.exerciseKey);
  if(muscle)week.groups[muscle]=(week.groups[muscle]||0)+1;else week.unassignedSets++;
  if(!exerciseCounts.has(start))exerciseCounts.set(start,new Set());
  exerciseCounts.get(start)!.add(row.exerciseKey);
 }
 for(const [k,v] of exerciseCounts)grouped.get(k)!.exerciseCount=v.size;
 return [...grouped.values()].sort((a,b)=>b.start.localeCompare(a.start));
}
export type ProgressPoint={date:string,weightKg:number,reps:number,e1rmKg:number|null,workoutId:string};
export function progression(rows:SetRow[],key:string):ProgressPoint[]{
 const byDay=new Map<string,ProgressPoint>();
 const candidates=rows.filter(r=>r.exerciseKey===key&&r.weightKg!==null&&r.weightKg>0&&r.reps!==null);
 for(const r of candidates){
  // Epley is a rough proxy only for 1–10 repetitions and external resistance.
  const e1rm=r.reps!>=1&&r.reps!<=10?r.weightKg!*(1+r.reps!/30):null;
  const candidate:ProgressPoint={date:r.date,weightKg:r.weightKg!,reps:r.reps!,e1rmKg:e1rm,workoutId:r.workoutId};
  const previous=byDay.get(r.date);
  if(!previous||(candidate.e1rmKg??candidate.weightKg)>(previous.e1rmKg??previous.weightKg))byDay.set(r.date,candidate);
 }
 return [...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export function suggested(name:string):Muscle|''{
 const n=name.toLowerCase();
 const rules:[RegExp,Muscle][]=[
  [/calf|soleus|gastrocnemius/,'Calves'],
  [/leg curl|hamstring curl|nordic|stiff.leg|romanian deadlift|rdl/,'Hamstrings'],
  [/leg extension|squat|hack squat|leg press|lunge|split squat/,'Quads'],
  [/hip thrust|glute bridge|kickback|hip abduction/,'Glutes'],
  [/rear delt|reverse pec deck|face pull|reverse fly/,'Rear delts'],
  [/lateral raise|side raise/,'Side delts'],
  [/front raise|shoulder press|overhead press|military press/,'Front delts'],
  [/tricep|pushdown|skull crusher|overhead extension/,'Triceps'],
  [/bicep|preacher curl|hammer curl|incline curl|concentration curl/,'Biceps'],
  [/pulldown|pull.up|chin.up|seated row|cable row|t.bar row|chest.supported row|lat pull|high row/,'Back'],
  [/bench press|chest press|pec deck|chest fly|chest dip|incline press/,'Chest'],
  [/ab crunch|cable crunch|sit.up|plank|ab rollout|hanging leg raise/,'Abs'],
 ];
 return rules.find(([rule])=>rule.test(n))?.[1]||'';
}
export const lbs=(kg:number)=>Math.round(kg*2.2046226218*10)/10;
