import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {officialAudioSource,relayOfficialAudio} from "../src/clip-source.js";
import index from "../src/audio-index.json" with {type:"json"};

const src=index[0].mp3_url;

test("strict audio relay supports all known genuine Folketinget MP3 source URLs",()=>{
  assert.equal(index.length>=100,true);
  for(const x of index)assert.equal(officialAudioSource(x.mp3_url),x.mp3_url);
  for(const disallowed of [
    "http://cdnapi.kaltura.com/p/2158211/sp/0/playManifest/entryId/1_123abc/protocol/http/flavorParamIds/0/format/url/23-10-2026_08-00_salen.mp3",
    "https://localhost/private",
    "https://cdnapi.kaltura.com.evil.example/anything",
    "https://cdnapi.kaltura.com@internal.example/secret",
    "https://cdnapi.kaltura.com:1234/",
    "https://cdnapi.kaltura.com/p/2158211/sp/0/playManifest/entryId/1_abc/protocol/http/flavorParamIds/0/format/url/file.mp3",
    "https://cdnapi.kaltura.com/p/2158211/sp/0/playManifest/entryId/1_abc/protocol/http/flavorParamIds/0/format/url/23-10-2026_08-00_salen.mp3?proxy=http://localhost",
    "https://www.folketinget.dk/",
    "file:///etc/passwd"
  ])assert.equal(officialAudioSource(disallowed),null,disallowed);
  assert.equal(officialAudioSource(null),null);
});

test("audio relay streams bytes and forwards Range without buffering hours of audio",async()=>{
  let called=0;
  const req=new Request("https://td2000.test/api/audio-stream",{headers:{range:"bytes=2048-4095"}});
  const url=new URL("https://td2000.test/api/audio-stream?source="+encodeURIComponent(src));
  const response=await relayOfficialAudio(req,url,async (source,options)=>{
    called++;
    assert.equal(source,src);
    assert.equal(options.method,"GET");
    assert.equal(options.headers.get("range"),"bytes=2048-4095");
    assert.equal(options.redirect,"follow");
    return new Response(new Uint8Array([73,68,51]),{
      status:206,headers:{"content-type":"audio/mpeg","content-range":"bytes 2048-2050/100000",
      "content-length":"3","accept-ranges":"bytes"}
    });
  });
  assert.equal(called,1);
  assert.equal(response.status,206);
  assert.equal(response.headers.get("content-range"),"bytes 2048-2050/100000");
  assert.equal(response.headers.get("content-type"),"audio/mpeg");
  assert.equal(response.headers.get("cache-control"),"private, no-store");
  assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())),[73,68,51]);
});

test("reject malformed ranges, unknown hosts and upstream errors",async()=>{
  const good=new URL("https://td2000.test/api/audio-stream?source="+encodeURIComponent(src));
  const invalid=await relayOfficialAudio(new Request(good,{headers:{range:"bytes=1-2,5-10"}}),good,
    async()=>{throw Error("should not fetch")});
  assert.equal(invalid.status,416);
  const blocked=new URL("https://td2000.test/api/audio-stream?source="+encodeURIComponent("https://localhost/foo"));
  assert.equal((await relayOfficialAudio(new Request(blocked),blocked,async()=>{throw Error("no") })).status,400);
  assert.equal((await relayOfficialAudio(new Request(good,{method:"POST"}),good,async()=>{})).status,405);
  const offline=await relayOfficialAudio(new Request(good),good,async()=>new Response("oops",{status:404}));
  assert.equal(offline.status,502);
});

test("worker wires the public range proxy without requiring admin login or D1",()=>{
  const source=readFileSync("src/worker.js","utf8");
  assert.match(source,/relayOfficialAudio\(request,url\)/);
  assert.ok(source.indexOf('if(url.pathname==="/api/audio-stream")') <
    source.indexOf("return await endpoint(request,env,url)"));
});
