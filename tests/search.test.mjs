import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {searchTokens,matchesSearchTerms,ftsQuery,findSpeeches} from "../src/worker.js";

test("ulv matches a complete word, not pulver or ulven",()=>{
  assert.deepEqual(searchTokens("ULV, angst!"),["ulv","angst"]);
  assert.equal(matchesSearchTerms("Pulver og pulvere blev omtalt.",["ulv"]),false);
  assert.equal(matchesSearchTerms("Ulven kom i går.",["ulv"]),false);
  assert.equal(matchesSearchTerms("En ulv, en ræv – og flere dyr.",["ulv"]),true);
  assert.equal(matchesSearchTerms("Det var en ULV!",["ulv"]),true);
  assert.equal(matchesSearchTerms("Om økonomi og ansvar.",["økonomi","ansvar"]),true);
  assert.equal(matchesSearchTerms("Det er uacceptabelt.",["accept"]),false);
});

test("FTS5 keeps word matching, filters before pagination and joins only verified audio",async()=>{
  assert.equal(ftsQuery(["ulv"],""),'content:"ulv"');
  assert.equal(ftsQuery(["problemulv"],"Mette Thi"),'content:"problemulv" AND speaker:"mette"* AND speaker:"thi"*');
  const sample={id:"20251_M41:1",idx:1,meeting_id:"20251_M41",speaker:"Mette",
    party:"S",clock:"13:00:18",content:"Ulven er løs, men vi taler om en ulv.",date:"2026-01-21",
    meeting_no:41,samling:"20251",source_url:"https://example.org/ref",favorite:0,
    mp3_url:"https://cdnapi.kaltura.com/p/2158211/sp/0/playManifest/entryId/1_jb8pshgl/protocol/http/flavorParamIds/0/format/url/21-01-2026_11-00_salen.mp3",
    audio_title:"Folketingssalen"};
  const sqls=[],params=[],db={prepare(sql){
    sqls.push(sql);
    return {bind(...args){params.push(args);return this;},
      async first(){return {value:"1"};},
      async all(){return {results:sql.includes("JOIN meeting_audio")?[sample]:[]};}
    };
  }};
  const rows=await findSpeeches({DB:db},new URLSearchParams({
    q:"ulv",from:"2025",to:"2026",party:"S,V",sort:"oldest",page:"1"
  }));
  assert.equal(rows.length,1);
  assert.equal(rows[0].content,sample.content);
  assert.equal(rows[0].audio_source,"verified_mp3");
  assert.equal(rows[0].first_clock,"11:00");
  assert.equal(rows.page,1);
  assert.equal(rows.has_more,false);
  const sql=sqls.find(x=>x.includes("JOIN meeting_audio"));
  assert.ok(sql);
  assert.match(sql,/speech_fts MATCH \?/);
  assert.match(sql,/s\.party IN \(\?,\?\)/);
  assert.match(sql,/s\.speaker LIKE \?/);
  assert.match(sql,/m\.date>=\?/);
  assert.match(sql,/m\.date<\?/);
  assert.match(sql,/LIMIT \? OFFSET \?/);
  assert.ok(!sql.includes("LIMIT 1000"));
  assert.deepEqual(params.at(-1),['content:"ulv"',"2025-01-01","2027-01-01","S","V","% (S)","% (V)",26,25]);
});

test("25-result pages report whether further results exist",async()=>{
 const sample=Array.from({length:26},(_,i)=>({id:"20261_M7:"+i,idx:i,meeting_id:"20261_M7",
   speaker:"Taler",clock:"13:00:00",content:"Noget om ansvar",
   date:"2026-10-21",meeting_no:7,samling:"20261",
   mp3_url:"https://cdnapi.kaltura.com/p/2158211/sp/0/playManifest/entryId/1_jb8pshgl/protocol/http/flavorParamIds/0/format/url/21-01-2026_11-00_salen.mp3"}));
 const db={prepare(sql){return {bind(){return this;},async first(){return {value:"1"};},
   async all(){return {results:sample};}};}};
 const rows=await findSpeeches({DB:db},new URLSearchParams({q:"ansvar"}));
 assert.equal(rows.length,25);
 assert.equal(rows.has_more,true);
 assert.equal(rows.page,0);
});

test("FTS search does not fall back to expensive scans while index is incomplete",async()=>{
  const sqls=[];
  const db={prepare(sql){sqls.push(sql);return {async first(){return null;}};}};
  await assert.rejects(findSpeeches({DB:db},new URLSearchParams({q:"ulv"})),/klargøres/);
  assert.equal(sqls.length,1);
});

test("search markup submits on Enter and highlights whole words only",()=>{
  const html=readFileSync("public/index.html","utf8");
  assert.match(html,/<form[^>]+id="searchForm"[^>]*>/);
  assert.match(html,/<button id="searchBtn" type="submit"/);
  assert.match(html,/<input id="query"[^>]+enterkeyhint="search"/);
  const source=readFileSync("public/app.js","utf8");
  assert.match(source,/\$\("searchForm"\)\.onsubmit=e=>\{e\.preventDefault\(\);search\(true\);/);
  const a=source.indexOf("function queryTokens(q){"),b=source.indexOf("function dateLabel(",a);
  assert.ok(a>=0&&b>a);
  const utils=new Function("esc",source.slice(a,b)+";return {highlight,excerpt};")(
    s=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  );
  assert.equal(utils.highlight("En ulv med pulver i pelsen.","ulv"),
    "En <mark>ulv</mark> med pulver i pelsen.");
  assert.equal(utils.highlight("Pulver og pulvere.","ulv"),"Pulver og pulvere.");
  assert.match(utils.excerpt("pulver er her. Og en ulv der.","ulv"),/ulv der/);
});
