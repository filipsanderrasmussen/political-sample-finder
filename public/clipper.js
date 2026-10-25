// Taledatabase 2000 / LYDKLIPPER
// Clip markers refer to absolute seconds in the ORIGINAL MP3 recording.
// Streaming PCM capture avoids fetching an entire multi-hour parliamentary file.
export const MAX_CLIP_SECONDS=30;
export const MIN_CLIP_SECONDS=.05;
const OFFICIAL_DIRECT_MP3=/^https:\/\/cdnapi\.kaltura\.com\/p\/2158211\/sp\/0\/playManifest\/entryId\/1_[a-z0-9]+\/protocol\/http\/flavorParamIds\/0\/format\/url\/\d{2}-\d{2}-\d{4}_\d{2}-\d{2}_salen\.mp3$/i;
export function approvedClipSource(src){
 return typeof src==="string"&&src.length<=400&&OFFICIAL_DIRECT_MP3.test(src);
}

export function formatClipTime(value){
  if(!Number.isFinite(value)||value<0)return "00:00:00.000";
  const ms=Math.round(value*1000);
  const hours=Math.floor(ms/3600000);
  const min=Math.floor(ms/60000)%60;
  const sec=Math.floor(ms/1000)%60;
  return [hours,min,sec].map(x=>String(x).padStart(2,"0")).join(":")+"."+String(ms%1000).padStart(3,"0");
}

export function parseClipTime(value){
  const input=String(value||"").trim();
  const match=/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(input);
  if(!match)return NaN;
  const hours=Number(match[1]||0),minutes=Number(match[2]),seconds=Number(match[3]);
  if(minutes>59||seconds>59)return NaN;
  return hours*3600+minutes*60+seconds+Number((match[4]||"").padEnd(3,"0"))/1000;
}

export function validateClip(start,end,duration=Infinity){
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)
    throw new Error("Angiv gyldigt IN og OUT. OUT skal ligge efter IN.");
  if(end-start<MIN_CLIP_SECONDS)
    throw new Error("Udklippet skal være mindst 0,05 sekunder.");
  if(end-start>MAX_CLIP_SECONDS+.00001)
    throw new Error("Maksimum er 30 sekunder pr. udklip.");
  if(Number.isFinite(duration)&&end>duration+.01)
    throw new Error("OUT ligger efter optagelsens slutning.");
  return {start,end,seconds:end-start};
}

// Sample-accurate WAV length. Source seeking into a compressed MP3 may still
// have a small decoder/seek offset; never claim word-accurate transcript timing.
export function encodeWav(chunks,sampleRate,frameCount){
  if(!Number.isInteger(frameCount)||frameCount<1||!Number.isFinite(sampleRate)||sampleRate<8000)
    throw new Error("Ugyldige lyddata.");
  const size=44+frameCount*4; // 16-bit stereo PCM
  const bytes=new ArrayBuffer(size),view=new DataView(bytes);
  let index=0;
  const str=s=>{for(let i=0;i<s.length;i++)view.setUint8(index++,s.charCodeAt(i));};
  const u16=x=>{view.setUint16(index,x,true);index+=2;};
  const u32=x=>{view.setUint32(index,x,true);index+=4;};
  str("RIFF");u32(size-8);str("WAVE");str("fmt ");u32(16);
  u16(1);u16(2);u32(sampleRate);u32(sampleRate*4);u16(4);u16(16);
  str("data");u32(frameCount*4);
  let written=0;
  for(const chunk of chunks){
    const left=new Float32Array(chunk.left),right=new Float32Array(chunk.right);
    const count=Math.min(left.length,right.length,frameCount-written);
    for(let i=0;i<count;i++){
      for(const value of [left[i],right[i]]){
        const v=Math.max(-1,Math.min(1,value));
        view.setInt16(index,v<0?Math.round(v*32768):Math.round(v*32767),true);
        index+=2;
      }
    }
    written+=count;
    if(written===frameCount)break;
  }
  if(written!==frameCount)throw new Error("Lydoptagelsen er ufuldstændig. Prøv igen.");
  return new Blob([bytes],{type:"audio/wav"});
}

function waitForMedia(media,event,condition,signal,timeout=20000){
  if(condition())return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const clean=()=>{
      clearTimeout(timer);
      media.removeEventListener(event,done);
      media.removeEventListener("error",failed);
      signal?.removeEventListener("abort",cancel);
    };
    const done=()=>{clean();resolve();};
    const failed=()=>{clean();reject(new Error("Lydserveren kunne ikke levere optagelsen."));};
    const cancel=()=>{clean();reject(new Error("Udklip afbrudt."));};
    const timer=setTimeout(()=>{clean();reject(new Error("Lydserveren svarede ikke i tide."));},timeout);
    media.addEventListener(event,done,{once:true});
    media.addEventListener("error",failed,{once:true});
    signal?.addEventListener("abort",cancel,{once:true});
    if(signal?.aborted)cancel();
    else if(condition())done();
  });
}

export async function captureWav({src,start,end,signal,onProgress=()=>{}}){
  validateClip(start,end);
  const Ctx=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!Ctx||!globalThis.AudioWorkletNode)
    throw new Error("Din browser understøtter ikke WAV-optagelse. Prøv nyere Chrome.");
  // Start/resume the audio engine inside the real export click gesture.
  const context=new Ctx();
  const resumed=context.resume();
  const media=new Audio();
  const abort=()=>{try{media.pause()}catch{}};
  signal?.addEventListener("abort",abort,{once:true});
  let worklet=null,watch=null;
  try{
    // Official Kaltura MP3 supports CORS and native HTTP Range streaming.
    // Direct media prevents Cloudflare caching from stripping Range headers.
    if(!approvedClipSource(src))throw new Error("Kun Folketingets originale MP3-lyd kan eksporteres.");
    media.crossOrigin="anonymous";
    media.preload="auto";
    media.src=src;
    media.load();
    await Promise.all([
      resumed,
      context.audioWorklet.addModule("/clip-worklet.js"),
      waitForMedia(media,"loadedmetadata",()=>media.readyState>=1,signal)
    ]);
    validateClip(start,end,media.duration);
    media.currentTime=start;
    if(start>0)await waitForMedia(media,"seeked",()=>!media.seeking&&Math.abs(media.currentTime-start)<.02,signal);
    if(signal?.aborted)throw new Error("Udklip afbrudt.");

    const frameCount=Math.round((end-start)*context.sampleRate);
    const chunks=[];
    let received=0;
    const done=new Promise((resolve,reject)=>{
      worklet=new AudioWorkletNode(context,"taledatabase-recorder",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
      worklet.port.onmessage=e=>{
        if(e.data?.type==="frames"){
          chunks.push({left:e.data.left,right:e.data.right});
          received+=new Float32Array(e.data.left).length;
          onProgress(Math.min(1,received/frameCount));
        }else if(e.data?.type==="complete"){
          resolve();
        }
      };
      media.addEventListener("error",()=>reject(new Error("MP3-afspilningen blev afbrudt.")),{once:true});
      media.addEventListener("ended",()=>{if(received<frameCount)reject(new Error("Lydkilden stoppede før OUT."));},{once:true});
    });
    const source=context.createMediaElementSource(media);
    source.connect(worklet);
    worklet.connect(context.destination);
    // Do not record the silent AudioContext frames while the remote MP3 seeks
    // or buffers. Arm the worklet only when actual media playback begins.
    let captureStarted=false;
    media.addEventListener("playing",()=>{
      if(!captureStarted){
        captureStarted=true;
        worklet.port.postMessage({type:"start",frames:frameCount});
      }else worklet.port.postMessage({type:"resume"});
    });
    media.addEventListener("waiting",()=>{
      if(captureStarted)worklet.port.postMessage({type:"pause"});
    });
    // Audio is played through the worklet and heard while recording.
    await media.play();
    const timeout=new Promise((_,reject)=>{
      watch=setTimeout(()=>reject(new Error("Optagelsen tog for lang tid. Prøv igen.")),Math.ceil((end-start)*1000)+45000);
    });
    const cancelled=new Promise((_,reject)=>{
      if(signal?.aborted)reject(new Error("Udklip afbrudt."));
      signal?.addEventListener("abort",()=>reject(new Error("Udklip afbrudt.")),{once:true});
    });
    await Promise.race([done,timeout,cancelled]);
    const wav=encodeWav(chunks,context.sampleRate,frameCount);
    return {wav,seconds:frameCount/context.sampleRate,sampleRate:context.sampleRate};
  }finally{
    clearTimeout(watch);
    signal?.removeEventListener("abort",abort);
    try{worklet?.port.postMessage({type:"cancel"});media.pause();media.removeAttribute("src");media.load()}catch{}
    try{await context.close()}catch{}
  }
}

export function initClipper({audio}){
  const id=x=>document.getElementById(x);
  const $start=id("clipIn"),$end=id("clipOut");
  const $message=id("clipStatus"),$length=id("clipLength");
  let source=null,controller=null,previewing=false,previewTimer=null;

  const progress=()=>{const a=parseClipTime($start.value),b=parseClipTime($end.value);
    $length.textContent=Number.isFinite(a)&&Number.isFinite(b)&&b>a?
      (b-a).toFixed(2).replace(".",",")+" SEK.":"—";
  };
  const haltPreview=()=>{
    previewing=false;clearInterval(previewTimer);previewTimer=null;
    id("clipPreview").textContent="▶ FORHØR UDKLIP";
  };
  const close=()=>{
    haltPreview();
    controller?.abort();controller=null;
    id("clipExport").disabled=false;
    id("clipExport").textContent="↓ GEM WAV";
  };
  const open=(url,near)=>{
    close();
    source=url;
    const center=Number.isFinite(near)&&near>0?near:0;
    const start=Math.max(0,center-2);
    const end=start+8;
    $start.value=formatClipTime(start);
    $end.value=formatClipTime(end);
    $message.textContent="Markér IN og OUT ved afspilning. Maks. 30 sekunder.";
    progress();
  };
  const position=()=>{
    const t=audio.currentTime;
    if(!Number.isFinite(t))throw new Error("Vent på, at MP3'en er indlæst.");
    return Math.max(0,t);
  };
  id("clipSetIn").onclick=()=>{
    try{
      $start.value=formatClipTime(position());
      const end=parseClipTime($end.value);
      if(end<=position())$end.value=formatClipTime(position()+5);
      progress();
    }catch(e){$message.textContent=e.message}
  };
  id("clipSetOut").onclick=()=>{
    try{
      const t=position();
      $end.value=formatClipTime(t);
      if(t<=parseClipTime($start.value))$start.value=formatClipTime(Math.max(0,t-1));
      progress();
    }catch(e){$message.textContent=e.message}
  };
  for(const field of [$start,$end]){
    field.addEventListener("change",()=>{
      const n=parseClipTime(field.value);
      if(Number.isFinite(n))field.value=formatClipTime(n);
      progress();
    });
  }
  for(const button of document.querySelectorAll("[data-clip-nudge]")){
    button.addEventListener("click",()=>{
      const field=button.dataset.clipTarget==="in"?$start:$end;
      const prev=parseClipTime(field.value);
      if(Number.isFinite(prev)){
        field.value=formatClipTime(Math.max(0,prev+Number(button.dataset.clipNudge)));
        progress();
      }
    });
  }
  id("clipPreview").onclick=async()=>{
    if(previewing){audio.pause();haltPreview();return;}
    try{
      if(!source)throw new Error("Vælg en optagelse først.");
      const {start,end}=validateClip(parseClipTime($start.value),parseClipTime($end.value),audio.duration);
      audio.pause();
      audio.currentTime=start;
      await audio.play();
      previewing=true;
      id("clipPreview").textContent="■ STOP FORHØR";
      previewTimer=setInterval(()=>{
        if(!previewing)return;
        if(audio.currentTime>=end||audio.ended||audio.paused){audio.pause();haltPreview();}
      },25);
      $message.textContent="Forhør fra "+formatClipTime(start)+" til "+formatClipTime(end)+".";
    }catch(e){haltPreview();$message.textContent=e.message}
  };
  id("clipExport").onclick=async()=>{
    if(controller){controller.abort();return;}
    let filename,token=null;
    try{
      if(!source)throw new Error("Vælg en optagelse først.");
      const {start,end,seconds}=validateClip(parseClipTime($start.value),parseClipTime($end.value),audio.duration);
      audio.pause();haltPreview();
      controller=new AbortController();
      token=controller;
      id("clipExport").textContent="■ AFBRYD";
      $message.textContent="OPTAGER UDKLIP – "+seconds.toFixed(2).replace(".",",")+" SEKUNDER…";
      filename="TD2000_"+new Date().toISOString().slice(0,10)+"_"+String(Math.floor(start*1000))+"-"+String(Math.floor(end*1000))+".wav";
      const result=await captureWav({src:source,start,end,signal:token.signal,onProgress:p=>{
        if(controller===token)$message.textContent="OPTAGER WAV "+Math.round(p*100)+" % · realtid";
      }});
      if(controller!==token)return;
      const href=URL.createObjectURL(result.wav);
      const link=document.createElement("a");
      link.href=href;link.download=filename;
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(href),60000);
      $message.textContent="WAV KLAR · "+result.seconds.toFixed(3)+" sek. · "+Math.round(result.sampleRate/1000)+" kHz / 16-bit stereo.";
    }catch(e){if(controller===token)$message.textContent=e.message||"Kunne ikke gemme udklippet.";}
    finally{
      if(controller===token){
        controller=null;
        id("clipExport").disabled=false;
        id("clipExport").textContent="↓ GEM WAV";
      }
    }
  };
  return {open,close};
}
