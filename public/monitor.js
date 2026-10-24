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
