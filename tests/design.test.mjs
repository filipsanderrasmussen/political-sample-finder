import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const html=readFileSync("public/index.html","utf8");
const css=readFileSync("public/style.css","utf8");
const js=readFileSync("public/app.js","utf8");

test("phosphor terminal homepage keeps search controls and no marketing hero",()=>{
  assert.match(html,/class="terminal-frame"/);
  assert.match(html,/id="siteTitle"/);
  assert.match(html,/POLITICAL/);
  assert.match(html,/SAMPLE FINDER/);
  assert.match(html,/id="searchForm"/);
  assert.match(html,/id="query"/);
  assert.match(html,/id="speaker"/);
  assert.match(html,/id="searchBtn" type="submit"/);
  assert.doesNotMatch(html,/Find ordene\.|Hør stemmen\.|Søg i Folketingets referater, find omtrent/);
});

test("actual live stats are bound to three terminal readouts",()=>{
  for(const id of ["statMeetings","statSpeeches","statAudio"]){
    assert.match(html,new RegExp('id="'+id+'"'));
    assert.match(js,new RegExp('\\$\\("'+id+'"\\)\\.textContent'));
  }
  assert.match(css,/--accent:#4aff8f/);
  assert.match(css,/\.blinking-cursor/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test("audio playback, transcript reading and archive admin tools survive redesign",()=>{
  for(const id of ["sampleAudio","playerSeek","playerBack","playerForward","transcriptList","transcriptPdf","importDialog","openImport","syncArchiveBtn","adminLoginBtn","favTab","allTab"]){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(js,/function openPlayer\(row,p\)/);
  assert.match(js,/function skipAudio\(delta\)/);
  assert.match(js,/function loadTranscript\(row\)/);
  assert.match(js,/class="link-btn listen-btn"/);
});
