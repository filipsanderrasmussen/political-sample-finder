import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {contextParams} from "../src/worker.js";

test("transcript context is centered on the clicked speech, not inferred from minutes",()=>{
  assert.deepEqual(contextParams("20251_M41",88),{
    meetingId:"20251_M41",index:88,start:81,end:95
  });
  assert.deepEqual(contextParams("20251_M41",2).start,0);
  assert.throws(()=>contextParams("20251_M41",-1));
  assert.throws(()=>contextParams("20251_M41","abc"));
  assert.throws(()=>contextParams("INVALID",1));
});

test("player keeps 15-second seek and renders read-only source context",()=>{
  const html=readFileSync("public/index.html","utf8");
  const js=readFileSync("public/app.js","utf8");
  assert.match(html,/id="transcriptList"/);
  assert.match(html,/id="transcriptPdf"/);
  assert.doesNotMatch(html,/id="transcriptPrev"|id="transcriptNext"/);
  assert.match(js,/loadTranscript\(row\)/);
  assert.match(js,/data\.items/);
  assert.match(js,/skipAudio\(-15\)/);
  assert.match(js,/skipAudio\(15\)/);
  assert.match(js,/DET VALGTE INDLÆG/);
});
