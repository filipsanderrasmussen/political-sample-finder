// The terminal's front-panel power switch and deliberately theatrical start-up.
// No network requests are needed to boot. The real search UI is initialized once
// the monitor is on; only a successful boot is remembered per browser session.
export const BOOT_STEPS = Object.freeze([
  {at:120, text:"DATATERMINAL TD-2000"},
  {at:570, text:"INITIALISERER BILLEDRØR"},
  {at:1190,text:"KONTROL AF ARBEJDSLAGER ... OK"},
  {at:1860,text:"INDLÆSER TERMINALPROGRAM"},
  {at:2390,text:"SYSTEM KLAR"}
]);

const SESSION_KEY="td2000.monitor.booted";

function storageGet(key){
  try{return sessionStorage.getItem(key)}catch{return null}
}
function storageSet(key,value){
  try{sessionStorage.setItem(key,value)}catch{}
}
function storageRemove(key){
  try{sessionStorage.removeItem(key)}catch{}
}

// Synthesised at the user's click: a short mechanical click, quiet 55 Hz hum,
// and one terse start-up beep. No files, permissions or autoplay required.
export function playPowerSound(){
  const AudioEngine=window.AudioContext||window.webkitAudioContext;
  if(!AudioEngine)return;
  let ctx;
  try{
    ctx=new AudioEngine();
    const t=ctx.currentTime;
    // Mechanical switch transient.
    const length=Math.max(1,Math.floor(ctx.sampleRate*.014));
    const buffer=ctx.createBuffer(1,length,ctx.sampleRate);
    const samples=buffer.getChannelData(0);
    for(let i=0;i<samples.length;i++){
      samples[i]=(Math.random()*2-1)*Math.pow(1-i/samples.length,2);
    }
    const click=ctx.createBufferSource(),clickGain=ctx.createGain();
    click.buffer=buffer;
    clickGain.gain.value=.12;
    click.connect(clickGain).connect(ctx.destination);
    click.start(t);
    // Transformer hum fades in and out; keep quiet.
    const hum=ctx.createOscillator(),gain=ctx.createGain();
    hum.type="sine";
    hum.frequency.setValueAtTime(55,t);
    gain.gain.setValueAtTime(.0001,t);
    gain.gain.linearRampToValueAtTime(.025,t+.12);
    gain.gain.exponentialRampToValueAtTime(.0001,t+.85);
    hum.connect(gain).connect(ctx.destination);
    hum.start(t+.03);hum.stop(t+.88);
    // One restrained diagnostic beep.
    const beep=ctx.createOscillator(),beepGain=ctx.createGain();
    beep.type="sine";beep.frequency.setValueAtTime(690,t+1.86);
    beepGain.gain.setValueAtTime(.0001,t+1.86);
    beepGain.gain.linearRampToValueAtTime(.028,t+1.88);
    beepGain.gain.exponentialRampToValueAtTime(.0001,t+2.03);
    beep.connect(beepGain).connect(ctx.destination);
    beep.start(t+1.86);beep.stop(t+2.04);
    setTimeout(()=>ctx.close().catch(()=>{}),3200);
  }catch(err){
    // Sound is strictly optional. Browser audio restrictions must never
    // interrupt the app's real functionality.
    console.debug("Opstartslyd ikke tilgængelig:",err);
    if(ctx)ctx.close().catch(()=>{});
  }
}

export function initMonitor({onReady,onShutdown}){
  const shell=document.getElementById("monitorShell");
  const screen=document.getElementById("monitorScreen");
  const content=document.getElementById("terminalFrame");
  const power=document.getElementById("monitorPower");
  const label=document.getElementById("monitorPowerLabel");
  const offline=document.getElementById("monitorOffline");
  const lines=document.getElementById("monitorBootLines");
  if(!shell||!screen||!content||!power||!label||!offline||!lines)
    throw new Error("Skærmens betjeningspanel mangler.");
  const timers=new Set();
  let state="off";
  const schedule=(fn,ms)=>{
    const id=setTimeout(()=>{timers.delete(id);fn()},ms);
    timers.add(id);
  };
  const clearTimers=()=>{
    for(const id of timers)clearTimeout(id);
    timers.clear();
  };
  const setState=next=>{
    state=next;
    shell.dataset.power=next;
    content.inert=next!=="on";
    content.setAttribute("aria-hidden",String(next!=="on"));
    power.setAttribute("aria-pressed",String(next==="on"));
    power.setAttribute("aria-label",next==="on"?"Sluk skærmen":next==="booting"?"Opstart i gang":"Tænd skærmen");
    power.disabled=next==="booting";
    label.textContent=next==="on"?"SLUK":next==="booting"?"STARTER":"TÆND";
    offline.hidden=next!=="off";
    lines.hidden=next!=="booting";
    if(next==="off"||next==="booting")screen.scrollTop=0;
  };
  const ready=()=>{
    clearTimers();
    storageSet(SESSION_KEY,"1");
    setState("on");
    onReady?.();
  };
  const powerOff=()=>{
    clearTimers();
    storageRemove(SESSION_KEY);
    setState("off");
    lines.replaceChildren();
    onShutdown?.();
  };
  const powerOn=()=>{
    if(state!=="off")return;
    setState("booting");
    lines.replaceChildren();
    const reduceMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if(!reduceMotion)playPowerSound();
    if(reduceMotion){
      lines.textContent="SYSTEM KLAR";
      schedule(ready,350);
      return;
    }
    for(const step of BOOT_STEPS){
      schedule(()=>{
        const row=document.createElement("div");
        row.className="monitor-boot-row";
        row.textContent="> "+step.text;
        lines.append(row);
      },step.at);
    }
    schedule(ready,2900);
  };
  power.addEventListener("click",()=>state==="on"?powerOff():powerOn());
  // Only one theatrical boot per tab session. The physical switch can
  // still turn the monitor off and back on again to show it to a friend.
  if(storageGet(SESSION_KEY)==="1")ready();
  else {setState("off");power.focus({preventScroll:true})}
  return {get state(){return state},powerOn,powerOff};
}
