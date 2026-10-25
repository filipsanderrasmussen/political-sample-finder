import {preloadBootAudio} from "./boot-audio.js";

// The terminal's front-panel power switch and deliberately theatrical start-up.
// The real search UI is initialized only after boot. The supplied MP3 is
// preloaded before the switch is pressed; no synthetic audio is generated.
// Fictional TD-2000 ROM/serial diagnostics inspired by period text terminals.
// This is visual theatre, not a claim that a genuine 1987 computer is present.
export const BOOT_DURATION_MS=12900;
export const POWER_DOWN_MS=950;
export const BOOT_STEPS=Object.freeze([
  {at:850,  text:"TD-2000 TERMINAL   ROM V1.7"},
  {at:1860, text:"64 KB RAM ............... OK"},
  {at:2900, text:"TEGNGENERATOR .......... OK"},
  {at:4100, text:"TASTATUR ............... OK"},
  {at:5300, text:"SERIEL PORT A    9600 8N1"},
  {at:6350, text:"SERIEL PORT B    9600 8N1"},
  {at:7410, text:"VENTER PÅ VÆRTSSYSTEM"},
  {at:9140, text:"FORBINDELSE ............ OK"},
  {at:10330,text:"INDLÆSER TALEDATABASE 2000"},
  {at:11870,text:"SYSTEM KLAR"}
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
  const bootAudio=preloadBootAudio(shell.dataset.bootSoundSrc);
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
    power.setAttribute("aria-label",next==="on"?"Sluk skærmen":next==="booting"?"Opstart i gang":next==="powering-down"?"Skærmen slukker":"Tænd skærmen");
    power.disabled=next==="booting"||next==="powering-down";
    label.textContent=next==="on"?"SLUK":next==="booting"?"STARTER":next==="powering-down"?"SLUKKER":"TÆND";
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
    if(state!=="on")return;
    clearTimers();
    storageRemove(SESSION_KEY);
    // Pause audio and dismiss dialogs as soon as the physical switch is thrown.
    bootAudio.stop();
    onShutdown?.();
    const reduceMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if(reduceMotion){
      setState("off");
      lines.replaceChildren();
      return;
    }
    // Keep the phosphor visible while it loses brightness and definition.
    setState("powering-down");
    schedule(()=>{
      setState("off");
      lines.replaceChildren();
      power.focus({preventScroll:true});
    },POWER_DOWN_MS);
  };
  const powerOn=()=>{
    if(state!=="off")return;
    bootAudio.play(); // Directly inside the click handler; never await first.
    setState("booting");
    lines.replaceChildren();
    const reduceMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if(reduceMotion){
      lines.textContent="SYSTEM KLAR";
      schedule(ready,350);
      return;
    }
    for(const step of BOOT_STEPS){
      schedule(()=>{
        const row=document.createElement("div");
        row.className="monitor-boot-row";
        row.textContent=step.text;
        lines.append(row);
      },step.at);
    }
    schedule(ready,BOOT_DURATION_MS);
  };
  power.addEventListener("click",()=>state==="on"?powerOff():powerOn());
  // Only one theatrical boot per tab session. The physical switch can
  // still turn the monitor off and back on again to show it to a friend.
  if(storageGet(SESSION_KEY)==="1")ready();
  else {setState("off");power.focus({preventScroll:true})}
  return {get state(){return state},powerOn,powerOff};
}
