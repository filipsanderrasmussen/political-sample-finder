import test from "node:test";
import assert from "node:assert/strict";
import { isoDate, rssEntries, safeMeeting } from "../src/worker.js";

test("datoer i mødetitler normaliseres",()=>{
  assert.equal(isoDate("21. januar 2026"),"2026-01-21");
  assert.equal(isoDate("21/1/2026"),"2026-01-21");
  assert.equal(isoDate("2026-01-21"),"2026-01-21");
  assert.equal(isoDate("ukendt"),null);
});

test("mødenummer valideres og kilde-URL dannes",()=>{
  assert.deepEqual(safeMeeting("20251",41),{
    id:"20251_M41",samling:"20251",number:41,
    url:"https://www.folketingstidende.dk/samling/20251/salen/M41/20251_M41_referat.pdf"
  });
  assert.throws(()=>safeMeeting("foo",4));
  assert.throws(()=>safeMeeting("20251",201));
});

test("RSS bruger enclosures og mødedato – aldrig pubDate som mødedato",()=>{
  const feed='<rss><channel><item><title>Folketingssalen 21. januar 2026</title>'+
    '<description><![CDATA[Møde i salen]]></description><pubDate>Sat, 24 Jan 2026 12:00:00 GMT</pubDate>'+
    '<link>https://www.ft.dk/lyd/41</link>'+
    '<enclosure type="audio/mpeg" url="https://example.org/meeting.mp3?x=1&amp;y=2"/>'+
    '</item></channel></rss>';
  const entries=rssEntries(feed,"Salen");
  assert.equal(entries.length,1);
  assert.equal(entries[0].date,"2026-01-21");
  assert.equal(entries[0].mp3_url,"https://example.org/meeting.mp3?x=1&y=2");
});
