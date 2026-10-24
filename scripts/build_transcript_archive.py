#!/usr/bin/env python3
"""Build sourced, searchable Danish Folketing transcript data for MP3-linked meetings.

Fetches Parliament's published PDF transcript for each distinct meeting in
src/audio-index.json. Uses PyMuPDF to extract speeches and timestamps, saving
*public transcript text only* as deployable Cloudflare static assets.

Never invents transcript rows: if an official PDF is unavailable or cannot be
parsed reliably, the meeting is marked as unavailable in the manifest.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import pathlib
import re
import time
import urllib.error
import urllib.request
from collections import defaultdict
import fitz

BASE = pathlib.Path(__file__).resolve().parents[1]
AUDIO = BASE / "src/audio-index.json"
OUTPUT = BASE / "public/archive"
MARK = re.compile(r"(?m)^\s*Kl\.\s*(\d{1,2}:\d{2})\s*$")
MONTHS = ["januar","februar","marts","april","maj","juni","juli","august","september","oktober","november","december"]
SUSPECT = re.compile(r"^(?:Spm\.?\s*nr|Svar på|Til\s+(?:udenrigs|stats|justits|finans|social|miljø|udlændinge)|\d+[\).–-])",re.I)

def session(date):
    d=dt.date.fromisoformat(date)
    # The second 2025-26 sitting has its own official samling identifier.
    if dt.date(2026,4,10) <= d < dt.date(2026,10,6):
        return "20252"
    return str(d.year if d.month>=10 else d.year-1)+"1"

def extract_page(blocktext,page):
    result=[]
    marks=list(MARK.finditer(blocktext))
    for i,m in enumerate(marks):
        block=blocktext[m.end():(marks[i+1].start() if i+1<len(marks) else len(blocktext))]
        lines=[re.sub(r"\s+"," ",l.strip()) for l in block.splitlines() if l.strip()]
        if len(lines)<2:continue
        marker=next((j for j in range(min(4,len(lines))) if lines[j].endswith(":")),None)
        if marker is None:continue
        speaker=" ".join(lines[:marker+1]).rstrip(":").strip()
        if not speaker or len(speaker)>160 or SUSPECT.search(speaker):continue
        speech=re.sub(r"\s+"," "," ".join(lines[marker+1:]).replace("\u00ad","")).strip()
        speech=re.sub(r"\s+-\s+","-",speech)
        if len(speech)<7:continue
        result.append({"clock":m.group(1),"speaker":speaker,"content":speech[:12000],"page":page})
    return result

def ordered_columns(page):
    blocks=[b for b in page.get_text("blocks") if len(b)>=7 and b[6]==0 and b[4].strip()]
    split=page.rect.width*.49
    left=sorted((b for b in blocks if b[0]<split),key=lambda b:(b[1],b[0]))
    right=sorted((b for b in blocks if b[0]>=split),key=lambda b:(b[1],b[0]))
    return "\n".join(b[4] for b in left+right)

def parse_pdf(raw, expected_date=None, expected_meeting_no=None):
    pdf=fitz.open(stream=raw,filetype="pdf")
    if not pdf.page_count:raise ValueError("Empty PDF")
    first=pdf[0].get_text("text",sort=True)
    if expected_date:
        d=dt.date.fromisoformat(expected_date)
        day=str(d.day)
        expected=re.compile(r"\b0?"+re.escape(day)+r"\.\s*"+MONTHS[d.month-1]+r"\s+"+str(d.year)+r"\b",re.I)
        if not expected.search(first):
            pdf.close()
            raise ValueError("PDF date does not match podcast date")
    if expected_meeting_no:
        expected=re.compile(r"\b"+str(expected_meeting_no)+r"\.\s*møde\\b",re.I)
        if not expected.search(first):
            pdf.close()
            raise ValueError("PDF meeting number does not match podcast")
    records=[]
    for no,page in enumerate(pdf,1):
        col=extract_page(ordered_columns(page),no)
        alternate=extract_page(page.get_text("text",sort=True),no)
        records.extend(col if len(col)>=len(alternate) else alternate)
    pdf.close()
    # Remove accidental duplicate adjacent clock/speaker/short lead snippets.
    cleaned=[]
    for speech in records:
        if cleaned and all(speech[k]==cleaned[-1][k] for k in ["clock","speaker","content"]):
            continue
        cleaned.append(speech)
    return cleaned

def download(url,retries=2):
    for n in range(retries+1):
        try:
            req=urllib.request.Request(url,headers={
                "User-Agent":"PoliticalSampleFinder/0.5 (historical source-backed transcript indexing)",
                "Accept":"application/pdf"
            })
            with urllib.request.urlopen(req,timeout=40) as response:
                if response.status!=200:raise IOError("HTTP "+str(response.status))
                length=int(response.headers.get("Content-Length","0") or 0)
                if length>30_000_000:raise IOError("PDF above 30MB")
                raw=response.read(30_000_001)
                if not raw.startswith(b"%PDF") or len(raw)>30_000_000:
                    raise IOError("Not a PDF below 30MB")
                return raw
        except Exception:
            if n==retries:raise
            time.sleep(1+n)
    raise AssertionError("unreachable")

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--limit",type=int,default=0,help="For smoke-test: only the most recent N distinct meetings")
    p.add_argument("--meeting",type=str,default="",help="Only one meeting id, e.g. 20251_M41")
    p.add_argument("--overwrite",action="store_true")
    args=p.parse_args()
    audio=json.loads(AUDIO.read_text(encoding="utf-8"))
    unique={}
    for pcast in audio:
        meeting_id=f"{session(pcast['date'])}_M{pcast['meeting_no']}"
        unique.setdefault(meeting_id,{
            "id":meeting_id,"samling":session(pcast['date']),
            "meeting_no":pcast["meeting_no"],"date":pcast["date"],
            "source_url":f"https://www.folketingstidende.dk/samling/{session(pcast['date'])}/salen/M{pcast['meeting_no']}/{session(pcast['date'])}_M{pcast['meeting_no']}_referat.pdf"
        })
    meetings=sorted(unique.values(),key=lambda m:(m["date"],m["meeting_no"]),reverse=True)
    if args.meeting:meetings=[m for m in meetings if m["id"]==args.meeting]
    if args.limit:meetings=meetings[:args.limit]
    if not meetings:raise ValueError("No meetings selected")
    OUTPUT.mkdir(parents=True,exist_ok=True)
    existing={}
    manifest_path=OUTPUT/"manifest.json"
    if manifest_path.exists():
        old=json.loads(manifest_path.read_text(encoding="utf-8"))
        existing={m["id"]:m for m in old if isinstance(m,dict) and "id" in m}
    processed,failed=0,0
    for position,m in enumerate(meetings,1):
        target=OUTPUT/(m["id"]+".json")
        if target.exists() and not args.overwrite:
            present=json.loads(target.read_text(encoding="utf-8"))
            if present.get("date")==m["date"] and present.get("source_url")==m["source_url"] and present.get("speeches"):
                row={**m,"speeches":len(present["speeches"]),"status":"ready"}
                existing[m["id"]]=row
                continue
        try:
            raw=download(m["source_url"])
            extracted=parse_pdf(raw,m["date"],m["meeting_no"])
            if not extracted:
                raise ValueError("No speeches parsed")
            row={**m,"speeches":len(extracted),"status":"ready"}
            target.write_text(json.dumps({**m,"speeches":extracted},ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
            existing[m["id"]]=row
            processed+=1
            print(f"[{position}/{len(meetings)}] OK {m['id']} {m['date']} {len(extracted)} speeches",flush=True)
        except Exception as exc:
            failed+=1
            existing[m["id"]]={**m,"speeches":0,"status":"missing","error":str(exc)[:180]}
            print(f"[{position}/{len(meetings)}] FAIL {m['id']} {str(exc)[:150]}",flush=True)
    manifest=sorted((existing[k] for k in unique if k in existing),key=lambda x:(x["date"],x["meeting_no"]),reverse=True)
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    total=sum(x.get("speeches",0) for x in manifest if x.get("status")=="ready")
    print(f"SUMMARY: examined={len(meetings)} downloaded={processed} failed={failed}, archived meetings={sum(x.get('status')=='ready' for x in manifest)}, archived speeches={total}",flush=True)
    if args.meeting and failed:raise SystemExit("Smoke-test meeting failed")

if __name__=="__main__": main()
