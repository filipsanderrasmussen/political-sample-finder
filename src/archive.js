// Bounded, source-backed D1 archive ingestion.
// Runs on Cloudflare Cron or an authenticated browser request; only committed
// official-source JSON is consumed. No automatic MP3 download or conversion.
const PREFIX="/archive/";

async function readAssetJSON(env,path) {
  const r=await env.ASSETS.fetch(new Request("https://archive.internal"+path));
  if(!r.ok)throw new Error("Arkivfil ikke tilgængelig: "+path+" (HTTP "+r.status+")");
  return r.json();
}
export async function archiveManifest(env) {
  try{
    const data=await readAssetJSON(env,PREFIX+"manifest.json");
    return Array.isArray(data)?data.filter(x=>x?.status==="ready"&&/^\d{5}_M\d{1,3}$/.test(x.id)):[];
  }catch(err){
    if(String(err).includes("404"))return [];
    throw err;
  }
}
export async function archiveStatus(env,manifest=null) {
  const items=manifest||await archiveManifest(env);
  const res=await env.DB.prepare("SELECT id,status,speech_count FROM meetings").all();
  const states=new Map((res.results||[]).map(x=>[x.id,x]));
  const ready=items.filter(m=>states.get(m.id)?.status==="ready");
  const active=items.filter(m=>states.get(m.id)?.status==="syncing");
  const remaining=items.filter(m=>!["ready","importing"].includes(states.get(m.id)?.status));
  return {
    archive_meetings:items.length,
    archive_speeches:items.reduce((n,x)=>n+(Number(x.speeches)||0),0),
    indexed_meetings:ready.length,
    indexed_speeches:ready.reduce((n,x)=>n+(states.get(x.id)?.speech_count||0),0),
    importing_meetings:active.length,
    remaining_meetings:remaining.length,
  };
}
export async function syncArchiveBatch(env) {
  const manifest=await archiveManifest(env);
  if(!manifest.length)return {done:true,reason:"Arkivmanifests ikke tilgængeligt endnu.",...await archiveStatus(env,manifest)};
  const current=await env.DB.prepare("SELECT id,status FROM meetings").all();
  const statuses=new Map((current.results||[]).map(m=>[m.id,m.status]));
  // Include interrupted automatic imports, but respect a manual import in progress.
  const target=manifest.find(m=>statuses.get(m.id)!=="ready"&&statuses.get(m.id)!=="importing");
  if(!target)return {done:true,...await archiveStatus(env,manifest)};
  const data=await readAssetJSON(env,PREFIX+target.id+".json");
  if(data.id!==target.id||!Array.isArray(data.speeches)||!data.speeches.length)
    throw new Error("Transskriptindhold fra manifest kan ikke verificeres: "+target.id);
  if(data.speeches.length!==target.speeches)
    throw new Error("Arkivets antal taleindlæg er inkonsistent: "+target.id);
  let progress=0;
  if(statuses.get(target.id)==="syncing"){
    const found=await env.DB.prepare("SELECT MAX(idx) last_idx FROM speeches WHERE meeting_id=?")
      .bind(target.id).first();
    progress=(found?.last_idx??-1)+1;
  }else{
    await env.DB.batch([
      env.DB.prepare("INSERT INTO meetings (id,samling,meeting_no,date,title,source_url,status,speech_count,imported_at) VALUES (?,?,?,?,?,?,'syncing',0,?) ON CONFLICT(id) DO UPDATE SET status='syncing',date=excluded.date,title=excluded.title,source_url=excluded.source_url,imported_at=excluded.imported_at")
        .bind(target.id,target.samling,Number(target.meeting_no),target.date,"Møde "+target.meeting_no+" · "+target.samling,target.source_url,new Date().toISOString()),
      env.DB.prepare("DELETE FROM speeches WHERE meeting_id=?").bind(target.id)
    ]);
  }
  const chunk=data.speeches.slice(progress,progress+100),queries=[];
  for(let i=0;i<chunk.length;i++){
    const speech=chunk[i],idx=progress+i;
    if(!/^\d{1,2}:\d{2}$/.test(speech.clock)||typeof speech.speaker!=="string"||
       typeof speech.content!=="string"||speech.content.length>12000) {
      throw new Error("Ugyldigt transskriptindhold ved "+target.id+":"+idx);
    }
    queries.push(env.DB.prepare("INSERT OR REPLACE INTO speeches(id,meeting_id,idx,speaker,clock,content,page) VALUES(?,?,?,?,?,?,?)")
      .bind(target.id+":"+idx,target.id,idx,speech.speaker,speech.clock,speech.content,Number(speech.page)||1));
  }
  const complete=progress+chunk.length>=data.speeches.length;
  if(complete)queries.push(env.DB.prepare("UPDATE meetings SET status='ready',speech_count=? WHERE id=?")
    .bind(data.speeches.length,target.id));
  if(queries.length)await env.DB.batch(queries);
  return {done:false,meeting:target.id,processed:progress+chunk.length,total:data.speeches.length,meeting_completed:complete};
}
