// Verify original Folketinget RSS snapshot MP3 URLs before exposing existing PDF records.
// Runs only from Cron or an authenticated maintenance endpoint, never during search.
import { officialAudioSource } from "./clip-source.js";
import offlinePodcastIndex from "./audio-index.json" with {type:"json"};
export async function verifyKnownAudioBatch(env,fetchHead=fetch){
 const cursor=await env.DB.prepare("SELECT value FROM app_meta WHERE key='audio_cursor'").first();
 const start=Math.max(0,Number(cursor?.value)||0);
 if(!offlinePodcastIndex.length)return {checked:0};
 let verified=0;
 const count=Math.min(8,offlinePodcastIndex.length);
 for(let i=0;i<count;i++){
  const item=offlinePodcastIndex[(start+i)%offlinePodcastIndex.length];
  const url=officialAudioSource(item.mp3_url);
  if(!url||!item.date||!Number.isInteger(item.meeting_no))continue;
  const rows=await env.DB.prepare(
   "SELECT m.id FROM meetings m LEFT JOIN meeting_audio a ON a.meeting_id=m.id "+
   "WHERE m.status='ready' AND m.date=? AND m.meeting_no=? AND a.meeting_id IS NULL LIMIT 2"
  ).bind(item.date,item.meeting_no).all();
  if(!(rows.results||[]).length)continue;
  try{
   const r=await fetchHead(url,{method:"HEAD",headers:{"accept":"audio/mpeg"},signal:AbortSignal.timeout(12000)});
   if(!r.ok||!r.headers.get("content-type")?.startsWith("audio/mpeg")||
       Number(r.headers.get("content-length")||0)<100000)continue;
   for(const row of rows.results){
    await env.DB.prepare(
     "INSERT OR IGNORE INTO meeting_audio(meeting_id,mp3_url,title,verified_at) VALUES(?,?,?,?)"
    ).bind(row.id,url,item.title||"Original MP3",new Date().toISOString()).run();
    verified++;
   }
  }catch(err){console.warn("Audio HEAD verification failed:",String(err));}
 }
 const next=(start+count)%offlinePodcastIndex.length;
 await env.DB.prepare("INSERT INTO app_meta(key,value) VALUES('audio_cursor',?) "+
   "ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(next)).run();
 return {checked:count,verified,next};
}
