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

test("FTS5 uses whole words and bounded indexed candidate rows",async()=>{
  assert.equal(ftsQuery(["ulv"],""),'content:"ulv"');
  assert.equal(ftsQuery(["problemulv"],"Mette Thi"),'content:"problemulv" AND speaker:"mette"* AND speaker:"thi"*');
  const samples=[
    {id:"20251_M41:1",idx:1,meeting_id:"20251_M41",speaker:"Mette",clock:"13:00",
      content:"Ulven er løs, men vi taler om en ulv.",date:"2026-01-21",
      meeting_no:41,samling:"20251",source_url:"https://example.org/ref",favorite:0}
  ];
  const sqls=[],db={prepare(sql){
    sqls.push(sql);
    return {args:[],bind(...args){this.args=args;return this;},
      async first(){return {value:"1"};},
      async all(){return {results:sql.includes("WITH hits AS MATERIALIZED")?samples:[]};}
    };
  }};
  const rows=await findSpeeches({DB:db},new URLSearchParams({q:"ulv"}));
  assert.equal(rows.length,1);
  assert.equal(rows[0].content,samples[0].content);
  assert.ok(sqls.some(s=>s.includes("speech_fts MATCH ? LIMIT 1000")));
  assert.ok(sqls.every(s=>!s.includes("LIKE '%")));
  assert.ok(sqls.every(s=>!s.includes("SELECT MIN(clock)")));
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
  assert.match(source,/\$\("searchForm"\)\.onsubmit=e=>\{e\.preventDefault\(\);search\(\);/);
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
