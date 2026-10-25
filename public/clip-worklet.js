// Bounded, batched PCM capture of a streamed media element.
// 2048-frame batches avoid flooding the main thread with tiny 128-frame messages.
class TaledatabaseRecorder extends AudioWorkletProcessor {
  constructor(){
    super();
    this.remaining=0;
    this.recording=false;
    this.paused=false;
    this.left=new Float32Array(2048);
    this.right=new Float32Array(2048);
    this.filled=0;
    this.port.onmessage=e=>{
      if(e.data?.type==="start"){
        this.remaining=Math.max(1,Math.round(e.data.frames));
        this.recording=true;
        this.paused=false;
        this.filled=0;
      }
      if(e.data?.type==="pause")this.paused=true;
      if(e.data?.type==="resume")this.paused=false;
      if(e.data?.type==="cancel")this.recording=false;
    };
  }
  flush(){
    if(!this.filled)return;
    const left=this.left.slice(0,this.filled);
    const right=this.right.slice(0,this.filled);
    this.port.postMessage({type:"frames",left:left.buffer,right:right.buffer},[left.buffer,right.buffer]);
    this.filled=0;
  }
  process(inputs,outputs){
    const input=inputs[0]||[];
    const output=outputs[0]||[];
    for(let ch=0;ch<output.length;ch++){
      if(input[ch]||input[0])output[ch].set(input[ch]||input[0]);
    }
    if(!this.recording||this.paused||!input.length||!input[0].length)return true;
    let offset=0;
    while(offset<input[0].length && this.remaining>0){
      const n=Math.min(input[0].length-offset,this.remaining,this.left.length-this.filled);
      this.left.set(input[0].subarray(offset,offset+n),this.filled);
      this.right.set((input[1]||input[0]).subarray(offset,offset+n),this.filled);
      offset+=n;
      this.filled+=n;
      this.remaining-=n;
      if(this.filled===this.left.length)this.flush();
    }
    if(this.remaining===0){
      this.flush();
      this.recording=false;
      this.port.postMessage({type:"complete"});
    }
    return true;
  }
}
registerProcessor("taledatabase-recorder",TaledatabaseRecorder);
