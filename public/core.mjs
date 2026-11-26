export const WAKE_WORDS = ['大肥鱼', '鲸鲸', '小鲸鱼', '小鲸'];
export function wakeWordsFor(character){return character.id==='dashifeiyu'?[...WAKE_WORDS]:[character.name];}
export function wakeEnabledHint(words){return `语音唤醒已开启，可以叫“${words[0]}”。`;}
export const EMOTIONS = { neutral: 'talk_neutral', happy: 'talk_happy', soft: 'talk_soft', serious: 'talk_serious', angry: 'talk_pout', shy: 'talk_shy', surprised: 'talk_surprise' };
const MOTIONS = { 'voice.wake': 'wake', 'voice.started': 'listen', 'voice.final': 'listen_end', 'voice.unclear': 'unclear', 'turn.accepted': 'task_ack', 'turn.thinking': 'think_loop', 'tool.started': 'working', 'approval.required': 'approval', 'turn.completed': 'success', 'turn.failed': 'failure', 'turn.cancelled': 'cancel', 'audio.ended': 'talk_end', 'voice.interrupt': 'interrupt', 'session.expired': 'session_end' };
export function actionFor(event) {
  if (event.type === 'audio.buffering' || event.type === 'turn.replied') return 'session_wait';
  if (event.type === 'audio.started') return EMOTIONS[event.emotion] || EMOTIONS.neutral;
  if (event.type === 'pointer.move') return event.dx < 0 ? 'pull_left' : 'pull_right';
  if (event.type === 'pointer.arrived') return event.dx < 0 ? 'pull_stop_left' : 'pull_stop_right';
  if (event.type === 'pointer.click') return event.count === 2 ? 'double_click' : 'click';
  return MOTIONS[event.type] || null;
}

export function validateCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.motions)) throw new Error('动作清单缺少 motions');
  const ids = new Set();
  for (const motion of catalog.motions) {
    if (!/^[a-z_]+$/.test(motion.id) || ids.has(motion.id)) throw new Error('动作ID重复或非法');
    if (!Number.isFinite(motion.durationMs) || motion.durationMs <= 0) throw new Error('动作时长非法');
    if (!/^\/assets\/(?:motions\/|characters\/pack-[a-f0-9]{12}\/actions\/)[a-zA-Z0-9_.-]+\.webm$/.test(motion.src)) throw new Error('动作路径非法');
    ids.add(motion.id);
  }
  if (!ids.has('idle')) throw new Error('必须有idle动作');
  return catalog;
}

export class MotionDirector {
  constructor(catalog, render, clock = globalThis) {
    this.catalog = new Map(validateCatalog(catalog).motions.map(m => [m.id, m]));
    this.aliases=catalog.aliases||{};
    this.render = render;
    this.clock = clock;
    this.timer = null;
    this.current = null;
    this.generation = 0;
  }
  play(id, next = 'idle') {
    const motion = this.catalog.get(this.aliases[id]||id);
    if (!motion) return false;
    this.requestedId=id;
    if (this.current?.id === motion.id && motion.loop) return true;
    this.clock.clearTimeout(this.timer);
    const generation = ++this.generation;
    this.current = motion;
    const schedule = () => {
      if (generation !== this.generation || motion.loop) return;
      this.timer = this.clock.setTimeout(() => {
        if (generation === this.generation) this.play(next);
      }, motion.durationMs);
    };
    const rendered = this.render(motion);
    // Real clips must get their full duration after loading/starting playback.
    if (rendered && typeof rendered.then === 'function') rendered.then(schedule, schedule);
    else schedule();
    return true;
  }
  dispose() { this.generation++; this.clock.clearTimeout(this.timer); }
}

export class PetState {
  constructor(now = Date.now) {
    this.now = now;
    this.turnId = '';
    this.status = 'idle';
    this.activeUntil = 0;
    this.lastSeq = -1;
    this.task = null;
    this.speaking = false;
    this.busy = false;
  }
  activate() { this.activeUntil = this.now() + 30_000; }
  accept(event) {
    if (!event || typeof event.type !== 'string') return false;
    if (event.type === 'turn.accepted') {
      if (!event.turnId || event.turnId === this.turnId) return false;
      this.turnId = event.turnId;
      this.lastSeq = -1;
      this.busy = true;
      this.task = { title: String(event.text || '新任务'), steps: [], status: '处理中', phase: 'running', backend: event.backend || 'dsh' };
    } else if (event.turnId && event.turnId !== this.turnId) return false;
    // A host's delayed progress event must not resurrect a finished task.
    if (this.task?.phase === 'terminal' && ['turn.thinking', 'tool.started', 'tool.progress', 'task.plan', 'approval.required'].includes(event.type)) return false;
    if (Number.isInteger(event.seq)) {
      if (event.seq <= this.lastSeq) return false;
      this.lastSeq = event.seq;
    }
    this.status = event.type;
    if (event.type === 'task.plan' && this.task) this.task.steps = (event.steps || []).map(s => ({ id: String(s.id), label: String(s.label), status: 'pending' }));
    if (event.type === 'tool.progress' && this.task) {
      const step = this.task.steps.find(s => s.id === String(event.stepId));
      if (step && ['pending', 'running', 'completed', 'failed'].includes(event.status)) step.status = event.status;
    }
    if (['audio.started','sound.started'].includes(event.type)) this.speaking = true;
    if (event.type === 'tool.started' && this.task) this.task.status = String(event.text || '执行工具');
    if (event.type === 'turn.replied') { this.busy = false; if (this.task) { this.task.status = '已回复'; this.task.phase = 'terminal'; } }
    if (['audio.ended','sound.ended', 'voice.interrupt', 'turn.cancelled'].includes(event.type)) this.speaking = false;
    if (event.type === 'approval.required' && this.task) this.task.status = '等待确认';
    if (['turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.type)) {
      this.busy = false;
      if (this.task) { this.task.status = { 'turn.completed': '已完成', 'turn.failed': '失败', 'turn.cancelled': '已取消' }[event.type]; this.task.phase = 'terminal'; }
    }
    if (event.type === 'session.expired') this.activeUntil = 0;
    else this.activate();
    return true;
  }
  tick() {
    if (!this.busy && !this.speaking && this.activeUntil && this.now() >= this.activeUntil) {
      this.accept({ type: 'session.expired' });
      return true;
    }
    return false;
  }
}

export function speechWindow(text, progress, max = 64) {
  const chars = Array.from(String(text));
  const shown = Math.min(chars.length, Math.max(0, Math.floor(chars.length * Math.max(0, Math.min(1, progress)))));
  return chars.slice(Math.max(0, shown - max), shown).join('');
}
export function stripWake(text, detectedKeyword = '', wakeWords = WAKE_WORDS) {
  let value = String(text).trim();
  // Only fix this observed ASR homophone when KWS independently confirmed it.
  if (detectedKeyword === '大肥鱼' && value.startsWith('打肥鱼')) value = '大肥鱼' + value.slice(3);
  if (detectedKeyword === '小鸡毛' && value.startsWith('小金毛')) value = '小鸡毛' + value.slice(3);
  const word = [...wakeWords].sort((a, b) => b.length - a.length).find(w => value.startsWith(w));
  if (word) value = value.slice(word.length).replace(/^[，,。！!？?\s]+/u, '');
  return value;
}
export function pcm16(samples) {
  const bytes = new Uint8Array(samples.length * 2), view = new DataView(bytes.buffer);
  samples.forEach((v, i) => view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, v)) * (v < 0 ? 32768 : 32767)), true));
  return bytes;
}
export function wav16(samples, rate = 16000) {
  const pcm = pcm16(samples), bytes = new Uint8Array(44 + pcm.length), view = new DataView(bytes.buffer);
  const str = (offset, s) => Array.from(s).forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, pcm.length, true); bytes.set(pcm, 44); return bytes;
}
