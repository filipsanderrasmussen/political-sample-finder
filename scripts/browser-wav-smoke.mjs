// Real Chrome smoke test for user-visible WAV export from original official MP3.
// Read-only: no database mutation and no sample file is persisted or published.
import {chromium} from "playwright";
import fs from "node:fs/promises";

const APP="https://political-sample-finder.filip-8d4.workers.dev";
const SOURCE="https://cdnapi.kaltura.com/p/2158211/sp/0/playManifest/entryId/1_50oi4p46/protocol/http/flavorParamIds/0/format/url/08-11-2024_09-00_salen.mp3";
const report={time:new Date().toISOString(),app:APP,source:"Official Folketinget MP3, 8 Nov 2024",requestedClipSeconds:1,requestedStart:"02:00:00",ok:false};
let browser;
try{
 browser=await chromium.launch({headless:true,args:["--autoplay-policy=no-user-gesture-required","--no-sandbox"]});
 const context=await browser.newContext({permissions:[]});
 const page=await context.newPage();
 page.setDefaultTimeout(65000);
 const errors=[];
 page.on("pageerror",e=>errors.push(String(e).slice(0,250)));
 const reply=await page.goto(APP,{waitUntil:"domcontentloaded",timeout:40000});
 report.http=reply?.status();
 await page.waitForFunction(()=>{
   const counter=document.querySelector("#statMeetings")?.textContent?.trim()||"";
   const coverage=document.querySelector("#archiveCoverage")?.textContent||"";
   return /^\d/.test(counter)&&coverage.includes("SØGBART NU");
 },null,{timeout:22000});
 report.archiveUi=await page.evaluate(async ()=>{
   const response=await fetch("/api/stats");
   const stats=await response.json();
   return {
     labels:[...document.querySelectorAll(".stat-label")].map(x=>x.textContent.trim()),
     meetings:document.querySelector("#statMeetings")?.textContent?.trim(),
     speech_turns:document.querySelector("#statSpeeches")?.textContent?.trim(),
     period:document.querySelector("#statPeriod")?.textContent?.trim(),
     coverage:document.querySelector("#archiveCoverage")?.textContent?.trim(),
     first:stats.searchable_first_date,last:stats.searchable_last_date,
     meetingCount:stats.verified_audio_meetings,speechCount:stats.audio_speeches
   };
 });
 report.export=await page.evaluate(async src=>{
   const {captureWav}=await import("/clipper.js");
   const started=performance.now();
   const audio=await captureWav({src,start:7200,end:7201});
   const data=new Uint8Array(await audio.wav.arrayBuffer());
   const view=new DataView(data.buffer);
   let peak=0,nonzero=0;
   for(let i=44;i+1<data.length;i+=2){
     const sample=Math.abs(view.getInt16(i,true));
     if(sample>peak)peak=sample;
     if(sample>0)nonzero++;
   }
   return {wavHeader:String.fromCharCode(...data.slice(0,4)),
           waveMark:String.fromCharCode(...data.slice(8,12)),
           bytes:data.length,seconds:audio.seconds,sampleRate:audio.sampleRate,
           peak,nonzero,elapsedMs:Math.round(performance.now()-started)};
 },SOURCE);
 report.pageErrors=errors;
 report.ok=report.http===200&&report.export.wavHeader==="RIFF"&&report.export.waveMark==="WAVE"&&report.export.bytes>10000&&report.export.peak>0&&report.export.nonzero>1000
   &&report.archiveUi.labels.includes("MØDER I SALEN")
   &&report.archiveUi.labels.includes("TALEINDLÆG")
   &&report.archiveUi.labels.includes("ARKIVETS ÅR")
   &&report.archiveUi.coverage.includes("IKKE KOMPLET DÆKNING")
   &&report.archiveUi.meetings===report.archiveUi.meetingCount.toLocaleString("da-DK")
   &&report.archiveUi.speech_turns===report.archiveUi.speechCount.toLocaleString("da-DK");
 await context.close();
}catch(e){report.error=String(e).slice(0,900)}
finally{await browser?.close().catch(()=>{});}
await fs.writeFile("browser-wav-smoke.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
if(!report.ok)process.exitCode=1;
