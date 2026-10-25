// Same-origin byte-range relay for official Folketinget MP3 files.
// Strict allowlist: never permit arbitrary upstream URLs (SSRF/open proxy).
const OFFICIAL=/^\/p\/2158211\/sp\/0\/playManifest\/entryId\/1_[a-z0-9]+\/protocol\/http\/flavorParamIds\/0\/format\/url\/\d{2}-\d{2}-\d{4}_\d{2}-\d{2}_salen\.mp3$/i;

export function officialAudioSource(value){
  if(typeof value!=="string"||value.length>400)return null;
  try{
    const src=new URL(value);
    if(src.protocol!=="https:"||src.hostname!=="cdnapi.kaltura.com"||
       src.port||src.username||src.password||src.search||src.hash||!OFFICIAL.test(src.pathname))return null;
    return src.toString();
  }catch{return null}
}

export async function relayOfficialAudio(request,url,fetchAudio=fetch){
  if(!["GET","HEAD"].includes(request.method))
    return new Response("Metoden understøttes ikke.",{status:405,headers:{"allow":"GET, HEAD"}});
  const src=officialAudioSource(url.searchParams.get("source"));
  if(!src)return new Response("Kun Folketingets godkendte lydkilder understøttes.",{status:400});
  const range=request.headers.get("range");
  if(range&&!/^bytes=\d*-\d*$/.test(range))
    return new Response("Ugyldigt byte-interval.",{status:416});
  const upstreamHeaders=new Headers({"accept":"audio/mpeg","accept-encoding":"identity"});
  if(range)upstreamHeaders.set("range",range);
  const upstream=await fetchAudio(src,{method:request.method,headers:upstreamHeaders,redirect:"follow"});
  if(!upstream.ok && upstream.status!==206)
    return new Response("Folketingets lydserver svarede "+upstream.status+".",{status:502});
  const output=new Headers({
    "content-type":"audio/mpeg",
    "cache-control":"private, no-store",
    "x-content-type-options":"nosniff"
  });
  for(const key of ["content-length","content-range","accept-ranges","etag","last-modified"]){
    const val=upstream.headers.get(key);
    if(val)output.set(key,val);
  }
  return new Response(request.method==="HEAD"?null:upstream.body,{status:upstream.status,headers:output});
}
