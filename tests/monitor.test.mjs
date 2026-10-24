import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {BOOT_STEPS,BOOT_DURATION_MS,playPowerSound,initMonitor} from "../public/monitor.js";
import {BOOT_SOUND_CUES} from "../public/boot-audio.js";

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
  assert.match(css,/\.monitor-shell\{[\s\S]*?height:100dvh/);
  assert.match(css,/\.monitor-screen\{[\s\S]*?overflow:auto/);
  assert.match(css,/\.monitor-shell\[data-power="off"\] \.terminal-frame/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/--bezel-side:clamp\(15px,1\.8vw,30px\)/);
  assert.match(css,/--panel-height:74px/);
  assert.match(css,/\.monitor-shell\[data-power="off"\] \.monitor-boot\{display:none\}/);
  assert.match(css,/\.monitor-shell\[data-power="off"\] \.monitor-screen\{background:#010101/);
  assert.match(css,/\.monitor-shell\[data-power="off"\]::after\{display:none\}/);

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
      BOOT_STEPS.filter(x=>x.at<=2400).map(x=>"> "+x.text)
    );
    assert.equal(ready,0);
    env.advanceTo(BOOT_DURATION_MS-1);
    assert.deepEqual(
      env.elements.get("monitorBootLines").children.map(x=>x.textContent),
      BOOT_STEPS.map(x=>"> "+x.text)
    );
    assert.equal(monitor.state,"booting");
    env.advanceTo(BOOT_DURATION_MS);
    assert.equal(monitor.state,"on");
    assert.equal(ready,1);
    assert.equal(env.storage.get("td2000.monitor.booted"),"1");
    assert.equal(env.elements.get("terminalFrame").inert,false);
    assert.equal(env.elements.get("monitorPowerLabel").textContent,"SLUK");
    power.click();
    assert.equal(monitor.state,"off");
    assert.equal(shutdown,1);
    assert.equal(env.storage.has("td2000.monitor.booted"),false);
    assert.equal(env.elements.get("terminalFrame").inert,true);
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


test("power-on audio schedules mechanical CRT, drive and POST phases in sync with boot",()=>{
  const env=fakeEnvironment();
  try{
    const sources=[];
    const params=[];
    class AudioParam {
      value=0;
      events=[];
      setValueAtTime(value,time){this.value=value;this.events.push({method:"set",value,time})}
      linearRampToValueAtTime(value,time){this.events.push({method:"linear",value,time})}
      exponentialRampToValueAtTime(value,time){this.events.push({method:"exponential",value,time})}
      cancelScheduledValues(){}
      setTargetAtTime(){}
    }
    class Node {
      constructor(){this.gain=new AudioParam;this.frequency=new AudioParam;this.Q=new AudioParam;
        this.threshold=new AudioParam;this.knee=new AudioParam;this.ratio=new AudioParam;
        this.attack=new AudioParam;this.release=new AudioParam}
      connect(dest){return dest}
      start(time){this.started=time;sources.push(this)}
      stop(time){this.stopped=time}
    }
    let context;
    env.elements.get("monitorPower");
    globalThis.window.AudioContext=class{
      constructor(){context=this;this.currentTime=0;this.sampleRate=22050;this.state="running";this.destination=new Node}
      createGain(){return new Node}
      createDynamicsCompressor(){return new Node}
      createBuffer(channels,frames){return {getChannelData:()=>new Float32Array(frames)}}
      createOscillator(){const node=new Node;params.push(node.frequency);return node}
      createBiquadFilter(){return new Node}
      createBufferSource(){return new Node}
      close(){this.state="closed";return Promise.resolve()}
    };
    const stop=playPowerSound();
    assert.equal(typeof stop,"function");
    assert.ok(sources.length>=35,"Relay, degaussing, fan, floppy clicks and beep must all play");
    assert.ok(sources.some(x=>x.started<.03),"Relay begins as soon as user presses power");
    assert.ok(sources.some(x=>x.started>=2&&x.started<=4.9),"Floppy seeks happen in the middle");
    assert.ok(sources.some(x=>x.started>=5.42&&x.started<=5.5),"POST beep fires near the end");
    assert.ok(params.some(p=>p.events.some(e=>e.value===920)),"POST frequency is generated");
    assert.equal(BOOT_DURATION_MS,6600);
    assert.deepEqual(BOOT_SOUND_CUES.map(x=>x.name),["relay","crt_degauss","fan_spinup","floppy_seek","post_beep"]);
    env.advanceTo(BOOT_DURATION_MS+381);
    assert.equal(context.state,"closed","Audio context is cleaned up after boot");
    stop();
  }finally{env.restore()}
});
