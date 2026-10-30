import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {clockSeconds,findRecesses,recessCorrection} from "../src/audio-timeline.js";

function sourceSpeeches(path){
 const d=JSON.parse(readFileSync(path,"utf8"));
 return {id:d.id,speeches:d.speeches.map((x,idx)=>({...x,idx,meeting_id:d.id}))};
}

test("June 4 2025: corrected time lands near the real football/sports speech",()=>{
 const {id,speeches}=sourceSpeeches("public/archive/xml/20241_M104.json");
 const events=findRecesses(speeches);
 assert.deepEqual(events,[{meeting_id:id,from:12*3600+13*60+5,to:13*3600+2,seconds:2817}]);
 assert.deepEqual(recessCorrection(events,id,"12:13:05"),{seconds:0,count:0});
 assert.deepEqual(recessCorrection(events,id,"13:00:02"),{seconds:2817,count:1});
 const target=speeches.find(s=>s.speaker==="Jakob Engel-Schmidt"&&s.content.includes("håndbold"));
 assert.equal(target.clock,"13:20:44");
 assert.equal(clockSeconds(target.clock)-clockSeconds("10:00:00")-2817,2*3600+33*60+47);
 // User listened at 02:34:08, 21 seconds into this intervention.
});

test("October 20 2026: PDF's explicit adjournment clock is preferred over its rounded speech clock",()=>{
 const {id,speeches}=sourceSpeeches("public/archive/20261_M6.json");
 const events=findRecesses(speeches);
 assert.deepEqual(events,[{meeting_id:id,from:11*3600+47*60,to:13*3600,seconds:4380}]);
 const target=speeches.find(s=>s.speaker.includes("Lars Boje")&&s.content.includes("fodbold"));
 assert.equal(target.clock,"13:45");
 assert.deepEqual(recessCorrection(events,id,target.clock),{seconds:4380,count:1});
 assert.equal(clockSeconds(target.clock)-clockSeconds("09:00")-4380,3*3600+32*60);
});

test("August 26 2026: no explicit recess means no inferred correction",()=>{
 const {id,speeches}=sourceSpeeches("public/archive/xml/20252_M19.json");
 const events=findRecesses(speeches);
 assert.deepEqual(events,[]);
 assert.deepEqual(recessCorrection(events,id,"14:17:20"),{seconds:0,count:0});
});

test("never infer breaks from large gaps, planned announcements or unmatched events",()=>{
 const id="20241_M99";
 const rows=[
  {meeting_id:id,idx:0,clock:"09:00:00",content:"Mødet er åbnet"},
  {meeting_id:id,idx:1,clock:"09:40:00",content:"Vi udsætter behandlingen af dette forslag."},
  {meeting_id:id,idx:2,clock:"10:00:00",content:"Mødet er genoptaget."},
  {meeting_id:id,idx:3,clock:"10:10:00",content:"Mødet udsættes måske efter pausen."},
  {meeting_id:id,idx:4,clock:"10:40:00",content:"Næste taler."},
  {meeting_id:id,idx:5,clock:"11:00:00",content:"Mødet er udsat."},
  {meeting_id:id,idx:6,clock:"11:02:00",content:"Mødet er genoptaget."},
  {meeting_id:id,idx:7,clock:"11:15:00",content:"Mødet er udsat."},
  {meeting_id:id,idx:8,clock:"11:45:00",content:"Mødet er genoptaget."},
  {meeting_id:id,idx:9,clock:"12:00:00",content:"Mødet er udsat."},
  {meeting_id:id,idx:10,clock:"12:30:00",content:"Mødet er genoptaget."},
  {meeting_id:id,idx:11,clock:"12:40:00",content:"Fortsætter."}
 ];
 const pauses=findRecesses(rows);
 assert.equal(pauses.length,2);
 assert.deepEqual(recessCorrection(pauses,id,"11:30:00"),{seconds:0,count:0});
 assert.deepEqual(recessCorrection(pauses,id,"12:40:00"),{seconds:3600,count:2});
 assert.deepEqual(recessCorrection(pauses,"20241_M88","12:40:00"),{seconds:0,count:0});
});
