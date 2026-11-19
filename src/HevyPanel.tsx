import {useState} from 'react';
import {CloudDownload,RefreshCcw,ShieldCheck,Unplug} from 'lucide-react';
export type HevyWorkout={
 id:string;title?:string;start_time:string;end_time?:string;
 exercises?:{title?:string,exercise_template_id?:string,sets?:{type?:string,weight_kg?:number|null,reps?:number|null,rpe?:number|null}[]}[]
};
export type HevyData={configured:boolean,connected:boolean,lastSynced:string|null,lastError:string|null,historyComplete:boolean,nextHistoryPage:number,workouts:HevyWorkout[]};
export async function loadHevy():Promise<HevyData>{
 const r=await fetch('/api/hevy',{credentials:'same-origin',cache:'no-store'});
 if(!r.ok)throw Error('Hevy connection could not be checked');
 return r.json() as Promise<HevyData>;
}
export default function HevyPanel({info,onRefresh}:{info:HevyData|null,onRefresh:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [problem,setProblem]=useState('');
 const act=async(path:string,label:string)=>{
  setBusy(true);setProblem('');setMessage(label);
  try{
   const r=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store'});
   const result=await r.json() as {error?:string,imported?:number,historyComplete?:boolean};
   if(!r.ok)throw Error(result.error||'Hevy request failed');
   await onRefresh();
   setMessage(path.includes('/sync')?'Imported or updated '+(result.imported??0)+' workouts. Duplicate IDs are updated, not duplicated.':'Connection updated.');
  }catch(e){setProblem(e instanceof Error?e.message:String(e));setMessage('')}finally{setBusy(false)}
 };
 return <section className="panel formpanel"><div className="panelhead"><div><div className="eyebrow">READ-ONLY INTEGRATION</div><h2>Hevy workout sync</h2></div><ShieldCheck size={21}/></div>
 <p className="muted">Keep logging in Hevy. Stagebound imports your completed sessions and training sets for trends and prep reviews, without writing changes back to Hevy.</p>
 {!info?<p className="muted">Checking Hevy status…</p>:<div className="hevy-status">
 <div><strong>API secret</strong><span>{info.configured?'Present on Worker':'Not configured'}</span></div>
 <div><strong>Connection</strong><span>{info.connected?'Connected to this login':'Not connected'}</span></div>
 <div><strong>Imported workouts</strong><span>{info.workouts.length}</span></div>
 <div><strong>Last sync</strong><span>{info.lastSynced?new Date(info.lastSynced).toLocaleString():'Not yet'}</span></div>
 </div>}
 {info?.lastError&&<p className="photo-error">Last sync failed: {info.lastError}</p>}
 {problem&&<p className="photo-error" role="alert">{problem}</p>}
 {message&&<p className="muted tiny" role="status">{message}</p>}
 <div className="actions">
 {!info?.connected?<button className="button" disabled={busy||!info?.configured} onClick={()=>act('/api/hevy/connect','Validating Hevy API key…')}>Connect Hevy</button>:<>
 <button className="button" disabled={busy} onClick={()=>act('/api/hevy/sync','Importing recent workouts…')}><RefreshCcw size={16}/> Sync latest</button>
 <button className="button secondary" disabled={busy||!!info?.historyComplete} onClick={()=>act('/api/hevy/sync?history=1','Importing older workout pages…')}><CloudDownload size={16}/> {info?.historyComplete?'History imported':'Import older history'}</button>
 <button className="button secondary" disabled={busy} onClick={()=>{if(confirm('Pause automatic Hevy synchronization? Imported workouts will remain in Stagebound.'))act('/api/hevy/disconnect','Disconnecting…')}}><Unplug size={16}/> Disconnect</button>
 </>}
 </div>
 {!info?.configured&&<p className="muted tiny">To connect, first add a Cloudflare Worker secret named <code>HEVY_API_KEY</code> to the <code>stagebound</code> Worker. Never place the key in GitHub or chat. Refresh the page afterward.</p>}
 <p className="muted tiny">An initial sync imports up to 50 recent workouts. “Import older history” fetches the next five pages each time. Automatic recent syncs are scheduled every six hours at :17 UTC. Hevy does not supply live Apple Watch biometric data through this API. Deleted workouts are not automatically removed from this first version's historical cache.</p>
 </section>;
}
