import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {findRecesses,recessCorrection} from "../src/audio-timeline.js";
import {experimentalWordSeek} from "../public/word-seek.js";

// Use the exact helpers shipped to the browser, with a fake persistent localStorage.
const js=readFileSync("public/app.js","utf8");
const begin=js.indexOf("function mins("),end=js.indexOf("function wordPlayback(",begin);
assert.ok(begin>=0&&end>begin,"Audio helper block must exist");
const stored=new Map();
const localStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,String(v))};
const helpers=new Function("localStorage",js.slice(begin,end)+
  ";return {manualAnchor,recessOffset,seconds};")(localStorage);

function fixture(path){
 const meeting=JSON.parse(readFileSync(path,"utf8"));
 const speeches=meeting.speeches.map((s,idx)=>({...s,idx,meeting_id:meeting.id}));
 return {meeting,speeches,pauses:findRecesses(speeches)};
}

test("19 October: paused MP3 matches user's wrong speaker precisely if a legacy default anchor is stored",()=>{
 const {meeting,speeches,pauses}=fixture("public/archive/xml/20261_M5.json");
 assert.deepEqual(pauses.filter(p=>p.to<12*3600),[
  {meeting_id:meeting.id,from:9*3600+57*60+18,to:10*3600+8*60+8,seconds:650}
 ]);
 const at=speeches.findIndex(s=>s.speaker==="Allan Feldt (DF)"&&s.clock==="10:49:29");
 assert.ok(at>=0);
 const row={...speeches[at],first_clock:"09:00",next_clock:speeches[at+1].clock,
   pause_seconds:recessCorrection(pauses,meeting.id,speeches[at].clock).seconds};
 const p={mp3_url:meeting.audio_url};
 const word=experimentalWordSeek(row,"moms");
 assert.equal(word.seconds,19);
 assert.equal(row.pause_seconds,650);
 stored.clear();
 assert.equal(helpers.seconds(row,p)+word.seconds,1*3600+38*60+58);
 // Old client stored the unchanged filename start on a normal replay.
 stored.set("psf.anchor:"+p.mp3_url,"09:00");
 assert.equal(helpers.manualAnchor(row,p),null);
 assert.equal(helpers.recessOffset(row,p),650);
 assert.equal(helpers.seconds(row,p)+word.seconds,1*3600+38*60+58,
   "unchanged saved start must not bypass the 10:50 pause");
 stored.set("psf.anchor:"+p.mp3_url,"09:00:00");
 assert.equal(helpers.manualAnchor(row,p),null,"equivalent HH:MM:SS clock is not a manual override");
 assert.equal(helpers.seconds(row,p)+word.seconds,1*3600+38*60+58);
});

test("different genuine manual start still overrides pause correction and can be restored",()=>{
 const {meeting,speeches,pauses}=fixture("public/archive/xml/20261_M5.json");
 const at=speeches.findIndex(s=>s.clock==="10:49:29");
 const row={...speeches[at],first_clock:"09:00",
  pause_seconds:recessCorrection(pauses,meeting.id,speeches[at].clock).seconds};
 const p={mp3_url:meeting.audio_url};
 stored.set("psf.anchor:"+p.mp3_url,"08:55");
 assert.equal(helpers.manualAnchor(row,p),"08:55");
 assert.equal(helpers.recessOffset(row,p),0);
 assert.equal(helpers.seconds(row,p),1*3600+54*60+29);
 stored.set("psf.anchor:"+p.mp3_url,"09:00");
 assert.equal(helpers.manualAnchor(row,p),null);
 assert.equal(helpers.recessOffset(row,p),650);
 assert.equal(helpers.seconds(row,p),1*3600+38*60+39);
});

test("4 June verified break and 26 August control retain earlier behaviour",()=>{
 const june=fixture("public/archive/xml/20241_M104.json");
 const speech=june.speeches.find(s=>s.speaker==="Jakob Engel-Schmidt"&&s.clock==="13:20:44");
 const p={mp3_url:june.meeting.audio_url};
 const row={...speech,first_clock:"10:00",pause_seconds:recessCorrection(june.pauses,june.meeting.id,speech.clock).seconds};
 stored.set("psf.anchor:"+p.mp3_url,"10:00");
 assert.equal(helpers.seconds(row,p),2*3600+33*60+47);
 const august=fixture("public/archive/xml/20252_M19.json");
 const wolf=august.speeches.find(s=>s.content.includes("problemulv"));
 const a={mp3_url:august.meeting.audio_url};
 stored.delete("psf.anchor:"+a.mp3_url);
 assert.equal(helpers.seconds({...wolf,first_clock:"13:00",pause_seconds:0},a),1*3600+17*60+20);
});
