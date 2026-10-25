#!/usr/bin/env python3
"""Read-only historical-session MP3 byte-seek test with strict ~1 MB/network cap.
Proofs: ID3/MP3 metadata, CBR consistency sample, HTTP 206 mid-file, small WAV.
No video requests and no full media downloads.
"""
import array, json, re, struct, subprocess, tempfile, urllib.request, wave
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
INDEX=json.loads((ROOT/"src/audio-index.json").read_text("utf-8"))
TARGETS=[min(INDEX,key=lambda x:x["date"]),max(INDEX,key=lambda x:x["date"])]
REPORT={"purpose":"Seek two hours into direct MP3 with tiny byte range","tests":[]}
MAX_RANGE=300000
def http(url, method="GET", byte_range=None):
    h={"User-Agent":"TALEDATABASE-2000-bounded-MP3-test/1.0","Accept":"audio/mpeg","Accept-Encoding":"identity"}
    if byte_range:h["Range"]="bytes="+str(byte_range[0])+"-"+str(byte_range[1])
    req=urllib.request.Request(url,headers=h,method=method)
    try:
        with urllib.request.urlopen(req,timeout=15) as r:
            blob=r.read(MAX_RANGE+1) if method=="GET" else b""
            return {"status":r.status,"data":blob[:MAX_RANGE],
                "overflow":len(blob)>MAX_RANGE,"range":r.headers.get("Content-Range"),
                "size":r.headers.get("Content-Length"),"type":r.headers.get("Content-Type")}
    except Exception as e:return {"error":str(e)[:230],"status":None,"data":b""}

def frames(blob,base=0,maximum=9):
    output=[]
    for i in range(len(blob)-4):
        h=struct.unpack_from(">I",blob,i)[0]
        if h&0xffe00000 != 0xffe00000:continue
        version=(h>>19)&3;layer=(h>>17)&3;br=(h>>12)&15;sr=(h>>10)&3
        if version==1 or layer!=1 or br in (0,15) or sr==3:continue
        v1=version==3
        rates=[44100,48000,32000]; rate=rates[sr]//(1 if v1 else 2 if version==2 else 4)
        table=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] if v1 else [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160]
        kbps=table[br]
        size=(144000 if v1 else 72000)*kbps//rate+((h>>9)&1)
        if size<24 or i+2*size+4>len(blob):continue
        nxt=struct.unpack_from(">I",blob,i+size)[0]
        if nxt&0xffe00000 != 0xffe00000 or ((nxt>>19)&3)!=version or ((nxt>>17)&3)!=layer:continue
        nxt2=struct.unpack_from(">I",blob,i+2*size)[0]
        if nxt2&0xffe00000 != 0xffe00000:continue
        output.append({"position":base+i,"kbps":kbps,"sample_rate":rate,"frame_bytes":size,"version":version})
        if len(output)>=maximum:break
    return output

for item in TARGETS:
    url=item["mp3_url"]
    row={"date":item["date"],"mp3_url":url,"requests":[]}
    head=http(url,method="HEAD")
    row["head"]={k:v for k,v in head.items() if k!="data"}
    length=int(head.get("size") or 0)
    if head.get("status")!=200 or not length:
        REPORT["tests"].append(row);continue
    initial=http(url,byte_range=(0,MAX_RANGE-1))
    row["requests"].append({"bytes":"0-"+str(MAX_RANGE-1),"status":initial.get("status"),"content_range":initial.get("range"),"actual_bytes":len(initial.get("data",b""))})
    first=initial["data"]
    if len(first)<20000 or initial.get("status")!=206:
        row["problem"]="Initial range not honored";REPORT["tests"].append(row);continue
    id3=0
    if first.startswith(b"ID3") and len(first)>10:
        id3=10+((first[6]&127)<<21)+((first[7]&127)<<14)+((first[8]&127)<<7)+(first[9]&127)
    all_start=frames(first)
    at_start=[x for x in all_start if x["position"]>=id3]
    bitrate=at_start[0]["kbps"] if at_start else None
    row["mp3_metadata"]={"id3_bytes":id3,"initial_bitrates":list(sorted(set(x["kbps"] for x in all_start))),
                         "primary_kbps":bitrate,"first_frames":all_start[:2],
                         "vbr_marker":("Xing" if b"Xing" in first[:4096] else "Info" if b"Info" in first[:4096] else "VBRI" if b"VBRI" in first[:4096] else None)}
    if not bitrate:
        row["problem"]="No reliable MPEG Layer 3 frame detected";REPORT["tests"].append(row);continue
    # Estimated absolute 2h time offset for CBR; check bitrate at this byte range.
    seconds=7200
    offset=id3+round(bitrate*1000/8*seconds)
    row["estimated_seek_offset"]=offset
    row["estimated_full_length_seconds"]=round((length-id3)/(bitrate*1000/8))
    if offset+MAX_RANGE>=length:
        row["problem"]="Recording shorter than two hours at sampled bitrate";REPORT["tests"].append(row);continue
    fragment=http(url,byte_range=(offset,offset+MAX_RANGE-1))
    row["requests"].append({"bytes":str(offset)+"-"+str(offset+MAX_RANGE-1),
        "status":fragment.get("status"),"content_range":fragment.get("range"),
        "actual_bytes":len(fragment.get("data",b""))})
    middle=fragment.get("data",b"")
    middle_frames=frames(middle,base=offset)
    row["mid_file_bitrates"]=list(sorted(set(x["kbps"] for x in middle_frames)))
    row["samples_agree_cbr"]=bool(middle_frames) and len(set(x["kbps"] for x in all_start+middle_frames))==1 and not row["mp3_metadata"]["vbr_marker"]=="Xing"
    if fragment.get("status")!=206 or not middle_frames:
        row["problem"]="Middle sample not accessible or no MP3 frame";REPORT["tests"].append(row);continue
    with tempfile.TemporaryDirectory() as tmp:
        source=Path(tmp)/"midfile.mp3"
        # Remove arbitrary bytes preceding first valid frame.
        frame_start=middle_frames[0]["position"]-offset
        source.write_bytes(middle[frame_start:])
        out=Path(tmp)/"sample.wav"
        cmd=["ffmpeg","-v","error","-nostdin","-f","mp3","-i",str(source),
             "-t","3","-ac","1","-ar","16000","-c:a","pcm_s16le","-y",str(out)]
        p=subprocess.run(cmd,capture_output=True,text=True,timeout=18)
        wav=out.read_bytes() if out.exists() else b""
        row["wav"]={"valid":len(wav)>30000 and wav[:4]==b"RIFF" and wav[8:12]==b"WAVE",
                    "bytes":len(wav),"ffmpeg_exit":p.returncode,"error":p.stderr[-240:]}
        if row["wav"]["valid"]:
            with wave.open(str(out),"rb") as opened:
                raw=opened.readframes(opened.getnframes())
                samples=array.array("h");samples.frombytes(raw[:min(len(raw),200000)])
                row["wav"].update({"duration_seconds":round(opened.getnframes()/opened.getframerate(),3),
                   "channels":opened.getnchannels(),"sample_rate":opened.getframerate(),
                   "peak_absolute_sample":max((abs(x) for x in samples),default=0)})
        row["total_mp3_downloaded_bytes"]=len(first)+len(middle)
    REPORT["tests"].append(row)
REPORT["verdict"]="MID_FILE_RANGE_WAV_SUCCESS" if all(x.get("wav",{}).get("valid") for x in REPORT["tests"]) else "PARTIAL_OR_FAILED"
Path("ft-mp3-two-hour-range.json").write_text(json.dumps(REPORT,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(REPORT,ensure_ascii=False,indent=2))
