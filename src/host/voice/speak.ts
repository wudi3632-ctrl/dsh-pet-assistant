/**
 * 语音服务：校验输入、串行排队、查缓存、调合成，把结果收敛成「文件路径或失败原因」。
 *
 * 队列放在这里而不是路由里：并发上限是资源约束，与 HTTP 无关。串行保证同一时刻只有
 * 一条上游连接，也保证先点先响——并发合成会让顺序不可预测。
 * 不负责把 wav 交给客户端：那是路由与 bridge 的事。
 * @module dsh-pet/src/host/voice/speak
 */
import { stat, writeFile } from 'node:fs/promises';
import { cacheKey, cachePath, ensureCacheDir, pruneCache } from './cache.ts';
import { VoiceSynthError } from './edge.ts';
import { streamCosy, synthesizeCosy, type CosySynthInput } from './cosyvoice.ts';
import { streamQwen, synthesizeQwen } from './qwen3.ts';
import { BUILTIN_VOICE_ID, activeVoiceProvider, type VoiceProvider } from './registry.ts';
import { DEFAULT_VOICE, VOICES, isKnownVoice, type VoiceInfo } from './voices.ts';
import { performanceOf, type PetEmotion, type PetSpeed, type PetVoiceTag } from '../../shared/performance.ts';

/** 单次请求允许的最大文本长度（字符，按 UTF-16 计）。 */
export const MAX_TEXT_CHARS = 500;
/** 同时排队的合成上限（含正在跑的那个）；超出直接拒绝，不无限堆积。 */
export const MAX_QUEUE = 3;

/** 语速表达式：`+N%` 或 `-N%`。 */
const RATE_PATTERN = /^[+-]\d{1,3}%$/;
/** 语速下界（百分比）。 */
const RATE_MIN_PERCENT = -50;
/** 语速上界（百分比）。 */
const RATE_MAX_PERCENT = 100;
/** 第三方实现的单次合成上限（ms）：与内置同口径，避免一句卡住串行队列。 */
const PROVIDER_TIMEOUT_MS = 15_000;
/** 本地合成的排队陈旧阈值（ms）。 */
const BUILTIN_TIMEOUT_MS = 28_000;
/** 排队超过这么久还没轮到就丢弃（ms）：等得比一次合成还久，客户端早已放弃，再合成只是白烧上游。 */
const STALE_WAIT_MS = BUILTIN_TIMEOUT_MS;

/** 一次合成的输入（已校验）。 */
interface SpeakInput {
  readonly text: string;
  readonly voice: string;
  readonly rate: string;
  readonly emotion: PetEmotion;
  readonly speed: PetSpeed;
  readonly tag: PetVoiceTag;
  readonly traceId?: string;
}

/** 失败原因；路由层原样映射成 `result.ts` 的 reason。 */
export type SpeakFailure = 'bad-request' | 'voice-busy' | 'generate-error';

/** 合成结果：成功时给出最终 mp3 的绝对路径。 */
export type SpeakResult = { ok: true; file: string } | { ok: false; reason: SpeakFailure; message: string };
export type SpeakStreamResult =
  | { ok: true; file: string }
  | { ok: true; body: ReadableStream<Uint8Array>; headers: Record<string, string> }
  | { ok: false; reason: SpeakFailure; message: string };

/** 语音服务：路由层只依赖这两个方法。 */
export interface VoiceService {
  /** 合成一段文本；同一输入命中缓存时不再联网。 */
  speak(raw: unknown): Promise<SpeakResult>;
  /** Stream a cache miss as framed PCM; cache hits remain ordinary WAV files. */
  stream(raw: unknown, signal?: AbortSignal): Promise<SpeakStreamResult>;
  /** 可选音色列表（与白名单同源）。 */
  listVoices(): readonly VoiceInfo[];
}

/** 解析结论：成功给已校验输入，失败给一句可直接回给调用方的说明。 */
type ParseResult = { ok: true; value: SpeakInput } | { ok: false; message: string };

/** 校验请求体；情绪字段非法时回中性，绝不把任意控制串送进模型。 */
function parseSpeakInput(raw: unknown): ParseResult {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return { ok: false, message: 'text is required' };
  if (text.length > MAX_TEXT_CHARS) return { ok: false, message: `text too long (max ${MAX_TEXT_CHARS} chars)` };
  const voice = body.voice === undefined ? DEFAULT_VOICE : body.voice;
  if (typeof voice !== 'string' || !isKnownVoice(voice)) {
    return { ok: false, message: `unknown voice; allowed: ${VOICES.map((item) => item.id).join(', ')}` };
  }
  const rate = body.rate === undefined ? '+0%' : body.rate;
  if (typeof rate !== 'string' || !RATE_PATTERN.test(rate)) {
    return { ok: false, message: 'rate must look like +0% or -10%' };
  }
  const percent = Number(rate.slice(1, -1));
  if (!Number.isFinite(percent) || percent < RATE_MIN_PERCENT || percent > RATE_MAX_PERCENT) {
    return { ok: false, message: `rate out of range (${RATE_MIN_PERCENT}%..+${RATE_MAX_PERCENT}%)` };
  }
  const traceId = typeof body.traceId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(body.traceId)
    ? body.traceId
    : undefined;
  return { ok: true, value: { text, voice, rate, ...performanceOf(body), ...(traceId ? { traceId } : {}) } };
}

/** 断言用：`SpeakResult` 的构造点都经过这里，避免各处手写同一句文案。 */
function dropped(): SpeakResult {
  return { ok: false, reason: 'voice-busy', message: 'queued too long, dropped' };
}

/**
 * 这一条排队等得太久了吗。
 *
 * 等得比一次合成允许的时长还久，客户端那边早已超时放弃：再合成只是白烧上游，
 * 而且声音出来时说的已经是上一件事。
 *
 * @param queuedMs - 入队时刻。
 * @param nowMs - 轮到自己时的时刻。
 * @param waitMs - 容许的最长排队时间；缺省用 {@link STALE_WAIT_MS}，测试注入更短的值。
 * @returns 应该丢弃时为 true。
 * @internal
 */
export function isQueueStale(queuedMs: number, nowMs: number, waitMs: number = STALE_WAIT_MS): boolean {
  return nowMs - queuedMs > waitMs;
}

/** 造语音服务。 */
export function createVoiceService(options: {
  /** 用户数据根；缓存落在 `<userRoot>/voice-cache/`。 */
  userRoot: string;
  /** 留痕用；不传则静默。只记字数与结果，不记正文（用户内容不进日志）。 */
  log?: { info?(message: string): void; warn?(message: string): void };
  /** 合成实现；测试注入替身，缺省只走本机 CosyVoice3，不回退 Edge。 */
  synthesize?: (input: CosySynthInput) => Promise<void>;
  /** Selected built-in local engine. Read lazily so config edits apply without a host restart. */
  speechEngine?: () => 'cosyvoice' | 'qwen3';
  /** 容许的最长排队时间（ms）；缺省 {@link STALE_WAIT_MS}，测试用它把丢弃分支逼出来。 */
  staleWaitMs?: number;
}): VoiceService {
  const { userRoot, log } = options;
  const synthesizeImpl = options.synthesize ?? synthesizeCosy;
  const selectedEngine = (): 'cosyvoice' | 'qwen3' => options.speechEngine?.() ?? 'cosyvoice';
  const staleWaitMs = options.staleWaitMs ?? STALE_WAIT_MS;
  const trace = (traceId: string | undefined, stage: string, data: Record<string, unknown> = {}): void => {
    if (!traceId) return;
    log?.info?.(`[dsh-pet-trace] ${JSON.stringify({ traceId, stage, wallMs: Date.now(), ...data })}`);
  };
  /** 已占用的队列名额（含正在跑的那个）。 */
  let queueUsed = 0;
  /** 串行链：上一件事收尾（成功或失败）后才轮到下一件。 */
  let chain: Promise<void> = Promise.resolve();

  /** 把一次合成排进串行链；无论成败都释放名额。 */
  function enqueue(task: () => Promise<void>): Promise<void> {
    queueUsed += 1;
    const run = chain.then(task, task);
    // 链本身不能带拒绝，否则后续任务会继承同一个失败；拒绝只交给本次的调用方
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      queueUsed -= 1;
    });
  }

  /** 缓存命中返回文件路径；不存在或空文件返回 undefined。 */
  async function findCached(target: string): Promise<string | undefined> {
    try {
      const info = await stat(target);
      return info.isFile() && info.size > 0 ? target : undefined;
    } catch {
      return undefined;
    }
  }

  async function speak(raw: unknown): Promise<SpeakResult> {
    const parsed = parseSpeakInput(raw);
    if (!parsed.ok) return { ok: false, reason: 'bad-request', message: parsed.message };
    const { text, voice, rate, emotion, speed, tag, traceId } = parsed.value;
    // 每次请求现查一次：第三方可能运行中才注册、也可能被卸载，启动快照会漏掉这两种
    const provider = activeVoiceProvider();
    const engine = selectedEngine();
    const source = provider ? provider.id : `${BUILTIN_VOICE_ID}:${engine}`;
    // 第三方没有音色概念，缓存键里把 voice 置空；来源进键，换实现不会命中旧音频
    const controls = `${rate}|${emotion}|${speed}|${tag}`;
    const target = cachePath(userRoot, cacheKey(source, voice, controls, text));
    const startedMs = Date.now();
    const cached = await findCached(target);
    if (cached) {
      log?.info?.(`[dsh-pet] voice speak: cache=hit chars=${text.length} voice=${source}`);
      return { ok: true, file: cached };
    }
    if (queueUsed >= MAX_QUEUE) {
      log?.warn?.(`[dsh-pet] voice speak: queue full (max ${MAX_QUEUE}) chars=${text.length} voice=${source}`);
      return { ok: false, reason: 'voice-busy', message: 'voice queue is full, retry later' };
    }
    const queue = { dropped: false };
    const queuedMs = Date.now();
    try {
      await enqueue(async () => {
        if (isQueueStale(queuedMs, Date.now(), staleWaitMs)) {
          queue.dropped = true;
          return;
        }
        const dir = await ensureCacheDir(userRoot);
        if (provider) await synthesizeWithProvider(provider, { text, voice, rate, target, emotion, speed, tag, traceId });
        else {
          const builtinSynth = options.synthesize ? synthesizeImpl : engine === 'qwen3' ? synthesizeQwen : synthesizeCosy;
          await builtinSynth({
            signal: AbortSignal.timeout(75_000),
            target,
            text,
            voice,
            rate,
            emotion,
            speed,
            tag,
            traceId,
          });
        }
        // 淘汰放在成功之后：失败时不该为腾地方而删掉还能用的缓存
        await pruneCache(dir);
      });
    } catch (error) {
      // 上游细节（含 URL、状态码）不外泄，只留在日志里
      log?.warn?.(
        `[dsh-pet] voice speak: failed chars=${text.length} voice=${source} ` +
          `ms=${Date.now() - startedMs} reason=${error instanceof VoiceSynthError ? error.message : String(error)}`,
      );
      return { ok: false, reason: 'generate-error', message: 'voice synthesis failed' };
    }
    if (queue.dropped) {
      log?.warn?.(
        `[dsh-pet] voice speak: dropped chars=${text.length} voice=${source} queued=${Date.now() - queuedMs}ms`,
      );
      return dropped();
    }
    log?.info?.(`[dsh-pet] voice speak: cache=miss chars=${text.length} voice=${source} ms=${Date.now() - startedMs}`);
    return { ok: true, file: target };
  }

  async function stream(raw: unknown, signal?: AbortSignal): Promise<SpeakStreamResult> {
    const parsed = parseSpeakInput(raw);
    if (!parsed.ok) return { ok: false, reason: 'bad-request', message: parsed.message };
    const provider = activeVoiceProvider();
    // Third-party providers keep the complete-file contract. A registered
    // provider must not be bypassed merely because the built-in engine can stream.
    if (provider) return speak(raw);
    const { text, voice, rate, emotion, speed, tag, traceId } = parsed.value;
    const engine = selectedEngine();
    const controls = `${rate}|${emotion}|${speed}|${tag}`;
    const target = cachePath(userRoot, cacheKey(`${BUILTIN_VOICE_ID}:${engine}`, voice, controls, text));
    const cached = await findCached(target);
    if (cached) {
      log?.info?.(`[dsh-pet] voice stream: cache=hit chars=${text.length}`);
      return { ok: true, file: cached };
    }
    if (queueUsed >= MAX_QUEUE) {
      return { ok: false, reason: 'voice-busy', message: 'voice queue is full, retry later' };
    }

    queueUsed += 1;
    const queuedMs = Date.now();
    trace(traceId, 'tts-queued', { queueDepth: queueUsed, chars: text.length });
    let released = false;
    let releaseDone: () => void = () => undefined;
    const streamDone = new Promise<void>((resolve) => {
      releaseDone = resolve;
    });
    const release = (): void => {
      if (released) return;
      released = true;
      queueUsed -= 1;
      releaseDone();
      void ensureCacheDir(userRoot).then(pruneCache).catch(() => undefined);
    };
    const open = chain.then(async (): Promise<SpeakStreamResult> => {
      if (isQueueStale(queuedMs, Date.now(), staleWaitMs)) {
        release();
        return dropped();
      }
      await ensureCacheDir(userRoot);
      trace(traceId, 'tts-host-open', { queueWaitMs: Date.now() - queuedMs });
      const combinedSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(75_000)])
        : AbortSignal.timeout(75_000);
      const streamBuiltin = engine === 'qwen3' ? streamQwen : streamCosy;
      const streamed = await streamBuiltin(
        { text, voice, rate, emotion, speed, tag, traceId, target, signal: combinedSignal },
        target,
        release,
      );
      log?.info?.(`[dsh-pet] voice stream: opened chars=${text.length} emotion=${emotion}`);
      return { ok: true, ...streamed };
    });
    chain = open.then(
      (result) => (result.ok && 'body' in result ? streamDone : undefined),
      () => undefined,
    );
    try {
      const result = await open;
      if (!result.ok || !('body' in result)) release();
      return result;
    } catch (error) {
      release();
      log?.warn?.(
        `[dsh-pet] voice stream: failed chars=${text.length} reason=${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: false, reason: 'generate-error', message: 'voice synthesis failed' };
    }
  }

  return { listVoices: () => VOICES, speak, stream };
}

/** 给一个 Promise 套超时；超时 reject，原 Promise 不被取消（provider 自己该处理放弃）。 */
function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('voice provider timed out')), timeoutMs);
    timer.unref?.();
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 用第三方实现合成并落盘。
 *
 * 空字节按失败处理：0 字节文件会被 {@link findCached} 的 `size > 0` 跳过，
 * 于是每次请求都重新合成、每次又得到空文件，白烧上游。
 */
async function synthesizeWithProvider(provider: VoiceProvider, input: CosySynthInput): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = await withTimeout(
      provider.synthesize({
        text: input.text,
        rate: input.rate,
        voice: input.voice,
        emotion: input.emotion,
        speed: input.speed,
        tag: input.tag,
      }),
      PROVIDER_TIMEOUT_MS,
    );
  } catch (error) {
    throw new VoiceSynthError(error instanceof Error ? error.message : String(error));
  }
  if (bytes.length === 0) throw new VoiceSynthError('voice provider returned empty audio');
  await writeFile(input.target, bytes);
}
