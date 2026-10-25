// Capture only the requested PCM frames. The media element is streamed separately.
class TaledatabaseRecorder extends AudioWorkletProcessor {
  constructor(){
    super();
    this.remaining=0;
    this.recording=false;
    this.paused=false;
    this.port.onmessage=e=>{
      if(e.data?.type==="start"){
        this.remaining=Math.max(1,Math.round(e.data.frames));
        this.recording=true;
        this.paused=false;
      }
      if(e.data?.type==="pause")this.paused=true;
      if(e.data?.type==="resume")this.paused=false;
      if(e.data?.type==="cancel")this.recording=false;
    };
  }
  process(inputs,outputs){
    const input=inputs[0]||[];
    const output=outputs[0]||[];
    for(let ch=0;ch<output.length;ch++){
      if(input[ch]||input[0])output[ch].set(input[ch]||input[0]);
    }
    if(!this.recording||this.paused||!input.length||!input[0].length)return true;
    const frames=Math.min(this.remaining,input[0].length);
    const left=new Float32Array(frames);
    const right=new Float32Array(frames);
    left.set(input[0].subarray(0,frames));
    right.set((input[1]||input[0]).subarray(0,frames));
    this.port.postMessage({type:"frames",left:left.buffer,right:right.buffer},[left.buffer,right.buffer]);
    this.remaining-=frames;
    if(this.remaining<=0){
      this.recording=false;
      this.port.postMessage({type:"complete"});
    }
    return true;
  }
}
registerProcessor("taledatabase-recorder",TaledatabaseRecorder);
