import HevyPanel, {loadHevy,type HevyData} from './HevyPanel';
import {useEffect,useMemo,useState} from 'react';
import {Activity,CalendarDays,Check,ChevronDown,Dumbbell,Flame,Plus,Target,Trash2,TrendingUp} from 'lucide-react';
type S={id:string,date:string,focus:string,duration:number|null,recovery:number|null,effort:number|null,notes:string};
type E={id:string,sessionId:string,exercise:string,sets:number,reps:number,load:number,rpe:number|null,notes:string};
type N={date:string,calories:number|null,protein:number|null,carbs:number|null,fat:number|null,adherence:number|null,notes:string};
type T={calories:number|null,protein:number|null,carbs:number|null,fat:number|null,weeklyTrainingTarget:number|null};
type P={id:string,title:string,startDate:string,endDate:string,phase:string,notes:string};
type Data={sessions:S[],sets:E[],days:N[],phases:P[],targets:T};
const iso=()=>new Date().toLocaleDateString('en-CA');
const uid=()=>crypto.randomUUID();
const monday=(d:string)=>{const x=new Date(d+'T12:00:00');const shift=(x.getDay()+6)%7;x.setDate(x.getDate()-shift);return x.toLocaleDateString('en-CA')};
const fmt=(s:string)=>new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const round=(n:number,places=0)=>Number(n.toFixed(places));
const blankS=():S=>({id:uid(),date:iso(),focus:'',duration:null,recovery:null,effort:null,notes:''});
const blankE=(sessionId:string):E=>({id:uid(),sessionId,exercise:'',sets:3,reps:10,load:0,rpe:null,notes:''});
const blankN=():N=>({date:iso(),calories:null,protein:null,carbs:null,fat:null,adherence:null,notes:''});
const blankP=():P=>({id:uid(),title:'',startDate:iso(),endDate:iso(),phase:'Improvement',notes:''});
const zeroT:T={calories:null,protein:null,carbs:null,fat:null,weeklyTrainingTarget:null};
const num=(v:string)=>v===''?null:Number(v);
async function call(method:'GET'|'POST'|'DELETE',path:string,value?:unknown):Promise<any>{
 const r=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:value?{'Content-Type':'application/json'}:undefined,body:value?JSON.stringify(value):undefined});
 const result:any=await r.json();if(!r.ok)throw new Error(result.error||'Server returned '+r.status);return result;
}
function Num({name,value,onChange,min=0,max=10000,step=1,placeholder}:{name:string,value:number|null,onChange:(v:number|null)=>void,min?:number,max?:number,step?:number,placeholder?:string}){
 return <label>{name}<input type="number" min={min} max={max} step={step} placeholder={placeholder||'Optional'} value={value??''} onChange={e=>onChange(num(e.target.value))}/></label>;
}
function Trend({values,unit}:{values:{date:string,value:number}[],unit:string}){
 const arr=values.filter(x=>Number.isFinite(x.value)&&x.value>0).sort((a,b)=>a.date.localeCompare(b.date)).slice(-18);
 if(arr.length<2)return <div className="empty compact">Add two entries to reveal a trend.</div>;
 const min=Math.min(...arr.map(x=>x.value)),max=Math.max(...arr.map(x=>x.value)),margin=Math.max((max-min)*.13,1);
 const points=arr.map((x,i)=>[25+i*550/(arr.length-1),15+(max+margin-x.value)*120/(max-min+2*margin)]);
 return <div className="prep-chart"><svg role="img" aria-label="Progress trend" viewBox="0 0 600 170">
  {[0,1,2].map(k=><line key={k} x1="25" y1={15+k*60} x2="580" y2={15+k*60} stroke="#3c4a60" strokeDasharray="4 5"/>)}
  <polyline fill="none" stroke="#e5b37f" strokeWidth="3" points={points.map(p=>p.join(',')).join(' ')}/>
  {points.map((p,i)=><circle key={i} fill="#e5b37f" r="4" cx={p[0]} cy={p[1]}><title>{fmt(arr[i].date)}: {arr[i].value} {unit}</title></circle>)}
  <text x="25" y="160" fontSize="12" fill="#a2afc2">{fmt(arr[0].date)}</text><text x="580" y="160" textAnchor="end" fontSize="12" fill="#a2afc2">{fmt(arr[arr.length-1].date)}</text>
 </svg></div>;
}
function MacroTrack({name,value,target}:{name:string,value:number|null,target:number|null}){
 const percent=target&&value!=null?Math.round(100*value/target):null;
 return <div className="macro-track"><div><strong>{name}</strong><span>{value==null?'—':round(value)}{target!=null?' / '+target:''} g</span></div><div className="macro-bar"><span style={{width:(percent===null?0:Math.min(100,percent))+'%'}}/></div></div>;
}
export default function Preparation({goToCheckin,goToPhysique}:{goToCheckin:()=>void,goToPhysique:()=>void}){
 const [hevy,setHevy]=useState<HevyData|null>(null);
 const reloadHevy=async()=>{setHevy(await loadHevy())};
 const [context,setContext]=useState<{weight:string,bf:string,checkinDate:string,photos:number,measureDate:string}>({weight:'',bf:'',checkinDate:'',photos:0,measureDate:''});
 const [data,setData]=useState<Data|null>(null),[tab,setTab]=useState<'training'|'nutrition'|'review'|'timeline'>('review'),[error,setError]=useState(''),[working,setWorking]=useState(false),[status,setStatus]=useState('');
 const [session,setSession]=useState<S>(blankS()),[showSession,setShowSession]=useState(false),[currentSession,setCurrentSession]=useState(''),[exercise,setExercise]=useState<E>(blankE('')),[showExercise,setShowExercise]=useState(false);
 const [day,setDay]=useState<N>(blankN()),[targets,setTargets]=useState<T>(zeroT),[phase,setPhase]=useState<P>(blankP()),[showPhase,setShowPhase]=useState(false),[selectedExercise,setSelectedExercise]=useState('');
 const reload=async()=>{const x=await call('GET','/api/prep');setData({sessions:x.sessions||[],sets:x.sets||[],days:x.days||[],phases:x.phases||[],targets:x.targets||zeroT});setTargets(x.targets||zeroT);setStatus('Saved securely in D1')};
 useEffect(()=>{
  reload().catch(e=>setError(String(e)));
  reloadHevy().catch(()=>{});
  Promise.all([call('GET','/api/state'),call('GET','/api/photos'),call('GET','/api/measurements')]).then(([state,photos,measurements])=>{
    const latest=[...(state.checkins||[])].sort((a:any,b:any)=>b.date.localeCompare(a.date))[0];
    const measured=[...(measurements.measurements||[])].sort((a:any,b:any)=>b.date.localeCompare(a.date))[0];
    setContext({weight:latest?.weight||'',bf:latest?.bf||'',checkinDate:latest?.date||'',photos:(photos.photos||[]).length,measureDate:measured?.date||''});
  }).catch(()=>{});
},[]);
 const apply=async(kind:string,value:unknown,after?:()=>void)=>{
  setWorking(true);setError('');setStatus('Saving…');
  try{await call('POST','/api/prep',{kind,value});await reload();after?.()}catch(e){setError(String(e));setStatus('Save failed')}finally{setWorking(false)}
 };
 const remove=async(kind:string,id:string)=>{
  if(!confirm('Delete this entry?'))return;
  setWorking(true);setError('');
  try{await call('DELETE','/api/prep?kind='+kind+'&id='+encodeURIComponent(id));await reload()}catch(e){setError(String(e))}finally{setWorking(false)}
 };
 const sessions=data?.sessions||[],sets=data?.sets||[],days=data?.days||[],phases=data?.phases||[];
 const hevySessions:S[]=(hevy?.workouts||[]).filter(w=>w.id&&w.start_time).map(w=>({
   id:'hevy_'+w.id,date:w.start_time.slice(0,10),focus:w.title||'Hevy workout',
   duration:w.end_time?Math.max(0,Math.round((Date.parse(w.end_time)-Date.parse(w.start_time))/60000)):null,
   recovery:null,effort:null,notes:'Imported from Hevy'
 }));
 const hevySets:E[]=(hevy?.workouts||[]).flatMap(w=>(w.exercises||[]).flatMap((ex,idx)=>{
   const working=(ex.sets||[]).filter(x=>x.type!=='warmup'&&Number.isFinite(x.reps)&&x.reps!=null&&x.reps>0);
   if(!working.length)return [];
   const top=[...working].sort((a,b)=>(b.weight_kg||0)-(a.weight_kg||0))[0];
   return [{id:'hevy_'+w.id+'_'+idx,sessionId:'hevy_'+w.id,exercise:ex.title||ex.exercise_template_id||'Exercise',sets:working.length,reps:top.reps||0,load:round((top.weight_kg||0)*2.2046226218,1),rpe:top.rpe??null,notes:'Hevy working sets, top logged load'}];
 }));
 const allSessions=[...sessions,...hevySessions];
 const allSets=[...sets,...hevySets];
 const week=monday(iso());
 const weekSessions=allSessions.filter(s=>monday(s.date)===week),weekDays=days.filter(d=>monday(d.date)===week);
 const averages=useMemo(()=>{
  const avg=(key:'calories'|'protein'|'carbs'|'fat')=>{const xs=weekDays.map(x=>x[key]).filter((v):v is number=>v!=null);return xs.length?round(xs.reduce((a,b)=>a+b,0)/xs.length):null};
  return {calories:avg('calories'),protein:avg('protein'),carbs:avg('carbs'),fat:avg('fat')};
 },[days]);
 const totalSetCount=weekSessions.reduce((a,s)=>a+allSets.filter(e=>e.sessionId===s.id).reduce((z,e)=>z+e.sets,0),0);
 const focusedExerciseNames=[...new Set(allSets.map(e=>e.exercise))].sort();
 const progression=allSets.filter(e=>e.exercise===selectedExercise).map(e=>({date:allSessions.find(s=>s.id===e.sessionId)?.date||'',value:e.load,sets:e.sets,reps:e.reps})).filter(e=>e.date);
 const thisWeekAdherence=weekDays.map(d=>d.adherence).filter((x):x is number=>x!=null);
 const adherence=thisWeekAdherence.length?round(thisWeekAdherence.reduce((a,b)=>a+b,0)/thisWeekAdherence.length,1):null;
 const label=(n:number|null,suffix='')=>n==null?'—':round(n,1)+suffix;
 return <div>
  <div className="pagehead"><div><div className="eyebrow">PREP EXECUTION</div><h1>Training & nutrition<span className="punct">.</span></h1><p className="muted">Record the minimum useful data. Review the trend, then adjust.</p></div></div>
  <div className="prep-tabs" role="tablist">{(['review','training','nutrition','timeline'] as const).map(t=><button key={t} role="tab" aria-selected={tab===t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t==='review'?'Weekly review':t==='training'?'Training':t==='nutrition'?'Nutrition':'Prep timeline'}</button>)}</div>
  {error&&<div role="alert" className="photo-error">{error}<button type="button" onClick={()=>setError('')}>Dismiss</button></div>}
  <p className="muted tiny">{status||'Connecting to private database…'}</p>
  {data&&tab==='review'&&<>
   <div className="panel"><div className="panelhead"><div><div className="eyebrow">CURRENT WEEK · {fmt(week)}</div><h2>Preparation check-in</h2></div><span className="pill estimated">Incomplete days stay blank</span></div>
   <div className="prep-metrics">
    <div><small>TRAINING SESSIONS</small><strong>{weekSessions.length}{data.targets.weeklyTrainingTarget!=null?<em> / {data.targets.weeklyTrainingTarget}</em>:''}</strong></div>
    <div><small>WORKING SETS</small><strong>{totalSetCount}</strong></div>
    <div><small>LOGGED NUTRITION DAYS</small><strong>{weekDays.length}<em> / 7</em></strong></div>
    <div><small>CALORIES / LOGGED DAY</small><strong>{label(averages.calories)}</strong></div>
    <div><small>PROTEIN / LOGGED DAY</small><strong>{label(averages.protein,' g')}</strong></div>
    <div><small>ADHERENCE / 5</small><strong>{label(adherence)}</strong></div>
   </div>
   <p className="muted tiny">Averages include only days with entries; missing days are not treated as zero. Set totals are based on logged sets, not automatically imported from a workout tracker.</p>
   <div className="prep-quick"><button className="button" onClick={()=>{setTab('training');setSession(blankS());setShowSession(true)}}><Plus size={16}/> Record session</button><button className="button secondary" onClick={()=>{setTab('nutrition');setDay(blankN())}}><Plus size={16}/> Log nutrition</button></div>
   </div>
   <div className="prep-columns"><section className="panel"><div className="panelhead"><h2>Training this week</h2><Dumbbell size={19}/></div>{weekSessions.length?weekSessions.map(s=><div key={s.id} className="entry"><div><strong>{fmt(s.date)} · {s.focus||'Training'}</strong><span>{allSets.filter(e=>e.sessionId===s.id).length} exercises · {s.duration??'—'} min</span></div></div>):<div className="empty compact">No logged workouts yet. Connect Hevy or add a manual session.</div>}</section><section className="panel"><div className="panelhead"><h2>Average macro intake</h2><Flame size={19}/></div><MacroTrack name="Protein" value={averages.protein} target={targets.protein}/><MacroTrack name="Carbs" value={averages.carbs} target={targets.carbs}/><MacroTrack name="Fat" value={averages.fat} target={targets.fat}/></section></div>
   <section className="panel"><div className="panelhead"><h2>Training load trend</h2><select aria-label="Select exercise" className="trend-select" value={selectedExercise} onChange={e=>setSelectedExercise(e.target.value)}><option value="">Choose exercise</option>{focusedExerciseNames.map(n=><option key={n} value={n}>{n}</option>)}</select></div>{selectedExercise?<Trend values={progression} unit="lb"/>:<div className="empty compact">Choose a logged exercise to compare load across sessions. Load alone doesn't measure total training volume.</div>}</section>
   <section className="panel"><div className="panelhead"><h2>Body composition & check-in</h2><Activity size={20}/></div><div className="prep-metrics"><div><small>LATEST CHECK-IN WEIGHT</small><strong>{context.weight?context.weight+" lb":"—"}</strong></div><div><small>BODY FAT ESTIMATE</small><strong>{context.bf?context.bf+"%":"—"}</strong></div><div><small>PROGRESS PHOTOS</small><strong>{context.photos}</strong></div></div><p className="muted tiny">Latest weekly check-in: {context.checkinDate?fmt(context.checkinDate):"Not recorded"} · Last body measurements: {context.measureDate?fmt(context.measureDate):"Not recorded"}. Training and nutrition are summarized above, while posing, cardio, and adjustments remain in your weekly check-in.</p><div className="prep-quick"><button className="button secondary" onClick={goToCheckin}>Open weekly check-in</button><button className="button secondary" onClick={goToPhysique}>Open physique tracking</button></div></section>
  </>}
  {data&&tab==='training'&&<>
   <HevyPanel info={hevy} onRefresh={reloadHevy}/>
   <section className="panel"><div className="panelhead"><h2>Workout sessions</h2><button className="button" onClick={()=>{setSession(blankS());setShowSession(!showSession)}}><Plus size={16}/> Add session</button></div>
   {showSession&&<div className="prep-form"><div className="formgrid"><label>Date<input type="date" value={session.date} onChange={e=>setSession({...session,date:e.target.value})}/></label><label>Focus<input placeholder="Pull · Lower · Push …" value={session.focus} onChange={e=>setSession({...session,focus:e.target.value})}/></label><Num name="Duration (min)" value={session.duration} onChange={duration=>setSession({...session,duration})} max={600}/><Num name="Recovery (1 poor–5 good)" value={session.recovery} min={1} max={5} onChange={recovery=>setSession({...session,recovery})}/><Num name="Effort (1–10)" value={session.effort} min={1} max={10} onChange={effort=>setSession({...session,effort})}/><label className="wide">Notes<textarea value={session.notes} rows={3} onChange={e=>setSession({...session,notes:e.target.value})}/></label></div><div className="actions"><button className="button" disabled={working} onClick={()=>apply('session',session,()=>setShowSession(false))}>Save session</button><button className="button secondary" onClick={()=>setShowSession(false)}>Cancel</button></div></div>}
   {sessions.length?sessions.slice(0,60).map(s=><div key={s.id} className="prep-session"><div className="prep-session-heading"><button className="prep-expand" onClick={()=>{setCurrentSession(currentSession===s.id?'':s.id);setExercise(blankE(s.id));setShowExercise(false)}}><ChevronDown size={16}/><strong>{fmt(s.date)} · {s.focus||'Training'}</strong><span>{sets.filter(x=>x.sessionId===s.id).reduce((a,b)=>a+b.sets,0)} logged sets</span></button><button className="textbutton" onClick={()=>{setSession(s);setShowSession(true)}}>Edit</button><button aria-label="Delete session" className="iconbutton" onClick={()=>remove('session',s.id)}><Trash2 size={16}/></button></div>
    {currentSession===s.id&&<div className="prep-expanded">{sets.filter(x=>x.sessionId===s.id).map(x=><div key={x.id} className="prep-exercise"><div><strong>{x.exercise}</strong><small>{x.sets} × {x.reps} @ {x.load} lb {x.rpe?' · RPE '+x.rpe:''}</small></div><button className="textbutton" onClick={()=>{setExercise(x);setShowExercise(true)}}>Edit</button><button className="iconbutton" aria-label="Delete exercise" onClick={()=>remove('set',x.id)}><Trash2 size={16}/></button></div>)}
     <button className="textbutton" onClick={()=>{setExercise(blankE(s.id));setShowExercise(true)}}><Plus size={15}/> Log exercise</button>
     {showExercise&&<div className="prep-form"><div className="formgrid"><label>Exercise<input placeholder="Neutral grip pulldown" value={exercise.exercise} onChange={e=>setExercise({...exercise,exercise:e.target.value})}/></label><Num name="Working sets" min={1} max={30} value={exercise.sets} onChange={sets=>setExercise({...exercise,sets:sets??1})}/><Num name="Reps / set" min={1} max={100} value={exercise.reps} onChange={reps=>setExercise({...exercise,reps:reps??1})}/><Num name="Load (lb)" max={2000} step={.5} value={exercise.load} onChange={load=>setExercise({...exercise,load:load??0})}/><Num name="RPE (optional)" min={1} max={10} step={.5} value={exercise.rpe} onChange={rpe=>setExercise({...exercise,rpe})}/><label>Notes<input value={exercise.notes} onChange={e=>setExercise({...exercise,notes:e.target.value})}/></label></div><div className="actions"><button className="button" disabled={working||!exercise.exercise.trim()} onClick={()=>apply('set',exercise,()=>setShowExercise(false))}>Save exercise</button><button className="button secondary" onClick={()=>setShowExercise(false)}>Cancel</button></div></div>}
    </div>}</div>):<div className="empty compact">No workouts tracked. Add a session to begin.</div>}
   </section>
   {hevy?.connected&&<section className="panel"><div className="panelhead"><h2>Imported Hevy workouts</h2><span className="muted tiny">Source: Hevy, read-only</span></div>{hevySessions.length?hevySessions.slice(0,35).map(x=><div key={x.id} className="entry"><div><strong>{fmt(x.date)} · {x.focus}</strong><span>{hevySets.filter(e=>e.sessionId===x.id).reduce((total,e)=>total+e.sets,0)} working sets · {x.duration??'—'} min</span></div></div>):<div className="empty compact">Connected. Select “Sync latest” above to import workouts.</div>}</section>}
   <section className="panel"><div className="panelhead"><h2>Exercise progression</h2><select aria-label="Exercise to chart" className="trend-select" value={selectedExercise} onChange={e=>setSelectedExercise(e.target.value)}><option value="">Choose exercise</option>{focusedExerciseNames.map(n=><option key={n} value={n}>{n}</option>)}</select></div>{selectedExercise?<><Trend values={progression} unit="lb"/><p className="muted tiny">Compare sets and reps alongside load. A heavier weight with different repetitions is not necessarily a performance improvement.</p></>:<div className="empty compact">Log or import the same exercise across two training days to chart load.</div>}</section>
  </>}
  {data&&tab==='nutrition'&&<>
   <section className="panel"><div className="panelhead"><div><div className="eyebrow">EDITABLE TARGETS</div><h2>Nutrition goals</h2></div></div><div className="formgrid"><Num name="Calories / day" value={targets.calories} onChange={calories=>setTargets({...targets,calories})}/><Num name="Protein (g)" value={targets.protein} onChange={protein=>setTargets({...targets,protein})}/><Num name="Carbs (g)" value={targets.carbs} onChange={carbs=>setTargets({...targets,carbs})}/><Num name="Fat (g)" value={targets.fat} onChange={fat=>setTargets({...targets,fat})}/><Num name="Training days / week" min={0} max={14} value={targets.weeklyTrainingTarget} onChange={weeklyTrainingTarget=>setTargets({...targets,weeklyTrainingTarget})}/></div><div className="actions"><button className="button" disabled={working} onClick={()=>apply('targets',targets)}>Save targets</button></div><p className="muted tiny">Targets are manually set; Stagebound does not prescribe calorie intake or competition weight caps.</p></section>
   <section className="panel"><div className="panelhead"><h2>Daily intake</h2><span className="muted tiny">One entry per date</span></div><div className="formgrid"><label>Date<input type="date" value={day.date} onChange={e=>setDay({...day,date:e.target.value})}/></label><Num name="Calories (kcal)" value={day.calories} onChange={calories=>setDay({...day,calories})}/><Num name="Protein (g)" value={day.protein} onChange={protein=>setDay({...day,protein})}/><Num name="Carbs (g)" value={day.carbs} onChange={carbs=>setDay({...day,carbs})}/><Num name="Fat (g)" value={day.fat} onChange={fat=>setDay({...day,fat})}/><Num name="Adherence (1–5)" min={1} max={5} value={day.adherence} onChange={adherence=>setDay({...day,adherence})}/><label className="wide">Notes<textarea rows={3} value={day.notes} onChange={e=>setDay({...day,notes:e.target.value})}/></label></div><div className="actions"><button className="button" disabled={working} onClick={()=>apply('day',day,()=>setDay(blankN()))}>Save nutrition day</button></div></section>
   <section className="panel"><div className="panelhead"><h2>Nutrition history</h2></div>{days.length?<div className="tablewrap"><table><thead><tr><th>Date</th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th><th></th></tr></thead><tbody>{days.slice(0,40).map(n=><tr key={n.date}><td>{fmt(n.date)}</td><td>{label(n.calories)}</td><td>{label(n.protein)}</td><td>{label(n.carbs)}</td><td>{label(n.fat)}</td><td><button className="textbutton" onClick={()=>{setDay(n);window.scrollTo({top:0,behavior:'smooth'})}}>Edit</button><button aria-label="Delete nutrition" className="iconbutton" onClick={()=>remove('day',n.date)}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div>:<div className="empty compact">No nutrition days yet.</div>}</section><section className="panel"><div className="panelhead"><h2>Calorie trend</h2><TrendingUp size={18}/></div><Trend values={days.filter(n=>n.calories!=null).map(n=>({date:n.date,value:n.calories!}))} unit="kcal"/></section>
  </>}
  {data&&tab==='timeline'&&<>
   <section className="panel"><div className="panelhead"><div><h2>Preparation phases</h2><p className="muted tiny">Flexible dates. These phases are plans, not automatically verified competitions.</p></div><button className="button" onClick={()=>{setPhase(blankP());setShowPhase(true)}}><Plus size={16}/> Add phase</button></div>
   {showPhase&&<div className="prep-form"><div className="formgrid"><label>Phase title<input placeholder="Offseason development" value={phase.title} onChange={e=>setPhase({...phase,title:e.target.value})}/></label><label>Type<select value={phase.phase} onChange={e=>setPhase({...phase,phase:e.target.value})}>{['Improvement','Cutting','Maintenance','Posing','Show week','Other'].map(x=><option key={x}>{x}</option>)}</select></label><label>Start<input type="date" value={phase.startDate} onChange={e=>setPhase({...phase,startDate:e.target.value})}/></label><label>End<input type="date" value={phase.endDate} onChange={e=>setPhase({...phase,endDate:e.target.value})}/></label><label className="wide">Phase notes<textarea rows={3} value={phase.notes} onChange={e=>setPhase({...phase,notes:e.target.value})}/></label></div><div className="actions"><button className="button" disabled={working||!phase.title.trim()||phase.endDate<phase.startDate} onClick={()=>apply('phase',phase,()=>setShowPhase(false))}>Save phase</button><button className="button secondary" onClick={()=>setShowPhase(false)}>Cancel</button></div></div>}
   {phases.length?<div className="phase-stack">{phases.map(p=><div className="phase-row" key={p.id}><div className="phase-dot"/><div className="phase-detail"><strong>{p.title}</strong><span>{p.phase} · {fmt(p.startDate)} to {fmt(p.endDate)}</span>{p.notes&&<p>{p.notes}</p>}</div><button className="textbutton" onClick={()=>{setPhase(p);setShowPhase(true)}}>Edit</button><button className="iconbutton" aria-label="Delete phase" onClick={()=>remove('phase',p.id)}><Trash2 size={16}/></button></div>)}</div>:<div className="empty compact">No phases scheduled. You can start with an improvement phase; refine show-specific dates when organizers confirm them.</div>}
   </section>
  </>}
 </div>;
}
