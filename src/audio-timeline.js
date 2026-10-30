// Calculate cumulative meeting recesses from original indexed transcript rows.
// Only pair explicit "Mødet er udsat" -> "Mødet er genoptaget" markers.
// This is a wall-clock correction, NOT proof of sample-accurate MP3 alignment.

export function clockSeconds(value){
  const m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value||""));
  if(!m)return null;
  const h=+m[1],minute=+m[2],second=+(m[3]||0);
  return h<24&&minute<60&&second<60?h*3600+minute*60+second:null;
}

export function findRecesses(speeches){
  const events=[],byId=new Map();
  for(const speech of speeches||[]){
    const id=String(speech.meeting_id||"");
    if(!/^\d{5}_M\d{1,3}$/.test(id))continue;
    if(!byId.has(id))byId.set(id,[]);
    byId.get(id).push(speech);
  }
  for(const [meeting_id,rows] of byId){
    rows.sort((a,b)=>Number(a.idx)-Number(b.idx));
    let start=null;
    for(const row of rows){
      const content=String(row.content||"");
      const clock=clockSeconds(row.clock);
      if(clock===null)continue;
      if(/mødet er udsat\b/i.test(content)){
        let at=clock;
        // PDF transcripts often timestamp only the minute BEFORE the actual
        // adjournment. Prefer the explicit "(Kl. 11:47)" in that case.
        if(/^\d{1,2}:\d{2}$/.test(row.clock)){
          const precise=/mødet er udsat\.?\s*\(kl\.\s*(\d{1,2})[:.](\d{2})\)/i.exec(content);
          const explicit=precise&&clockSeconds(precise[1]+":"+precise[2]);
          if(explicit!==null&&explicit>=clock&&explicit-clock<=120)at=explicit;
        }
        start={at,idx:Number(row.idx)};
      }else if(/mødet er genoptaget\b/i.test(content)&&start){
        const duration=clock-start.at;
        if(Number(row.idx)>start.idx&&duration>=5*60&&duration<=4*3600){
          events.push({meeting_id,from:start.at,to:clock,seconds:duration});
        }
        start=null; // No correction for unpaired / implausible events.
      }
    }
  }
  return events;
}

export function recessCorrection(events,meetingId,speechClock){
  const t=clockSeconds(speechClock);
  if(t===null)return {seconds:0,count:0};
  const matching=(events||[]).filter(e=>e.meeting_id===meetingId&&e.to<=t);
  return {seconds:matching.reduce((n,e)=>n+e.seconds,0),count:matching.length};
}

export async function meetingRecesses(env,found){
  const meetings=[...new Set((found||[]).map(row=>row.meeting_id).filter(id=>/^\d{5}_M\d{1,3}$/.test(id)))].slice(0,25);
  if(!meetings.length)return [];
  // One small bounded query for all meetings on the current result page.
  // Match *both* ends explicitly; never assume any large clock gap is a recess.
  const sql="SELECT meeting_id,idx,clock,speaker,content FROM speeches "+
    "WHERE meeting_id IN ("+meetings.map(()=>"?").join(",")+") AND ("+
    "content LIKE '%mødet er udsat%' OR content LIKE '%mødet er genoptaget%') "+
    "ORDER BY meeting_id,idx LIMIT 250";
  const rows=(await env.DB.prepare(sql).bind(...meetings).all()).results||[];
  return findRecesses(rows);
}
