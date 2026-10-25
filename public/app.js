import { initMonitor } from "./monitor.js";
import { initClipper } from "./clipper.js";
const $=x=>document.getElementById(x);
let clipper=null;
const state={rows:[],stats:null,q:"",speaker:"",favorites:false,playing:null,pending:null,loading:false,transcriptRequestId:0,searchRequestId:0,adminSession:false};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
// The server keeps a 30-day signed HttpOnly session; no password storage.
function notice(s,bad=false){const el=$("notification");el.textContent=s;el.className="notification"+(bad?" error":"");clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.classList.add("hidden"),9000);}
async function api(path,options={}){
 const r=await fetch(path,options),data=await r.json();
 if(!r.ok)throw new Error(data.error||"HTTP "+r.status);return data;
}
const post=(path,data)=>api(path,{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify(data)});
function showAdminState(){
 $("adminLoginArea").classList.toggle("hidden",!!state.adminSession);
 $("adminLoggedIn").classList.toggle("hidden",!state.adminSession);
}
async function authorize(){
 if(state.adminSession)return true;
 const session=await api("/api/session");
 if(session.authenticated){state.adminSession=true;showAdminState();return true;}
 const password=$("adminPassword").value;
 if(!password){
   if(!$("importDialog").open)$("importDialog").showModal();
   $("adminPassword").focus();
   throw new Error("Log ind én gang i Arkivstatus for at gemme favoritter og importere data.");
 }
 await api("/api/login",{method:"POST",headers:{"x-admin-key":password},credentials:"same-origin"});
 $("adminPassword").value="";
 state.adminSession=true;showAdminState();
 $("adminLoginStatus").textContent="✓ Login gemt i 30 dage.";
 return true;
}
function queryTokens(q){
 return String(q||"").toLocaleLowerCase("da-DK").match(/[\p{L}\p{M}\p{N}_]+/gu)||[];
}
function highlight(text,q){
 const words=new Set(queryTokens(q));
 return String(text||"").split(/([\p{L}\p{M}\p{N}_]+)/gu)
  .map(part=>words.has(part.toLocaleLowerCase("da-DK"))?"<mark>"+esc(part)+"</mark>":esc(part)).join("");
}
function excerpt(text,q){
 const source=String(text||""),terms=new Set(queryTokens(q));
 const tokens=source.matchAll(/[\p{L}\p{M}\p{N}_]+/gu);
 let index=0;
 for(const token of tokens){
  if(terms.has(token[0].toLocaleLowerCase("da-DK"))){index=token.index;break;}
 }
 const from=Math.max(0,index-120),to=Math.min(source.length,index+240);
 return (from?"…":"")+source.slice(from,to)+(to<source.length?"…":"");
}
function dateLabel(x){if(!x)return "Ukendt dato";return new Date(x+"T12:00:00").toLocaleDateString("da-DK",{day:"numeric",month:"short",year:"numeric"});}
function mins(x){const m=/^(\d{1,2}):(\d{2})$/.exec(x||"");return m&&+m[1]<24&&+m[2]<60?+m[1]*60+ +m[2]:null;}
function offset(v){if(v===null||v<0||!Number.isFinite(v))return "Ukendt";v=Math.floor(v);return [Math.floor(v/3600),Math.floor(v%3600/60),v%60].map(n=>String(n).padStart(2,"0")).join(":");}
function anchor(url){try{return localStorage.getItem("psf.anchor:"+url);}catch{return null;}}
function storeAnchor(url,val){try{localStorage.setItem("psf.anchor:"+url,val);}catch{}}
function seconds(row,p){const a=mins(row.clock),b=mins(anchor(p.mp3_url)||row.first_clock||row.clock);return a===null||b===null?null:(a-b)*60;}
function render(){
 const meet=Number(state.stats?.meetings||0);
 const speech=Number(state.stats?.speeches||0);
 const audio=Number(state.stats?.audio_archive_meetings||0);
 $("statMeetings").textContent=meet.toLocaleString("da-DK");
 $("statSpeeches").textContent=speech.toLocaleString("da-DK");
 $("statAudio").textContent=audio.toLocaleString("da-DK");
 $("stats").textContent=meet+" søgbare møder, "+speech.toLocaleString("da-DK")+" taleafsnit, "+audio+" møder med lyd";
 $("count").textContent=state.loading?"SØGER":((state.q.trim()||state.speaker.trim()||state.favorites)?String(state.rows.length).padStart(2,"0")+" FUNDET"+(state.rows.length===120?" / MAKS.":""):"KLAR TIL SØGNING");
 const empty=$("empty");empty.classList.toggle("hidden",state.loading||state.rows.length>0);
 const searching=!!(state.q.trim()||state.speaker.trim()||state.favorites);
 empty.querySelector("h2").textContent=searching?"INGEN FUND":"AFVENTER SØGNING";
 empty.querySelector("p").textContent=searching?"Ingen fund. Prøv et andet ord eller navn.":"Indtast et søgeord, eller vælg en hurtigsøgning.";
 $("emptyImport").classList.toggle("hidden",!!state.stats?.speeches);
 $("results").innerHTML=state.rows.map((r,i)=>{
  const podcasts=r.podcasts||[],p=podcasts[0];
  const video="https://mobiltv.ft.dk/video/"+encodeURIComponent(r.samling)+"/salen/"+Number(r.meeting_no);
  const speaker=/^(Spm\.?\s*nr\.?|\d+\)|Til\s+(?:udenrigs|justits|stats|udlændinge|social|miljø|indenrigs|finans))/i.test(r.speaker)?"Taler ikke sikkert identificeret":r.speaker;
  const mp3Links=podcasts.slice(0,3).map((a,i)=>'<a class="link-btn" href="'+esc(a.mp3_url)+'" target="_blank" rel="noopener noreferrer">↓ Åbn MP3'+(podcasts.length>1?' '+(i+1):'')+' ↗</a>').join("");
  const listen=podcasts.slice(0,3).map((a,i)=>'<button class="link-btn listen-btn" data-listen="'+esc(r.id)+'" data-ix="'+i+'">♫ Lyt fra ca. '+esc(offset(seconds(r,a)))+(podcasts.length>1?" · kandidat "+(i+1):"")+'</button>').join("");
  return '<article class="result"><div class="result-terminal-top"><span class="result-index">#'+String(i+1).padStart(3,"0")+'</span><span>// REFERATFUND</span></div><div class="result-meta"><b class="speaker-name">'+esc(speaker)+'</b><span class="date">'+dateLabel(r.date)+' · Møde '+r.meeting_no+'</span></div>'+
  '<p class="quote">“'+highlight(excerpt(r.content,state.q),state.q)+'”</p><div class="result-footer"><span class="time-pill">◷ Kl. '+esc(r.clock)+'</span>'+
  '<span class="micro">'+(p?"✓ MP3 fundet til møde nr. "+r.meeting_no:(r.audio_source==="not_in_feed"?"Mødet er ikke i det nuværende RSS-feed":r.audio_source==="feed_unavailable"?"Lydfeed kunne ikke hentes":"Ingen MP3 fundet endnu"))+'</span>'+
  '<a class="link-btn" href="'+esc(video)+'" target="_blank" rel="noopener noreferrer">▶ Video fra mødet ↗</a>'+
  '<a class="link-btn muted-link" href="'+esc(r.source_url)+'#page='+Number(r.page||1)+'" target="_blank" rel="noopener noreferrer">Referat ↗</a>'+
  mp3Links+listen+

  '<button class="fav-btn '+(r.favorite?"active":"")+'" data-fav="'+esc(r.id)+'">'+(r.favorite?"★":"☆")+'</button></div></article>';
 }).join("");
 document.querySelectorAll("[data-listen]").forEach(b=>b.onclick=()=>{const r=state.rows.find(x=>x.id===b.dataset.listen);const p=r?.podcasts?.[Number(b.dataset.ix)];if(r&&p)openPlayer(r,p);});
 document.querySelectorAll("[data-fav]").forEach(b=>b.onclick=async()=>{
  try{await authorize();const r=state.rows.find(x=>x.id===b.dataset.fav),next=!r.favorite;await post("/api/favorite",{id:r.id,favorite:next});r.favorite=next;if(state.favorites&&!next)state.rows=state.rows.filter(x=>x!==r);render();}
  catch(e){notice(e.message,true);}
 });
}
async function stats(){state.stats=await api("/api/stats");render();}
async function search(){
 state.q=$("query").value;state.speaker=$("speaker").value;
 const current=++state.searchRequestId;
 if(!state.q.trim()&&!state.speaker.trim()&&!state.favorites){state.rows=[];render();return;}
 state.loading=true;$("count").textContent="SØGER…";
 try{
  const p=new URLSearchParams({q:state.q,speaker:state.speaker,favorites:state.favorites?"1":"0"});
  const results=(await api("/api/search?"+p)).results;
  if(current===state.searchRequestId)state.rows=results;
 }catch(e){
  if(current===state.searchRequestId){state.rows=[];notice(e.message,true);}
 }finally{
  if(current===state.searchRequestId){state.loading=false;render();}
 }
}
function setTab(fav){
 state.favorites=fav;
 $("allTab").classList.toggle("selected",!fav);
 $("favTab").classList.toggle("selected",fav);
 $("allTab").setAttribute("aria-selected",String(!fav));
 $("favTab").setAttribute("aria-selected",String(fav));
 search();
}

// The original transcript is a reading aid, not word-aligned subtitles.
function speechIndex(row){
 if(Number.isInteger(row.idx))return row.idx;
 const match=String(row.id||"").match(/:(\d+)$/);
 return match?Number(match[1]):null;
}
function safeSpeaker(name){
 const s=String(name||"");
 return /^(Spm\.?\s*nr\.?|Til\s+(?:udenrigs|justits|stats|udlændinge|social|miljø|indenrigs|finans)|\d+[).])/i.test(s)
   ?"Taler ikke sikkert identificeret":s;
}
function showTranscript(items,selectedIdx){
 const list=$("transcriptList");
 if(!items.length){
   list.textContent="Der er endnu ingen tekst omkring dette citat.";
   return;
 }
 list.innerHTML=items.map(item=>{
   const selected=item.idx===selectedIdx;
   return '<article class="transcript-line '+(selected?'selected':'')+'">'+
     '<div class="transcript-line-top"><span class="transcript-clock">Kl. '+esc(item.clock)+'</span>'+
     '<span class="transcript-speaker">'+esc(safeSpeaker(item.speaker))+'</span></div>'+
     '<p class="transcript-paragraph">'+highlight(item.content,state.q)+'</p>'+
     (selected?'<div class="transcript-note">DET VALGTE INDLÆG</div>':'')+
     '</article>';
 }).join("");
 const selected=list.querySelector(".transcript-line.selected");
 if(selected){
   // Scroll only the reading pane, not the entire dialog or underlying page.
   const target=selected.querySelector("mark")||selected;
   const top=target.getBoundingClientRect().top-list.getBoundingClientRect().top;
   list.scrollTop+=top-Math.min(100,list.clientHeight*.25);
 }
}
async function loadTranscript(row){
 const meetingId=String(row.meeting_id||"");
 const idx=speechIndex(row);
 const token=++state.transcriptRequestId;
 const list=$("transcriptList");
 list.textContent="Henter referatet omkring citatet…";
 if(!/^\d{5}_M\d{1,3}$/.test(meetingId)||idx===null){
   list.textContent="Citatet mangler et sikkert referat-ID.";
   return;
 }
 try{
   const params=new URLSearchParams({meeting_id:meetingId,index:String(idx)});
   const data=await api("/api/meeting/context?"+params);
   if(token!==state.transcriptRequestId||state.playing?.row.meeting_id!==meetingId)return;
   showTranscript(data.items||[],idx);
 }catch(e){
   if(token===state.transcriptRequestId)list.textContent="Referatteksten kunne ikke hentes: "+e.message;
 }
}
function openPlayer(row,p){
 const audio=$("sampleAudio");
 audio.pause();
 audio.removeAttribute("src");
 audio.load();
 state.playing={row,p};
 state.pending=null;
 const speaker=String(row.speaker||"");
 const suspect=/^(Spm\.?\s*nr\.?|Til\s+(?:udenrigs|justits|stats|udlændinge|social|miljø|indenrigs|finans)|\d+[).])/i.test(speaker);
 $("playerQuote").textContent="“"+excerpt(row.content,state.q)+"”";
 $("playerSpeaker").textContent=suspect?"Taler ikke sikkert identificeret":speaker;
 $("playerContext").textContent="Møde "+row.meeting_no+" · "+dateLabel(row.date)+" · kl. "+row.clock+" i referatet";
 $("playerStart").value=anchor(p.mp3_url)||row.first_clock||row.clock;
 $("playerMp3Link").href=p.mp3_url;
 $("transcriptPdf").href=row.source_url+"#page="+Number(row.page||1);
 $("playerStatus").textContent="";
 $("playerDialog").querySelector(".player-advanced").open=false;
 const position=calcOffset();
 $("playerDialog").showModal();
 audio.src=p.mp3_url;
 audio.load();
 clipper?.open(p.mp3_url,position);
 loadTranscript(row);
 if(position!==null&&position>=0) {
   state.pending=position;
   // Place the playhead immediately if supported. Reapply after metadata loads.
   try{audio.currentTime=position;}catch{}
   // This runs in the user's click gesture. Some browsers may still block
   // playback; in that case the large play button remains available.
   const playing=audio.play();
   if(playing&&typeof playing.catch==="function")playing.catch(()=>{
     if(state.playing?.p.mp3_url===p.mp3_url)
       $("playerStatus").textContent="Tryk på Afspil, hvis browseren ikke starter automatisk.";
   });
 }else{
   $("playerStatus").textContent="Kontrollér optagelsens startklokkeslæt under Justér.";
 }
}
function calcOffset(){
 if(!state.playing)return null;
 const a=mins(state.playing.row.clock),b=mins($("playerStart").value);
 const diff=a===null||b===null?null:(a-b)*60;
 $("playerOffset").textContent=diff!==null&&diff<0?"Før lydstart":offset(diff);
 return diff;
}
async function seek(){
 if(!state.playing)return;
 const n=calcOffset();
 if(n===null||n<0){
   $("playerStatus").textContent="Justér optagelsens startklokkeslæt.";
   $("playerDialog").querySelector(".player-advanced").open=true;
   return;
 }
 const audio=$("sampleAudio");
 if(Number.isFinite(audio.duration)&&n>=audio.duration){
   $("playerStatus").textContent="Tidspunktet ligger efter MP3'ens slutning. Justér startklokkeslættet.";
   $("playerDialog").querySelector(".player-advanced").open=true;
   state.pending=null;return;
 }
 storeAnchor(state.playing.p.mp3_url,$("playerStart").value);
 if(audio.readyState<1){
   state.pending=n;
   $("playerStatus").textContent="Indlæser lydfilen…";
 }else{
   state.pending=null;
   try{audio.currentTime=n;}catch{
     $("playerStatus").textContent="Kunne ikke springe i lydfilen. Brug tidslinjen i afspilleren.";
     return;
   }
   $("playerStatus").textContent="Afspiller omkring "+offset(n)+".";
 }
 try{await audio.play();}
 catch{
   $("playerStatus").textContent="Tryk på Play i lydafspilleren, eller åbn MP3-filen direkte.";
 }
}
function finishInitialSeek(){
 const audio=$("sampleAudio");
 if(state.pending===null||!state.playing)return;
 const n=state.pending;
 state.pending=null;
 if(Number.isFinite(audio.duration)&&n>=audio.duration){
   audio.pause();
   $("playerStatus").textContent="Tidspunktet ligger uden for optagelsen. Justér startklokkeslættet.";
   $("playerDialog").querySelector(".player-advanced").open=true;
   return;
 }
 try{
   audio.currentTime=n;
   $("playerStatus").textContent="Startet omkring "+offset(n)+" · brug ±15 sek. til at finjustere.";
 }catch{
   $("playerStatus").textContent="Hop er ikke understøttet af MP3-serveren. Prøv tidslinjen.";
 }
}
function skipAudio(delta){
 if(!state.playing)return;
 const audio=$("sampleAudio");
 if(audio.readyState<1){
   $("playerStatus").textContent="Lydfilen indlæses stadig.";
   return;
 }
 const now=Number.isFinite(audio.currentTime)?audio.currentTime:0;
 const last=Number.isFinite(audio.duration)?Math.max(0,audio.duration-.1):Infinity;
 try{
   audio.currentTime=Math.max(0,Math.min(last,now+delta));
   $("playerStatus").textContent="Position "+offset(audio.currentTime)+".";
   if(audio.paused)audio.play().catch(()=>{});
 }catch{$("playerStatus").textContent="Kunne ikke springe i denne optagelse.";}
}
function meeting(){const samling=$("samling").value.trim(),number=Number($("meeting").value);if(!/^20\d{3}$/.test(samling)||!Number.isInteger(number)||number<1||number>200)throw new Error("Ugyldig samling eller mødenummer.");return {samling,number};}
function parseDate(text){
 let m=text.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
 if(m)return m[1]+"-"+m[2].padStart(2,"0")+"-"+m[3].padStart(2,"0");
 m=text.match(/(\d{1,2})\.?\s+(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\s+(20\d{2})/i);
 if(!m)return null;const months=["januar","februar","marts","april","maj","juni","juli","august","september","oktober","november","december"];
 return m[3]+"-"+String(months.indexOf(m[2].toLowerCase())+1).padStart(2,"0")+"-"+m[1].padStart(2,"0");
}
function orderLines(columns){
 const all=[];
 for(const col of columns){
  const lines=[];
  for(const part of col.sort((a,b)=>b.y-a.y||a.x-b.x)){
   let line=lines.find(l=>Math.abs(l.y-part.y)<2.7);
   if(!line){line={y:part.y,bits:[]};lines.push(line);}
   line.bits.push(part);
  }
  for(const line of lines.sort((a,b)=>b.y-a.y)){
   let value="",right=null;
   for(const b of line.bits.sort((a,b)=>a.x-b.x)){
    if(right!==null&&b.x-right>1.4&&!/\s$/.test(value)&&!/^\s/.test(b.s))value+=" ";
    value+=b.s;right=b.x+b.width;
   }
   if(value.trim())all.push(value.trim());
  }
 }
 return all;
}
function extract(lines,page){
 const text=lines.join("\n"),marks=[...text.matchAll(/^Kl\.\s*(\d{1,2}:\d{2})\s*$/gm)],result=[];
 for(let i=0;i<marks.length;i++){
  const mark=marks[i],next=i+1<marks.length?marks[i+1].index:text.length;
  const parts=text.slice(mark.index+mark[0].length,next).split("\n").map(s=>s.replace(/\s+/g," ").trim()).filter(Boolean);
  const stop=parts.slice(0,4).findIndex(s=>s.endsWith(":"));
  if(stop<0)continue;
  const speaker=parts.slice(0,stop+1).join(" ").replace(/:$/,"").trim();
  const content=parts.slice(stop+1).join(" ").replace(/\s+/g," ").replace(/\s+-\s+/g,"-").trim();
  if(speaker&&speaker.length<=160&&content.length>=6&&!/^(Spm\.?\s*nr\.?|\d+\)|Til\s+(?:udenrigs|justits|stats|udlændinge|social|miljø|indenrigs|finans))/i.test(speaker))result.push({speaker,clock:mark[1],content,page});
 }
 return result;
}
async function readPdf(arrayBuffer,progress){
 let lib;try{lib=await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs");}
 catch{throw new Error("Kan ikke indlæse PDF-læser fra jsDelivr.");}
 lib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
 const doc=await lib.getDocument({data:new Uint8Array(arrayBuffer)}).promise,rows=[];let header="";
 try{for(let n=1;n<=doc.numPages;n++){
  const page=await doc.getPage(n),width=page.getViewport({scale:1}).width,items=(await page.getTextContent()).items,left=[],right=[];
  for(const x of items){if(!x.str?.trim())continue;const it={s:x.str,x:x.transform[4],y:x.transform[5],width:x.width||0};(it.x<width*.5?left:right).push(it);}
  const lines=orderLines([left,right]);if(n<=2)header+="\n"+lines.slice(0,35).join("\n");
  rows.push(...extract(lines,n));progress("Læser side "+n+" / "+doc.numPages+" · "+rows.length+" taler fundet…");
  if(n%8===0)await new Promise(r=>setTimeout(r,0));
 }}finally{await doc.destroy();}
 if(!rows.length)throw new Error("Ingen taler med klokkeslæt blev fundet. PDF-layoutet er måske ændret.");
 return {date:parseDate(header),speeches:rows};
}
async function importPdf(bytes){
 const m=meeting(),b=$("importBtn"),u=$("uploadBtn"),out=$("importState");b.disabled=u.disabled=true;
 try{
  await authorize();if(bytes.byteLength>30_000_000)throw new Error("PDF over 30 MB.");
  const doc=await readPdf(bytes,s=>out.textContent=s);
  out.textContent="Gemmer "+doc.speeches.length+" taler i D1…";
  await post("/api/import/start",{...m,date:doc.date});
  for(let i=0;i<doc.speeches.length;i+=40){
   await post("/api/import/batch",{...m,speeches:doc.speeches.slice(i,i+40).map((x,k)=>({...x,idx:i+k}))});
   out.textContent="Gemmer… "+Math.min(i+40,doc.speeches.length)+" / "+doc.speeches.length;
  }
  const res=await post("/api/import/finish",m);
  out.textContent="✓ "+res.speeches+" taler indlæst.";await stats();$("importDialog").close();
  notice("Indekserede "+res.speeches+" taler.");if(!$("query").value)$("query").value="ansvar";await search();
 }finally{b.disabled=u.disabled=false;}
}
function bind(){
 clipper=initClipper({audio:$("sampleAudio")});
 $("openImport").onclick=()=>{if(!$("importDialog").open)$("importDialog").showModal();};$("emptyImport").onclick=$("openImport").onclick;
 $("closeImport").onclick=()=>$("importDialog").close();$("closePlayer").onclick=()=>$("playerDialog").close();
 $("playerDialog").onclose=()=>{$("sampleAudio").pause();clipper?.close();state.playing=null;state.pending=null;state.transcriptRequestId++;};
 $("playerStart").oninput=()=>{
   calcOffset();
   if(state.playing)storeAnchor(state.playing.p.mp3_url,$("playerStart").value);
 };
 $("playerSeek").onclick=seek;
 $("playerBack").onclick=()=>skipAudio(-15);
 $("playerForward").onclick=()=>skipAudio(15);
 $("sampleAudio").onloadedmetadata=finishInitialSeek;
 $("sampleAudio").onerror=()=>{if(state.playing)$("playerStatus").textContent="Kunne ikke afspille MP3 her. Åbn originalen i stedet.";};
 $("searchForm").onsubmit=e=>{e.preventDefault();search();};
 let timer;$("speaker").oninput=()=>{clearTimeout(timer);timer=setTimeout(search,350);};
 $("allTab").onclick=()=>setTab(false);$("favTab").onclick=()=>setTab(true);
 $("importBtn").onclick=async()=>{
  const out=$("importState");out.textContent="Henter PDF fra Folketingstidende…";
  try{const r=await fetch("/api/pdf?"+new URLSearchParams(meeting()));if(!r.ok){const x=await r.json();throw new Error(x.error||"PDF kunne ikke hentes.");}
   await importPdf(await r.arrayBuffer());
  }catch(e){out.textContent="Fejl: "+e.message;notice(e.message,true);}
 };
 $("uploadBtn").onclick=async()=>{
  const out=$("importState");try{const file=$("pdfFile").files[0];if(!file)throw new Error("Vælg en PDF først.");await importPdf(await file.arrayBuffer());}
  catch(e){out.textContent="Fejl: "+e.message;notice(e.message,true);}
 };
 $("syncArchiveBtn").onclick=async()=>{
  const btn=$("syncArchiveBtn"),out=$("archiveState");
  btn.disabled=true;
  try{
    await authorize();
    let last="",done=false;
    // Keep a single manual run bounded so it does not exhaust D1's daily quota.
    for(let i=0;i<30;i++){
      const r=await post("/api/archive/sync",{});
      if(r.done){done=true;last="✓ Arkivet er færdigindekseret ("+(r.indexed_meetings||0)+" møder).";break;}
      last=(r.meeting||"") + ": "+r.processed+" / "+r.total+" taler behandlet";
      out.textContent=last;
      if(i%8===0)await new Promise(resolve=>setTimeout(resolve,1));
    }
    if(!done)last+=" · Pause efter 30 batches for at skåne D1-kvoten. Tryk igen for at fortsætte.";
    out.textContent=last;
    await stats();await search();
  }catch(err){out.textContent="Import kunne ikke fortsætte: "+err.message;notice(err.message,true);}
  finally{btn.disabled=false;}
 };
 $("rssBtn").onclick=async()=>{
  const out=$("rssState"),btn=$("rssBtn");btn.disabled=true;out.textContent="Indlæser lydfeed…";
  try{await authorize();const r=await post("/api/rss",{feed:$("feed").value});out.textContent="✓ "+r.fetched+" episoder; "+r.dated+" med dato.";await stats();await search();notice("Lydindeks opdateret.");}
  catch(e){out.textContent="Fejl: "+e.message;notice(e.message,true);}finally{btn.disabled=false;}
 };
 sessionStorage.removeItem("psf.admin"); // Remove old tab-only password storage.
 api("/api/session").then(r=>{state.adminSession=!!r.authenticated;showAdminState();}).catch(()=>showAdminState());
 $("adminLoginBtn").onclick=async()=>{
   try{await authorize();}catch(e){$("adminLoginStatus").textContent=e.message;}
 };
 $("adminPassword").onkeydown=e=>{
   if(e.key==="Enter"){e.preventDefault();$("adminLoginBtn").click();}
 };
 $("adminLogoutBtn").onclick=async()=>{
   await post("/api/logout",{});
   state.adminSession=false;showAdminState();$("adminLoginStatus").textContent="Logget ud.";
 };
 api("/api/archive/status").then(r=>{
   $("archiveState").textContent=r.archive_meetings
     ?(r.indexed_meetings+" / "+r.archive_meetings+" klargjorte møder indekseret · "+r.indexed_speeches.toLocaleString("da-DK")+" søgbare taleafsnit · "+r.remaining_meetings+" afventer import. Opdateres automatisk.")
     :"Referatarkivet klargøres automatisk fra Folketingstidende.";
 }).catch(()=>{$("archiveState").textContent="Arkivstatus er midlertidigt utilgængelig.";});

}
// Initialize the application only when the physical monitor has power.
// Returning to a powered-on tab restores the terminal without replaying boot.
let appInitialized=false;
function startTerminal(){
 if(!appInitialized){
   appInitialized=true;
   bind();
   stats().catch(e=>notice("API er ikke klar: "+e.message,true));
 }
 // The native text caret is the terminal's only continuously blinking element.
 // Avoid opening a software keyboard without a tap on phones/tablets.
 if(window.matchMedia("(pointer:fine)").matches) $("query").focus({preventScroll:true});
}
initMonitor({
 onReady:startTerminal,
 onShutdown:()=>{
   $("sampleAudio").pause();
   clipper?.close();
   if($("playerDialog").open)$("playerDialog").close();
   if($("importDialog").open)$("importDialog").close();
 }
});
