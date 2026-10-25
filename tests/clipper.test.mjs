import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {formatClipTime,parseClipTime,validateClip,encodeWav,MAX_CLIP_SECONDS} from "../public/clipper.js";

const html=readFileSync("public/index.html","utf8");
const css=readFileSync("public/style.css","utf8");
const js=readFileSync("public/app.js","utf8");
const processor=readFileSync("public/clip-worklet.js","utf8");

test("precise timecode round trips to the nearest millisecond",()=>{
  for(const n of [0,.001,3.65,15.09,60,3600,3661.237,27428.999]){
    assert.ok(Math.abs(parseClipTime(formatClipTime(n))-n)<.00001);
  }
  assert.equal(formatClipTime(3661.237),"01:01:01.237");
  assert.equal(parseClipTime("01:01:01.237"),3661.237);
  assert.equal(parseClipTime("01:02.4"),62.4);
  assert.ok(Number.isNaN(parseClipTime("01:61:01")));
  assert.ok(Number.isNaN(parseClipTime("-00:10")));
  assert.ok(Number.isNaN(parseClipTime("ikke lyd")));
});

test("clip selection enforces bounds and short, useful sample lengths",()=>{
  assert.equal(MAX_CLIP_SECONDS,30);
  const clip=validateClip(120.01,128.51,200);
  assert.equal(clip.start,120.01);
  assert.equal(clip.end,128.51);
  assert.ok(Math.abs(clip.seconds-8.5)<1e-10);
  assert.throws(()=>validateClip(-1,5),/gyldigt/);
  assert.throws(()=>validateClip(5,5),/gyldigt/);
  assert.throws(()=>validateClip(5,4),/gyldigt/);
  assert.throws(()=>validateClip(2,2.01),/mindst/);
  assert.throws(()=>validateClip(2,33),/Maksimum/);
  assert.throws(()=>validateClip(2,9,8),/slutning/);
});

test("WAV exports valid little-endian 16-bit stereo PCM with exact frame count",async()=>{
  const left=new Float32Array([0,1,-1,.5]);
  const right=new Float32Array([.5,-.5,0,1]);
  const wav=encodeWav([{left:left.buffer,right:right.buffer}],48000,4);
  assert.equal(wav.type,"audio/wav");
  const bytes=new DataView(await wav.arrayBuffer());
  const ascii=(from,len)=>String.fromCharCode(...new Uint8Array(bytes.buffer,from,len));
  assert.equal(ascii(0,4),"RIFF");
  assert.equal(bytes.getUint32(4,true),36+16);
  assert.equal(ascii(8,4),"WAVE");
  assert.equal(ascii(12,4),"fmt ");
  assert.equal(bytes.getUint16(20,true),1);
  assert.equal(bytes.getUint16(22,true),2);
  assert.equal(bytes.getUint32(24,true),48000);
  assert.equal(bytes.getUint32(28,true),192000);
  assert.equal(bytes.getUint16(34,true),16);
  assert.equal(ascii(36,4),"data");
  assert.equal(bytes.getUint32(40,true),16);
  assert.deepEqual(Array.from({length:8},(_,i)=>bytes.getInt16(44+i*2,true)),
    [0,16384,32767,-16384,-32768,0,16384,32767]);
  assert.throws(()=>encodeWav([],48000,5),/ufuldstændig/);
});

test("clipper is inside current player, and preserves the existing playback workflow",()=>{
  for(const id of ["clipIn","clipOut","clipSetIn","clipSetOut","clipPreview","clipExport","clipStatus","clipLength"]){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/data-clip-nudge="-0\.01"/);
  assert.match(html,/data-clip-nudge="0\.01"/);
  assert.match(html,/Vurdér brugsrettigheder før offentliggørelse/);
  assert.match(css,/\.clip-markers\{display:grid/);
  assert.match(js,/import \{ initClipper \} from "\.\/clipper\.js"/);
  assert.match(js,/clipper=initClipper/);
  assert.match(js,/clipper\?\.open\(p\.mp3_url,position\)/);
  assert.match(js,/clipper\?\.close\(\)/);
  assert.match(processor,/registerProcessor\("taledatabase-recorder"/);
  assert.match(processor,/this\.remaining-=frames/);
});

test("sample recording is bounded and sent through a same-origin streaming URL",()=>{
  const source=readFileSync("public/clipper.js","utf8");
  assert.match(source,/\/api\/audio-stream\?source=/);
  assert.match(source,/createMediaElementSource\(media\)/);
  assert.match(source,/AudioWorkletNode\(context,"taledatabase-recorder"/);
  assert.match(source,/Math\.round\(\(end-start\)\*context\.sampleRate\)/);
  assert.match(source,/new Blob\(\[bytes\],\{type:"audio\/wav"\}\)/);
  assert.doesNotMatch(source,/ffmpeg|MediaRecorder|response\.arrayBuffer\(\)/);
});
