import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {searchTokens,matchesSearchTerms,ftsQuery,findSpeeches,periodBoundary} from "../src/worker.js";
import { inferredParty, ministerPartyPredicate } from "../src/minister-parties.js";

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
  assert.equal(rows[0].audio_timing,"unverified","A verified recording is not proof of accurate wall-clock alignment");
  assert.equal(rows[0].first_clock,"11:00");
  assert.equal(rows.page,1);
  assert.equal(rows.has_more,false);
  const sql=sqls.find(x=>x.includes("JOIN meeting_audio"));
  assert.ok(sql);
  assert.match(sql,/speech_fts MATCH \?/);
  assert.match(sql,/SELECT sx\.clock FROM speeches sx WHERE sx\.meeting_id=s\.meeting_id/);
  assert.match(sql,/sx\.idx>s\.idx AND sx\.clock>s\.clock ORDER BY sx\.idx LIMIT 1\) next_clock/);
  assert.match(sql,/s\.party IN \(\?,\?\)/);
  assert.match(sql,/s\.speaker LIKE \?/);
  assert.match(sql,/m\.date>=\?/);
  assert.match(sql,/m\.date<\?/);
  assert.match(sql,/LIMIT \? OFFSET \?/);
  assert.ok(!sql.includes("LIMIT 1000"));
  assert.deepEqual(params.at(-1),['content:"ulv"',"2025-01-01","2027-01-01","S","V","% (S)","% (V)",...ministerPartyPredicate(["S","V"]).values,26,25]);
});

test("ministers with missing XML group are filtered by historically correct affiliation",async()=>{
  const actualMeeting=JSON.parse(readFileSync("public/archive/xml/20252_M19.json","utf8"));
  assert.equal(actualMeeting.date,"2026-08-26");
  const speech=actualMeeting.speeches.find(s=>s.content.toLowerCase().includes("problemulv"));
  assert.ok(speech,"The original August 2026 problemulv speech must exist in the archive");
  assert.equal(speech.speaker,"Christian Rabjerg Madsen");
  assert.equal(speech.party,""); // Folketing XML omits ministers' affiliations.
  assert.equal(inferredParty(speech.speaker,actualMeeting.date),"S");
  assert.equal(inferredParty("Christina Egelund",actualMeeting.date),"M");
  assert.equal(inferredParty("Samira Nawa",actualMeeting.date),"RV");
  assert.equal(inferredParty("Pia Olsen Dyhr",actualMeeting.date),"SF");
  assert.equal(inferredParty("Christian Rabjerg Madsen","2025-03-01"),null);
  assert.equal(inferredParty("Christina Egelund","2025-03-01"),"M");
  assert.equal(inferredParty("En ukendt minister",actualMeeting.date),null);
  const sample={...speech,id:actualMeeting.id+":12",idx:12,meeting_id:actualMeeting.id,
    date:actualMeeting.date,meeting_no:actualMeeting.meeting_no,samling:"20252",
    source_url:"https://www.ft.dk",favorite:0,
    mp3_url:"https://cdnapi.kaltura.com/p/2158211/sp/0/playManifest/entryId/1_jb8pshgl/protocol/http/flavorParamIds/0/format/url/26-08-2026_11-00_salen.mp3",
    audio_title:"Salen"};
  const sqls=[],bindings=[];
  const db={prepare(sql){
    sqls.push(sql);
    return {
      bind(...a){bindings.push(a);return this;},
      async first(){return {value:"1"};},
      async all(){return {results:sql.includes("JOIN meeting_audio")?[sample]:[]};}
    };
  }};
  const found=await findSpeeches({DB:db},new URLSearchParams({q:"problemulv",party:"S"}));
  assert.equal(found.length,1);
  assert.equal(found[0].party,"S");
  assert.equal(found[0].speaker,"Christian Rabjerg Madsen");
  const sql=sqls.find(x=>x.includes("JOIN meeting_audio"));
  assert.ok(sql);
  assert.match(sql,/m\.date>=\?/);
  assert.match(sql,/s\.speaker IN \(/);
  assert.ok(bindings.at(-1).includes("Christian Rabjerg Madsen"));
  assert.ok(bindings.at(-1).includes("2026-06-03"));
  assert.ok(!ministerPartyPredicate(["DF"]).values.includes("Christian Rabjerg Madsen"));
});

test("month boundaries include the whole selected final month and handle December rollover",()=>{
  assert.equal(periodBoundary("2025-02"),"2025-02-01");
  assert.equal(periodBoundary("2025-02",true),"2025-03-01");
  assert.equal(periodBoundary("2026-12",true),"2027-01-01");
  assert.equal(periodBoundary("2025",true),"2026-01-01"); // Legacy year-filter links.
  assert.equal(periodBoundary("2025-00"),null);
  assert.equal(periodBoundary("2025-13"),null);
  assert.equal(periodBoundary("2025-02-15"),null);
  assert.equal(periodBoundary("2025-invalid"),null);
  assert.equal(periodBoundary(""),null);
});

test("SQL applies month date boundaries before pagination",async()=>{
  const calls=[];
  const db={prepare(sql){return {
    bind(...args){calls.push({sql,args});return this;},
    async first(){return {value:"1"};},
    async all(){return {results:[]};}
  };}};
  await findSpeeches({DB:db},new URLSearchParams({
    q:"ulv",from:"2025-11",to:"2026-02"
  }));
  const match=calls.find(x=>x.sql.includes("JOIN meeting_audio"));
  assert.ok(match);
  assert.match(match.sql,/m\.date>=\?/);
  assert.match(match.sql,/m\.date<\?/);
  assert.deepEqual(match.args,['content:"ulv"',"2025-11-01","2026-03-01",26,0]);
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
