// TALEDATABASE 2000: non-invasive historical-media proof of concept.
// Tests a 2010 meeting against a known 2024 meeting. Never changes production.
// Streams at most 5 seconds when an official audio/video URL is actually exposed.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cases=[
  {kind:"old",id:"20101_M1",url:"https://mobiltv.ft.dk/video/20101/salen/1"},
  {kind:"old",id:"20101_M2",url:"https://mobiltv.ft.dk/video/20101/salen/2"},
  {kind:"old",id:"20101_M3",url:"https://mobiltv.ft.dk/video/20101/salen/3"},
  {kind:"control",id:"20241_M6",url:"https://mobiltv.ft.dk/video/20241/salen/6"}
];
const MAX_HTML=1300000;
const sanitize=s=>String(s??"").replace(/[\r\n]+/g," ").slice(0,240);
function unescape(s){return s.replace(/&amp;/g,"&").replace(/\\u0026/g,"&").replace(/\\\//g,"/");}
async function request(url){
 try{
  const started=Date.now();
  const res=await fetch(url,{redirect:"follow",headers:{"User-Agent":"TALEDATABASE-2000-test/1.0","Accept":"text/html,application/json,*/*"},signal:AbortSignal.timeout(12500)});
  const html=(await res.text()).slice(0,MAX_HTML);
  return {status:res.status,ok:res.ok,finalUrl:res.url,elapsedMs:Date.now()-started,html};
 }catch(e){return {ok:false,status:null,error:sanitize(e.message),html:""};}
}
function findMatches(text,re,limit=12){return [...new Set([...text.matchAll(re)].map(x=>x[1]||x[0]))].slice(0,limit);}
function extract(html){
 const s=unescape(html);
 const title=s.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]||"";
 const desc=s.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1]||"";
 const scripts=findMatches(s,/<script\b[^>]*src=["']([^"']+)/gi,20);
 const refs=findMatches(s,/https?:[^"'<>\s]+(?:\.mp3|\.m3u8|\.mp4)(?:\?[^"'<>\s]*)?/gi,10);
 const entryIds=findMatches(s,/(?:entryId|entry_id|entryId%22|entry_id%22)[^a-z0-9_]{1,30}(1_[a-z0-9]+)/gi,15);
 const knownIds=findMatches(s,/\b(1_[a-z0-9]{8})\b/gi,15);
 const videoTag = s.match(/<video\b[^>]*>/i)?.[0]||null;
 return {title:sanitize(title),description:sanitize(desc),scripts:scripts.slice(0,8),mediaReferences:refs,
         entryIds,knownIds,videoTag,mentionsMeeting:/møde nr\.?\s*[1-9]/i.test(s),
         bytes:Buffer.byteLength(html,"utf8")};
}
const result={date:new Date().toISOString(),purpose:"2010 audio availability and 5s playable WAV",readOnly:true,cases:[],verdict:"NOT_TESTED",audioTest:null};
for(const item of cases){
 const response=await request(item.url);
 const parsed=extract(response.html);
 result.cases.push({kind:item.kind,id:item.id,url:item.url,ok:response.ok,status:response.status,
   finalUrl:response.finalUrl,error:response.error,elapsedMs:response.elapsedMs,...parsed});
}
const old=result.cases.find(x=>x.kind==="old" && x.ok && (/2010/i.test(x.title+" "+x.description)||x.mentionsMeeting));
const current=result.cases.find(x=>x.kind==="control");
if(!old) result.verdict="NO_VERIFIED_2010_MEETING_PAGE";
else{
 const sources=old.mediaReferences.map(x=>x.replace(/&amp;/g,"&")).filter(x=>/^https:\/\//.test(x));
 if(!sources.length){
  result.verdict="2010_PAGE_ACCESSIBLE_BUT_NO_DIRECT_AUDIO_LINK";
 }else{
  const source=sources[0];
  const destination=path.join(os.tmpdir(),"td2000-2010-test.wav");
  const args=["-hide_banner","-loglevel","error","-nostdin","-rw_timeout","15000000",
              "-ss","00:00:05","-i",source,"-t","5","-vn","-ac","1","-ar","16000","-c:a","pcm_s16le","-y",destination];
  const child=spawnSync("ffmpeg",args,{encoding:"utf8",timeout:50000});
  let bytes=0,duration=null;
  try{
    const stat=await fs.stat(destination);bytes=stat.size;
    if(bytes>44)duration=Math.round((bytes-44)/(16000*2)*100)/100;
  }catch{}
  result.audioTest={source,ffmpegExit:child.status,ffmpegError:sanitize(child.stderr),wavBytes:bytes,
    approximateSeconds:duration};
  result.verdict=bytes>15000?"2010_WAV_CLIP_CREATED":"2010_MEDIA_FOUND_WAV_NOT_VERIFIED";
 }
}
if(!old&&current?.ok)result.verdict="2010_MEDIA_ROUTE_NOT_CONFIRMED_2024_CONTROL_OK";
await fs.writeFile("ft-2010-audio-test.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({verdict:result.verdict,cases:result.cases.map(({kind,id,status,title,entryIds,knownIds,mediaReferences,error,scripts})=>({kind,id,status,title,entryIds,knownIds,mediaReferences,error,scripts})),audioTest:result.audioTest},null,2));
