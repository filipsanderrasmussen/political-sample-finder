// Live Chromium regression: the CRT stays black briefly while the original
// startup audio is triggered synchronously by the physical power switch.
// No recording or media file is created or modified.
import {chromium} from "playwright";
import fs from "node:fs/promises";

const APP="https://political-sample-finder.filip-8d4.workers.dev/";
const report={app:APP,verifiedAt:new Date().toISOString(),ok:false};
let browser;
try{
  browser=await chromium.launch({headless:true,args:["--autoplay-policy=no-user-gesture-required","--no-sandbox"]});
  const context=await browser.newContext({reducedMotion:"no-preference"});
  const page=await context.newPage();
  await page.addInitScript(()=>{
    window.__bootCheck={pressedAt:null,plays:[],pauses:[]};
    document.addEventListener("click",event=>{
      if(event.target?.closest?.("#monitorPower"))
        window.__bootCheck.pressedAt=performance.now();
    },true);
    const play=HTMLMediaElement.prototype.play;
    const pause=HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play=function(...args){
      window.__bootCheck.plays.push({src:this.src,at:performance.now()});
      return play.apply(this,args);
    };
    HTMLMediaElement.prototype.pause=function(...args){
      window.__bootCheck.pauses.push({src:this.src,at:performance.now()});
      return pause.apply(this,args);
    };
  });
  const errors=[];
  page.on("pageerror",error=>errors.push(String(error).slice(0,240)));
  const navigation=await page.goto(APP,{waitUntil:"domcontentloaded",timeout:35000});
  report.http=navigation?.status();
  await page.locator("#monitorPower").click();
  const snapshot=()=>page.evaluate(()=>{
    const boot=document.getElementById("monitorBoot");
    return {
      elapsedMs:Math.round(performance.now()-window.__bootCheck.pressedAt),
      state:document.getElementById("monitorShell").dataset.power,
      opacity:Number(getComputedStyle(boot).opacity),
      lines:document.getElementById("monitorBootLines").children.length
    };
  });
  report.immediate=await snapshot();
  await page.waitForTimeout(650);
  report.blackHold=await snapshot();
  await page.waitForTimeout(850);
  report.fade=await snapshot();
  report.audio=await page.evaluate(()=>{
    const checks=window.__bootCheck;
    const srcMatches=entry=>entry.src.includes("/boot.mp3");
    const plays=checks.plays.filter(srcMatches);
    const pauses=checks.pauses.filter(srcMatches);
    return {playCalls:plays.length,firstPlayDelayMs:plays.length?Math.round(plays[0].at-checks.pressedAt):null,
      pausesBeforeFade:pauses.length};
  });
  report.errors=errors;
  report.ok=report.http===200
    &&report.immediate.state==="booting"
    &&report.immediate.opacity===0
    &&report.blackHold.elapsedMs<1000
    &&report.blackHold.opacity===0
    &&report.blackHold.lines>=1
    &&report.fade.elapsedMs>=1000
    &&report.fade.opacity>0.02
    &&report.fade.state==="booting"
    &&report.audio.playCalls===1
    &&report.audio.firstPlayDelayMs>=0
    &&report.audio.firstPlayDelayMs<120
    &&report.audio.pausesBeforeFade===1
    &&report.errors.length===0;
  await context.close();
}catch(error){report.error=String(error).slice(0,500)}
finally{await browser?.close().catch(()=>{})}
await fs.writeFile("browser-boot-smoke.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
if(!report.ok)process.exitCode=1;
