#!/usr/bin/env python3
"""Read-only XML source diagnostic. No production changes; no audio download."""
import collections
import datetime as dt
import ftplib
import json
import re
import socket
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import PurePosixPath

HOST="oda.ft.dk"
SEARCH="smørrebrød"
MAX_BYTES=12*1024*1024
result={"timestamp":dt.datetime.now(dt.timezone.utc).isoformat(),"source":"Folketinget ODA official XML archive","read_only":True,"http":[],"ftp":{},"xml":{},"verdict":"NOT_TESTED"}

def local(tag):
    return tag.rsplit("}",1)[-1] if isinstance(tag,str) else str(tag)

def collect(buf,max_bytes=MAX_BYTES):
    def receive(chunk):
        if sum(map(len,buf))+len(chunk)>max_bytes:
            raise ValueError("Download over 12 MiB; terminated")
        buf.append(chunk)
    return receive

def analyze(source,data):
    # Official Microsoft FTP exports may be UTF-16 rather than UTF-8.
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        decoded=data.decode("utf-16")
    elif data[:3] == b"\xef\xbb\xbf":
        decoded=data.decode("utf-8-sig")
    else:
        decoded=data.decode("utf-8")
    if "<!DOCTYPE" in decoded.upper() or "<!ENTITY" in decoded.upper():
        raise ValueError("DTD/entity found: reject external entity expansion")
    if not decoded.lstrip().startswith("<"):
        raise ValueError("XML does not start with '<', first bytes "+repr(data[:32]))
    root=ET.fromstring(decoded)
    tags=collections.Counter(local(x.tag) for x in root.iter())
    values=[(local(x.tag), (x.text or "").strip()) for x in root.iter() if x.text and x.text.strip()]
    patterns=("tale","tid","klokke","navn","person","aktor","ordfoer","speaker","afsnit","tekst")
    matching_tags={k:v for k,v in tags.most_common() if any(p in k.lower() for p in patterns)}
    hits=[(tag,txt[max(0,txt.casefold().find(SEARCH)-110):txt.casefold().find(SEARCH)+len(SEARCH)+160])
          for tag,txt in values if SEARCH in txt.casefold()]
    times=[(tag,value[:60]) for tag,value in values if re.search(r"^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$",value)]
    # Associate the exact quote with its enclosing speech segment and metadata.
    matched_segments=[]
    for segment in root.iter():
        if local(segment.tag)!="TaleSegment":
            continue
        chars=[(x.text or "").strip() for x in segment.iter() if local(x.tag)=="Char" and x.text]
        full=" ".join(chars)
        if SEARCH not in full.casefold():
            continue
        fields={}
        for element in segment.iter():
            tag=local(element.tag)
            if tag in ("StartDateTime","EndDateTime","OratorFirstName","OratorLastName",
                       "GroupNameShort","OratorRole","TalerTitel","EdixiStatus","TaleType"):
                value=(element.text or "").strip()
                if value and tag not in fields:fields[tag]=value[:160]
        p=full.casefold().find(SEARCH)
        matched_segments.append({"fields":fields,"quote_context":full[max(0,p-145):p+260],
                                 "char_elements":len(chars)})
    return {"source":source,"bytes":len(data),"well_formed_xml":True,"root_tag":local(root.tag),
            "elements":sum(tags.values()),"common_tags":tags.most_common(24),
            "speech_related_tags":dict(list(matching_tags.items())[:24]),
            "time_examples":times[:8],"sample_element_values":values[:14],
            "keyword_hits":hits[:4],"keyword_count":len(hits),"matched_speech_segments":matched_segments[:3]}

def try_http():
    urls=[
        "https://oda.ft.dk/api/M%C3%B8de?$top=1&$format=json",
        "https://oda.ft.dk/ODAXML/Referat/20241/"
    ]
    for url in urls:
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"TALEDATABASE-2000-XML-Probe/1.0","Accept":"application/json,application/xml,text/xml,*/*"})
            with urllib.request.urlopen(req,timeout=10) as res:
                body=res.read(120000)
                result["http"].append({"url":url,"status":res.status,"final_url":res.url,"content_type":res.headers.get("Content-Type"),
                                       "bytes_read":len(body),"sample":body[:140].decode("utf-8","replace")})
        except Exception as e:
            result["http"].append({"url":url,"error":str(e)[:280]})

def try_ftp():
    ftp=ftplib.FTP(timeout=13)
    result["ftp"]={"host":HOST,"login":"anonymous","directories_checked":[]}
    try:
        ftp.connect(HOST,21)
        result["ftp"]["welcome"]=ftp.getwelcome()[:160]
        ftp.login("anonymous","taledatabase-test@example.invalid")
        result["ftp"]["logged_in"]=True
        ftp.set_pasv(True)
        for path in ["/ODAXML/Referat/samling/20241","/ODAXML/Referat/samling","/ODAXML/Referat/20241","/ODAXML/Referat"]:
            row={"path":path}
            result["ftp"]["directories_checked"].append(row)
            try:
                ftp.cwd(path)
                names=ftp.nlst()
                row.update({"ok":True,"entries":len(names),"first_names":names[:12]})
                choices=[x for x in names if x.lower().endswith(".xml")]
                # Prefer 10 Oct 2024 / sitting 6; otherwise any real XML is useful.
                choices.sort(key=lambda x:(0 if re.search(r"(?:^|[_/-])m0*6(?:[_./-]|$)|2024[-_]?10[-_]?10",x,re.I) else 1,x))
                if choices:
                    for name in choices[:5]:
                        try:
                            downloaded=[]
                            ftp.retrbinary("RETR "+str(PurePosixPath(name).name),collect(downloaded),blocksize=65536)
                            doc=b"".join(downloaded)
                            result["xml"]=analyze(path+"/"+name,doc)
                            result["verdict"]="XML_RETRIEVED_AND_PARSED"
                            return
                        except Exception as e:
                            row.setdefault("download_errors",[]).append({"file":name,"error":str(e)[:160]})
                else:
                    row["note"]="Directory accessible but did not show XML files"
            except Exception as e:
                row["error"]=str(e)[:220]
        result["verdict"]="FTP_CONNECTED_NO_XML_RETRIEVED"
    except Exception as e:
        result["ftp"]["error"]=type(e).__name__+": "+str(e)[:280]
        result["verdict"]="FTP_CONNECTION_FAILED"
    finally:
        try:ftp.quit()
        except Exception:pass

try:
    result["dns"]={"host":HOST,"resolved_addresses":sorted(set(x[4][0] for x in socket.getaddrinfo(HOST,None)))[:4]}
except Exception as e:
    result["dns"]={"error":str(e)[:240]}

try_ftp()
try_http()
with open("ft-xml-probe.json","w",encoding="utf-8") as fh:
    json.dump(result,fh,ensure_ascii=False,indent=2)
with open("ft-xml-probe.md","w",encoding="utf-8") as fh:
    fh.write("# TALEDATABASE 2000 · XML-referattest\n\n")
    fh.write("**Verificering:** "+result["verdict"]+"\n\n")
    fh.write("**FTP:** "+json.dumps(result["ftp"],ensure_ascii=False,indent=2)+"\n\n")
    fh.write("**XML:** "+json.dumps(result["xml"],ensure_ascii=False,indent=2)+"\n\n")
    fh.write("**HTTP:** "+json.dumps(result["http"],ensure_ascii=False,indent=2)+"\n")
print(json.dumps(result,ensure_ascii=False,indent=2))
