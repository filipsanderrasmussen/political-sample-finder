#!/usr/bin/env python3
"""Read-only feasibility test: historical *direct* MP3 and bounded two-hour seek."""
import datetime as dt
import json
import re
import socket
import subprocess
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = json.loads((ROOT / "src/audio-index.json").read_text("utf-8"))
AUDIO = min(INDEX, key=lambda x: x["date"])["mp3_url"]
REPORT = {"created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
          "audio_only": True, "historical_candidates": [],
          "historical_validated": [], "catalog_checks": [],
          "middle_seek": {}, "verdict": "UNTESTED"}
UA = "TALEDATABASE-2000/1.0 (MP3-only source verification)"
MAX_PROXY_BYTES = 5 * 1024 * 1024
HEADERS = {"User-Agent": UA, "Accept": "application/json,audio/mpeg,*/*"}

def json_request(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers={**HEADERS, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read(2_000_001)
            if len(body) > 2_000_000:
                return {"status":response.status,"error":"response >2 MB"},None
            parsed = json.loads(body)
            return {"status":response.status},parsed
    except Exception as error:
        return {"error":str(error)[:220]},None

def media_head(url):
    try:
        req=urllib.request.Request(url, headers={"User-Agent":UA},method="HEAD")
        with urllib.request.urlopen(req,timeout=12) as response:
            return {"status":response.status,"type":response.headers.get("Content-Type"),
                    "bytes":response.headers.get("Content-Length"),
                    "accept_ranges":response.headers.get("Accept-Ranges")}
    except Exception as error:
        return {"error":str(error)[:160]}

# Discover past episodes through Apple's public directory (a pointer, not a trusted audio source).
url="https://itunes.apple.com/lookup?id=1440585813&entity=podcastEpisode&limit=200"
status,body=json_request(url)
info={"service":"Apple podcast episode directory","request":url,**status}
if isinstance(body,dict) and isinstance(body.get("results"),list):
    episodes=[x for x in body["results"] if x.get("wrapperType")=="podcastEpisode"]
    info["episodes"]=len(episodes)
    info["earliest_release"]=min((x.get("releaseDate") for x in episodes if x.get("releaseDate")),default=None)
    for ep in sorted(episodes,key=lambda x:x.get("releaseDate","")):
        link=ep.get("episodeUrl","")
        date=ep.get("releaseDate","")
        if date and date[:10] < "2024-11-08" and link.startswith("https://"):
            REPORT["historical_candidates"].append({
                "source":"Apple-podcast-episode","published":date[:10],
                "title":ep.get("trackName","")[:130],"url":link[:550]})
            if len(REPORT["historical_candidates"])>=12:break
REPORT["catalog_checks"].append(info)

# Test public read-only Kaltura media listing; permissions may require a session.
params={
 "format":"1", "partnerId":"2158211", "filter[objectType]":"KalturaMediaEntryFilter",
 "filter[mediaTypeEqual]":"5", "filter[createdAtLessThanOrEqual]":"1731024000",
 "pager[pageSize]":"30", "pager[pageIndex]":"1"}
kurl="https://www.kaltura.com/api_v3/service/media/action/list?"+urllib.parse.urlencode(params)
status,body=json_request(kurl)
kres={"service":"Kaltura public media.list",**status}
if isinstance(body,dict):
    if body.get("objectType")=="KalturaAPIException":
        kres["api_response"]="permission_or_api_exception"
        kres["api_error_code"]=body.get("code")
    else:
        entries=body.get("objects",[])
        kres["reported_total_count"]=body.get("totalCount")
        kres["returned"]=len(entries)
        for x in entries[:30]:
            name=x.get("name","")
            entry_id=x.get("id")
            if re.search(r"(?:møde i salen|salen|folketing)",name,re.I):
                kres.setdefault("candidate_entries",[]).append({"id":entry_id,"name":name[:110],
                    "created_at":x.get("createdAt"),"media_type":x.get("mediaType")})
else:kres["api_response"]="not_json_response"
REPORT["catalog_checks"].append(kres)

# Only validate authentic MP3 links, never URLs to a video.
for item in REPORT["historical_candidates"][:6]:
    url=item["url"]
    if not (".mp3" in url.lower() and ("/playManifest/" in url or "/feed/" in url)):
        continue
    response=media_head(url)
    item["head"]=response
    if response.get("status")==200 and response.get("type","").startswith("audio/"):
        REPORT["historical_validated"].append(item)

# A traffic-metered localhost proxy prevents ffmpeg from silently downloading whole recordings.
class BoundedProxy(BaseHTTPRequestHandler):
    upstream=AUDIO
    total=0
    ranges=[]
    def log_message(self,*args):pass
    def do_GET(self):
        requested=self.headers.get("Range")
        # Keep accurate-seek byte-range negotiation; never fetch any video.
        extra={"User-Agent":UA,"Accept":"audio/mpeg","Accept-Encoding":"identity"}
        if requested:extra["Range"]=requested
        BoundedProxy.ranges.append(requested or "none")
        try:
            rq=urllib.request.Request(self.upstream,headers=extra)
            upstream=urllib.request.urlopen(rq,timeout=15)
            self.send_response(upstream.status)
            for key in ["Content-Length","Content-Type","Content-Range","Accept-Ranges"]:
                if upstream.headers.get(key):self.send_header(key,upstream.headers.get(key))
            self.send_header("Connection","close")
            self.end_headers()
            with upstream:
                while BoundedProxy.total<MAX_PROXY_BYTES:
                    block=upstream.read(min(32768,MAX_PROXY_BYTES-BoundedProxy.total))
                    if not block:break
                    BoundedProxy.total+=len(block)
                    try:self.wfile.write(block)
                    except (BrokenPipeError,ConnectionResetError):break
        except Exception as error:
            if not self.wfile.closed:
                try:self.send_error(502,str(error)[:80])
                except Exception:pass

server=ThreadingHTTPServer(("127.0.0.1",0),BoundedProxy)
thread=threading.Thread(target=server.serve_forever,daemon=True)
thread.start()
try:
    with tempfile.TemporaryDirectory() as temp:
        output=Path(temp)/"two_hours_into_meeting.wav"
        link=f"http://127.0.0.1:{server.server_port}/official.mp3"
        # Actual timestamp seek, rather than converting a random middle byte range.
        args=["ffmpeg","-hide_banner","-loglevel","warning","-nostdin",
              "-rw_timeout","12000000","-ss","02:00:00","-i",link,
              "-t","3","-vn","-ac","1","-ar","16000","-c:a","pcm_s16le",
              "-y",str(output)]
        try:
            res=subprocess.run(args,capture_output=True,text=True,timeout=55)
            audio=output.read_bytes() if output.exists() else b""
            REPORT["middle_seek"]={
                "target_time":"02:00:00","output_seconds_requested":3,
                "original_mp3_size_bytes":media_head(AUDIO).get("bytes"),
                "ffmpeg_exit":res.returncode,"ffmpeg_log":res.stderr[-1100:],
                "wav_bytes":len(audio),"riff_wav_valid":audio.startswith(b"RIFF") and audio[8:12]==b"WAVE"
                     and len(audio)>10000,
                "total_upstream_mp3_bytes":BoundedProxy.total,
                "proxy_budget_bytes":MAX_PROXY_BYTES,
                "range_headers":BoundedProxy.ranges[:12]}
        except Exception as error:
            REPORT["middle_seek"]={"error":str(error)[:320]}
finally:
    server.shutdown()
    server.server_close()
if REPORT["middle_seek"].get("riff_wav_valid") and REPORT["middle_seek"].get("total_upstream_mp3_bytes",MAX_PROXY_BYTES+1)<MAX_PROXY_BYTES:
    REPORT["verdict"]="TIMED_2H_SEEK_WITH_BOUNDED_MP3_AND_WAV_SUCCESS"
elif REPORT["middle_seek"].get("riff_wav_valid"):
    REPORT["verdict"]="WAV_VERIFIED_BUT_DOWNLOAD_BUDGET_EXHAUSTED"
else:
    REPORT["verdict"]="EXACT_TIMED_SEEK_NOT_YET_VERIFIED"
REPORT["historical_verdict"]="older_MP3_verified" if REPORT["historical_validated"] else "older_MP3_not_yet_verified"
Path("ft-mp3-history-seek.json").write_text(json.dumps(REPORT,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(REPORT,ensure_ascii=False,indent=2))
