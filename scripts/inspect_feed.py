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
        if items:
            print("OLDEST", {"title":(items[-1].findtext('title') or '')[:200],"pubDate":items[-1].findtext('pubDate')})
    except Exception as e: print("FAIL",feed,type(e).__name__,str(e)[:300])
