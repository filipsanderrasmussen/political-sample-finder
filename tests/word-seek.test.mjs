import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {estimatedWordSeek} from "../public/word-seek.js";

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
 assert.equal(match.wordIndex,12*10+4);
 assert.ok(match.seconds>50);
});

test("speech-only speaker searches never make an estimated jump",()=>{
 assert.equal(estimatedWordSeek(speech.content,"",speech.clock,following.clock),null);
});
