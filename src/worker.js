import { archiveManifest, archiveStatus, syncArchiveBatch } from "./archive.js";
import offlinePodcastIndex from "./audio-index.json" with { type: "json" };
// Political Sample Finder — Cloudflare Worker + D1.
// Source-backed: results only come from imported Folketingstidende PDFs.
// Podcast links are explicitly approximate date matches, not verified audio alignments.
const FEEDS = {
  Salen: "https://mobiltv.ft.dk/feed/Salen",
  Alle: "https://mobiltv.ft.dk/feed/Alle"
};
let prepared = false;
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, samling TEXT NOT NULL, meeting_no INTEGER NOT NULL, date TEXT, title TEXT, source_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ready', speech_count INTEGER NOT NULL DEFAULT 0, imported_at TEXT)",
  "CREATE TABLE IF NOT EXISTS speeches (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, idx INTEGER NOT NULL, speaker TEXT NOT NULL, clock TEXT NOT NULL, content TEXT NOT NULL, page INTEGER)",
  "CREATE INDEX IF NOT EXISTS speech_meeting_idx ON speeches(meeting_id)",
  "CREATE TABLE IF NOT EXISTS podcasts (mp3_url TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT, episode_url TEXT, description TEXT, feed TEXT)",
  "CREATE INDEX IF NOT EXISTS podcast_date_idx ON podcasts(date)",
  "CREATE TABLE IF NOT EXISTS favorites (speech_id TEXT PRIMARY KEY, added_at TEXT NOT NULL)"
].join(";\n") + ";";
async function init(env) {
  if (!env.DB) throw new Error("D1-databasen DB mangler. Kontrollér Cloudflare-bindingen.");
  if (!prepared) { await env.DB.exec(SCHEMA); prepared = true; }
}
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
function json(data, status=200) { return new Response(JSON.stringify(data), {status,headers}); }
function error(message,status=400) { return json({error:message},status); }
function safeMeeting(s, n) {
  if (!/^20\d{3}$/.test(String(s))) throw new Error("Samling skal være fem cifre, fx 20251.");
  const num = Number(n);
  if (!Number.isInteger(num) || num<1 || num>200) throw new Error("Mødenummer skal være 1–200.");
  return {id:String(s)+"_M"+num, samling:String(s), number:num,
    url:"https://www.folketingstidende.dk/samling/"+s+"/salen/M"+num+"/"+s+"_M"+num+"_referat.pdf"};
}
function isoDate(s) {
  if (!s) return null;
  const text=String(s);
  let match=text.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  let year,month,day;
  if(match){year=+match[1];month=+match[2];day=+match[3];}
  else {
    match=text.match(/(?:^|[^\d])(\d{1,2})[./-](\d{1,2})[./-](20\d{2})(?!\d)/);
    if(match){day=+match[1];month=+match[2];year=+match[3];}
    else {
      match=text.match(/(\d{1,2})\.?\s+(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\s+(20\d{2})/i);
      if (!match) return null;
      day=+match[1];month=["januar","februar","marts","april","maj","juni","juli","august","september","oktober","november","december"].indexOf(match[2].toLowerCase())+1;year=+match[3];
    }
  }
  const d=new Date(Date.UTC(year,month-1,day));
  return d.getUTCFullYear()===year && d.getUTCMonth()===month-1 && d.getUTCDate()===day ?
    [year,String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-") : null;
}
function stripXml(s) {
  let t=String(s||"").replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/,"$1");
  return t.replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"')
    .replace(/&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/\s+/g," ").trim();
}
function tag(xml,name) {
  const match=xml.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/"+name+">","i"));
  return match?stripXml(match[1]):"";
}
function rssEntries(xml,feed) {
  const entries=[];
  const items=xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)||[];
  for(const item of items) {
    const enc=item.match(/<enclosure\b[^>]*>/i);
    if(!enc)continue;
    const attr=enc[0].match(/\burl\s*=\s*["']([^"']+)["']/i);
    if(!attr)continue;
    let url=stripXml(attr[1]);
    let parsed;
    try{parsed=new URL(url);}catch{continue;}
    if(!["https:","http:"].includes(parsed.protocol))continue;
    // Folketinget publishes Kaltura MP3 links as HTTP. HTTPS was verified
    // against the 21 Jan 2026 recording and avoids browser mixed content.
    if(parsed.hostname==="cdnapi.kaltura.com" && parsed.protocol==="http:"){
      parsed.protocol="https:"; url=parsed.toString();
    }
    const title=tag(item,"title");
    const desc=tag(item,"description");
    const link=tag(item,"link");
    // Use the meeting date from the title, not the podcast publication date.
    const date=isoDate(title)||isoDate(desc)||isoDate(link)||isoDate(url);
    const meetingNo=desc.match(/Møde\s+nr\.?\s*(\d{1,3})\s+i\s+salen/i);
    entries.push({mp3_url:url,title:title||"Optagelse",description:desc.slice(0,1800),
      episode_url:url,date,feed,meeting_no:meetingNo?Number(meetingNo[1]):null});
  }
  return entries;
}
async function body(request) {
  const size=Number(request.headers.get("content-length")||"0");
  if(size>1_800_000)throw new Error("Anmodningen er for stor.");
  const raw=await request.text();
  if(raw.length>1_800_000)throw new Error("Anmodningen er for stor.");
  try{return JSON.parse(raw);}catch{throw new Error("Ugyldig JSON.");}
}
async function authorized(request,env) {
  if(!env.APP_PASSWORD || String(env.APP_PASSWORD).length<12) return false;
  const provided=request.headers.get("x-admin-key")||"";
  const enc=new TextEncoder();
  const a=enc.encode(provided), b=enc.encode(env.APP_PASSWORD);
  // Compare digests to avoid short-circuit equality on plaintext.
  const [ha,hb]=await Promise.all([crypto.subtle.digest("SHA-256",a),crypto.subtle.digest("SHA-256",b)]);
  return crypto.subtle.timingSafeEqual(new Uint8Array(ha),new Uint8Array(hb));
}
// The official podcast RSS contains meeting IDs in the item description.
// We match BOTH date and meeting number, never date alone (multiple recordings per day).
function podcastMeetingNo(p) {
  if(Number.isInteger(p.meeting_no))return p.meeting_no;
  const match=String(p.description||"").match(/Møde\s+nr\.?\s*(\d{1,3})\s+i\s+salen/i);
  return match?Number(match[1]):null;
}
function findMeetingAudio(items,row) {
  return items.filter(p=>p.date===row.date && podcastMeetingNo(p)===Number(row.meeting_no))
    .sort((a,b)=>{
      const unsuitable=p=>/tegnsprog/i.test(p.title+" "+(p.description||"").slice(0,100))?1:0;
      return unsuitable(a)-unsuitable(b);
    }).slice(0,3).map(p=>{const secure=u=>String(u||"").replace(/^http:\/\/cdnapi\.kaltura\.com\//i,"https://cdnapi.kaltura.com/");return {mp3_url:secure(p.mp3_url),title:p.title,date:p.date,episode_url:secure(p.mp3_url),feed:p.feed};});
}
let liveFeed=null;
let liveFeedExpiry=0;
async function liveSalenPodcasts() {
  if(liveFeed && Date.now()<liveFeedExpiry)return liveFeed;
  const upstream=await fetch(FEEDS.Salen,{headers:{"Accept":"application/rss+xml, application/xml"},cf:{cacheTtl:600}});
  if(!upstream.ok)throw new Error("Folketingets RSS-feed svarede "+upstream.status);
  const xml=await upstream.text();
  if(xml.length>8_000_000)throw new Error("RSS-feed er større end forventet");
  const entries=rssEntries(xml,"Salen");
  if(!entries.length)throw new Error("Ingen lydlinks fundet i RSS-feedet");
  liveFeed=entries;
  liveFeedExpiry=Date.now()+10*60*1000;
  return entries;
}
// Match Danish/Unicode words, not substrings ("ulv" != "pulver").
// SQLite LIKE is a coarse candidate filter; exact token matching happens here.
function searchTokens(text){
  return String(text||"").toLocaleLowerCase("da-DK").match(/[\p{L}\p{M}\p{N}_]+/gu)||[];
}
function matchesSearchTerms(content,terms){
  if(!terms.length)return true;
  const found=new Set(searchTokens(content));
  return terms.every(t=>found.has(t.toLocaleLowerCase("da-DK")));
}
async function findSpeeches(env,params) {
  const q=(params.get("q")||"").trim().slice(0,160);
  const speaker=(params.get("speaker")||"").trim().slice(0,120);
  const fav=params.get("favorites")==="1";
  if(!q && !speaker && !fav)return [];
  const terms=searchTokens(q).slice(0,10);
  const clauses=["m.status='ready'"], binds=[];
  const escapeLike=s=>s.replace(/!/g,"!!").replace(/%/g,"!%").replace(/_/g,"!_");
  for(const term of terms) {
    clauses.push("lower(s.content) LIKE ? ESCAPE '!'");
    binds.push("%"+escapeLike(term.toLowerCase())+"%");
  }
  if(speaker){
    clauses.push("lower(s.speaker) LIKE ? ESCAPE '!'");
    binds.push("%"+escapeLike(speaker.toLowerCase())+"%");
  }
  if(fav) clauses.push("f.speech_id IS NOT NULL");
  const sql="SELECT s.id,s.idx,s.meeting_id,s.speaker,s.clock,s.content,s.page,m.date,m.title,m.meeting_no,m.samling,m.source_url,"+
    "CASE WHEN f.speech_id IS NULL THEN 0 ELSE 1 END favorite,"+
    "(SELECT MIN(clock) FROM speeches x WHERE x.meeting_id=s.meeting_id) first_clock "+
    "FROM speeches s JOIN meetings m ON m.id=s.meeting_id LEFT JOIN favorites f ON f.speech_id=s.id "+
    "WHERE "+clauses.join(" AND ")+" ORDER BY m.date DESC,s.clock ASC,s.idx ASC LIMIT ? OFFSET ?";
  // Apply the exact-word filter BEFORE the 120-result limit. Otherwise many
  // early false-positive substrings can hide real matches further down.
  const rows=[],pageSize=200,maxCandidates=12000;
  for(let off=0;off<maxCandidates && rows.length<120;off+=pageSize){
    const data=await env.DB.prepare(sql).bind(...binds,pageSize,off).all();
    const batch=data.results||[];
    for(const row of batch){
      if(matchesSearchTerms(row.content,terms))rows.push(row);
      if(rows.length>=120)break;
    }
    if(batch.length<pageSize)break;
  }
  const dbByDate=new Map(),missing=[];
  for(const row of rows) {
    if(!dbByDate.has(row.date)){
      const p=row.date?await env.DB.prepare(
        "SELECT title,mp3_url,episode_url,date,description,feed FROM podcasts WHERE date=? AND feed='Salen' LIMIT 25"
      ).bind(row.date).all():{results:[]};
      dbByDate.set(row.date,p.results||[]);
    }
    row.podcasts=findMeetingAudio(dbByDate.get(row.date),row);
    row.favorite=!!row.favorite;
    row.audio_source=row.podcasts.length?"indexed":"unmatched";
    if(!row.podcasts.length && row.date){
      row.podcasts=findMeetingAudio(offlinePodcastIndex,row);
      if(row.podcasts.length)row.audio_source="official_rss_snapshot";
      else missing.push(row);
    }
  }
  if(missing.length) {
    try {
      const fromFeed=await liveSalenPodcasts();
      for(const row of missing){
        row.podcasts=findMeetingAudio(fromFeed,row);
        row.audio_source=row.podcasts.length?"live":"not_in_feed";
      }
    }catch(e) {
      console.warn("RSS live lookup unavailable:",String(e));
      for(const row of missing)row.audio_source="feed_unavailable";
    }
  }
  return rows;
}
// Nearby source transcript paragraphs, in their actual document order.
// A timestamp belongs to the beginning of a speech, NOT to every sentence.
function contextParams(meetingId,at) {
  if(!/^\d{5}_M\d{1,3}$/.test(String(meetingId||"")))throw new Error("Ugyldigt møde-id");
  const index=Number(at);
  if(!Number.isInteger(index)||index<0||index>30000)throw new Error("Ugyldigt indeks for tale");
  return {meetingId,index,start:Math.max(0,index-7),end:index+7};
}
async function getTranscriptContext(env,meetingId,at){
  const x=contextParams(meetingId,at);
  const exists=await env.DB.prepare("SELECT id,status FROM meetings WHERE id=?").bind(x.meetingId).first();
  if(!exists||exists.status!=="ready")throw new Error("Dette mødes referat er endnu ikke færdigindekseret");
  const rows=await env.DB.prepare(
    "SELECT id,idx,clock,speaker,content,page FROM speeches "+
    "WHERE meeting_id=? AND idx BETWEEN ? AND ? ORDER BY idx ASC LIMIT 15"
  ).bind(x.meetingId,x.start,x.end).all();
  return {meeting_id:x.meetingId,center:x.index,items:rows.results||[],
    note:"Klokkeslæt er afrundet og angiver taleafsnittets start, ikke præcise tidspunkter for ordene."};
}
async function endpoint(request,env,url) {
  await init(env);
  const path=url.pathname,method=request.method;
  if(method==="GET" && path==="/api/stats"){
    const [meetings,speeches,podcasts,dated,items]=await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) n FROM meetings WHERE status='ready'"),
      env.DB.prepare("SELECT COUNT(*) n FROM speeches s JOIN meetings m ON m.id=s.meeting_id WHERE m.status='ready'"),
      env.DB.prepare("SELECT COUNT(*) n FROM podcasts"),
      env.DB.prepare("SELECT COUNT(*) n FROM podcasts WHERE date IS NOT NULL"),
      env.DB.prepare("SELECT id,title,date,source_url,speech_count FROM meetings WHERE status='ready' ORDER BY imported_at DESC LIMIT 15")
    ]);
    const archive=await archiveStatus(env).catch(err=>({archive_error:String(err)}));
    return json({meetings:meetings.results[0].n,speeches:speeches.results[0].n,
      podcasts:podcasts.results[0].n,dated_podcasts:dated.results[0].n,recent_meetings:items.results,
      audio_archive_links:offlinePodcastIndex.length,
      audio_archive_meetings:new Set(offlinePodcastIndex.map(x=>x.date+":"+x.meeting_no)).size,
      ...archive,
      protected:!!env.APP_PASSWORD});
  }
  if(method==="GET" && path==="/api/archive/status")return json(await archiveStatus(env));
  if(method==="GET" && path==="/api/search")return json({results:await findSpeeches(env,url.searchParams)});
  if(method==="GET" && path==="/api/meeting/context")return json(await getTranscriptContext(env,url.searchParams.get("meeting_id"),url.searchParams.get("index")));
  if(method==="GET" && path==="/api/pdf"){
    const m=safeMeeting(url.searchParams.get("samling"),url.searchParams.get("number"));
    const upstream=await fetch(m.url,{headers:{"Accept":"application/pdf"}});
    if(!upstream.ok)return error("PDF kunne ikke hentes hos Folketingstidende (HTTP "+upstream.status+"). Prøv manuel upload.",502);
    const bytes=await upstream.arrayBuffer();
    if(bytes.byteLength>30_000_000 || !new TextDecoder().decode(bytes.slice(0,4)).startsWith("%PDF"))
      return error("Kilden sendte ikke en gyldig PDF under 30 MB.",502);
    return new Response(bytes,{headers:{"content-type":"application/pdf","cache-control":"public, max-age=86400"}});
  }
  if(method==="POST" && path==="/api/login")
    return (await authorized(request,env))?json({ok:true}):error("Forkert adgangskode eller APP_PASSWORD er ikke opsat i Cloudflare.",401);
  if(method!=="POST")return error("Ukendt endpoint.",404);
  if(!(await authorized(request,env)))
    return error("Skriveadgang kræver APP_PASSWORD (mindst 12 tegn) opsat som Cloudflare Worker-secret.",401);
  const data=await body(request);
  if(path==="/api/archive/sync"){
    const batch=await syncArchiveBatch(env);
    return json(batch);
  }
  if(path==="/api/import/start"){
    const m=safeMeeting(data.samling,data.number);
    if(data.date && !isoDate(data.date))throw new Error("Ugyldig mødedato.");
    const date=data.date?isoDate(data.date):null;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO meetings(id,samling,meeting_no,date,title,source_url,status,speech_count,imported_at) "+
        "VALUES(?,?,?,?,? ,?,'importing',0,?) "+
        "ON CONFLICT(id) DO UPDATE SET date=excluded.date,source_url=excluded.source_url,status='importing',speech_count=0,imported_at=excluded.imported_at")
        .bind(m.id,m.samling,m.number,date,"Møde "+m.number+" · "+m.samling,m.url,new Date().toISOString()),
      env.DB.prepare("DELETE FROM speeches WHERE meeting_id=?").bind(m.id)
    ]);
    return json({meeting_id:m.id});
  }
  if(path==="/api/import/batch"){
    const m=safeMeeting(data.samling,data.number);
    const found=await env.DB.prepare("SELECT status FROM meetings WHERE id=?").bind(m.id).first();
    if(found?.status!=="importing")throw new Error("Import er ikke startet.");
    if(!Array.isArray(data.speeches)||data.speeches.length>40)throw new Error("Maksimalt 40 taler pr. batch.");
    const statements=data.speeches.map(s=>{
      if(!Number.isInteger(s.idx)||s.idx<0||s.idx>20000 || !/^\d{1,2}:\d{2}$/.test(s.clock) ||
         typeof s.speaker!=="string"||s.speaker.length>160 || typeof s.content!=="string"||s.content.length>12000)
        throw new Error("Ugyldige taledata.");
      return env.DB.prepare("INSERT OR REPLACE INTO speeches(id,meeting_id,idx,speaker,clock,content,page) VALUES(?,?,?,?,?,?,?)")
        .bind(m.id+":"+s.idx,m.id,s.idx,s.speaker,s.clock,s.content,Number(s.page)||1);
    });
    if(statements.length)await env.DB.batch(statements);
    return json({saved:statements.length});
  }
  if(path==="/api/import/finish"){
    const m=safeMeeting(data.samling,data.number);
    const found=await env.DB.prepare("SELECT COUNT(*) n FROM speeches WHERE meeting_id=?").bind(m.id).first();
    if(!found?.n)throw new Error("Ingen taler importeret.");
    await env.DB.prepare("UPDATE meetings SET status='ready',speech_count=? WHERE id=?").bind(found.n,m.id).run();
    return json({meeting_id:m.id,speeches:found.n});
  }
  if(path==="/api/rss"){
    const feed=data.feed;
    if(!Object.hasOwn(FEEDS,feed))throw new Error("Ukendt feed.");
    const r=await fetch(FEEDS[feed],{headers:{"Accept":"application/rss+xml, application/xml, text/xml"}});
    if(!r.ok)throw new Error("Podcastfeed svarede HTTP "+r.status+".");
    const xml=await r.text();
    if(xml.length>8_000_000)throw new Error("Podcastfeed er for stort.");
    const items=rssEntries(xml,feed);
    for(let i=0;i<items.length;i+=45){
      await env.DB.batch(items.slice(i,i+45).map(x=>
        env.DB.prepare("INSERT INTO podcasts(mp3_url,title,date,episode_url,description,feed) VALUES(?,?,?,?,?,?) "+
          "ON CONFLICT(mp3_url) DO UPDATE SET title=excluded.title,date=excluded.date,episode_url=excluded.episode_url,description=excluded.description,feed=excluded.feed")
          .bind(x.mp3_url,x.title,x.date,x.episode_url,x.description,x.feed)));
    }
    return json({fetched:items.length,dated:items.filter(x=>x.date).length});
  }
  if(path==="/api/favorite"){
    const id=String(data.id||"");
    if(!/^\d{5}_M\d{1,3}:\d+$/.test(id))throw new Error("Ugyldigt tale-id.");
    if(data.favorite){
      const speech=await env.DB.prepare("SELECT id FROM speeches WHERE id=?").bind(id).first();
      if(!speech)throw new Error("Talen findes ikke.");
      await env.DB.prepare("INSERT OR REPLACE INTO favorites(speech_id,added_at) VALUES(?,?)").bind(id,new Date().toISOString()).run();
    }else await env.DB.prepare("DELETE FROM favorites WHERE speech_id=?").bind(id).run();
    return json({ok:true});
  }
  return error("Ukendt endpoint.",404);
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(!url.pathname.startsWith("/api/"))return env.ASSETS.fetch(request);
    try{return await endpoint(request,env,url);}
    catch(err){console.error("API error:",err);return error(err?.message||"Uventet fejl.",400);}
  },
  async scheduled(event,env,ctx){
    ctx.waitUntil((async()=>{
      await init(env);
      // Multiple bounded chunks per invocation. No public write endpoint.
      for(let i=0;i<4;i++){
        const r=await syncArchiveBatch(env);
        if(r.done)break;
      }
    })().catch(err=>console.error("Scheduled transcript import:",err)));
  }
};
export { isoDate, rssEntries, safeMeeting, findMeetingAudio, contextParams, searchTokens, matchesSearchTerms };
