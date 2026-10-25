import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {xmlManifest, syncXmlBatch} from "../src/xml-archive.js";

const MP3="https://cdnapi.kaltura.com/p/2158211/sp/0/playManifest/entryId/1_mypod123/protocol/http/flavorParamIds/0/format/url/21-10-2026_13-00_salen.mp3";
const id="20261_M7", version="a".repeat(64);
const spec={id,samling:"20261",meeting_no:7,date:"2026-10-21",
 source_url:"https://www.folketingstidende.dk/samling/20261/salen/M7/20261_M7_referat.pdf",
 audio_url:MP3,version,speeches:2,status:"ready"};
const body={...spec,verified_at:"2026-10-25T12:00:00Z",speeches:[
 {speaker:"Henrik Frandsen (M)",party:"M",clock:"13:00:02",content:"Formanden åbner dette møde for Folketinget."},
 {speaker:"Medlem (S)",party:"S",clock:"13:00:45",content:"Vi har i dag et forslag om offentlighed."}
 ]};
function mockEnv(manifest=[spec]){
 const meetings=new Map(),speeches=new Map(),audio=new Map(),meta=new Map();
 const env={
 ASSETS:{async fetch(req){const route=new URL(req.url).pathname;
  if(route==="/archive/xml/manifest.json")return Response.json(manifest);
  if(route==="/archive/xml/"+id+".json")return Response.json(body);
  return new Response("Not found",{status:404});
 }},
 DB:{
  prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},
   async first(){if(sql.startsWith("SELECT status,imported_at"))return meetings.get(this.args[0])||null;
    if(sql.startsWith("SELECT MAX(idx)")){const rows=[...speeches.values()].filter(x=>x.meeting===this.args[0]);return {last_idx:Math.max(-1,...rows.map(x=>x.idx))};}
    return null;},
   async all(){if(sql.includes("FROM app_meta WHERE key LIKE"))return {results:[...meta].filter(x=>x[0].startsWith("xml:")).map(([key,value])=>({key,value}))};
    return {results:[]};}
  };},
  async batch(queries){for(const q of queries){
   if(q.sql.startsWith("INSERT INTO meetings"))meetings.set(q.args[0],{status:"xml-syncing",imported_at:q.args[7]});
   else if(q.sql.startsWith("DELETE FROM speeches")){for(const [k,v] of speeches){if(v.meeting===q.args[0])speeches.delete(k)}}
   else if(q.sql.startsWith("INSERT OR REPLACE INTO speeches"))speeches.set(q.args[0],{meeting:q.args[1],idx:q.args[2],party:q.args[7],clock:q.args[4]});
   else if(q.sql.startsWith("INSERT INTO meeting_audio"))audio.set(q.args[0],q.args[1]);
   else if(q.sql.startsWith("UPDATE meetings SET status='ready'"))meetings.set(q.args[2],{status:"ready",count:q.args[0]});
   else if(q.sql.startsWith("INSERT INTO app_meta"))meta.set(q.args[0],q.args[1]);
  }}
 }};
 return {env,meetings,speeches,audio,meta};
}
test("Only manifest records with official Kaltura MP3 and source hash are accepted",async()=>{
 const bad={...spec,id:"20261_M8",audio_url:"https://example.org/meeting.mp3"};
 const {env}=mockEnv([bad,spec]);
 const items=await xmlManifest(env);
 assert.equal(items.length,1);
 assert.equal(items[0].id,id);
});
test("Official XML speech importer finishes and registers MP3 atomically",async()=>{
 const {env,meetings,speeches,audio}=mockEnv();
 const result=await syncXmlBatch(env);
 assert.equal(result.meeting_completed,true);
 assert.equal(result.total,2);
 assert.equal(meetings.get(id).status,"ready");
 assert.equal(speeches.size,2);
 assert.equal(speeches.get(id+":0").party,"M");
 assert.equal(audio.get(id),MP3);
 assert.equal((await syncXmlBatch(env)).done,true);
});
test("Prepared official XML contains real finished speech text, not placeholders",()=>{
 const path="public/archive/xml/manifest.json";
 if(!existsSync(path))return;
 const manifest=JSON.parse(readFileSync(path,"utf8"));
 assert.ok(manifest.length>=1);
 for(const m of manifest){
  const record=JSON.parse(readFileSync("public/archive/xml/"+m.id+".json","utf8"));
  assert.equal(record.speeches.length,m.speeches);
  assert.equal(record.version,m.version);
  assert.equal(record.audio_url,m.audio_url);
  assert.ok(record.speeches.every(s=>/^\d\d:\d\d:\d\d$/.test(s.clock)));
  assert.ok(record.speeches.every(s=>!/(talen er under udarbejdelse|afventer korrektur)/i.test(s.content)));
 }
});
