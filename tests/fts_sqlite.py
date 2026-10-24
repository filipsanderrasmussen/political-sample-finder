#!/usr/bin/env python3
"""Integration-test the exact SQL schema shipped in src/search-index.js.
Uses SQLite's bundled FTS5 locally; does not touch Cloudflare quotas.
"""
import json
import sqlite3
import subprocess

raw=subprocess.check_output([
    "node","--input-type=module","-e",
    'import {VIRTUAL_SQL,TRIGGERS} from "./src/search-index.js";'
    'process.stdout.write(JSON.stringify({virtual:VIRTUAL_SQL,triggers:TRIGGERS}));'
],text=True)
ddl=json.loads(raw)
db=sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE speeches (
 id TEXT PRIMARY KEY, meeting_id TEXT, idx INTEGER, speaker TEXT,
 clock TEXT, content TEXT, page INTEGER
);
INSERT INTO speeches VALUES('s1','m',0,'Mette Thiesen','13:00','En ulv er ikke en problemulv.',1);
INSERT INTO speeches VALUES('s2','m',1,'En minister','13:02','Det er bare pulver.',1);
INSERT INTO speeches VALUES('s3','m',2,'Mette Thiesen','13:05','Problemulven er her.',1);
""")
db.execute(ddl["virtual"])
for trigger in ddl["triggers"]:
    db.execute(trigger)
db.execute("INSERT INTO speech_fts(speech_fts) VALUES('rebuild')")
def hits(query):
    return [r[0] for r in db.execute(
        "WITH hits AS MATERIALIZED (SELECT rowid FROM speech_fts WHERE speech_fts MATCH ? LIMIT 1000) "
        "SELECT s.id FROM hits JOIN speeches s ON s.rowid=hits.rowid ORDER BY s.idx",
        (query,)
    )]
assert hits('content:"ulv"')==["s1"],hits('content:"ulv"')
assert hits('content:"problemulv"')==["s1"],hits('content:"problemulv"')
assert hits('speaker:"mette"*')==["s1","s3"],hits('speaker:"mette"*')
assert hits('content:"pulver"')==["s2"]
db.execute("INSERT INTO speeches VALUES('s4','m',3,'Mette Thiesen','13:06','Ulven er væk.',1)")
assert hits('content:"ulven"')==["s4"]
db.execute("UPDATE speeches SET content='Ren isvinter.' WHERE id='s4'")
assert hits('content:"ulven"')==[]
db.execute("DELETE FROM speeches WHERE id='s1'")
assert hits('content:"ulv"')==[]
assert hits('content:"problemulv"')==[]
print("OK: actual FTS5 SQL, whole-word matching, incremental insert/update/delete.")
