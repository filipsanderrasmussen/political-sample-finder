#!/usr/bin/env python3
"""One official, real XML speech -> real MP3 byte-range -> 3-sec WAV. No video."""
import datetime as dt
import ftplib
import json
import re
import struct
import subprocess
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

REPO=Path(__file__).resolve().parents[1]
RECORDS=json.loads((REPO/"src/audio-index.json").read_text("utf-8"))
SESSION="20241"; MEETING=16; DATE="2024-11-08"
NAME=f"{SESSION}_M{MEETING}_helemoedet.xml"
URL=next(x["mp3_url"] for x in RECORDS if x["date"]==DATE and x["meeting_no"]==MEETING)
RESULT={"source_xml":"ftp://oda.ft.dk/ODAXML/Referat/samling/"+SESSION+"/"+NAME,
        "source_mp3":URL,"date":DATE,"meeting":MEETING,"retrieved_video":False}
def tag(x):
    return x.tag.rsplit("}",1)[-1]
def fields(e):
    out={}
    for x in e.iter():
        k=tag(x)
        if k in ("StartDateTime","EndDateTime","OratorFirstName","OratorLastName","GroupNameShort","OratorRole"):
            if x.text and x.text.strip() and k not in out:out[k]=x.text.strip()
    return out

buf=[]
def add(chunk):
    if sum(map(len,buf))+len(chunk)>12_000_000:raise ValueError("XML exceeds 12MB limit")
    buf.append(chunk)
with ftplib.FTP("oda.ft.dk",timeout=18) as ft:
    ft.login("anonymous","source-check@example.invalid")
    ft.cwd("/ODAXML/Referat/samling/"+SESSION)
    ft.retrbinary("RETR "+NAME,add)
source=b"".join(buf)
if source.startswith((b"\xff\xfe",b"\xfe\xff")):plain=source.decode("utf-16")
elif source.startswith(b"\xef\xbb\xbf"):plain=source.decode("utf-8-sig")
else:plain=source.decode("utf-8")
if "<!DOCTYPE" in plain.upper() or "<!ENTITY" in plain.upper():raise RuntimeError("Reject DTD")
root=ET.fromstring(plain)
RESULT["xml_bytes"]=len(source)
sitting=next(((x.text or "") for x in root.iter() if tag(x)=="DateOfSitting"),"")
if not sitting.startswith(DATE):raise RuntimeError("XML does not correspond to requested audio date")
anchor_match=re.search(r"/(\d\d)-(\d\d)-(\d{4})_(\d\d)-(\d\d)_salen\.mp3",URL)
if not anchor_match:raise RuntimeError("Audio filename doesn't encode a verifiable start clock")
dd,mm,yy,hh,mn=map(int,anchor_match.groups())
anchor=dt.datetime(yy,mm,dd,hh,mn)
if anchor.date()!=dt.date.fromisoformat(DATE):raise RuntimeError("Audio date differs from XML")
speeches=[]
for t in root.iter():
    if tag(t)!="Tale":continue
    f=fields(t)
    chars=[(x.text or "").strip() for x in t.iter() if tag(x)=="Char" and x.text]
    text=" ".join(chars)
    if not f.get("StartDateTime") or len(text)<100 or not f.get("OratorLastName"):continue
    when=dt.datetime.fromisoformat(f["StartDateTime"])
    seconds=(when-anchor).total_seconds()
    if 90*60<=seconds<=150*60:
        speeches.append({"fields":f,"excerpt":text[:240],"offset_seconds":seconds})
if not speeches:raise RuntimeError("No long speech found 90–150 minutes into known meeting")
speech=min(speeches,key=lambda x:abs(x["offset_seconds"]-7200))
RESULT["speech"]=speech

def request(method="GET",ran=None):
    headers={"Accept":"audio/mpeg","Accept-Encoding":"identity","User-Agent":"TALEDATABASE-2000-XML-AUDIO-TEST/1.0"}
    if ran:headers["Range"]="bytes="+str(ran[0])+"-"+str(ran[1])
    with urllib.request.urlopen(urllib.request.Request(URL,headers=headers,method=method),timeout=17) as r:
        blob=r.read(320_001) if method=="GET" else b""
        if len(blob)>320000:raise RuntimeError("MP3 byte limit exceeded")
        return r.status,blob,dict(r.headers)
status,_,h=request("HEAD")
if status!=200 or h.get("Content-Type")!="audio/mpeg":raise RuntimeError("Not a valid audio source")
total=int(h["Content-Length"])
status,initial,_=request(ran=(0,319999))
if status!=206:raise RuntimeError("Remote server did not return MP3 byte range")
# Demand five consecutive matching MPEG-1 Layer III frames to avoid false sync hits.
id3=0
if initial[:3]==b"ID3":id3=10+((initial[6]&127)<<21)+((initial[7]&127)<<14)+((initial[8]&127)<<7)+(initial[9]&127)
table=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]
def get_header(blob,pos):
    if pos<0 or pos+4>len(blob):return None
    h=struct.unpack_from(">I",blob,pos)[0]
    if (h&0xffe00000)!=0xffe00000 or ((h>>19)&3)!=3 or ((h>>17)&3)!=1:return None
    br=(h>>12)&15;sr=(h>>10)&3
    if br in (0,15) or sr==3:return None
    kbps=table[br];sample_rate=[44100,48000,32000][sr]
    frame_size=144000*kbps//sample_rate+((h>>9)&1)
    return kbps,sample_rate,frame_size
def first_verified_frame(blob,min_at=0):
    for start in range(min_at,min(len(blob)-3000,24000)):
        frame=get_header(blob,start)
        if frame is None:continue
        pos=start
        if all_valid_sequence(blob,pos,frame):
            return start,frame[0]
    return None,None
def all_valid_sequence(blob,start,frame):
    pos=start
    for _ in range(5):
        info=get_header(blob,pos)
        if info is None or info[:2]!=frame[:2]:return False
        pos+=info[2]
    return True
_,rate=first_verified_frame(initial,id3)
if rate is None:raise RuntimeError("No five-frame-consistent MPEG Layer 3 bitrate detected")
if rate != 128:raise RuntimeError(f"Unexpected bitrate {rate}; refuse inaccurate time mapping")
offset=int(id3+(speech["offset_seconds"]*rate*1000/8))
if offset>=total-320000:raise RuntimeError("XML speech starts beyond MP3 bytes")
status,middle,hr=request(ran=(offset,offset+319999))
if status!=206 or len(middle)!=320000:raise RuntimeError("Timed MP3 byte range unavailable")
# Seek forward to the first MP3 frame boundary.
start, mid_rate=first_verified_frame(middle)
if start is None or mid_rate != rate:raise RuntimeError("No five-frame-consistent same-bitrate MP3 frames at target range")
with tempfile.TemporaryDirectory() as temp:
    inp=Path(temp)/"speech.mp3";inp.write_bytes(middle[start:])
    out=Path(temp)/"speech.wav"
    ff=subprocess.run(["ffmpeg","-v","error","-nostdin","-f","mp3","-i",str(inp),
                       "-t","3","-ac","1","-ar","16000","-c:a","pcm_s16le","-y",str(out)],
                      capture_output=True,text=True,timeout=18)
    wav=out.read_bytes() if out.exists() else b""
    RESULT["clip"]={"wave_valid":len(wav)>30000 and wav[:4]==b"RIFF" and wav[8:12]==b"WAVE",
        "bytes":len(wav),"ffmpeg_exit":ff.returncode,"ffmpeg_error":ff.stderr[-220:],
        "source_bitrate_kbps":rate,"source_mp3_bytes":total,"downloaded_mp3_bytes":len(initial)+len(middle),
        "requested_mp3_range":hr.get("Content-Range"),
        "time_reference":"XML StartDateTime relative to audio filename start; approx CBR timing, not exact word alignment"}
RESULT["verdict"]="XML_SPEECH_TO_MP3_TO_WAV_VERIFIED" if RESULT["clip"]["wave_valid"] else "NOT_VERIFIED"
Path("ft-xml-audio-e2e.json").write_text(json.dumps(RESULT,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(RESULT,ensure_ascii=False,indent=2))
