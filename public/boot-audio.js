// Procedural sound design for the TD-2000 power sequence. No external files.
// Deliberately more mechanical than musical: relay, CRT degauss, fan, floppy, POST.
// Audio starts only from a user click, so normal browser autoplay policy applies.
export const BOOT_DURATION_MS=6600;

export const BOOT_SOUND_CUES=Object.freeze([
  {name:"relay",at:0},
  {name:"crt_degauss",at:180},
  {name:"fan_spinup",at:950},
  {name:"floppy_seek",at:2030},
  {name:"post_beep",at:5420}
]);

export function playPowerSound(){
  const AudioEngine=window.AudioContext||window.webkitAudioContext;
  if(!AudioEngine)return ()=>{};
  let ctx,cleanupTimer;
  try{
    ctx=new AudioEngine();
    const t=ctx.currentTime+.02;
    const at=ms=>t+ms/1000;
    // Bus and compressor provide a finite master level even during overlapping
    // low-frequency degauss and noisy disk-seek transients.
    const bus=ctx.createGain();
    bus.gain.value=.68;
    const limiter=ctx.createDynamicsCompressor();
    limiter.threshold.value=-14;
    limiter.knee.value=14;
    limiter.ratio.value=7;
    limiter.attack.value=.006;
    limiter.release.value=.17;
    bus.connect(limiter).connect(ctx.destination);

    // Reusable looping broadband noise; each hit gets its own filter/envelope.
    const noiseBuffer=ctx.createBuffer(1,Math.max(1,Math.floor(ctx.sampleRate*.31)),ctx.sampleRate);
    const noiseData=noiseBuffer.getChannelData(0);
    for(let i=0;i<noiseData.length;i++)noiseData[i]=Math.random()*2-1;

    const envelope=(gain,start,duration,volume,attack=.006)=>{
      gain.setValueAtTime(.0001,start);
      gain.linearRampToValueAtTime(volume,start+Math.min(attack,duration*.3));
      gain.exponentialRampToValueAtTime(.0001,start+duration);
    };
    const tone=(ms,duration,frequency,endFrequency,volume,type="sine",cutoff=0,attack=.01)=>{
      const start=at(ms),end=start+duration;
      const osc=ctx.createOscillator();
      osc.type=type;
      osc.frequency.setValueAtTime(frequency,start);
      if(endFrequency!==frequency)osc.frequency.exponentialRampToValueAtTime(endFrequency,end);
      const amp=ctx.createGain();
      envelope(amp.gain,start,duration,volume,attack);
      if(cutoff){
        const filter=ctx.createBiquadFilter();
        filter.type="lowpass";
        filter.frequency.value=cutoff;
        osc.connect(filter).connect(amp);
      }else osc.connect(amp);
      amp.connect(bus);
      osc.start(start);
      osc.stop(end+.01);
    };
    const noise=(ms,duration,volume,cutoff,filterType="bandpass",attack=.004)=>{
      const start=at(ms),end=start+duration;
      const src=ctx.createBufferSource();
      src.buffer=noiseBuffer;src.loop=true;
      const filter=ctx.createBiquadFilter();
      filter.type=filterType;
      filter.frequency.value=cutoff;
      if(filterType==="bandpass")filter.Q.value=.7;
      const amp=ctx.createGain();
      envelope(amp.gain,start,duration,volume,attack);
      src.connect(filter).connect(amp).connect(bus);
      src.start(start);src.stop(end+.01);
    };

    // 0.00–0.16s — a very positive two-part relay CLONK.
    noise(0,.032,.58,2400,"highpass",.002);
    noise(22,.15,.69,310,"lowpass",.006);
    tone(25,.15,145,63,.48,"triangle",500,.003);
    noise(126,.033,.17,1700,"highpass",.002);

    // 0.18–1.50s — lumpy downward CRT degauss: BWOOONG.
    // Harmonics are intentionally imperfect, not a clean sci-fi laser sweep.
    tone(180,1.2,146,43,.48,"sawtooth",380,.08);
    tone(225,1.16,111,46,.27,"triangle",0,.06);
    tone(240,.83,73,35,.20,"sine",0,.03);
    noise(300,.45,.18,320,"lowpass",.08);

    // 0.95–5.20s — low fan motor and slightly gritty bearing noise.
    tone(950,4.2,39,66,.18,"sawtooth",220,.5);
    tone(1030,3.98,81,109,.065,"triangle",400,.35);
    noise(1080,4.08,.16,750,"lowpass",.75);

    // 1.88–4.95s — floppy spindle, then recognisable rhythmic head seeks.
    tone(1880,3.06,310,400,.048,"triangle",900,.4);
    noise(2020,2.82,.032,2800,"bandpass",.32);
    const seeks=[2030,2148,2260,2540,2647,2762,3080,3201,3308,3645,3775,3902,4330,4435,4555,4730];
    seeks.forEach((ms,i)=>{
      const strong=i%4===0;
      noise(ms,strong?.064:.039,strong?.29:.20,strong?1700:2300,"bandpass",.002);
      tone(ms+4,strong?.07:.047,strong?285:345,strong?150:210,strong?.14:.085,"square",1150,.002);
    });

    // 5.42–5.96s — a full, proud power-on self-test BIIIP.
    tone(5420,.53,920,875,.25,"square",1800,.018);
    tone(5420,.53,920,875,.17,"sine",0,.018);

    // The sound ends before the real UI is shown at 6.6s.
    cleanupTimer=setTimeout(()=>ctx.close().catch(()=>{}),BOOT_DURATION_MS+380);
    if(ctx.state==="suspended")ctx.resume().catch(()=>{});
    return ()=>{
      clearTimeout(cleanupTimer);
      if(ctx.state==="closed")return;
      try{
        bus.gain.cancelScheduledValues(ctx.currentTime);
        bus.gain.setTargetAtTime(0,ctx.currentTime,.018);
      }catch{}
      setTimeout(()=>ctx.close().catch(()=>{}),120);
    };
  }catch(error){
    // Failed sound output must never prevent the actual terminal from starting.
    if(cleanupTimer)clearTimeout(cleanupTimer);
    if(ctx&&ctx.state!=="closed")ctx.close().catch(()=>{});
    console.debug("Opstartslyd ikke tilgængelig:",error);
    return ()=>{};
  }
}
