import {useEffect,useMemo,useState} from 'react';
import {BarChart3,CheckCircle2,ChevronDown,ClipboardList,Info,Save,TrendingUp} from 'lucide-react';
import type {HevyData} from './HevyPanel';
import {MUSCLES,flatten,weeks,progression,exerciseKey,suggested,lbs,monday,fmt,type Mapping,type Muscle} from './trainingAnalytics';

type ResponseBody={mappings:Mapping[],groups:string[]};
const getMappings=async():Promise<Mapping[]>=>{
 const r=await fetch('/api/muscles',{credentials:'same-origin',cache:'no-store'});
 if(!r.ok)throw new Error('Unable to load your exercise assignments');
 const x=await r.json() as ResponseBody;return x.mappings||[];
};
function Assignment({item,saved,onSave}:{item:{key:string,name:string,sets:number},saved?:Mapping,onSave:(key:string,name:string,muscle:Muscle)=>Promise<void>}){
 const hint=suggested(item.name);
 const [selection,setSelection]=useState<Muscle|''>(saved?.primaryMuscle||hint);
 const [busy,setBusy]=useState(false);
 useEffect(()=>setSelection(saved?.primaryMuscle||suggested(item.name)),[saved?.primaryMuscle,item.name]);
 return <div className="assign-row">
 <div className="assign-desc"><strong>{item.name}</strong><span>{item.sets} logged working sets · {saved?'Confirmed assignment':hint?'Suggested: '+hint+' (review before saving)':'Unassigned'}</span></div>
 <select aria-label={'Primary muscle for '+item.name} value={selection} onChange={e=>setSelection(e.target.value as Muscle|'')}><option value="">Choose group</option>{MUSCLES.map(x=><option key={x} value={x}>{x}</option>)}</select>
 <button className="button secondary" disabled={busy||!selection||selection===saved?.primaryMuscle} onClick={async()=>{setBusy(true);try{await onSave(item.key,item.name,selection as Muscle)}finally{setBusy(false)}}}><Save size={15}/> Save</button>
 </div>;
}
function MiniBars({entries}:{entries:{name:string,current:number,previous:number}[]}){
 const max=Math.max(1,...entries.map(e=>Math.max(e.current,e.previous)));
 return <div className="analytics-bars">{entries.map(e=><div className="analytics-bar-row" key={e.name}><strong>{e.name}</strong><div className="analytics-bar-tracks"><div title={'Current: '+e.current+' working sets'}><span style={{width:100*e.current/max+'%'}}/></div><div className="previous" title={'Previous: '+e.previous+' working sets'}><span style={{width:100*e.previous/max+'%'}}/></div></div><div className="analytics-count">{e.current}<small>{e.current!==e.previous?' ('+(e.current>e.previous?'+':'')+(e.current-e.previous)+')':''}</small></div></div>)}</div>;
}
export default function TrainingAnalytics({hevy,compact=false}:{hevy:HevyData|null,compact?:boolean}){
 const [mappings,setMappings]=useState<Mapping[]>([]),[problem,setProblem]=useState(''),[loaded,setLoaded]=useState(false),[showAssignments,setShowAssignments]=useState(false);
 const [exercise,setExercise]=useState('');
 const workouts=hevy?.workouts||[];
 const allRows=useMemo(()=>flatten(workouts),[workouts]);
 const history=useMemo(()=>weeks(workouts,allRows,mappings),[workouts,allRows,mappings]);
 const current=monday(new Date().toLocaleDateString('en-CA'));
 const datePrev=new Date(current+'T12:00:00');datePrev.setDate(datePrev.getDate()-7);
 const prev=monday(datePrev.toLocaleDateString('en-CA'));
 const thisWeek=history.find(x=>x.start===current);
 const prevWeek=history.find(x=>x.start===prev);
 const rowGroups=useMemo(()=>{
  const map=new Map<string,{key:string,name:string,sets:number}>();
  for(const row of allRows){const current=map.get(row.exerciseKey);if(current)current.sets++;else map.set(row.exerciseKey,{key:row.exerciseKey,name:row.exerciseName,sets:1})}
  return [...map.values()].sort((a,b)=>b.sets-a.sets);
 },[allRows]);
 const mapped=new Map(mappings.map(x=>[x.exerciseKey,x]));
 const unmapped=rowGroups.filter(x=>!mapped.has(x.key));
 const named=rowGroups.filter(x=>mapped.has(x.key));
 const combined=[...unmapped,...named].slice(0,200);
 const muscleData=MUSCLES.filter(x=>x!=='Other'||(thisWeek?.groups[x]||prevWeek?.groups[x])).map(name=>({name,current:thisWeek?.groups[name]||0,previous:prevWeek?.groups[name]||0})).filter(r=>r.current+r.previous>0);
 const trendHistory=[...history].reverse().slice(-8);
 const exerciseOptions=rowGroups.map(r=>({key:r.key,name:r.name}));
 const points=useMemo(()=>progression(allRows,exercise),[allRows,exercise]);
 const save=async(key:string,name:string,muscle:Muscle)=>{
  setProblem('');
  try{
   const r=await fetch('/api/muscles',{method:'PUT',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({exerciseKey:key,exerciseName:name,primaryMuscle:muscle})});
   if(!r.ok){const x=await r.json() as {error?:string};throw new Error(x.error||'Could not save assignment')}
   setMappings(await getMappings());
  }catch(e){setProblem(e instanceof Error?e.message:String(e))}
 };
 useEffect(()=>{getMappings().then(x=>{setMappings(x);setLoaded(true)}).catch(e=>{setProblem(String(e));setLoaded(true)})},[]);
 const count=thisWeek?.workingSets||0;
 const mappedCount=count-(thisWeek?.unassignedSets||0);
 if(!hevy?.connected)return <section className="panel"><h2>Training intelligence</h2><p className="muted">Connect Hevy under the Training tab to analyze exercise sets and muscle-group volume.</p></section>;
 return <section className="panel training-intelligence">
 <div className="panelhead"><div><div className="eyebrow">HEVY · ORIGINAL WORKOUT SETS</div><h2>Training intelligence</h2></div><BarChart3 size={22}/></div>
 <p className="muted">Counts are based on actual Hevy sets with repetitions; warmups and duration-only exercises are excluded. Each qualifying set is credited to one <strong>confirmed primary muscle group</strong>, not every muscle involved.</p>
 <div className="prep-metrics">
 <div><small>THIS WEEK · SESSIONS</small><strong>{thisWeek?.workouts||0}</strong></div>
 <div><small>WORKING SETS</small><strong>{count}</strong></div>
 <div><small>MAPPED SETS</small><strong>{mappedCount}<em> / {count}</em></strong></div>
 </div>
 {problem&&<div className="photo-error" role="alert">{problem}</div>}
 {!loaded&&<p className="muted">Loading exercise assignments…</p>}
 <div className="panelhead"><h2>Muscle-group volume</h2><span className="muted tiny">Current vs prior Monday–Sunday week</span></div>
 {muscleData.length?<><MiniBars entries={muscleData}/><p className="muted tiny">Gold bars represent current weekly primary-muscle sets; grey bars represent the prior week. The difference is descriptive, not a prescribed volume target.</p></>:<div className="empty compact">Assign the primary muscle for logged Hevy exercises to populate muscle-volume comparisons.</div>}
 <div className="panelhead analytics-gap"><h2>Volume over time</h2><TrendingUp size={18}/></div>
 {trendHistory.length?<div className="week-timeline">{trendHistory.map(w=><div key={w.start} className={'week-timeline-row '+(w.start===current?'current':'')}><span>{fmt(w.start)}</span><div className="week-meter"><span style={{width:Math.min(100,100*w.workingSets/Math.max(1,...trendHistory.map(a=>a.workingSets)))+'%'}}/></div><strong>{w.workingSets} sets</strong><small>{w.unassignedSets?' · '+w.unassignedSets+' unmapped':''}</small></div>)}</div>:<div className="empty compact">No imported training sets yet.</div>}
 <div className="panelhead analytics-gap"><h2>Exercise progression</h2><select aria-label="Exercise progression" className="trend-select" value={exercise} onChange={e=>setExercise(e.target.value)}><option value="">Choose exercise</option>{exerciseOptions.map(x=><option key={x.key} value={x.key}>{x.name}</option>)}</select></div>
 {exercise&&points.length?<div className="tablewrap"><table><thead><tr><th>Workout</th><th>Top representative set</th><th>Est. 1RM*</th></tr></thead><tbody>{points.slice(-12).reverse().map(p=><tr key={p.workoutId}><td>{fmt(p.date)}</td><td>{lbs(p.weightKg)} lb × {p.reps}</td><td>{p.e1rmKg?lbs(p.e1rmKg)+' lb':'—'}</td></tr>)}</tbody></table></div>:<p className="muted tiny">Choose an exercise to inspect comparable logged loads and repetitions.</p>}
 <p className="muted tiny">*Estimated 1RM uses Epley for 1–10 reps with externally loaded exercises. It is a rough strength proxy, not a direct measure of hypertrophy; machines and body-weight-assisted exercises may not be comparable.</p>
 <div className="analytics-mapping-header"><button className="textbutton" type="button" onClick={()=>setShowAssignments(x=>!x)}><ClipboardList size={17}/> Exercise muscle assignments ({mappings.length} saved, {unmapped.length} to review) <ChevronDown size={15}/></button></div>
 {showAssignments&&<><p className="muted tiny">Suggested mappings are not counted until you confirm them. Assign a single primary group per exercise. Compound lifts may train additional muscles, but secondary sets are deliberately not double-counted.</p>{combined.map(item=><Assignment key={item.key} item={item} saved={mapped.get(item.key)} onSave={save}/>)}</>}
 {compact&&<p className="muted tiny">For exercise-level details and mapping controls, open Prep → Training.</p>}
 </section>;
}
