import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {searchTokens,matchesSearchTerms,findSpeeches} from "../src/worker.js";

test("ulv matches a complete word, not pulver or ulven",()=>{
  assert.deepEqual(searchTokens("ULV, angst!"),["ulv","angst"]);
  assert.equal(matchesSearchTerms("Pulver og pulvere blev omtalt.",["ulv"]),false);
  assert.equal(matchesSearchTerms("Ulven kom i går.",["ulv"]),false);
  assert.equal(matchesSearchTerms("En ulv, en ræv – og flere dyr.",["ulv"]),true);
  assert.equal(matchesSearchTerms("Det var en ULV!",["ulv"]),true);
  assert.equal(matchesSearchTerms("Om økonomi og ansvar.",["økonomi","ansvar"]),true);
  assert.equal(matchesSearchTerms("Det er uacceptabelt.",["accept"]),false);
});

test("search paginates beyond early false-positive substring hits",async()=>{
  const speeches=Array.from({length:225},(_,i)=>({
    id:"20251_M41:"+i,idx:i,meeting_id:"20251_M41",speaker:"Taler",clock:"13:00",
    content:i===217?"Her taler vi om en ulv!":"Pulver til alle!",page:1,
    date:null,meeting_no:41,samling:"20251",title:"Møde",source_url:"https://example.org/p",
    first_clock:"13:00",favorite:0
  }));
  const db={prepare(sql){
    const o={args:[],bind(...args){this.args=args;return this;},
      async all(){
        if(sql.includes("FROM speeches s JOIN meetings")){
          const size=this.args.at(-2),offset=this.args.at(-1);
          return {results:speeches.slice(offset,offset+size)};
        }
        return {results:[]};
      }
    };
    return o;
  }};
  const found=await findSpeeches({DB:db},new URLSearchParams({q:"ulv"}));
  assert.equal(found.length,1);
  assert.equal(found[0].idx,217);
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
