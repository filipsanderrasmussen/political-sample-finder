const $=x=>document.getElementById(x);
const state={rows:[],stats:null,q:"",speaker:"",favorites:false,playing:null,pending:null,loading:false};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const admin=()=>($("adminPassword").value||sessionStorage.getItem("psf.admin")||"");
function notice(s,bad=false){const el=$("notification");el.textContent=s;el.className="notification"+(bad?" error":"");clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.classList.add("hidden"),9000);}
async function api(path,options={}){
 const r=await fetch(path,options),data=await r.json();
 if(!r.ok)throw new Error(data.error||"HTTP "+r.status);return data;
}
const post=(path,data)=>api(path,{method:"POST",headers:{"content-type":"application/json","x-admin-key":admin()},body:JSON.stringify(data)});
async function authorize(){
 if(!admin()){if(!$("importDialog").open)$("importDialog").showModal();throw new Error("Angiv din APP_PASSWORD under Indlæs data.");}
 await post("/api/login",{});sessionStorage.setItem("psf.admin",admin());
}
function highlight(text,q){
 const words=q.trim().split(/\s+/).filter(Boolean);if(!words.length)return esc(text);
 const re=new RegExp("("+words.map(w=>w.replace(/[.*+?^$()|[\]{}\\]/g,"\\$&")).join("|")+")","gi");
 return String(text).split(re).map(part=>words.some(w=>w.toLowerCase()===part.toLowerCase())?"<mark>"+esc(part)+"</mark>":esc(part)).join("");
}
function excerpt(text,q){const w=q.trim().split(/\s+/)[0]?.toLowerCase()||"";const p=w?text.toLowerCase().indexOf(w):0;const a=Math.max(0,p-120),b=Math.min(text.length,Math.max(p,0)+240);return (a?"…":"")+text.slice(a,b)+(b<text.length?"…":"");}
function dateLabel(x){if(!x)return "Ukendt dato";return new Date(x+"T12:00:00").toLocaleDateString("da-DK",{day:"numeric",month:"short",year:"numeric"});}
function mins(x){const m=/^(\d{1,2}):(\d{2})$/.exec(x||"");return m&&+m[1]<24&&+m[2]<60?+m[1]*60+ +m[2]:null;}
function offset(v){if(v===null||v<0||!Number.isFinite(v))return "Ukendt";v=Math.floor(v);return [Math.floor(v/3600),Math.floor(v%3600/60),v%60].map(n=>String(n).padStart(2,"0")).join(":");}
function anchor(url){try{return localStorage.getItem("psf.anchor:"+url);}catch{return null;}}
function storeAnchor(url,val){try{localStorage.setItem("psf.anchor:"+url,val);}catch{}}
function seconds(row,p){const a=mins(row.clock),b=mins(anchor(p.mp3_url)||row.first_clock||row.clock);return a===null||b===null?null:(a-b)*60;}
function render(){
 $("stats").textContent=(state.stats?.meetings||0)+" søgbare møder · "+(state.stats?.speeches||0)+" taler · "+(state.stats?.audio_archive_meetings||0)+" møder med MP3";
 $("count").textContent=state.rows.length+" MATCHES"+(state.rows.length===120?" (maks.)":"");
 const empty=$("empty");empty.classList.toggle("hidden",state.loading||state.rows.length>0);
 empty.querySelector("h2").textContent=(state.stats?.speeches||0)?"Ingen taler matcher søgningen.":"Først skal der lidt tale på pladen.";
 empty.querySelector("p").textContent=(state.stats?.speeches||0)?"Prøv andre ord, eller indlæs flere møder.":"Indlæs et referat, og søg i politikernes ord.";
 $("emptyImport").classList.toggle("hidden",!!state.stats?.speeches);
 $("results").innerHTML=state.rows.map(r=>{
  const podcasts=r.podcasts||[],p=podcasts[0];
  const video="https://mobiltv.ft.dk/video/"+encodeURIComponent(r.samling)+"/salen/"+Number(r.meeting_no);
  const speaker=/^(Spm\.?\s*nr\.?|\d+\)|Til\s+(?:udenrigs|justits|stats|udlændinge|social|miljø|indenrigs|finans))/i.test(r.speaker)?"Taler ikke sikkert identificeret":r.speaker;
  const mp3Links=podcasts.slice(0,3).map((a,i)=>'<a class="link-btn" href="'+esc(a.mp3_url)+'" target="_blank" rel="noopener noreferrer">↓ Åbn MP3'+(podcasts.length>1?' '+(i+1):'')+' ↗</a>').join("");
  const listen=podcasts.slice(0,3).map((a,i)=>'<button class="link-btn" data-listen="'+esc(r.id)+'" data-ix="'+i+'">♫ Lyt fra ca. '+esc(offset(seconds(r,a)))+(podcasts.length>1?" · kandidat "+(i+1):"")+'</button>').join("");
  return '<article class="result"><div class="result-meta"><b class="speaker-name">'+esc(speaker)+'</b><span class="date">'+dateLabel(r.date)+' · Møde '+r.meeting_no+'</span></div>'+
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
 if(!state.q.trim()&&!state.speaker.trim()&&!state.favorites){state.rows=[];render();return;}
 state.loading=true;$("count").textContent="SØGER…";
 try{const p=new URLSearchParams({q:state.q,speaker:state.speaker,favorites:state.favorites?"1":"0"});state.rows=(await api("/api/search?"+p)).results;}
 catch(e){state.rows=[];notice(e.message,true);}finally{state.loading=false;render();}
}
function setTab(fav){state.favorites=fav;$("allTab").classList.toggle("selected",!fav);$("favTab").classList.toggle("selected",fav);search();}
function openPlayer(row,p){
 const audio=$("sampleAudio");audio.pause();audio.removeAttribute("src");audio.load();
 state.playing={row,p};state.pending=null;
 $("playerSpeaker").textContent=row.speaker;
 $("playerContext").textContent="Møde "+row.meeting_no+" · "+dateLabel(row.date)+" · start kl. "+row.clock+" · "+p.title+" (kun datomatch)";
 $("playerStart").value=anchor(p.mp3_url)||row.first_clock||row.clock;
 $("playerMp3Link").href=p.mp3_url;
 $("playerStatus").textContent="Hele mødeoptagelsen. Tidspositionen er kun et overslag.";
 $("playerAnchorHelp").textContent="Ret MP3'ens startklokkeslæt ved behov; browseren husker din indstilling.";
 calcOffset();$("playerDialog").showModal();audio.src=p.mp3_url;audio.load();
}
function calcOffset(){
 if(!state.playing)return null;const a=mins(state.playing.row.clock),b=mins($("playerStart").value);const diff=a===null||b===null?null:(a-b)*60;
 $("playerOffset").textContent=diff!==null&&diff<0?"Før MP3-start":offset(diff);return diff;
}
async function seek(){
 if(!state.playing)return;const n=calcOffset();if(n===null||n<0){$("playerStatus").textContent="Kontrollér startklokkeslættet.";return;}
 storeAnchor(state.playing.p.mp3_url,$("playerStart").value);
 const audio=$("sampleAudio");state.pending=n;
 if(audio.readyState<1){$("playerStatus").textContent="Indlæser MP3-metadata…";return;}
 if(Number.isFinite(audio.duration)&&n>=audio.duration){$("playerStatus").textContent="Hop-position efter MP3'ens slutning. Tjek dato og starttid.";state.pending=null;return;}
 try{audio.currentTime=n;state.pending=null;$("playerStatus").textContent="Søger omkring "+offset(n)+" – finjustér på tidslinjen.";await audio.play();}
 catch{$("playerStatus").textContent="MP3-serveren understøtter muligvis ikke hop her. Åbn originalen nedenfor.";}
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
 $("openImport").onclick=()=>{if(!$("importDialog").open)$("importDialog").showModal();};$("emptyImport").onclick=$("openImport").onclick;
 $("closeImport").onclick=()=>$("importDialog").close();$("closePlayer").onclick=()=>$("playerDialog").close();
 $("playerDialog").onclose=()=>{$("sampleAudio").pause();state.playing=null;state.pending=null;};
 $("playerStart").oninput=calcOffset;$("playerSeek").onclick=seek;
 $("sampleAudio").onloadedmetadata=()=>{if(state.pending!==null)seek();};
 $("sampleAudio").onerror=()=>{if(state.playing)$("playerStatus").textContent="Kunne ikke afspille MP3 her. Åbn originalen i stedet.";};
 $("searchBtn").onclick=search;
 for(const id of ["query","speaker"])$(id).onkeydown=e=>{if(e.key==="Enter")search();};
 let timer;$("speaker").oninput=()=>{clearTimeout(timer);timer=setTimeout(search,350);};
 $("allTab").onclick=()=>setTab(false);$("favTab").onclick=()=>setTab(true);
 document.querySelectorAll("[data-query]").forEach(b=>b.onclick=()=>{$("query").value=b.dataset.query;search();});
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
    let last="";
    for(let i=0;i<2000;i++){
      const r=await post("/api/archive/sync",{});
      if(r.done){last="✓ Arkivet er færdigindekseret ("+(r.indexed_meetings||0)+" møder).";break;}
      last=(r.meeting||"") + ": "+r.processed+" / "+r.total+" taler behandlet";
      out.textContent=last;
      if(i%8===0)await new Promise(resolve=>setTimeout(resolve,1));
    }
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
 $("adminPassword").value=sessionStorage.getItem("psf.admin")||"";
 api("/api/archive/status").then(r=>{
   $("archiveState").textContent=r.archive_meetings
     ?(r.indexed_meetings+" / "+r.archive_meetings+" MP3-møder søgbare · "+r.indexed_speeches+" taleafsnit")
     :"Arkivet klargøres på GitHub.";
 }).catch(()=>{});

}
bind();stats().catch(e=>notice("API er ikke klar: "+e.message,true));
