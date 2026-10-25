// Isolated search diagnostic. Fetches text pages only; no MP3s or database writes.
import fs from "node:fs/promises";

const BASE = "https://www.folketingstidende.dk/da/search";
const REF = "https://www.ft.dk/samling/20241/lovforslag/L25/BEH1-6/forhandling.htm";
const QUOTE = "højt belagt smørrebrød";
const POS = "smørrebrød";
const NEG = "zzzxqjplm927364test";

function clean(html) {
  return String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}
function snippet(body, query) {
  const i = body.toLocaleLowerCase("da-DK").indexOf(query.toLocaleLowerCase("da-DK"));
  return i < 0 ? "" : body.slice(Math.max(0,i-90),i+query.length+250);
}
async function request(url) {
  const start = Date.now();
  try {
    const response = await fetch(url, {redirect:"follow",headers:{"accept":"text/html"},signal:AbortSignal.timeout(15000)});
    const html = (await response.text()).slice(0,2000000);
    return {status:response.status,ok:response.ok,url:response.url,elapsedMs:Date.now()-start,html,body:clean(html)};
  } catch(error) {return {status:null,ok:false,url,elapsedMs:Date.now()-start,error:String(error),html:"",body:""};}
}
function reportSearch(response,query) {
  const text=response.body.toLocaleLowerCase("da-DK");
  const links=[...response.html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map(x=>x[1]).filter(u=>/\/samling\/|\/forhandlinger\/|_referat\.pdf/i.test(u));
  return {
    query,status:response.status,ok:response.ok,elapsedMs:response.elapsedMs,url:response.url,
    bodyLength:response.body.length,
    mentionsQuery:text.includes(query.toLocaleLowerCase("da-DK")),
    noResults:/din søgning matchede ikke nogen dokumenter|ingen søgeresultater|0 resultater/i.test(response.body),
    containsKnownFullPhrase:text.includes(QUOTE),
    likelyDocumentLinks:[...new Set(links)].slice(0,10),
    snippet:snippet(response.body,query),
    error:response.error||null
  };
}
const searches=[];
for(const query of [POS,NEG]){
  const url=new URL(BASE);url.searchParams.set("q",query);url.searchParams.set("spo","referater");
  searches.push(reportSearch(await request(url.toString()),query));
}
const source=await request(REF);
const body=source.body.toLocaleLowerCase("da-DK");
const reference={
  status:source.status,ok:source.ok,hasPhrase:body.includes(QUOTE),
  hasSpeaker:body.includes("anders kronborg"),hasClock:body.includes("16:11"),
  snippet:snippet(source.body,QUOTE),error:source.error||null
};
const positive=searches[0],negative=searches[1];
let verdict="INCONCLUSIVE";
if(!positive.ok||!negative.ok)verdict="SEARCH_SITE_UNAVAILABLE";
else if(positive.noResults)verdict="KNOWN_POSITIVE_MISSED";
else if(!negative.noResults)verdict="NEGATIVE_CONTROL_NOT_EXCLUDED";
else if(positive.containsKnownFullPhrase&&reference.hasPhrase)verdict="DIRECT_SEARCH_POTENTIALLY_USABLE";
else verdict="HTTP_OK_BUT_STRUCTURED_MATCH_UNPROVEN";

const report={name:"FT direct full-text search proof of concept",date:new Date().toISOString(),
  verdict,searches,reference,
  notes:"A query echo is not evidence of a result. Does not validate search pagination, snippet extraction, audio alignment or production stability. No audio was requested."};
await fs.writeFile("ft-search-probe.json",JSON.stringify(report,null,2)+"\n");
const lines=[
"# TALEDATABASE 2000 – direkte FT-søgning",
"",
"Testdato: "+report.date,
"Resultat: "+verdict,
"",
"| Test | Status | Tegn på resultat |",
"| --- | --- | --- |",
...searches.map(x=>"| "+x.query+" | HTTP "+x.status+" | Ingen resultater: "+x.noResults+"; eksakt citat: "+x.containsKnownFullPhrase+"; dokumentlinks: "+x.likelyDocumentLinks.length+" |"),
"| Officiel tale | HTTP "+reference.status+" | Citat: "+reference.hasPhrase+"; Anders Kronborg: "+reference.hasSpeaker+"; kl. 16:11: "+reference.hasClock+" |",
"",
"Vigtigt: Dette er en feasibility-test, ikke en komplet integration.",
"En virkende fuldtekstsøgning kræver stadig maskinlæsbart resultat, pagination og kildeidentifikation.",
"",
"FT-søgelink: "+BASE+"?q=sm%C3%B8rrebr%C3%B8d&spo=referater",
"Kendt original: "+REF,
""];
await fs.writeFile("ft-search-probe.md",lines.join("\n"));
console.log(JSON.stringify({verdict,searches:searches.map(x=>({query:x.query,status:x.status,noResults:x.noResults,containsKnownFullPhrase:x.containsKnownFullPhrase})),reference},null,2));
