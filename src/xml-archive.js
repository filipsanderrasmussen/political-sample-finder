// Source-backed XML imports produced ONLY for verified official Kaltura MP3 meetings.
// Cloudflare Workers cannot use FTP: GitHub Actions prepares these JSON assets.
import { officialAudioSource } from "./clip-source.js";

const PREFIX="/archive/xml/";
async function readJson(env,path){
 const r=await env.ASSETS.fetch(new Request("https://archive.internal"+path));
 if(!r.ok)throw new Error("XML-arkivfil mangler: "+path+" ("+r.status+")");
 return r.json();
}
export async function xmlManifest(env){
 try{
  const list=await readJson(env,PREFIX+"manifest.json");
  if(!Array.isArray(list))return [];
  return list.filter(x=>/^\d{5}_M\d{1,3}$/.test(x?.id||"") &&
    /^\d{4}-\d\d-\d\d$/.test(x.date||"") &&
    officialAudioSource(x.audio_url) &&
    /^[a-f0-9]{32,64}$/.test(x.version||"") &&
    Number.isInteger(x.speeches) && x.speeches>0 && x.speeches<=2500);
 }catch(e){if(String(e).includes("404"))return [];throw e;}
}

export async function xmlArchiveStatus(env){
 const manifest=await xmlManifest(env);
 if(!manifest.length)return {xml_meetings:0,xml_imported_meetings:0,xml_remaining_meetings:0};
 const values=await env.DB.prepare("SELECT key,value FROM app_meta WHERE key LIKE 'xml:%'").all();
 const done=new Map((values.results||[]).map(x=>[x.key,x.value]));
 const imported=manifest.filter(x=>done.get("xml:"+x.id)===x.version);
 return {xml_meetings:manifest.length,xml_imported_meetings:imported.length,
         xml_remaining_meetings:manifest.length-imported.length};
}
export async function syncXmlBatch(env){
 const manifest=await xmlManifest(env);
 if(!manifest.length)return {done:true,reason:"Ingen lydverificerede XML-arkivfiler endnu."};
 const saved=await env.DB.prepare("SELECT key,value FROM app_meta WHERE key LIKE 'xml:%'").all();
 const done=new Map((saved.results||[]).map(x=>[x.key,x.value]));
 const target=manifest.find(x=>done.get("xml:"+x.id)!==x.version);
 if(!target)return {done:true,xml_meetings:manifest.length};
 const data=await readJson(env,PREFIX+target.id+".json");
 if(data.id!==target.id||data.version!==target.version||
    data.date!==target.date||data.audio_url!==target.audio_url||
    !Array.isArray(data.speeches)||data.speeches.length!==target.speeches)
  throw new Error("XML-manifest og indhold passer ikke sammen: "+target.id);
 if(!officialAudioSource(data.audio_url))
  throw new Error("XML-mødet mangler godkendt MP3.");
 const existing=await env.DB.prepare("SELECT status,imported_at FROM meetings WHERE id=?").bind(target.id).first();
 const ongoing=existing?.status==="xml-syncing" && existing.imported_at===target.version;
 let progress=0;
 if(ongoing){
  const last=await env.DB.prepare("SELECT MAX(idx) last_idx FROM speeches WHERE meeting_id=?").bind(target.id).first();
  progress=(last?.last_idx??-1)+1;
 }else{
  const statements=[];
  if(existing){
   // Old PDF IDs may not refer to the same paragraphs. Preserve favorited text.
   statements.push(env.DB.prepare(
    "INSERT OR IGNORE INTO archived_favorites(id,meeting_id,source_date,speaker,clock,content,archived_at) "+
    "SELECT f.speech_id,s.meeting_id,m.date,s.speaker,s.clock,s.content,? "+
    "FROM favorites f JOIN speeches s ON s.id=f.speech_id JOIN meetings m ON m.id=s.meeting_id WHERE s.meeting_id=?")
     .bind(new Date().toISOString(),target.id));
   statements.push(env.DB.prepare("DELETE FROM favorites WHERE speech_id IN (SELECT id FROM speeches WHERE meeting_id=?)").bind(target.id));
  }
  statements.push(env.DB.prepare("INSERT INTO meetings(id,samling,meeting_no,date,title,source_url,status,speech_count,imported_at) "+
    "VALUES(?,?,?,?,?,?,'xml-syncing',0,?) ON CONFLICT(id) DO UPDATE SET "+
    "date=excluded.date,title=excluded.title,source_url=excluded.source_url,status='xml-syncing',speech_count=0,imported_at=excluded.imported_at")
     .bind(data.id,data.samling,data.meeting_no,data.date,"Møde "+data.meeting_no+" · "+data.samling,data.source_url,data.version));
  statements.push(env.DB.prepare("DELETE FROM speeches WHERE meeting_id=?").bind(target.id));
  await env.DB.batch(statements);
 }
 const chunk=data.speeches.slice(progress,progress+60);
 const queries=[];
 for(let i=0;i<chunk.length;i++){
  const row=chunk[i],idx=progress+i;
  if(typeof row.speaker!=="string"||!row.speaker||row.speaker.length>160||
    typeof row.content!=="string"||row.content.length<6||row.content.length>12000||
    !/^\d{2}:\d{2}:\d{2}$/.test(row.clock)||
    !/^[A-ZÆØÅ]{1,6}$|^$/.test(row.party||""))
    throw new Error("Ugyldigt XML-taleafsnit "+data.id+":"+idx);
  queries.push(env.DB.prepare(
    "INSERT OR REPLACE INTO speeches(id,meeting_id,idx,speaker,clock,content,page,party) VALUES(?,?,?,?,?,?,?,?)")
    .bind(data.id+":"+idx,data.id,idx,row.speaker,row.clock,row.content,1,row.party||null));
 }
 const complete=progress+chunk.length>=data.speeches.length;
 if(complete){
  queries.push(env.DB.prepare("INSERT INTO meeting_audio(meeting_id,mp3_url,title,verified_at) VALUES(?,?,?,?) "+
    "ON CONFLICT(meeting_id) DO UPDATE SET mp3_url=excluded.mp3_url,title=excluded.title,verified_at=excluded.verified_at")
     .bind(data.id,data.audio_url,data.audio_title||"Original MP3",data.verified_at));
  queries.push(env.DB.prepare("UPDATE meetings SET status='ready',speech_count=?,imported_at=? WHERE id=?")
     .bind(data.speeches.length,new Date().toISOString(),data.id));
  queries.push(env.DB.prepare("INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
     .bind("xml:"+data.id,data.version));
 }
 if(queries.length)await env.DB.batch(queries);
 return {done:false,meeting:data.id,processed:progress+chunk.length,total:data.speeches.length,
         meeting_completed:complete,source:"official_xml_verified_mp3"};
}
