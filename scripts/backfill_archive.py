#!/usr/bin/env python3
"""Source-backed PDF archive backfill. Never invent a meeting or a speech."""
import argparse
import datetime as dt
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "public" / "archive"
MANIFEST = ARCHIVE / "manifest.json"
STATE = ROOT / "scripts" / "backfill-state.json"
MAX_ARCHIVE_BYTES = 750 * 1024 * 1024
MAX_PDF_BYTES = 25 * 1024 * 1024
MONTHS = "januar februar marts april maj juni juli august september oktober november december".split()
BAD_SPEAKER = re.compile(r"^(?:Spm\.?\s*nr\.?|\d+\)|Til\s+(?:udenrigs|justits|stats|udlændinge|social|miljø|indenrigs|finans))", re.I)
CLOCK = re.compile(r"^Kl\.\s*(\d{1,2}:\d{2})\s*$", re.M)


def iso_date(header):
    m = re.search(r"(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})", header)
    if m:
        try:
            return dt.date(*map(int, m.groups())).isoformat()
        except ValueError:
            return None
    m = re.search(r"(\d{1,2})\.?\s+(" + "|".join(MONTHS) + r")\s+(20\d{2})", header, re.I)
    if m:
        try:
            return dt.date(int(m[3]), MONTHS.index(m[2].lower()) + 1, int(m[1])).isoformat()
        except ValueError:
            return None
    return None


def ordered_lines(page):
    """Match the browser PDF parser's two-column reading order."""
    width = page.rect.width
    columns = ([], [])
    for block in page.get_text("dict")["blocks"]:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                s = span["text"]
                if s.strip():
                    x0, y0, x1, y1 = span["bbox"]
                    columns[0 if x0 < width * .5 else 1].append((x0, y1, x1, s))
    result = []
    for column in columns:
        lines = []
        for part in sorted(column, key=lambda x: (x[1], x[0])):
            line = next((line for line in lines if abs(line["y"] - part[1]) < 2.7), None)
            if line is None:
                line = {"y": part[1], "bits": []}
                lines.append(line)
            line["bits"].append(part)
        for line in sorted(lines, key=lambda x: x["y"]):
            value = ""
            right = None
            for x0, _, x1, s in sorted(line["bits"], key=lambda x: x[0]):
                if right is not None and x0 - right > 1.4 and not value.endswith(" ") and not s.startswith(" "):
                    value += " "
                value += s
                right = x1
            if value.strip():
                result.append(value.strip())
    return result


def speeches_on_page(lines, page_number):
    text = "\n".join(lines)
    markers = list(CLOCK.finditer(text))
    result = []
    for index, marker in enumerate(markers):
        end = markers[index + 1].start() if index + 1 < len(markers) else len(text)
        parts = [re.sub(r"\s+", " ", p).strip() for p in text[marker.end():end].split("\n")]
        parts = [p for p in parts if p]
        stop = next((i for i, p in enumerate(parts[:4]) if p.endswith(":")), -1)
        if stop == -1:
            continue
        speaker = " ".join(parts[:stop + 1]).removesuffix(":").strip()
        content = re.sub(r"\s+-\s+", "-", " ".join(parts[stop + 1:]))
        content = re.sub(r"\s+", " ", content).strip()
        hh, mm = map(int, marker[1].split(":"))
        if not speaker or len(speaker) > 160 or BAD_SPEAKER.search(speaker) or hh > 23 or mm > 59:
            continue
        if not 6 <= len(content) <= 12000:
            continue
        result.append({"clock": marker[1], "speaker": speaker, "content": content, "page": page_number})
    return result


def read_pdf(data, samling):
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        speeches, header = [], ""
        for i, page in enumerate(doc):
            lines = ordered_lines(page)
            if i < 2:
                header += "\n" + "\n".join(lines[:35])
            speeches.extend(speeches_on_page(lines, i + 1))
    finally:
        doc.close()
    date = iso_date(header)
    if not date or not speeches:
        raise ValueError("PDF mangler kontrollerbar dato eller klokkeslættede taleafsnit")
    if int(date[:4]) not in (int(samling[:4]), int(samling[:4]) + 1):
        raise ValueError(f"PDF-dato {date} passer ikke til samling {samling}")
    return date, speeches


def fetch_pdf(samling, number):
    url = f"https://www.folketingstidende.dk/samling/{samling}/salen/M{number}/{samling}_M{number}_referat.pdf"
    request = urllib.request.Request(url, headers={
        "User-Agent": "TALEDATABASE-2000-archive-indexer/1.0", "Accept": "application/pdf"
    })
    with urllib.request.urlopen(request, timeout=35) as response:
        data = response.read(MAX_PDF_BYTES + 1)
    if len(data) > MAX_PDF_BYTES or not data.startswith(b"%PDF"):
        raise ValueError("Kilden returnerede ikke en PDF under 25 MiB")
    return url, data


def candidates(existing):
    current = "20261"
    newest = max((int(x["meeting_no"]) for x in existing if x["samling"] == current), default=0)
    yield current, newest + 1
    # Fill actual holes in existing collections before working backwards.
    for season in ("20252", "20251", "20241"):
        seen = [int(x["meeting_no"]) for x in existing if x["samling"] == season]
        for n in range(1, max(seen, default=0) + 1):
            yield season, n
    for year in range(2023, 2012, -1):
        seasons = (f"{year}2", f"{year}1") if year in (2022, 2019, 2015) else (f"{year}1",)
        for season in seasons:
            for n in range(1, 131):
                yield season, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-new", type=int, default=12)
    ap.add_argument("--max-attempts", type=int, default=36)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not 1 <= args.max_new <= 30 or not 1 <= args.max_attempts <= 100:
        ap.error("Outside permitted bounded batch")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {"retry_after": {}, "errors": {}}
    existing = {x["id"] for x in manifest}
    now = dt.datetime.now(dt.timezone.utc)
    attempts = successes = 0
    total_bytes = sum(p.stat().st_size for p in ARCHIVE.glob("*.json"))
    if total_bytes >= MAX_ARCHIVE_BYTES:
        print("Archive-size safety ceiling reached; review the storage architecture.")
        return
    for samling, n in candidates(manifest):
        key = f"{samling}_M{n}"
        if key in existing:
            continue
        retry = state["retry_after"].get(key)
        if retry and retry > now.isoformat():
            continue
        if attempts >= args.max_attempts or successes >= args.max_new:
            break
        attempts += 1
        print(f"Checking {key}...", flush=True)
        if args.dry_run:
            continue
        try:
            url, pdf = fetch_pdf(samling, n)
            date, speeches = read_pdf(pdf, samling)
            item = {"id": key, "samling": samling, "meeting_no": n, "date": date,
                    "source_url": url, "speeches": speeches}
            payload = json.dumps(item, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            if len(payload) > 20 * 1024 * 1024 or total_bytes + len(payload) > MAX_ARCHIVE_BYTES:
                raise ValueError("JSON over grænsen for Cloudflare Static Assets")
            (ARCHIVE / (key + ".json")).write_bytes(payload)
            manifest.append({"id": key, "samling": samling, "meeting_no": n,
                             "date": date, "source_url": url, "speeches": len(speeches), "status": "ready"})
            existing.add(key)
            total_bytes += len(payload)
            successes += 1
            state["retry_after"].pop(key, None)
            state["errors"].pop(key, None)
            print(f"  OK: {date}, {len(speeches)} taler")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError, fitz.FileDataError) as exc:
            days = 1 if samling == "20261" else 30
            state["retry_after"][key] = (now + dt.timedelta(days=days)).isoformat()
            state["errors"][key] = str(exc)[:180]
            print(f"  SKIP ({days}d): {type(exc).__name__}: {exc}")
        time.sleep(.3)  # Respect the official source's bandwidth.
    if not args.dry_run:
        manifest.sort(key=lambda x: (x["date"], x["id"]), reverse=True)
        MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Complete: {successes} new source-backed meetings, {attempts} requests; {len(manifest)} total meetings")


if __name__ == "__main__":
    main()
