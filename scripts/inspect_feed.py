#!/usr/bin/env python3
"""Read a small, bounded diagnostic sample from the official Parliament RSS."""
import urllib.request
import xml.etree.ElementTree as ET
import re
import collections

for feed in ["Salen", "Alle"]:
    url="https://mobiltv.ft.dk/feed/"+feed
    try:
        request=urllib.request.Request(url,headers={"User-Agent":"PoliticalSampleFinder/0.3 (+RSS integration test)","Accept":"application/rss+xml,application/xml,*/*"})
        with urllib.request.urlopen(request,timeout=20) as res:
            blob=res.read(7_000_000)
            print("FEED",feed,"HTTP",res.status,"TYPE",res.headers.get("Content-Type"),"BYTES",len(blob))
        try:root=ET.fromstring(blob)
        except Exception as e:
            print("PARSE ERROR",e,"FIRST BYTES",blob[:400]);continue
        items=root.findall(".//item")
        print("ITEM COUNT",len(items),"ROOT",root.tag)
        print("TOP ITEM TAGS",collections.Counter(str(ch.tag) for i in items[:10] for ch in i))
        for item in items[:12]:
            val=lambda key: (item.findtext(key) or "").strip()
            enc=item.find("enclosure")
            print("ITEM",{"title":val("title")[:200],"description":re.sub("<[^>]+>","",val("description"))[:250],
                "link":val("link")[:250],"guid":val("guid")[:180],"pubDate":val("pubDate")[:100],
                "enclosure":enc.attrib if enc is not None else None})

        matches=[i for i in items if "21. januar 2026" in (i.findtext("title") or "") or "21-01-2026" in ((i.find("enclosure").get("url","") if i.find("enclosure") is not None else ""))]
        print("JAN_21_2026_MATCHES",len(matches))
        for i in matches:
            enc=i.find("enclosure")
            print("JAN21_ITEM",{"title":i.findtext("title"),"pubDate":i.findtext("pubDate"),"enclosure":enc.attrib if enc is not None else None,"description":(i.findtext("description") or "")[:90]})
        if feed=="Salen" and matches:
            import ssl
            entry=matches[0].find("enclosure").get("url")
            for u in [entry,entry.replace("http://","https://",1)]:
                try:
                    req=urllib.request.Request(u,method="HEAD",headers={"User-Agent":"Mozilla/5.0"})
                    with urllib.request.urlopen(req,timeout=15) as res: print("MP3_HEAD",res.status,res.headers.get("Content-Type"),"URL",res.url,"LENGTH",res.headers.get("Content-Length"))
                except Exception as e:print("MP3_HEAD_ERROR",u,str(e)[:300])
        if items:
            print("OLDEST", {"title":(items[-1].findtext('title') or '')[:200],"pubDate":items[-1].findtext('pubDate')})
    except Exception as e: print("FAIL",feed,type(e).__name__,str(e)[:300])
