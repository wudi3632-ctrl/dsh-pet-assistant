/** 本机 CosyVoice3 适配器。失败直接上抛，明确禁止回退到 Edge TTS。 */
import { writeFile } from 'node:fs/promises';
import type { PetEmotion, PetSpeed, PetVoiceTag } from '../../shared/performance.ts';
import { VoiceSynthError, type SynthInput } from './edge.ts';
import { FramedPcmCollector, writePcmCache } from './pcm-cache.ts';

export interface CosySynthInput extends SynthInput {
  readonly emotion: PetEmotion;
  readonly speed: PetSpeed;
  readonly tag: PetVoiceTag;
  readonly traceId?: string;
}

const COSYVOICE_URL = 'http://127.0.0.1:9882/tts';
const COSYVOICE_STREAM_URL = 'http://127.0.0.1:9882/tts/stream';

function cosyPayload(input: CosySynthInput): string {
  return JSON.stringify({
    text: input.text,
    voice: input.voice || 'self-cute-v1',
    emotion: input.emotion,
    speed: input.speed,
    tag: input.tag,
    realtime: true,
    stream_hop: 10,
    ...(input.traceId ? { trace_id: input.traceId } : {}),
  });
}

export async function synthesizeCosy(input: CosySynthInput): Promise<void> {
  try {
    const response = await fetch(COSYVOICE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cosyPayload(input),
      signal: input.signal ?? AbortSignal.timeout(75_000),
    });
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('audio')) {
      throw new Error(`CosyVoice HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error('CosyVoice returned empty audio');
    await writeFile(input.target, bytes);
  } catch (error) {
    throw new VoiceSynthError(error instanceof Error ? error.message : String(error));
  }
}

/** Open CosyVoice framed PCM and expose a validated, abortable stream. */
export async function streamCosy(
  input: CosySynthInput,
  cacheTarget: string,
  onDone: () => void,
): Promise<{ body: ReadableStream<Uint8Array>; headers: Record<string, string> }> {
  let response: Response;
  try {
    response = await fetch(COSYVOICE_STREAM_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cosyPayload(input),
      signal: input.signal ?? AbortSignal.timeout(75_000),
    });
  } catch (error) {
    onDone();
    throw new VoiceSynthError(error instanceof Error ? error.message : String(error));
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !response.body || !contentType.includes('application/x-dfy-pcm16')) {
    onDone();
    throw new VoiceSynthError(`CosyVoice stream HTTP ${response.status}`);
  }
  const sampleRate = Number(response.headers.get('X-PCM-Sample-Rate')) || 24_000;
  const recommended = Number(response.headers.get('X-PCM-Recommended-Buffer-Ms')) || 2_500;
  const reader = response.body.getReader();
  const collector = new FramedPcmCollector();
  let settled = false;
  const settle = (): void => {
    if (settled) return;
    settled = true;
    onDone();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) throw new Error('PCM stream ended without terminal frame');
        const terminal = collector.push(next.value);
        controller.enqueue(next.value);
        if (terminal) {
          await writePcmCache(cacheTarget, collector.wav(sampleRate));
          settle();
          controller.close();
          await reader.cancel().catch(() => undefined);
        }
      } catch (error) {
        settle();
        controller.error(error);
        await reader.cancel(error).catch(() => undefined);
      }
    },
    async cancel(reason) {
      settle();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
  return {
    body,
    headers: {
      'content-type': 'application/x-dfy-pcm16',
      'cache-control': 'no-store',
      'x-pcm-sample-rate': String(sampleRate),
      'x-pcm-recommended-buffer-ms': String(Math.max(80, Math.min(5_000, recommended))),
    },
  };
}
