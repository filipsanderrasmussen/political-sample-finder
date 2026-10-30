// Approximate where a search word occurs in the original recording.
// Official transcripts timestamp speech beginnings, not individual words.
// Return null for incomplete or implausible timing so playback starts safely
// at the known speech beginning instead.
const WORD=/[\p{L}\p{M}\p{N}_]+/gu;

function clockInSeconds(value){
 const m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value||""));
 if(!m)return null;
 const h=Number(m[1]),min=Number(m[2]),sec=Number(m[3]||0);
 return h<24&&min<60&&sec<60?h*3600+min*60+sec:null;
}

function tokens(value){
 return String(value||"").toLocaleLowerCase("da-DK").match(WORD)||[];
}

export function estimatedWordSeek(content,query,speechStart,nextSpeechStart){
 const start=clockInSeconds(speechStart),end=clockInSeconds(nextSpeechStart);
 if(start===null||end===null)return null;
 const duration=end-start;
 // Very short intervals are coarse; very long ones may conceal recesses.
 if(duration<8||duration>900)return null;
 const words=tokens(content),terms=tokens(query).slice(0,10);
 if(words.length<12||!terms.length)return null;
 const wordsPerMinute=words.length*60/duration;
 if(wordsPerMinute<60||wordsPerMinute>300)return null;

 // Prefer the full phrase when consecutive words match; otherwise the
 // first highlighted keyword, consistent with the search-result excerpt.
 let index=-1;
 if(terms.length>1){
  index=words.findIndex((word,i)=>word===terms[0]&&
    terms.every((term,j)=>words[i+j]===term));
 }
 if(index<0){
  const termSet=new Set(terms);
  index=words.findIndex(word=>termSet.has(word));
 }
 if(index<0)return null;

 // Begin six seconds before the expected word to allow for speech pauses,
 // editorial discrepancies and approximate original MP3 offsets.
 const wordSeconds=index/words.length*duration;
 const seconds=Math.round(wordSeconds-6);
 if(seconds<3)return null; // Jumping just 1–2 seconds adds no value.
 return {seconds,wordIndex:index,wordCount:words.length,duration};
}

// Experimental, user-visible opt-in for source-backed second-resolution XML.
// PDF transcripts (minute-only timestamps) are too coarse for this hop.
// A likely word position is not a validated MP3/audio synchronization.
export function experimentalWordSeek(row,query){
 const exact=/^\d{2}:\d{2}:\d{2}$/;
 if(!exact.test(String(row?.clock||""))||!exact.test(String(row?.next_clock||"")))
  return null;
 if(!Number.isFinite(Number(row?.pause_seconds))||Number(row.pause_seconds)<0)
  return null;
 return estimatedWordSeek(row.content,query,row.clock,row.next_clock);
}
