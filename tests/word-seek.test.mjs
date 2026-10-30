import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {estimatedWordSeek,experimentalWordSeek} from "../public/word-seek.js";
import {clockSeconds,findRecesses,recessCorrection} from "../src/audio-timeline.js";

const archive=JSON.parse(readFileSync("public/archive/xml/20252_M19.json","utf8"));
const speechIndex=archive.speeches.findIndex(x=>x.content.toLowerCase().includes("problemulv"));
const speech=archive.speeches[speechIndex];
const following=archive.speeches.slice(speechIndex+1).find(x=>x.clock>speech.clock);

test("real problemulv speech interpolates 41st of 143 words into a 39-second intervention",()=>{
  assert.equal(archive.date,"2026-08-26");
  assert.equal(speech.speaker,"Christian Rabjerg Madsen");
  assert.equal(speech.clock,"14:17:20");
  assert.equal(following.clock,"14:17:59");
  assert.deepEqual(estimatedWordSeek(speech.content,"problemulv",speech.clock,following.clock),
    {seconds:5,wordIndex:40,wordCount:143,duration:39});
});

test("same-time fragments, impossible speeds and missing next timestamp fall back to speech start",()=>{
 const text="Vi taler om en ulv og det er der mange gode grunde til.";
 assert.equal(estimatedWordSeek(text,"ulv","14:17:20","14:17:20"),null);
 assert.equal(estimatedWordSeek(text,"ulv","14:17:20",null),null);
 assert.equal(estimatedWordSeek(text,"ulv","14:17:20","14:17:24"),null);
 assert.equal(estimatedWordSeek(text,"ulv","14:17:20","14:17:19"),null);
 assert.equal(estimatedWordSeek(text,"ulv","14:17:20","15:17:20"),null);
 assert.equal(estimatedWordSeek(text,"ulv","not a clock","14:17:59"),null);
 assert.equal(estimatedWordSeek(speech.content,"nonsens","14:17:20","14:17:59"),null);
 assert.equal(estimatedWordSeek(speech.content,"","14:17:20","14:17:59"),null);
 assert.equal(estimatedWordSeek(speech.content,speech.content.split(" ")[0],"14:17:20","14:17:59"),null);
});

test("multiword searches prefer the complete adjacent phrase over isolated earlier words",()=>{
 const content=("Dette er et eksempel med ordet problem i sætningen. ").repeat(12)+
   "Til sidst kommer ordene problem ulv lige efter hinanden, som forventet. "+
   ("Dette er fortsat en del af det samlede indlæg. ").repeat(10);
 const match=estimatedWordSeek(content,"problem ulv","12:00:00","12:02:00");
 assert.ok(match,"A believable text duration and a phrase near the end should yield a seek");
 assert.equal(match.wordIndex,12*9+4);
 assert.ok(match.seconds>50);
});

test("speech-only speaker searches never make an estimated jump",()=>{
 assert.equal(estimatedWordSeek(speech.content,"",speech.clock,following.clock),null);
});

test("experimental combination matches the user's heard sports passage in the original audio",()=>{
  const meeting=JSON.parse(readFileSync("public/archive/xml/20241_M104.json","utf8"));
  const speeches=meeting.speeches.map((x,i)=>({...x,idx:i,meeting_id:meeting.id}));
  const pauseEvents=findRecesses(speeches);
  const index=speeches.findIndex(x=>x.speaker==="Jakob Engel-Schmidt" && x.content.includes("håndbold"));
  assert.ok(index>=0);
  const row={...speeches[index],next_clock:speeches[index+1].clock,
    pause_seconds:recessCorrection(pauseEvents,meeting.id,speeches[index].clock).seconds};
  const word=experimentalWordSeek(row,"håndbold");
  assert.ok(word);
  assert.equal(word.seconds,21);
  const position=clockSeconds(row.clock)-clockSeconds("10:00:00")-row.pause_seconds+word.seconds;
  assert.equal(position,2*3600+34*60+8); // 02:34:08, user listened and confirmed sports/boldbaner
});

test("experimental interpolation also works with no recess: problemulv",()=>{
  const meeting=JSON.parse(readFileSync("public/archive/xml/20252_M19.json","utf8"));
  const at=meeting.speeches.findIndex(x=>x.content.toLowerCase().includes("problemulv"));
  const row={...meeting.speeches[at],next_clock:meeting.speeches.slice(at+1).find(x=>x.clock>meeting.speeches[at].clock).clock,pause_seconds:0};
  const estimate=experimentalWordSeek(row,"problemulv");
  assert.equal(estimate.seconds,5);
  assert.equal(clockSeconds(row.clock)-clockSeconds("13:00:00")+estimate.seconds,1*3600+17*60+25);
});

test("third official XML meeting has independent plausible word interpolation",()=>{
  const meeting=JSON.parse(readFileSync("public/archive/xml/20261_M7.json","utf8"));
  const at=meeting.speeches.findIndex(x=>x.speaker==="Pia Olsen Dyhr" && x.content.includes("jernmarker"));
  assert.ok(at>=0);
  const row={...meeting.speeches[at],next_clock:meeting.speeches[at+1].clock,pause_seconds:0};
  const estimate=experimentalWordSeek(row,"jernmarker");
  assert.ok(estimate);
  assert.ok(estimate.seconds>=40 && estimate.seconds<estimate.duration);
});

test("rounded PDF clocks and unknown correction cannot enable experimental word hopping",()=>{
  const pdf=JSON.parse(readFileSync("public/archive/20261_M6.json","utf8"));
  const at=pdf.speeches.findIndex(x=>x.speaker.includes("Lars Boje")&&x.content.includes("fodbold"));
  assert.ok(at>=0);
  const row={...pdf.speeches[at],next_clock:pdf.speeches[at+1].clock,pause_seconds:4380};
  assert.equal(experimentalWordSeek(row,"fodbold"),null);
  const valid={...speech,next_clock:following.clock,pause_seconds:0};
  assert.ok(experimentalWordSeek(valid,"problemulv"));
  assert.equal(experimentalWordSeek({...valid,pause_seconds:undefined},"problemulv"),null);
  assert.equal(experimentalWordSeek({...valid,clock:"14:17"},"problemulv"),null);
  assert.equal(experimentalWordSeek({...valid,next_clock:"14:18"},"problemulv"),null);
  assert.equal(experimentalWordSeek({...valid,pause_seconds:-1},"problemulv"),null);
  assert.equal(experimentalWordSeek(valid,"irrelevant"),null);
});
