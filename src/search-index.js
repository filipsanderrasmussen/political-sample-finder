// Persistent FTS5 inverted index for source-backed speeches.
// One-time rebuild runs from Cron only, never from a user's search request.
const VIRTUAL_SQL="CREATE VIRTUAL TABLE IF NOT EXISTS speech_fts USING fts5("+
 "content,speaker,content='speeches',content_rowid='rowid',"+
 "tokenize='unicode61 remove_diacritics 2')";
const TRIGGERS=[
 "CREATE TRIGGER IF NOT EXISTS speech_fts_ai AFTER INSERT ON speeches BEGIN "+
 "INSERT INTO speech_fts(rowid,content,speaker) VALUES(new.rowid,new.content,new.speaker); END",
 "CREATE TRIGGER IF NOT EXISTS speech_fts_ad AFTER DELETE ON speeches BEGIN "+
 "INSERT INTO speech_fts(speech_fts,rowid,content,speaker) VALUES('delete',old.rowid,old.content,old.speaker); END",
 "CREATE TRIGGER IF NOT EXISTS speech_fts_au AFTER UPDATE ON speeches BEGIN "+
 "INSERT INTO speech_fts(speech_fts,rowid,content,speaker) VALUES('delete',old.rowid,old.content,old.speaker); "+
 "INSERT INTO speech_fts(rowid,content,speaker) VALUES(new.rowid,new.content,new.speaker); END"
];
export async function ensureSearchIndex(env){
 const ready=await env.DB.prepare("SELECT value FROM app_meta WHERE key='fts_ready'").first();
 if(ready?.value==="1")return {ready:true};
 const retry=await env.DB.prepare("SELECT value FROM app_meta WHERE key='fts_retry_at'").first();
 if(Number(retry?.value||0)>Date.now())return {ready:false,retryAt:retry.value};
 // A failed full rebuild must not retry on every scheduled invocation.
 await env.DB.prepare("INSERT INTO app_meta(key,value) VALUES('fts_retry_at',?) "+
   "ON CONFLICT(key) DO UPDATE SET value=excluded.value")
   .bind(String(Date.now()+2*60*60*1000)).run();
 await env.DB.prepare(VIRTUAL_SQL).run();
 for(const trigger of TRIGGERS)await env.DB.prepare(trigger).run();
 // One full scan only, after which the triggers update the index incrementally.
 await env.DB.prepare("INSERT INTO speech_fts(speech_fts) VALUES('rebuild')").run();
 await env.DB.prepare("INSERT INTO app_meta(key,value) VALUES('fts_ready','1') "+
   "ON CONFLICT(key) DO UPDATE SET value='1'").run();
 return {ready:true,built:true};
}
