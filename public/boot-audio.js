// A user-supplied boot recording, not synthesized effects.
// Preload when the page starts; start playback synchronously on the power click.
// No file is configured until a recording is supplied.
const SILENT=Object.freeze({play(){},stop(){}});
export function preloadBootAudio(src,createAudio=()=>new Audio()){
  if(!src)return SILENT;
  try{
    const audio=createAudio();
    audio.preload="auto";
    audio.src=src;
    audio.load(); // Starts buffering before the person reaches the power switch.
    return {
      play(){
        try{
          audio.pause();
          audio.currentTime=0;
          // Must run directly in the user click handler for autoplay permission.
          const result=audio.play();
          result?.catch?.(()=>{}); // Unsupported formats / interruptions remain silent.
        }catch{}
      },
      stop(){
        try{audio.pause();audio.currentTime=0}catch{}
      }
    };
  }catch{
    return SILENT; // Audio is optional; the terminal must still boot.
  }
}
