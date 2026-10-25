#!/usr/bin/env python3
"""Build verified-MP3-only XML archives from official Folketinget FTP (no videos).
Bounded per run, stable version hashes, never scrape transcripts or invent data.
"""
import argparse, datetime as dt, ftplib, hashlib, json, re, urllib.request, urllib.error, xml.etree.ElementTree as ET
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
INDEX=ROOT/"src/audio-index.json"
OUT=ROOT/"public/archive/xml"
MANIFEST=OUT/"manifest.json"
VALID=re.compile(r"^https://cdnapi\.kaltura\.com/p/2158211/sp/0/playManifest/entryId/1_[a-z0-9]+/protocol/http/flavorParamIds/0/format/url/\d{2}-\d{2}-\d{4}_\d{2}-\d{2}_salen\.mp3$",re.I)
LIMIT_XML=12_000_000
PARTY=re.compile(r"^[A-ZÆØÅ]{1,6}$")
def tag(element):return element.tag.rsplit("}",1)[-1]
def first(element,name):
    return next(((x.text or "").strip() for x in element.iter() if tag(x)==name and x.text), "")
def xml_speeches(raw,samling,meeting,date):
    if raw[:2] in (b"\xff\xfe",b"\xfe\xff"):plain=raw.decode("utf-16")
    elif raw.startswith(b"\xef\xbb\xbf"):plain=raw.decode("utf-8-sig")
    else:plain=raw.decode("utf-8")
    if "<!DOCTYPE" in plain.upper() or "<!ENTITY" in plain.upper():raise ValueError("XML entities rejected")
    root=ET.fromstring(plain)
    if first(root,"ParliamentarySession")!=samling or first(root,"MeetingNumber")!=str(meeting):
        raise ValueError("XML session/meeting doesn't match expected original")
    if not first(root,"DateOfSitting").startswith(date):
        raise ValueError("XML date differs from MP3 date")
    out=[]
    for tale in root.iter():
        if tag(tale)!="Tale":continue
        starts=first(tale,"StartDateTime")
        try:clock=dt.datetime.fromisoformat(starts).strftime("%H:%M:%S")
        except (ValueError,TypeError):continue
        if not starts.startswith(date):continue
        fname=first(tale,"OratorFirstName")
        lname=first(tale,"OratorLastName")
        party=first(tale,"GroupNameShort")
        if party and not PARTY.fullmatch(party):party=""
        title=(first(tale,"OratorRole") or "taler")
        speaker=(" ".join(x for x in (fname,lname) if x).strip() or first(tale,"TalerTitel"))
        if not speaker:continue
        if party:speaker+=" ("+party+")"
        words=[(e.text or "").strip() for e in tale.iter() if tag(e)=="Char" and e.text and e.text.strip()]
        # The XML Char payload represents the official spoken paragraph, not a PDF OCR guess.
        content=re.sub(r"\s+"," "," ".join(words)).strip()
        if not 6<=len(content)<=12000 or len(speaker)>160:continue
        out.append({"speaker":speaker,"clock":clock,"content":content,"party":party})
    if not out:raise ValueError("No speech metadata with transcript text was found")
    return out
def download_xml(ftp,path):
    blocks=[]
    def consume(b):
        if sum(map(len,blocks))+len(b)>LIMIT_XML:raise ValueError("XML over 12 MB")
        blocks.append(b)
    ftp.retrbinary("RETR "+path,consume,blocksize=65536)
    return b"".join(blocks)
def audio_head(url):
    req=urllib.request.Request(url,method="HEAD",headers={"User-Agent":"TALEDATABASE-2000/1.0","Accept":"audio/mpeg"})
    with urllib.request.urlopen(req,timeout=15) as res:
        return res.status==200 and res.headers.get("Content-Type","").split(";")[0].strip()=="audio/mpeg" and int(res.headers.get("Content-Length",0))>100000
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--max-new",type=int,default=3)
    p.add_argument("--max-checks",type=int,default=12)
    opt=p.parse_args()
    if not (1<=opt.max_new<=8 and 1<=opt.max_checks<=30):p.error("Unsafe batch size")
    OUT.mkdir(parents=True,exist_ok=True)
    manifest=json.loads(MANIFEST.read_text("utf-8")) if MANIFEST.exists() else []
    existing={x["id"] for x in manifest}
    records=json.loads(INDEX.read_text("utf-8"))
    print("Official MP3 entries:",len(records),"XML indexed:",len(existing),flush=True)
    # Scan newest first, then extend backwards across verified feed coverage.
    records=sorted(records,key=lambda x:(x.get("date",""),x.get("meeting_no",0)),reverse=True)
    checks=new=0
    ftp=None;current=None
    try:
        for a in records:
            if new>=opt.max_new or checks>=opt.max_checks:break
            date=a.get("date","")
            number=a.get("meeting_no")
            url=a.get("mp3_url","")
            if not re.fullmatch(r"20\d\d-\d\d-\d\d",date) or not isinstance(number,int) or not VALID.fullmatch(url):
                continue
            year=int(date[:4])
            samling=(str(year-1)+"1" if int(date[5:7])<9 else str(year)+"1")
            # Danish Folketing sessions may include extraordinary 2-sessions.
            possible=[samling,str(year)+"2",str(year-1)+"2"]
            if ftp is None:
                ftp=ftplib.FTP("oda.ft.dk",timeout=18)
                ftp.login("anonymous","taledatabase@example.invalid")
            if current is None:
                current=set(ftp.nlst("/ODAXML/Referat/samling"))
            for session in possible:
                mid=f"{session}_M{number}"
                if mid in existing:break
                checks+=1
                if checks>opt.max_checks:break
                remote=f"/ODAXML/Referat/samling/{session}/{session}_M{number}_helemoedet.xml"
                try:
                    raw=download_xml(ftp,remote)
                    speeches=xml_speeches(raw,session,number,date)
                    pending=sum(1 for row in speeches if re.search(
                        r"(?:talen er under udarbejdelse|afventer korrektur)",row["content"],re.I))
                    if pending:
                        raise ValueError(f"{pending}/{len(speeches)} speech segments are pending editorial completion")
                except (ftplib.error_perm,ValueError,ET.ParseError,UnicodeError) as e:
                    print("Skip",mid,"invalid or missing XML:",str(e)[:90],flush=True)
                    continue
                try:
                    if not audio_head(url):raise ValueError("MP3 HEAD is not valid audio/mpeg")
                except (urllib.error.URLError,TimeoutError,ValueError) as e:
                    print("Skip",mid,"MP3 verification failed:",str(e)[:100],flush=True)
                    break
                source=(f"https://www.folketingstidende.dk/samling/{session}/salen/M{number}/{session}_M{number}_referat.pdf")
                verified=dt.datetime.now(dt.timezone.utc).isoformat()
                content={"id":mid,"samling":session,"meeting_no":number,"date":date,
                         "source_url":source,"audio_url":url,"audio_title":a.get("title","")[:180],
                         "verified_at":verified,"speeches":speeches}
                # Version hashes only the source-backed content; do not hash verification timestamp.
                digest=hashlib.sha256(json.dumps({k:v for k,v in content.items() if k!="verified_at"},
                     sort_keys=True,ensure_ascii=False).encode("utf-8")).hexdigest()
                content["version"]=digest
                (OUT/(mid+".json")).write_text(json.dumps(content,ensure_ascii=False,separators=(",",":"))+"\n","utf-8")
                manifest.append({"id":mid,"samling":session,"meeting_no":number,"date":date,
                                 "audio_url":url,"source_url":source,"speeches":len(speeches),
                                 "version":digest,"status":"ready"})
                existing.add(mid);new+=1
                print("VERIFIED",mid,date,len(speeches),"speeches and direct MP3",flush=True)
                break
        manifest.sort(key=lambda x:(x["date"],x["id"]),reverse=True)
        MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,separators=(",",":"))+"\n","utf-8")
        print("NEW",new,"CHECKS",checks,"MANIFEST",len(manifest),flush=True)
    finally:
        if ftp is not None:
            try:ftp.quit()
            except Exception:pass
if __name__=="__main__":main()
