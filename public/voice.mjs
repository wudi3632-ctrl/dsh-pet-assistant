import { pcm16, wav16, stripWake, WAKE_WORDS } from './core.mjs';
import {MicrophoneLease} from './mic-lease.mjs';
const join = chunks => { const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0)); let offset = 0; for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; } return out; };
const base64 = bytes => { let value = ''; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(value); };

export class VoiceInput {
  constructor({ request, state, emit, submit, interrupt, report, level, threshold }) {
    Object.assign(this, { request, state, emit, submit, interrupt, report, level, threshold });
    this.running = false; this.session = crypto.randomUUID(); this.generation = 0;
    this.wakeWords=[...WAKE_WORDS];this.wakeVersion=0;
    this.microphoneLease=new MicrophoneLease();
  }
  setWakeWords(words){
    if(JSON.stringify(words)===JSON.stringify(this.wakeWords))return;
    this.wakeWords=[...words];this.wakeVersion++;this.kwsAbort?.abort();this.abort?.abort();
    this.session=crypto.randomUUID();this.detectedKeyword='';this.kws=[];this.pre=[];this.chunks=[];
    this.kwsBusy=false;this.busy=false;this.speechAt=0;this.startCount=0;this.retryAt=0;this.state.activeUntil=0;
    if(this.running)this.report('等待唤醒：'+this.wakeWords.join('、'));
  }
  async start(deviceId = '') {
    await this.stop(); const generation = ++this.generation;
    try {
    if(!await this.microphoneLease.acquire())return;
    // Load the local keyword model before capture so the first wake phrase is not
    // discarded while the initial asynchronous KWS request is still starting.
    const warming=new AbortController();this.kwsAbort=warming;
    await this.request('kws',{audio:base64(new Uint8Array(3200)),session:this.session},warming.signal);
    if(generation!==this.generation)return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const selected = devices.find(d => d.kind === 'audioinput' && d.deviceId === (deviceId || 'default')) || devices.find(d => d.kind === 'audioinput');
    const virtual = /UU|virtual|虚拟|remote|cable|loopback|fake|dummy/iu.test(selected?.label || '');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), channelCount: 1, echoCancellation: !virtual, noiseSuppression: !virtual, autoGainControl: false } });
    this.deviceLabel=this.stream.getAudioTracks()[0]?.label||selected?.label||'系统默认输入';
    if (generation !== this.generation) { this.stream.getTracks().forEach(t => t.stop()); return; }
      this.context = new AudioContext({ sampleRate: 16000 }); await this.context.resume();
      await this.context.audioWorklet.addModule('/capture-worklet.js');
      this.source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context, 'pet-capture');
      this.silent = this.context.createGain(); this.silent.gain.value = 0;
      this.source.connect(this.node); this.node.connect(this.silent); this.silent.connect(this.context.destination);
      this.running = true; this.chunks = []; this.pre = []; this.kws = []; this.kwsBusy = false;
      this.speechAt = 0; this.lastVoice = 0; this.cooldown = 0; this.busy = false; this.startCount = 0;
      this.session = crypto.randomUUID(); this.retryAt = 0;
      this.node.port.onmessage = event => { if (generation === this.generation) this.feed(event.data); };
      for(const track of this.stream.getAudioTracks())track.addEventListener('ended',()=>{
        if(generation!==this.generation||!this.running)return;
        void this.stop();this.report('麦克风连接已断开，请重新开启');this.emit({type:'voice.disconnected'});
      },{once:true});
      this.report('等待唤醒');
    } catch (error) { await this.stop(); throw error; }
  }
  async stop() {
    this.running = false; this.generation++; this.abort?.abort(); this.kwsAbort?.abort();
    this.microphoneLease.close();
    if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); }
    this.source?.disconnect(); this.stream?.getTracks().forEach(t => t.stop());
    await this.context?.close().catch(() => {}); this.context = null; this.level(0);
  }
  async keyword(samples) {
    if (this.kwsBusy || Date.now() < this.retryAt) return;
    this.kwsBusy = true; const generation = this.generation,wakeVersion=this.wakeVersion;
    const controller = new AbortController(); this.kwsAbort = controller;
    try {
      const result = await this.request('kws', { audio: base64(pcm16(samples)), session: this.session }, controller.signal);
      if (generation !== this.generation||wakeVersion!==this.wakeVersion) return;
      if (this.wakeWords.includes(result.keyword)) {
        this.detectedKeyword = result.keyword;
        this.interrupt(); this.state.activate(); this.cooldown = 0;
        this.emit({ type: 'voice.wake' }); this.report('已唤醒，请说');
        // Preserve a bounded pre-roll so a command joined to the wake phrase is not lost.
        this.chunks = [...this.pre]; this.speechAt = performance.now(); this.lastVoice = this.speechAt;
      }
    } catch (error) {
      if (generation === this.generation && wakeVersion===this.wakeVersion && !controller.signal.aborted) { this.retryAt = Date.now() + 5000; this.report('唤醒服务不可用：' + error.message); }
    } finally { if (generation === this.generation&&wakeVersion===this.wakeVersion) this.kwsBusy = false; }
  }
  feed(samples) {
    if (!this.running) return;
    const rms = Math.sqrt(samples.reduce((n, x) => n + x * x, 0) / samples.length);
    this.level(Math.min(1, rms * 8));
    this.pre.push(samples); if (this.pre.length > 16) this.pre.shift();
    const active = Date.now() < this.state.activeUntil;
    if (!active || this.state.speaking || this.state.busy) {
      this.kws.push(samples);
      if (this.kws.length >= 4) { const batch = join(this.kws); this.kws = []; void this.keyword(batch); }
      this.speechAt = 0; this.chunks = []; return;
    }
    this.kws = [];
    if (this.busy || Date.now() < this.cooldown) return;
    const now = performance.now();
    // Hysteresis keeps quiet final syllables from being cut at the onset threshold.
    const gate = this.speechAt ? Math.max(0.003, this.threshold() * 0.45) : this.threshold();
    if (rms >= gate) { this.startCount++; this.lastVoice = now; } else if (!this.speechAt) this.startCount = 0;
    if (!this.speechAt && this.startCount >= 2) {
      this.speechAt = now; this.chunks = [...this.pre]; this.emit({ type: 'voice.started' }); this.report('正在听'); return;
    }
    if (!this.speechAt) return;
    this.chunks.push(samples);
    if (now - this.lastVoice > 650 || now - this.speechAt > 15000) {
      const clip = join(this.chunks); const duration = now - this.speechAt;
      this.speechAt = 0; this.chunks = []; this.startCount = 0;
      if (duration >= 250) void this.transcribe(clip);
    }
  }
  async transcribe(samples) {
    if (this.busy) return;
    this.busy = true; const generation = this.generation,wakeVersion=this.wakeVersion;
    this.abort = new AbortController(); this.report('识别中');
    const asrStarted=performance.now();
    this.emit({ type: 'voice.final' });
    try {
      const result = await this.request('hear', { audio: base64(wav16(samples)), traceId: crypto.randomUUID() }, this.abort.signal);
      if (generation !== this.generation||wakeVersion!==this.wakeVersion) return;
      this.lastMetrics={audioMs:Math.round(samples.length/16),asrMs:Math.round(performance.now()-asrStarted),decodeMs:result.decodeMs??null};
      const detected=this.detectedKeyword;
      const text = stripWake(result.text || '', detected,this.wakeWords); this.detectedKeyword = '';
      if (!text) { this.emit({ type: detected?'voice.ready':'voice.unclear' }); this.report(detected?'已唤醒，等待指令':'没有听清，请再说一次'); return; }
      this.busy=false;
      this.report('已识别，DSH正在处理：' + text);
      void Promise.resolve(this.submit(text)).catch(error=>this.report('任务失败：'+error.message));
    } catch (error) { if (generation === this.generation && wakeVersion===this.wakeVersion && !this.abort.signal.aborted) {this.emit({type:'voice.failed'});this.report('语音失败：' + error.message);} }
    finally {
      if (generation === this.generation&&wakeVersion===this.wakeVersion) { this.busy = false; this.cooldown = Date.now() + 350; this.pre = []; this.state.activate(); }
    }
  }
}
