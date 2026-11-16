/** Local faster-qwen3-tts adapter. It preserves the framed PCM contract used by the desktop Helper. */
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { PACKAGE_ROOT } from '../paths.ts';
import type { PetEmotion, PetSpeed, PetVoiceTag } from '../../shared/performance.ts';
import { VoiceSynthError, type SynthInput } from './edge.ts';
import { FramedPcmCollector, writePcmCache } from './pcm-cache.ts';

export interface QwenSynthInput extends SynthInput {
  readonly emotion: PetEmotion;
  readonly speed: PetSpeed;
  readonly tag: PetVoiceTag;
  readonly traceId?: string;
}

const QWEN_STREAM_URL = 'http://127.0.0.1:9883/tts/stream';
const QWEN_HEALTH_URL = 'http://127.0.0.1:9883/health';
let qwenStart: Promise<void> | undefined;

function firstExisting(values: readonly string[]): string | undefined {
  return values.find((value) => value !== '' && existsSync(value));
}

/** Start the user's local Qwen service only when it is needed. No shell window and no network download. */
export async function prepareQwenService(): Promise<void> {
  try {
    const health = await fetch(QWEN_HEALTH_URL, { signal: AbortSignal.timeout(500) });
    if (health.ok) return;
  } catch {
    // Cold start below.
  }
  if (qwenStart) return qwenStart;
  qwenStart = (async () => {
    const workspace = resolve(PACKAGE_ROOT, '..', '..', '..');
    const projectRoot = firstExisting([process.env.DSH_PET_PROJECT_ROOT ?? '', workspace]);
    if (!projectRoot) throw new VoiceSynthError('Qwen3 TTS project root not found');
    const lab = join(projectRoot, 'speech-models', 'qwen3-tts-lab');
    const python = firstExisting([
      process.env.DSH_PET_QWEN_PYTHON ?? '',
      join(lab, '.venv310', 'Scripts', 'python.exe'),
    ]);
    const service = firstExisting([process.env.DSH_PET_QWEN_SERVICE ?? '', join(lab, 'qwen_tts_service.py')]);
    if (!python || !service) throw new VoiceSynthError('Qwen3 TTS runtime or service script not found');
    const child = spawn(python, ['-E', '-B', '-u', service], {
      cwd: lab,
      windowsHide: true,
      detached: false,
      stdio: 'ignore',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    child.unref();
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new VoiceSynthError(`Qwen3 TTS exited during startup (${child.exitCode})`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      try {
        const health = await fetch(QWEN_HEALTH_URL, { signal: AbortSignal.timeout(500) });
        if (health.ok) return;
      } catch {
        // Model is still loading.
      }
    }
    throw new VoiceSynthError('Qwen3 TTS startup timed out');
  })().finally(() => {
    qwenStart = undefined;
  });
  return qwenStart;
}

function payload(input: QwenSynthInput): string {
  return JSON.stringify({
    text: input.text,
    voice: input.voice || 'self-cute-v1',
    emotion: input.emotion,
    speed: input.speed,
    tag: input.tag,
    ...(input.traceId ? { trace_id: input.traceId } : {}),
  });
}

async function open(input: QwenSynthInput): Promise<Response> {
  await prepareQwenService();
  let response: Response;
  try {
    response = await fetch(QWEN_STREAM_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload(input),
      signal: input.signal ?? AbortSignal.timeout(75_000),
    });
  } catch (error) {
    throw new VoiceSynthError(error instanceof Error ? error.message : String(error));
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok || !response.body || !contentType.includes('application/x-dfy-pcm16')) {
    throw new VoiceSynthError(`Qwen3 TTS stream HTTP ${response.status}`);
  }
  return response;
}

/** Complete-file compatibility path used only when a caller cannot consume streaming PCM. */
export async function synthesizeQwen(input: QwenSynthInput): Promise<void> {
  const response = await open(input);
  const sampleRate = Number(response.headers.get('X-PCM-Sample-Rate')) || 24_000;
  const collector = new FramedPcmCollector();
  const reader = response.body!.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) throw new VoiceSynthError('Qwen3 PCM stream ended without terminal frame');
    if (collector.push(next.value)) break;
  }
  await writeFile(input.target, collector.wav(sampleRate));
  await reader.cancel().catch(() => undefined);
}

export async function streamQwen(
  input: QwenSynthInput,
  cacheTarget: string,
  onDone: () => void,
): Promise<{ body: ReadableStream<Uint8Array>; headers: Record<string, string> }> {
  let response: Response;
  try {
    response = await open(input);
  } catch (error) {
    onDone();
    throw error;
  }
  const sampleRate = Number(response.headers.get('X-PCM-Sample-Rate')) || 24_000;
  const recommended = Number(response.headers.get('X-PCM-Recommended-Buffer-Ms')) || 500;
  const reader = response.body!.getReader();
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
