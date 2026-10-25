#!/usr/bin/env python3
"""Read-only production end-to-end checks for audio-only parliamentary search.
Run from GitHub Actions; no production mutations or private credentials.
"""
import datetime as dt, json, re, urllib.error, urllib.parse, urllib.request
from pathlib import Path

BASE="https://political-sample-finder.filip-8d4.workers.dev"
REPORT={"time":dt.datetime.now(dt.timezone.utc).isoformat(),"target":BASE,"checks":[]}
def request(route,range_header=None):
    headers={"Accept":"application/json" if not range_header else "audio/mpeg",
             "User-Agent":"TALEDATABASE-2000-live-readonly-e2e/1.0"}
    if range_header:headers["Range"]=range_header
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE+route,headers=headers),timeout=24) as r:
            body=r.read(150001 if not range_header else 1024)
            if len(body)>(150000 if not range_header else 1024):
                raise ValueError("Source response exceeds read-only test byte cap")
            return {"status":r.status,"headers":dict(r.headers),"body":body}
    except Exception as e:
        return {"status":getattr(e,"code",None),"error":str(e)[:200]}
def query(name,params):
    route="/api/search?"+urllib.parse.urlencode(params)
    resp=request(route)
    test={"name":name,"http":resp.get("status")}
    try:
        if resp.get("status")!=200:raise ValueError(resp.get("error") or "HTTP "+str(resp.get("status")))
        data=json.loads(resp["body"])
        rows=data.get("results",[])
        test["count"]=len(rows)
        test["limit"]=data.get("limit")
        test["has_more"]=data.get("has_more")
        test["first_ids"]=[r["id"] for r in rows[:3]]
        test["all_have_audio"]=all(bool(r.get("podcasts")) and 
                r.get("audio_source")=="verified_mp3" for r in rows)
        test["all_source_urls_official"]=all(bool(re.match(r"https://cdnapi\.kaltura\.com/p/2158211/",r["podcasts"][0]["mp3_url"])) for r in rows)
        test["all_within_range"]=all((not params.get("from") or r["date"][:4]>=params["from"]) and
                (not params.get("to") or r["date"][:4]<=params["to"]) for r in rows)
        test["all_party_matches"]=all(r.get("party")=="S" for r in rows) if params.get("party")=="S" else None
        test["pass"]=test["limit"]==25 and test["all_have_audio"] and test["all_source_urls_official"] and test["all_within_range"] and test["all_party_matches"] is not False
        if not test["pass"]:test["error"]="Search filtering or audio-gating invariant failed"
        REPORT["checks"].append(test)
        return rows
    except Exception as e:
        test["pass"]=False;test["error"]=str(e);REPORT["checks"].append(test)
        return []
first=query("first page",{"q":"ansvar","from":"2024","to":"2026","page":"0"})
second=query("second page",{"q":"ansvar","from":"2024","to":"2026","page":"1"})
REPORT["checks"].append({"name":"pagination disjoint",
                         "pass":not first or not second or not set(x["id"] for x in first)&set(x["id"] for x in second),
                         "first_count":len(first),"second_count":len(second)})
query("party S",{"q":"ansvar","party":"S","from":"2024","to":"2026"})
query("relevance",{"q":"ansvar","sort":"relevance","from":"2024","to":"2026"})
query("historical bound",{"q":"ansvar","from":"2024","to":"2024"})
if first:
    media=first[0]["podcasts"][0]["mp3_url"]
    audio=request("/api/audio-stream?"+urllib.parse.urlencode({"source":media}),"bytes=0-1023")
    magic=(audio.get("body") or b"")[:4]
    check={"name":"official MP3 proxy 1 KiB range","status":audio.get("status"),
           "bytes":len(audio.get("body") or b""),"content_range":audio.get("headers",{}).get("Content-Range"),
           "content_type":audio.get("headers",{}).get("Content-Type"),"magic":magic.hex()}
    check["pass"]=(audio.get("status")==206 and check["bytes"]==1024 and
        check["content_type"]=="audio/mpeg" and (magic.startswith(b"ID3") or magic[:1]==b"\xff"))
    if not check["pass"]:check["error"]=audio.get("error","Range or MP3 signature invalid")
    REPORT["checks"].append(check)
else:
    REPORT["checks"].append({"name":"official MP3 proxy 1 KiB range","pass":False,"error":"No source-backed search result"})
REPORT["passed"]=sum(1 for c in REPORT["checks"] if c.get("pass"))
REPORT["failed"]=sum(1 for c in REPORT["checks"] if not c.get("pass"))
Path("production-audio-smoke.json").write_text(json.dumps(REPORT,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(REPORT,ensure_ascii=False,indent=2))
if REPORT["failed"]:raise SystemExit("Production audio smoke tests failed")
