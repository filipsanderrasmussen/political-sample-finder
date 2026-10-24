import test from "node:test";
import assert from "node:assert/strict";
import { archiveManifest, archiveStatus, syncArchiveBatch } from "../src/archive.js";

function mockEnv(){
  const manifest=[
    {id:"20251_M41",date:"2026-01-21",samling:"20251",meeting_no:41,source_url:"https://www.folketingstidende.dk/real.pdf",speeches:2,status:"ready"},
    {id:"20251_M42",date:"2026-01-22",samling:"20251",meeting_no:42,source_url:"https://www.folketingstidende.dk/another.pdf",speeches:1,status:"missing"}
  ];
  const documents={"20251_M41":{...manifest[0],speeches:[
    {speaker:"Formanden",clock:"13:00",content:"Velkommen til dagens møde",page:1},
    {speaker:"Et medlem",clock:"13:01",content:"Vi har ansvar for udviklingen",page:1}
  ]}};
  const meetings=new Map(),speeches=new Map();
  const env={
    ASSETS:{async fetch(req){
      const path=new URL(req.url).pathname;
      if(path==="/archive/manifest.json")return Response.json(manifest);
      const id=path.match(/^\/archive\/(\d{5}_M\d+)\.json$/)?.[1];
      return documents[id]?Response.json(documents[id]):new Response("Not Found",{status:404});
    }},
    DB:{
      prepare(sql){
        const q={sql,args:[],bind(...a){this.args=a;return this;},
          async all(){
            if(sql.startsWith("SELECT id,status,speech_count"))return {results:[...meetings].map(([id,m])=>({id,...m}))};
            if(sql.startsWith("SELECT id,status"))return {results:[...meetings].map(([id,m])=>({id,...m}))};
            return {results:[]};
          },
          async first(){
            if(sql.startsWith("SELECT MAX(idx)")){
              const r=[...speeches.values()].filter(v=>v.meeting_id===this.args[0]).map(v=>v.idx);
              return {last_idx:r.length?Math.max(...r):null};
            }
            return null;
          },
          async run(){apply(this);return {success:true};}
        };
        return q;
      },
      async batch(queries){for(const q of queries)apply(q);return [];}
    }
  };
  function apply(q){
    if(q.sql.startsWith("INSERT INTO meetings"))meetings.set(q.args[0],{status:"syncing",speech_count:0,date:q.args[3],source_url:q.args[5]});
    else if(q.sql.startsWith("DELETE FROM speeches")){for(const [id,r] of speeches){if(r.meeting_id===q.args[0])speeches.delete(id);}}
    else if(q.sql.startsWith("INSERT OR REPLACE INTO speeches"))speeches.set(q.args[0],{meeting_id:q.args[1],idx:q.args[2],speaker:q.args[3],content:q.args[5]});
    else if(q.sql.startsWith("UPDATE meetings SET status='ready'"))meetings.set(q.args[1],{...meetings.get(q.args[1]),status:"ready",speech_count:q.args[0]});
  }
  return {env,meetings,speeches};
}
test("archive manifest contains only validated, ready source meetings",async()=>{
  const {env}=mockEnv();
  const data=await archiveManifest(env);
  assert.deepEqual(data.map(x=>x.id),["20251_M41"]);
});
test("source-backed full meeting is indexed once and reported as searchable",async()=>{
  const {env,meetings,speeches}=mockEnv();
  const first=await syncArchiveBatch(env);
  assert.equal(first.meeting,"20251_M41");
  assert.equal(first.meeting_completed,true);
  assert.equal(speeches.size,2);
  assert.equal(meetings.get("20251_M41").status,"ready");
  const status=await archiveStatus(env);
  assert.equal(status.indexed_meetings,1);
  assert.equal(status.indexed_speeches,2);
  assert.equal((await syncArchiveBatch(env)).done,true);
});
