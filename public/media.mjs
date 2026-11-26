import { PCMFrames } from './pcm.mjs';
export class MotionPlayer {
  constructor(stage, onStatus) {
    this.stage = stage; this.onStatus = onStatus;
    this.videos = [...stage.querySelectorAll('video')];
    this.placeholder = stage.querySelector('img');
    this.seq = 0; this.front = 0;
  }
  async show(motion) {
    const seq = ++this.seq;
    this.cancelPending?.(); this.cancelPending = null;
    this.stage.parentElement.dataset.motion = motion.id;
    this.onStatus(motion.label + ' · 占位');
    if (!motion.enabled) { this.fallback(); return; }
    const nextIndex = 1 - this.front, video = this.videos[nextIndex];
    video.pause(); video.removeAttribute('src'); video.load();
    video.loop = motion.loop;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error('动画加载超时')); }, 4000);
        const cleanup = () => { clearTimeout(timer); video.onloadeddata = null; video.onerror = null; this.cancelPending = null; };
        this.cancelPending = () => { cleanup(); reject(new Error('动作已被替换')); };
        video.onloadeddata = () => { cleanup(); resolve(); };
        video.onerror = () => { cleanup(); reject(new Error('动画缺失或格式不支持')); };
        // Electron honors preload=none: assigning src alone may never fetch a
        // frame while we await loadeddata before play(). Explicitly start load.
        video.preload = 'auto';
        video.src = motion.src;
        video.load();
      });
      if (seq !== this.seq) return;
      await video.play();
      if (seq !== this.seq) { video.pause(); return; }
      video.classList.add('active');
      const previous = this.videos[this.front]; previous.classList.remove('active'); previous.pause();
      this.front = nextIndex; this.placeholder.style.opacity = '0';
      this.onStatus(motion.label);
    } catch {
      if (seq !== this.seq) return;
      this.fallback(); this.onStatus(motion.label + ' · 素材不可用，使用占位');
    }
  }
  fallback() {
    for (const video of this.videos) { video.pause(); video.classList.remove('active'); }
    this.placeholder.style.opacity = '1';
  }
}

export class SpeechPlayer {
  constructor(request, onEvent, onProgress) { this.request = request; this.onEvent = onEvent; this.onProgress = onProgress; this.seq = 0; }
  stop() {
    this.seq++; this.abort?.abort(); this.audio?.pause(); this.audio = null;
    for(const source of this.sources||[])try{source.stop();}catch{}
    this.sources?.clear();
    if(this.context){void this.context.close();this.context=null;}
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.settle?.(); this.settle = null;
    cancelAnimationFrame(this.frame);
  }
  async stream(response, text, sentence, offset, emotion, seq) {
    const rate=Number(response.headers.get('x-pcm-sample-rate')||24000);
    if(!Number.isInteger(rate)||rate<8000||rate>96000)throw new Error('Qwen采样率无效');
    const context=new AudioContext({sampleRate:rate});this.context=context;
    this.sources=new Set();await context.resume();
    const decoder=new PCMFrames(),queue=[];
    let received=0,scheduled=0,start=null,tail=0,done=false,played=0;
    const schedule=()=>{
      if(seq!==this.seq)return;
      if(start===null){if(received<rate*.5&&!done)return;start=context.currentTime+.03;tail=start;}
      for(const pcm of queue.splice(0)){
        const buffer=context.createBuffer(1,pcm.length,rate);buffer.copyToChannel(pcm,0);
        const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);
        tail=Math.max(tail,context.currentTime+.015);source.start(tail);tail+=buffer.duration;scheduled+=buffer.duration;
        this.sources.add(source);source.onended=()=>this.sources?.delete(source);
      }
    };
    let announced=false,lastFraction=0;
    const update=()=>{
      if(seq!==this.seq)return;
      if(start!==null&&context.currentTime>=start){
        if(!announced){announced=true;this.onEvent({type:'audio.started',emotion});}
        // During generation use an estimate, never reveal text ahead of playback.
        played=Math.max(played,Math.min(scheduled,scheduled-Math.max(0,tail-context.currentTime)));
        const duration=done?scheduled:Math.max(scheduled,Array.from(sentence).length/4.5);
        const fraction=Math.max(lastFraction,Math.min(done?1:.95,played/Math.max(.01,duration)));lastFraction=fraction;
        this.onProgress(text,(offset+Array.from(sentence).length*fraction)/Array.from(text).length);
      }
      this.frame=requestAnimationFrame(update);
    };
    update();
    try{
      for await(const chunk of response.body){
        if(seq!==this.seq)return;
        for(const pcm of decoder.push(chunk)){queue.push(pcm);received+=pcm.length;}
        schedule();
      }
      decoder.finish();done=true;schedule();
      if(!received)throw new Error('TTS音频为空');
      await new Promise(resolve=>{
        this.settle=resolve;
        const poll=()=>{if(seq!==this.seq||context.currentTime>=tail){resolve();return;}setTimeout(poll,20);};poll();
      });
    }finally{
      if(seq===this.seq){cancelAnimationFrame(this.frame);this.settle=null;for(const source of this.sources)try{source.stop();}catch{}this.sources.clear();this.context=null;}
      if(context.state!=='closed')await context.close();
    }
  }
  async speak(text, emotion = 'neutral') {
    this.stop(); const seq = this.seq;
    this.abort = new AbortController();
    const sentences = (String(text).match(/[^。！？!?\n]+[。！？!?\n]?/gu) || [text]).flatMap(s => {
      const chars = Array.from(s); const parts = [];
      for (let i = 0; i < chars.length; i += 100) parts.push(chars.slice(i, i + 100).join(''));
      return parts;
    }).filter(s => s.trim());
    if (!sentences.length) return;
    const synthesize = async sentence => {
      const response = await this.request('speak', { text: sentence, emotion, stream:true }, this.abort.signal, true);
      if((response.headers.get('content-type')||'').includes('application/x-dfy-pcm16'))return response;
      if (!(response.headers.get('content-type') || '').startsWith('audio/')) throw new Error('TTS未返回音频');
      return response.blob();
    };
    try {
      let next = synthesize(sentences[0]); next.catch(() => {});
      let offset = 0;
      for (let i = 0; i < sentences.length; i++) {
        const blob = await next;
        if (seq !== this.seq) return;
        if(blob instanceof Response){
          await this.stream(blob,text,sentences[i],offset,emotion,seq);
          if(seq!==this.seq)return;
          offset+=Array.from(sentences[i]).length;
          if(i+1<sentences.length){this.onEvent({type:'audio.buffering'});next=synthesize(sentences[i+1]);next.catch(()=>{});}
          continue;
        }
        if (i + 1 < sentences.length) { next = synthesize(sentences[i + 1]); next.catch(() => {}); }
        this.url = URL.createObjectURL(blob); const audio = new Audio(this.url); this.audio = audio;
        await new Promise((resolve, reject) => {
          this.settle = resolve;
          audio.onended = resolve; audio.onerror = () => reject(new Error('音频播放失败'));
          audio.onplaying = () => {
            if (seq !== this.seq) return;
            this.onEvent({ type: 'audio.started', emotion });
            const update = () => {
              if (seq !== this.seq) return;
              const progress = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.currentTime / audio.duration : 0;
              this.onProgress(text, (offset + Array.from(sentences[i]).length * progress) / Array.from(text).length);
              this.frame = requestAnimationFrame(update);
            };
            cancelAnimationFrame(this.frame); update();
          };
          audio.play().catch(reject);
        });
        if (seq !== this.seq) return;
        cancelAnimationFrame(this.frame); URL.revokeObjectURL(this.url); this.url = null;
        offset += Array.from(sentences[i]).length;
        if (i + 1 < sentences.length) this.onEvent({ type: 'audio.buffering' });
      }
      this.onProgress(text, 1); this.onEvent({ type: 'audio.ended' });
    } catch (error) {
      if (seq === this.seq && !this.abort.signal.aborted) { this.onEvent({ type: 'audio.ended' }); throw error; }
    } finally {
      if (seq === this.seq) { this.audio = null; this.settle = null; cancelAnimationFrame(this.frame); if (this.url) URL.revokeObjectURL(this.url); this.url = null; }
    }
  }
}
