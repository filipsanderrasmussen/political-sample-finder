import test from "node:test";
import assert from "node:assert/strict";
import { isoDate, rssEntries, safeMeeting, findMeetingAudio } from "../src/worker.js";
import index from "../src/audio-index.json" with { type: "json" };

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

test("official RSS snapshot links to the correct meeting, not just same day",()=>{
  assert.ok(index.length>100,"Expected a populated official podcast index");
  const example=index.find(x=>x.date==="2026-01-21" && x.meeting_no===41);
  assert.ok(example,"Missing January 21 2026, meeting 41");
  assert.match(example.mp3_url,/^https:\/\/cdnapi\.kaltura\.com\//);
  assert.match(example.mp3_url,/1_jb8pshgl/);
  assert.equal(findMeetingAudio(index,{date:"2026-01-21",meeting_no:41}).length,1);
  assert.equal(findMeetingAudio(index,{date:"2026-01-21",meeting_no:42}).length,0);
});
