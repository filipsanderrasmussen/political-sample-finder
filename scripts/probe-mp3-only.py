#!/usr/bin/env python3
"""MP3-only Folketinget feasibility probe. No video, no database writes."""
import collections, datetime, hashlib, io, json, os, re, subprocess, tempfile, urllib.error, urllib.request, xml.etree.ElementTree as ET
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
INDEX=json.loads((ROOT/"src/audio-index.json").read_text("utf-8"))
REPORT={"tested_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"scope":"Direct MP3 only; NEVER video","feed_tests":[],"mp3_tests":[],"wav":None,"historical":None}
HEADERS={"User-Agent":"TALEDATABASE-2000/1.0 (public source verification)","Accept":"application/rss+xml, application/xml, */*"}
def fetch_limited(url, limit=2_000_000, extra=None, method="GET", timeout=16):
    h=dict(HEADERS)
    if extra:h.update(extra)
    req=urllib.request.Request(url,headers=h,method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            content=r.read(limit+1) if method!="HEAD" else b""
            return {"status":r.status,"headers":{k.lower():v for k,v in r.headers.items()},
                    "data":content[:limit],"overflow":len(content)>limit,"final_url":r.url}
    except urllib.error.HTTPError as e:
        return {"status":e.code,"error":str(e)[:160],"headers":{},"data":b""}
    except Exception as e:
        return {"status":None,"error":str(e)[:160],"headers":{},"data":b""}
def tag(el,name):
    for sub in el.iter():
        if sub.tag.rsplit("}",1)[-1]==name:
            return (sub.text or "").strip()
    return ""
def feed(url):
    res=fetch_limited(url,limit=7_000_000)
    obj={"url":url,"status":res["status"],"bytes":len(res["data"]),"overflow":res.get("overflow"),
         "error":res.get("error"),"content_type":res["headers"].get("content-type")}
    if res["status"]!=200:return obj,[]
    try:root=ET.fromstring(res["data"])
    except Exception as e:obj["xml_error"]=str(e)[:160];return obj,[]
    records=[]
    for item in root.iter():
        if item.tag.rsplit("}",1)[-1]!="item":continue
        enclosure=next((x for x in item if x.tag.rsplit("}",1)[-1]=="enclosure"),None)
        if enclosure is None:continue
        raw=enclosure.attrib.get("url","")
        title=tag(item,"title")
        # Date must be embedded in official MP3 name, not inferred from RSS publish date.
        date=re.search(r"([0-3]\d)-([01]\d)-(20\d\d)_[0-2]\d-[0-5]\d_salen\.mp3",raw,re.I)
        day=(f"{date.group(3)}-{date.group(2)}-{date.group(1)}" if date else None)
        records.append({"title":title[:140],"mp3_url":raw.replace("http://cdnapi.kaltura.com/","https://cdnapi.kaltura.com/"),
                        "date":day,"enclosure_type":enclosure.attrib.get("type"),"length":enclosure.attrib.get("length")})
    dated=sorted(x["date"] for x in records if x["date"])
    obj.update({"episodes":len(records),"salen_with_dates":len(dated),
                "earliest_mp3_date":dated[0] if dated else None,"latest_mp3_date":dated[-1] if dated else None,
                "episodes_by_year":dict(sorted(collections.Counter(d[:4] for d in dated).items())),
                "oldest_samples":sorted((x for x in records if x["date"]),key=lambda x:x["date"])[:3],
                "rss_meta":{"title":tag(root,"title")[:160],"lastBuildDate":tag(root,"lastBuildDate")}})
    return obj,records

all_records=[]
for url in ["https://mobiltv.ft.dk/feed/Salen","https://mobiltv.ft.dk/feed/Alle",
            "https://mobiltv.ft.dk/feed/Salen?page=2"]:
    r,records=feed(url);REPORT["feed_tests"].append(r);all_records+=records

oldest_local=sorted(INDEX,key=lambda x:x.get("date",""))[0]
known={"source":"local-verified-RSS-snapshot","date":oldest_local["date"],"url":oldest_local["mp3_url"]}
old_in_feed=sorted((x for x in all_records if x["date"] and x["date"]<oldest_local["date"]),key=lambda x:x["date"])
candidate=old_in_feed[0] if old_in_feed else None
if candidate:
    REPORT["historical"]={"status":"Older MP3 link discovered in official feed","date":candidate["date"],
                          "url":candidate["mp3_url"],"title":candidate["title"]}
else:
    REPORT["historical"]={"status":"No earlier MP3 link verified in requested RSS feeds",
                          "note":"2019 launch date is not proof RSS retains 2019 recordings."}
targets=[known]
if candidate:targets.append({"source":"historical-official-RSS","date":candidate["date"],"url":candidate["mp3_url"]})
elif all_records:
    newest=max((x for x in all_records if x["date"]),key=lambda x:x["date"],default=None)
    if newest:targets.append({"source":"current-official-RSS","date":newest["date"],"url":newest["mp3_url"]})
for target in targets:
    url=target["url"]
    base={"source":target["source"],"date":target["date"],"url":url}
    head=fetch_limited(url,method="HEAD")
    base["head"]={"status":head["status"],"content_type":head["headers"].get("content-type"),"length":head["headers"].get("content-length"),"accept_ranges":head["headers"].get("accept-ranges"),"error":head.get("error")}
    ranged=fetch_limited(url,limit=262144,extra={"Range":"bytes=0-262143","Accept":"audio/mpeg"})
    content=ranged["data"]
    base["range"]={"status":ranged["status"],"content_range":ranged["headers"].get("content-range"),
                   "type":ranged["headers"].get("content-type"),"downloaded_bytes":len(content),
                   "magic":content[:16].hex(),"error":ranged.get("error"),"overflow":ranged.get("overflow")}
    valid_audio=content[:3]==b"ID3" or (len(content)>=2 and content[0]==255 and (content[1]&0xe0)==0xe0)
    base["range"]["mp3_magic"]=valid_audio
    if len(content)>10000 and valid_audio and ranged["status"]==206 and REPORT["wav"] is None:
        with tempfile.TemporaryDirectory() as tmp:
            mp3=Path(tmp)/"sample.mp3";out=Path(tmp)/"sample.wav"
            mp3.write_bytes(content)
            args=["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-f","mp3","-i",str(mp3),
                  "-t","3","-ac","1","-ar","16000","-c:a","pcm_s16le", "-y",str(out)]
            try:
                process=subprocess.run(args,capture_output=True,text=True,timeout=18)
                size=out.stat().st_size if out.exists() else 0
                b=out.read_bytes() if size else b""
                success=process.returncode==0 and b.startswith(b"RIFF") and b[8:12]==b"WAVE" and size>10000
                REPORT["wav"]={"source":target["source"],"from_bounded_mp3_range":True,"seconds_requested":3,
                               "bytes":size,"riff_wav_valid":success,"ffmpeg_exit":process.returncode,
                               "message":process.stderr[-380:]}
            except Exception as e:REPORT["wav"]={"error":str(e)}
    REPORT["mp3_tests"].append(base)
REPORT["verdict"]=("DIRECT_MP3_AND_WAV_VERIFIED" if REPORT.get("wav",{}).get("riff_wav_valid") else
                   "MP3_RANGE_CONFIRMED_NO_WAV" if any(x["range"]["status"]==206 and x["range"]["mp3_magic"] for x in REPORT["mp3_tests"]) else
                   "MP3_ACCESS_NOT_CONFIRMED")
if REPORT["historical"]["status"].startswith("Older") and any(x["source"]=="historical-official-RSS" and x["range"]["status"]==206 for x in REPORT["mp3_tests"]):
    REPORT["historical"]["range_verified"]=True
Path("ft-mp3-only-test.json").write_text(json.dumps(REPORT,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(REPORT,ensure_ascii=False,indent=2))
