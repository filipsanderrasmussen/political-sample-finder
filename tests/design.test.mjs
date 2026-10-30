import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const html=readFileSync("public/index.html","utf8");
const css=readFileSync("public/style.css","utf8");
const js=readFileSync("public/app.js","utf8");

test("phosphor terminal homepage keeps search controls and no marketing hero",()=>{
  assert.match(html,/class="terminal-frame"/);
  assert.match(html,/id="siteTitle"/);
  assert.match(html,/TALEDATABASE/);
  assert.match(html,/<h1 id="siteTitle">TALEDATABASE <span class="hero-number">2000<\/span><\/h1>/);
  assert.ok(html.indexOf('id="siteTitle"')<html.indexOf('id="searchForm"'),"Brand must be in header before the search form");
  assert.doesNotMatch(html,/class="hero"|class="stat-grid"/);
  assert.match(html,/class="top-stats"/);
  assert.match(html,/<title>Taledatabase 2000/);
  assert.match(html,/TALEDATABASE 2000 \/\/ EDB-VÆRKTØJ TIL LYDSØGNING I FOLKETINGETS TALER/);
  assert.match(html,/id="searchForm"/);
  assert.match(html,/id="query"/);
  assert.match(html,/id="speaker"/);
  assert.match(html,/id="searchBtn" type="submit"/);
  assert.match(html,/id="query"[^>]*placeholder="Angiv søgestreng"/);
  assert.match(html,/id="speaker"[^>]*placeholder="Alle talere"/);
  assert.doesNotMatch(html,/Filtrér på taler \(valgfrit\)/);
  assert.doesNotMatch(html,/data-query=|HURTIGSØGNINGER|01 \/ SØG I ARKIVET|03 \/ FILTRÉR TALER/);
  assert.doesNotMatch(js,/quick-pads|\[data-query\]/);
  assert.doesNotMatch(html,/Find ordene\.|Hør stemmen\.|Søg i Folketingets referater, find omtrent|SYSTEM ONLINE|READY|AWAITING INPUT|SAMPLE FINDER/);
});

test("focused search shows speaker and party filters but no date selection",()=>{
  assert.match(html,/class="filter-toolbar"/);
  assert.doesNotMatch(html,/AFGRÆNS SØGNINGEN/);
  for(const cls of ["filter-speaker","filter-party"]){
    assert.match(html,new RegExp('class="filter-field '+cls+'"'));
  }
  assert.match(html,/class="search-filters"/);
  assert.match(html,/id="resetFilters"/);
  assert.match(html,/id="speaker"/);
  assert.match(html,/id="partySummary"[^>]*>Alle partier<\/summary>/);
  assert.doesNotMatch(html,/id="monthFrom"|id="monthTo"|id="yearFrom"|id="yearTo"|FRA MÅNED|TIL MÅNED|FRA ÅR|TIL ÅR/);
  assert.doesNotMatch(js,/monthFrom|monthTo|fromMonth|toMonth/);
  assert.doesNotMatch(css,/filter-month-from|filter-month-to|input\[type="month"\]/);
  assert.match(css,/\.search-filters\{\s*display:grid/);
  assert.ok(css.includes("grid-template-columns:minmax(0,2fr) minmax(0,1fr)"));
  assert.ok(css.includes("@container search-filter-panel (max-width:780px)"));
  assert.ok(css.includes("@container search-filter-panel (max-width:490px)"));
  assert.ok(!css.includes("@container search-filter-panel (max-width:335px)"));
  assert.match(js,/party:\[\.\.\.document\.querySelectorAll/);
  assert.doesNotMatch(js,/from:\$\(|to:\$\(/);
});

test("party picker aligns every option and renders a centered old-school X",()=>{
  const options=[...html.matchAll(/<label><input type="checkbox" name="party" value="[^"]+">[^<]+<\/label>/g)];
  assert.equal(options.length,12);
  assert.match(css,/\.party-grid\{[\s\S]*?grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/\.party-grid label\{[\s\S]*?display:grid;grid-template-columns:22px minmax\(0,1fr\)/);
  assert.match(css,/\.filter-party \.party-grid input\[type="checkbox"\]\{[\s\S]*?appearance:none;[\s\S]*?display:grid;place-items:center;[\s\S]*?width:22px;height:22px;[\s\S]*?margin:0;padding:0/);
  assert.match(css,/\.filter-party \.party-grid input\[type="checkbox"\]::before\{\s*content:"X";[\s\S]*?opacity:0/);
  assert.match(css,/\.filter-party \.party-grid input\[type="checkbox"\]:checked::before\{\s*opacity:1/);
  assert.match(css,/\.filter-party \.party-grid input\[type="checkbox"\]:focus-visible\{/);
  assert.match(js,/input\[name="party"\]:checked/);
});

test("header keeps two counters but removes the public archive coverage text",()=>{
  for(const id of ["statMeetings","statSpeeches"]){
    assert.match(html,new RegExp('id="'+id+'"'));
    assert.match(js,new RegExp('\\$\\("'+id+'"\\)\\.textContent'));
  }
  assert.match(html,/MØDER I SALEN/);
  assert.match(html,/TALEINDLÆG/);
  assert.ok(html.indexOf('id="statMeetings"')<html.indexOf('</header>'));
  assert.ok(html.indexOf('id="statSpeeches"')<html.indexOf('</header>'));
  assert.doesNotMatch(html,/ARKIVETS ÅR|class="archive-strip"|id="statPeriod"|id="archiveCoverage"|HVAD TÆLLER VI\?/);
  assert.doesNotMatch(js,/IKKE KOMPLET DÆKNING AF PERIODEN|archiveCoverage|statPeriod/);
  assert.match(js,/searchable_first_date/);
  assert.match(js,/searchable_last_date/);
  assert.match(css,/\.brand h1\{/);
  assert.match(css,/\.searchbar\{[\s\S]*?min-height:100px/);
  assert.match(css,/\/\* COMPACT WORKSPACE v2:/);
  assert.match(css,/min-height:63px/);
  assert.match(css,/--accent:#4aff8f/);
  assert.doesNotMatch(css,/@keyframes cursor-blink|\.blinking-cursor|\.hero-cursor/);
  assert.match(css,/caret-color:var\(--accent\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test("audio playback, transcript reading and archive admin tools survive redesign",()=>{
  for(const id of ["sampleAudio","playerSeek","playerBack","playerForward","transcriptList","transcriptPdf","importDialog","openImport","openLogin","syncArchiveBtn","adminLoginBtn"]){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(js,/function openPlayer\(row,p\)/);
  assert.match(js,/function skipAudio\(delta\)/);
  assert.match(js,/function loadTranscript\(row\)/);
  assert.match(js,/class="link-btn listen-btn"/);
});

test("public search hides admin and removes extra result controls",()=>{
  assert.match(html,/id="openImport"[^>]*class="button outline hidden"/);
  assert.match(html,/id="openLogin"[^>]*class="footer-login"/);
  assert.match(html,/class="advanced-import admin-only hidden" id="advancedImport"/);
  assert.match(js,/\/api\/session/);
  assert.match(js,/\.classList\.toggle\("hidden",!state\.adminSession\)/);
  assert.doesNotMatch(html,/id="allTab"|id="favTab"|id="emptyImport"|ALLE FUND|FAVORITTER/);
  assert.doesNotMatch(js,/allTab|favTab|emptyImport|mp3Links|↓ Åbn MP3|Indtast et søgeord, eller vælg en hurtigsøgning/);
  assert.match(html,/id="playerMp3Link"/); // Full MP3 remains reachable inside the player.
});

test("search audio accurately says that playback begins at the speech turn, not the keyword",()=>{
  assert.match(js,/♫ Lyt fra indlæggets start/);
  assert.match(js,/Afspilning fra indlæggets begyndelse\. Søgeordet kan forekomme senere\./);
  assert.doesNotMatch(js,/♫ Lyt fra ca\./);
});

test("interface uses Danish terminal language without changing working search or playback",()=>{
  assert.match(html,/FOLKETINGETS TALER \/\/ ORIGINAL LYD/);
  assert.match(html,/AFVENTER SØGNING/);
  assert.doesNotMatch(html,/class="blinking-cursor"|class="hero-cursor"/);
  assert.match(js,/INGEN FUND/);
  assert.match(js,/REFERATFUND/);
  assert.doesNotMatch(js,/NO MATCH_|AWAITING INPUT_|TRANSCRIPT MATCH|AFVENTER SØGNING_|INGEN FUND_/);
  assert.match(js,/\$\("query"\)\.focus\(\{preventScroll:true\}\)/);
  assert.match(js,/\$\("searchForm"\)\.onsubmit/);
  assert.match(js,/skipAudio\(-15\)/);
  assert.match(js,/skipAudio\(15\)/);
});

test("all interface greens derive from exactly one phosphor color",()=>{
  assert.match(css,/--accent:#4aff8f/);
  assert.match(html,/<meta name="theme-color" content="#050505"/);
  const hexes=[...new Set(css.match(/#[0-9a-fA-F]{3,8}\b/g)||[])];
  const nonNeutral=hexes.filter(hex=>{
    const digits=hex.slice(1);
    if(digits.length===3)return !(digits[0]===digits[1]&&digits[1]===digits[2]);
    const rgb=digits.slice(0,6);
    return !(rgb.slice(0,2)===rgb.slice(2,4)&&rgb.slice(2,4)===rgb.slice(4,6));
  });
  assert.deepEqual(nonNeutral,["#4aff8f"]);
  assert.match(css,/--muted:color-mix\(in srgb,var\(--accent\)/);
  assert.match(css,/\.button\.primary\{[^}]*color:var\(--bg\)/);
  assert.match(css,/\.quote mark,\.transcript-line mark\{[^}]*color:var\(--bg\)/);
});
