/** Browser-side parser and stable scheduler for framed mono PCM16. */

const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export class FramedPcmParser {
  declare private pending: Uint8Array;
  declare private expected: number | null;
  declare private ended: boolean;

  constructor() {
    this.pending = new Uint8Array(0);
    this.expected = null;
    this.ended = false;
  }

  push(value: Uint8Array): { frames: Uint8Array[]; terminal: boolean } {
    if (this.ended) throw new Error('PCM bytes after terminal frame');
    const merged = new Uint8Array(this.pending.length + value.length);
    merged.set(this.pending);
    merged.set(value, this.pending.length);
    this.pending = merged;
    const frames: Uint8Array[] = [];
    while (true) {
      if (this.expected === null) {
        if (this.pending.length < 4) break;
        this.expected = new DataView(this.pending.buffer, this.pending.byteOffset, 4).getUint32(0, true);
        this.pending = this.pending.slice(4);
        if (this.expected === 0) {
          if (this.pending.length !== 0) throw new Error('PCM bytes after terminal frame');
          this.expected = null;
          this.ended = true;
          return { frames, terminal: true };
        }
        if (this.expected > MAX_FRAME_BYTES || this.expected % 2 !== 0) {
          throw new Error('invalid PCM frame length');
        }
      }
      if (this.pending.length < this.expected) break;
      frames.push(this.pending.slice(0, this.expected));
      this.pending = this.pending.slice(this.expected);
      this.expected = null;
    }
    return { frames, terminal: false };
  }
}

export interface PcmPlaybackMetrics {
  firstFrameMs: number | null;
  firstAudibleMs: number | null;
  underruns: number;
  scheduledAudioMs: number;
}

export async function playFramedPcmResponse(
  response: Response,
  options: {
    volume: number;
    startedAt: number;
    onStart: () => void;
    onFirstFrame?: (elapsedMs: number) => void;
    onPrebuffer?: (bufferMs: number) => void;
    registerStop: (stop: () => void) => void;
  },
): Promise<PcmPlaybackMetrics> {
  if (!response.body) throw new Error('PCM response has no body');
  const sampleRate = Number(response.headers.get('X-PCM-Sample-Rate')) || 24_000;
  const bufferMs = Math.max(
    80,
    Math.min(5_000, Number(response.headers.get('X-PCM-Recommended-Buffer-Ms')) || 2_500),
  );
  const context = new AudioContext();
  if (context.state === 'suspended') await context.resume();
  const gain = context.createGain();
  gain.gain.value = options.volume;
  gain.connect(context.destination);
  const reader = response.body.getReader();
  const parser = new FramedPcmParser();
  const sources: AudioBufferSourceNode[] = [];
  let stopped = false;
  let terminal = false;
  let playAt = context.currentTime + bufferMs / 1_000;
  let firstFrameMs: number | null = null;
  let firstAudibleMs: number | null = null;
  let underruns = 0;
  let scheduledAudioMs = 0;
  options.onPrebuffer?.(bufferMs);

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    void reader.cancel('voice interrupted').catch(() => undefined);
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
    }
    void context.close().catch(() => undefined);
  };
  options.registerStop(stop);

  try {
    while (!terminal && !stopped) {
      const next = await reader.read();
      if (next.done) throw new Error('PCM stream ended early');
      const parsed = parser.push(next.value);
      terminal = parsed.terminal;
      for (const pcm of parsed.frames) {
        if (firstFrameMs === null) {
          firstFrameMs = performance.now() - options.startedAt;
          options.onFirstFrame?.(firstFrameMs);
        }
        const samples = pcm.byteLength / 2;
        const buffer = context.createBuffer(1, samples, sampleRate);
        const channel = buffer.getChannelData(0);
        const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        for (let index = 0; index < samples; index += 1) channel[index] = view.getInt16(index * 2, true) / 32_768;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        const safeNow = context.currentTime + 0.04;
        if (sources.length > 0 && safeNow > playAt) underruns += 1;
        playAt = Math.max(playAt, safeNow);
        source.start(playAt);
        if (sources.length === 0) {
          firstAudibleMs = performance.now() - options.startedAt + Math.max(0, playAt - context.currentTime) * 1_000;
          options.onStart();
        }
        playAt += buffer.duration;
        scheduledAudioMs += buffer.duration * 1_000;
        sources.push(source);
      }
    }
    if (!terminal || sources.length === 0) throw new Error('PCM stream ended early');
    const remaining = Math.max(0, playAt - context.currentTime);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining * 1_000 + 20));
    return { firstFrameMs, firstAudibleMs, underruns, scheduledAudioMs };
  } finally {
    stop();
  }
}
