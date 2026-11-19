import { useEffect, useState } from 'react';
import JSZip from 'jszip';
import { Archive, CheckCircle2, CloudDownload, DatabaseBackup, RefreshCcw, ShieldCheck } from 'lucide-react';

type Backup={id:string,createdAt:string,bytes:number,sha256:string|null,kind:'daily'|'manual'};
type Verification={ok:boolean,createdAt:string,sha256:string,counts:Record<string,number>,missingPhotos:string[]};
type Preview={dryRun:boolean,missing:Record<string,number>,sourceCreatedAt:string};
const when=(date:string)=>new Date(date).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
async function request(path:string,options?:RequestInit):Promise<any>{
 const r=await fetch(path,{cache:'no-store',credentials:'same-origin',...options});
 const body:any=await r.json();
 if(!r.ok)throw new Error(body.error||'Request failed ('+r.status+')');
 return body;
}
export default function BackupPanel(){
 const [items,setItems]=useState<Backup[]>([]);
 const [chosen,setChosen]=useState('');
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState('Loading backup history…');
 const [error,setError]=useState('');
 const [verified,setVerified]=useState<Verification|null>(null);
 const [preview,setPreview]=useState<Preview|null>(null);
 const load=async()=>{
  const x=await request('/api/backups');
  const backups=x.backups as Backup[];
  setItems(backups);
  setChosen(v=>v&&backups.some(b=>b.id===v)?v:backups[0]?.id||'');
  setStatus(backups.length+' snapshot'+(backups.length===1?'':'s')+' available');
 };
 useEffect(()=>{load().catch(e=>{setStatus('Backup status unavailable');setError(String(e))})},[]);
 const act=async(label:string,fn:()=>Promise<void>)=>{
  setBusy(true);setError('');setStatus(label);
  try{await fn()}catch(e){setError(e instanceof Error?e.message:String(e));setStatus('Operation failed')}finally{setBusy(false)}
 };
 const run=()=>act('Creating protected backup…',async()=>{const b=await request('/api/backups/run',{method:'POST'});await load();setChosen(b.key);setVerified(null);setPreview(null);setStatus('Backup created and photos archived')});
 const verify=()=>act('Checking snapshot and photo archive…',async()=>{const x=await request('/api/backups/verify?id='+encodeURIComponent(chosen));setVerified(x);setStatus(x.ok?'Snapshot integrity and photo archive verified':'Some archived photos were not found')});
 const dryRun=()=>act('Comparing backup against current records…',async()=>{const x=await request('/api/backups/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:chosen,apply:false})});setPreview(x);setStatus('Non-destructive recovery preview complete')});
 const recover=()=>act('Recovering missing records…',async()=>{
  if(!preview||!confirm('Restore records missing from your current Stagebound account? Existing records will not be overwritten, and a checkpoint will be created first.'))return;
  const x=await request('/api/backups/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:chosen,apply:true})});
  setStatus('Missing records and photos recovered. Refresh the page to see restored entries.');
  setPreview(null);setVerified(null);await load();
  if(!x.restored)throw new Error('Restore not confirmed');
 });
 const exportAll=()=>act('Preparing full ZIP export…',async()=>{
  const [payload,photoList]=await Promise.all([request('/api/backups/export'),request('/api/photos')]);
  const zip=new JSZip();
  zip.file('stagebound-data.json',JSON.stringify(payload,null,2));
  const pictures=zip.folder('progress-photos');
  const photos=photoList.photos as {id:string,date:string,pose:string,contentType:string}[];
  for(let i=0;i<photos.length;i++){
   const p=photos[i];
   setStatus('Downloading protected photo '+(i+1)+' of '+photos.length+'…');
   const result=await fetch('/api/photos/'+p.id,{credentials:'same-origin',cache:'no-store'});
   if(!result.ok)throw Error('Photo '+p.id+' could not be downloaded. No incomplete archive will be saved.');
   const ext=p.contentType==='image/png'?'png':p.contentType==='image/webp'?'webp':'jpg';
   pictures?.file(p.date+'_'+p.pose+'_'+p.id+'.'+ext,await result.blob());
  }
  const file=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:3}});
  const link=document.createElement('a'),url=URL.createObjectURL(file);
  link.href=url;link.download='stagebound-complete-'+new Date().toISOString().slice(0,10)+'.zip';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  setStatus('Complete ZIP downloaded: records and '+photos.length+' original photos');
 });
 return <section className="panel formpanel backup-panel">
  <div className="panelhead"><div><div className="eyebrow">DATA PROTECTION</div><h2>Backups and recovery</h2></div><ShieldCheck size={24} color="#e5b37f"/></div>
  <p className="muted">Stagebound creates a private database snapshot each day at 08:00 UTC. Daily snapshots are retained for approximately 30 days; archived photo copies are retained separately. A manual snapshot is available anytime.</p>
  <div className="backup-actions">
   <button className="button" disabled={busy} onClick={run}><DatabaseBackup size={16}/> Back up now</button>
   <button className="button secondary" disabled={busy} onClick={exportAll}><CloudDownload size={16}/> Download complete ZIP</button>
   <button className="button secondary" disabled={busy} onClick={()=>act('Refreshing…',load)}><RefreshCcw size={15}/> Refresh</button>
  </div>
  <div className="backup-notice" aria-live="polite">{busy&&<span className="backup-spinner"/>}{status}</div>
  {error&&<p className="photo-error" role="alert">{error}</p>}
  <div className="backup-picker"><label>Available snapshots<select value={chosen} onChange={e=>{setChosen(e.target.value);setVerified(null);setPreview(null)}}><option value="">No snapshots</option>{items.map(b=><option key={b.id} value={b.id}>{when(b.createdAt)} · {b.kind} · {(b.bytes/1024).toFixed(1)} KB</option>)}</select></label></div>
  {chosen&&<><div className="backup-actions"><button className="button secondary" disabled={busy} onClick={verify}><ShieldCheck size={16}/> Verify backup</button><button className="button secondary" disabled={busy} onClick={dryRun}><Archive size={16}/> Test recovery (no changes)</button></div>
   {verified&&<div className="backup-result"><CheckCircle2 size={20} color={verified.ok?'#80d3b0':'#f0b785'}/><div><strong>{verified.ok?'Integrity verified':'Backup needs attention'}</strong><p>{Object.entries(verified.counts).map(([k,v])=>k+': '+v).join(' · ')}</p>{verified.missingPhotos.length>0&&<p>Missing archived photos: {verified.missingPhotos.length}</p>}</div></div>}
   {preview&&<div className="backup-result"><Archive size={20}/><div><strong>Recovery simulation · {when(preview.sourceCreatedAt)}</strong><p>Missing records that could be restored: {Object.entries(preview.missing).map(([k,v])=>k+': '+v).join(' · ')}</p>{Object.values(preview.missing).some(v=>v>0)&&<button className="button secondary" disabled={busy} onClick={recover}>Restore missing records only</button>}</div></div>}
  </>}
  <p className="muted tiny backup-caution">The backup bucket is private but belongs to the same Cloudflare account. For independent protection, periodically save the complete ZIP to a separate device or storage provider. ZIP exports contain sensitive physique photos; keep them private.</p>
 </section>;
}
