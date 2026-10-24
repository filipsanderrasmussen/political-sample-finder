#!/usr/bin/env python3
"""Build a lightweight, source-backed audio index from Folketingets official RSS.

This runs on GitHub Actions (no Python on the user's Mac), commits only links and
metadata, and is automatically deployed to Cloudflare on repository updates.
"""
import datetime
import email.utils
import json
import pathlib
import re
import urllib.request
import xml.etree.ElementTree as ET

SOURCE = "https://mobiltv.ft.dk/feed/Salen"
TARGET = pathlib.Path(__file__).resolve().parents[1] / "src" / "audio-index.json"

req = urllib.request.Request(
    SOURCE,
    headers={"Accept": "application/rss+xml, application/xml", "User-Agent": "PoliticalSampleFinder/0.4 (+source-only podcast index)"},
)
with urllib.request.urlopen(req, timeout=25) as response:
    xml = response.read(8_000_000)
    if response.status != 200:
        raise RuntimeError(f"RSS HTTP {response.status}")
root = ET.fromstring(xml)
result = []
for item in root.findall(".//item"):
    title = (item.findtext("title") or "").strip()
    description = (item.findtext("description") or "").strip()
    publication = (item.findtext("pubDate") or "").strip()
    enclosure = item.find("enclosure")
    if enclosure is None:
        continue
    url = enclosure.attrib.get("url", "")
    if url.startswith("http://cdnapi.kaltura.com/"):
        url = "https://" + url[len("http://"):]
    if not (url.startswith("https://cdnapi.kaltura.com/") or url.startswith("https://mobiltv.ft.dk/")):
        continue
    meeting = re.search(r"Møde\s+nr\.?\s*(\d{1,3})\s+i\s+salen", description, re.I)
    if not meeting:
        continue
    try:
        date = email.utils.parsedate_to_datetime(publication).date().isoformat()
    except (ValueError, TypeError):
        continue
    # Derive from source metadata; never fabricate dates or links.
    if not 2020 <= int(date[:4]) <= 2035:
        continue
    result.append({
        "date": date,
        "meeting_no": int(meeting.group(1)),
        "title": title,
        "mp3_url": url,
        "feed": "Salen",
    })
# Retain every previously discovered official link when the RSS feed rolls forward.
# Only metadata captured from the official podcast feed belongs in this archive.
if TARGET.exists():
    previous = json.loads(TARGET.read_text(encoding="utf-8"))
    if not isinstance(previous, list):
        raise RuntimeError("Existing RSS archive has an unexpected format")
    existing_urls = {item["mp3_url"] for item in result}
    for old in previous:
        if (
            isinstance(old, dict)
            and isinstance(old.get("mp3_url"), str)
            and old["mp3_url"].startswith(("https://cdnapi.kaltura.com/", "https://mobiltv.ft.dk/"))
            and isinstance(old.get("date"), str)
            and isinstance(old.get("meeting_no"), int)
            and old["mp3_url"] not in existing_urls
        ):
            result.append(old)
            existing_urls.add(old["mp3_url"])
result.sort(key=lambda r: (r["date"], r["meeting_no"], r["title"], r["mp3_url"]), reverse=True)
if len(result) < 20:
    raise RuntimeError(f"Unreasonably short official feed: {len(result)} records; refusing to overwrite existing index")
TARGET.parent.mkdir(parents=True, exist_ok=True)
TARGET.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
match = [r for r in result if r["date"] == "2026-01-21" and r["meeting_no"] == 41]
print(f"Indexed {len(result)} official RSS items; 21 Jan 2026 meeting 41 matches: {len(match)}")
if not match:
    print("Warning: the oldest/current rolling feed may have dropped the reference meeting.")
