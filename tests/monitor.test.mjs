import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {BOOT_STEPS,BOOT_DURATION_MS,POWER_DOWN_MS,initMonitor} from "../public/monitor.js";
import {preloadBootAudio} from "../public/boot-audio.js";

const html=readFileSync("public/index.html","utf8");
const css=readFileSync("public/style.css","utf8");
const app=readFileSync("public/app.js","utf8");

function fakeEnvironment({remembered=false,reduced=false}={}){
 const real={
   document:globalThis.document,window:globalThis.window,
   sessionStorage:globalThis.sessionStorage,
   setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout
 };
 const storage=new Map(remembered?[["td2000.monitor.booted","1"]]:[]);
 const timers=new Map();let id=0;let current=0;
 const elements=new Map();
 function element(){
   return {
     dataset:{},hidden:false,inert:false,disabled:false,scrollTop:0,
     textContent:"",attributes:{},children:[],handlers:{},
     setAttribute(key,val){this.attributes[key]=val},
     addEventListener(name,fn){this.handlers[name]=fn},
     replaceChildren(){this.children=[];this.textContent=""},
     append(child){this.children.push(child)},
     focus(){this.focused=true},
     click(){this.handlers.click?.()}
   };
 }
 for(const x of ["monitorShell","monitorScreen","terminalFrame","monitorPower","monitorPowerLabel","monitorOffline","monitorBootLines"])elements.set(x,element());
 globalThis.document={
   getElementById(id){return elements.get(id)},
   createElement(){return element()}
 };
 globalThis.window={matchMedia(){return {matches:reduced}}};
 globalThis.sessionStorage={
   getItem(key){return storage.get(key)??null},
   setItem(key,v){storage.set(key,String(v))},
   removeItem(key){storage.delete(key)}
 };
 globalThis.setTimeout=(fn,ms)=>{const k=++id;timers.set(k,{fn,at:current+ms});return k};
 globalThis.clearTimeout=k=>timers.delete(k);
 return {
   elements,storage,timers,
   advanceTo(time){
     for(;;){
       const next=[...timers].sort((a,b)=>a[1].at-b[1].at).find(x=>x[1].at<=time);
       if(!next)break;
       timers.delete(next[0]);current=next[1].at;next[1].fn();
     }
     current=time;
   },
   restore(){
     for(const key of Object.keys(real)){
       if(real[key]===undefined)delete globalThis[key];
       else globalThis[key]=real[key];
     }
   }
 };
}

test("real-world monitor is edge-to-edge with a physical switch; dialogs remain available",()=>{
  assert.match(html,/class="monitor-shell" id="monitorShell" data-power="off"/);
  assert.match(html,/id="monitorBoot"/);
  assert.match(html,/<div class="monitor-offline" id="monitorOffline" aria-hidden="true"><\/div>/);
  assert.doesNotMatch(html,/SKÆRM SLUKKET|Tryk på tændknappen under skærmen/);
  assert.match(html,/id="monitorPower"[^>]*aria-label="Tænd skærmen"/);
  assert.match(html,/id="terminalFrame" inert aria-hidden="true"/);
  assert.match(html,/id="playerDialog"/);
  assert.match(html,/id="importDialog"/);
  assert.ok(css.includes("width:min(93vw,1500px)"),"Whole monitor is displayed with black margins");
  assert.ok(css.includes("height:min(89dvh,940px)"),"Monitor is not cropped by viewport");
  assert.ok(css.includes("overflow:auto;overscroll-behavior:contain"),"Content scrolls within the glass");
  assert.ok(css.includes("--panel-height:clamp(85px,9vh,109px)"),"Substantial physical bottom console");
  assert.ok(css.includes('data-power="off"] .monitor-boot,'),"Off state has no visible text");
  assert.ok(css.includes('data-power="off"] .monitor-screen{'),"Off-state glass is dark");
  assert.ok(css.includes('data-power="off"]::after{display:none}'),"Off-state scanlines disappear");
  assert.ok(css.includes('data-power="powering-down"] .terminal-frame'),"Screen stays present while fading");
  assert.ok(css.includes("@keyframes crt-warm-up"));
  assert.ok(css.includes("@keyframes crt-cool-down"));
  assert.ok(css.includes("filter:blur(15px) brightness(.15)"));
  assert.ok(css.includes("filter:blur(14px) brightness(.10)"));
  assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));

  assert.match(app,/initMonitor\(\{/);
  assert.match(app,/onShutdown:\(\)=>\{/);
  assert.match(app,/if\(!appInitialized\)\{/);
  assert.match(app,/function startTerminal\(\)/);
});

test("power switch boots on user action, stores session, and turns off safely",()=>{
  const env=fakeEnvironment();
  try{
    let ready=0,shutdown=0;
    const monitor=initMonitor({onReady:()=>ready++,onShutdown:()=>shutdown++});
    const power=env.elements.get("monitorPower");
    assert.equal(monitor.state,"off");
    assert.equal(power.focused,true);
    assert.equal(ready,0);
    assert.equal(env.elements.get("terminalFrame").inert,true);
    power.click();
    assert.equal(monitor.state,"booting");
    assert.equal(power.disabled,true);
    assert.equal(env.storage.get("td2000.monitor.booted"),undefined);
    env.advanceTo(2400);
    assert.deepEqual(
      env.elements.get("monitorBootLines").children.map(x=>x.textContent),
      BOOT_STEPS.filter(step=>step.at<=2400).map(step=>step.text)
    );
    assert.equal(ready,0);
    env.advanceTo(BOOT_DURATION_MS-1);
    assert.deepEqual(
      env.elements.get("monitorBootLines").children.map(x=>x.textContent),
      BOOT_STEPS.map(step=>step.text)
    );
    assert.equal(monitor.state,"booting");
    env.advanceTo(BOOT_DURATION_MS);
    assert.equal(monitor.state,"on");
    assert.equal(ready,1);
    assert.equal(env.storage.get("td2000.monitor.booted"),"1");
    assert.equal(env.elements.get("terminalFrame").inert,false);
    assert.equal(env.elements.get("monitorPowerLabel").textContent,"SLUK");
    power.click();
    assert.equal(monitor.state,"powering-down","Text must fade before glass goes black");
    assert.equal(shutdown,1,"Playing audio stops immediately at switch-off");
    assert.equal(power.disabled,true);
    assert.equal(env.storage.has("td2000.monitor.booted"),false);
    assert.equal(env.elements.get("terminalFrame").inert,true);
    env.advanceTo(BOOT_DURATION_MS+POWER_DOWN_MS-1);
    assert.equal(monitor.state,"powering-down");
    env.advanceTo(BOOT_DURATION_MS+POWER_DOWN_MS);
    assert.equal(monitor.state,"off");
    assert.equal(power.disabled,false);
  }finally{env.restore()}
});

test("reload during same browser session skips startup and initializes app once",()=>{
  const env=fakeEnvironment({remembered:true});
  try{
    let ready=0;
    const monitor=initMonitor({onReady:()=>ready++});
    assert.equal(monitor.state,"on");
    assert.equal(ready,1);
    assert.equal(env.timers.size,0);
    assert.equal(env.elements.get("monitorPower").disabled,false);
  }finally{env.restore()}
});

test("reduced motion gives short silent startup without text animation",()=>{
  const env=fakeEnvironment({reduced:true});
  try{
    let ready=0;
    const monitor=initMonitor({onReady:()=>ready++});
    env.elements.get("monitorPower").click();
    assert.equal(monitor.state,"booting");
    assert.equal(env.elements.get("monitorBootLines").textContent,"SYSTEM KLAR");
    assert.equal(env.timers.size,1);
    env.advanceTo(350);
    assert.equal(monitor.state,"on");
    assert.equal(ready,1);
  }finally{env.restore()}
});

test("late-eighties CRT font is loaded with Danish-language capable fallback",()=>{
  assert.match(html,/fonts\.googleapis\.com\/css2\?family=VT323/);
  assert.match(css,/font-family:"VT323",ui-monospace/);
  assert.match(css,/\.monitor-controls\{[^}]*font-family:ui-monospace/);
  assert.match(css,/\.hero h1\{[\s\S]*?font-size:clamp\(60px,8\.4vw,123px\)/);
});


test("boot runs silently with no synthetic audio dependency",()=>{
  const monitor=readFileSync("public/monitor.js","utf8");
  assert.doesNotMatch(monitor,/playPowerSound|AudioContext|stopBootAudio/);
  assert.match(monitor,/bootAudio\.play\(\)/);
  assert.match(monitor,/bootAudio\.stop\(\)/);
  assert.ok(html.includes('data-boot-sound-src=""'));
  assert.ok(monitor.includes("schedule(ready,BOOT_DURATION_MS)"));
  assert.equal(BOOT_DURATION_MS,5200);
});

test("startup diagnostic text resembles a serial-ROM terminal, not a marketing splash",()=>{
  assert.equal(BOOT_STEPS.length,9);
  assert.equal(BOOT_STEPS[0].text,"TD-2000 TERMINAL   ROM V1.7");
  assert.ok(BOOT_STEPS.some(x=>x.text.includes("64 KB RAM")));
  assert.ok(BOOT_STEPS.some(x=>x.text.includes("TEGNGENERATOR")));
  assert.ok(BOOT_STEPS.some(x=>x.text.includes("TASTATUR")));
  assert.ok(BOOT_STEPS.some(x=>x.text.includes("9600 8N1")));
  assert.ok(BOOT_STEPS.some(x=>x.text.includes("VÆRTSSYSTEM")));
  assert.ok(BOOT_STEPS.at(-1).at<BOOT_DURATION_MS);
  assert.ok(css.includes("align-items:flex-start;justify-content:flex-start"));
  assert.ok(css.includes("animation:boot-line-materialize .22s"));
});

test("reduced-motion users can turn monitor off immediately",()=>{
  const env=fakeEnvironment({reduced:true,remembered:true});
  try{
    let shutdown=0;
    const monitor=initMonitor({onShutdown:()=>shutdown++});
    env.elements.get("monitorPower").click();
    assert.equal(monitor.state,"off");
    assert.equal(shutdown,1);
    assert.equal(env.timers.size,0);
  }finally{env.restore()}
});

test("supplied recording starts buffering at initialization and plays synchronously on click",()=>{
  const calls=[];
  const fakeAudio={
    preload:"none",src:"",currentTime:12,
    load(){calls.push("load")},
    play(){calls.push("play");return Promise.resolve()},
    pause(){calls.push("pause")}
  };
  const sound=preloadBootAudio("/assets/my-boot.mp3",()=>fakeAudio);
  assert.equal(fakeAudio.preload,"auto");
  assert.equal(fakeAudio.src,"/assets/my-boot.mp3");
  assert.deepEqual(calls,["load"],"preload happens before pressing the switch");
  sound.play();
  assert.deepEqual(calls,["load","pause","play"],"click launches playback immediately");
  assert.equal(fakeAudio.currentTime,0);
  sound.stop();
  assert.equal(calls.at(-1),"pause");
});

test("physical power switch plays user recording at click time and cuts it off on shutdown",()=>{
  const env=fakeEnvironment();
  const previousAudio=globalThis.Audio;
  const calls=[];
  try{
    env.elements.get("monitorShell").dataset.bootSoundSrc="/user-boot.mp3";
    globalThis.Audio=class{
      constructor(){this.currentTime=0}
      load(){calls.push("load")}
      play(){calls.push("play");return Promise.resolve()}
      pause(){calls.push("pause")}
    };
    const monitor=initMonitor({});
    assert.deepEqual(calls,["load"]);
    env.elements.get("monitorPower").click();
    assert.equal(monitor.state,"booting");
    assert.deepEqual(calls,["load","pause","play"]);
    env.advanceTo(BOOT_DURATION_MS);
    env.elements.get("monitorPower").click();
    assert.equal(monitor.state,"powering-down");
    assert.equal(calls.at(-1),"pause");
  }finally{
    if(previousAudio===undefined)delete globalThis.Audio;
    else globalThis.Audio=previousAudio;
    env.restore();
  }
});

test("without a supplied file there is no attempt to load or play audio",()=>{
  let invoked=0;
  const audio=preloadBootAudio("",()=>{invoked++;throw Error("not expected")});
  audio.play();audio.stop();
  assert.equal(invoked,0);
});
