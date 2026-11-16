/** 本机 faster-whisper 兜底：持久 Python worker 只加载一次模型，音频只经 stdin 传给本机进程。 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { PACKAGE_ROOT } from '../paths.ts';
import type { FileLogger } from '../log-file.ts';

interface Pending {
  resolve(result: { text?: string; keyword?: string }): void;
  reject(error: Error): void;
}

export interface LocalAsr {
  readonly available: boolean;
  transcribe(input: { audio: Uint8Array; language?: string }, signal?: AbortSignal): Promise<string>;
  spot(input: { audio: Uint8Array; session: string; reset?: boolean }, signal?: AbortSignal): Promise<string>;
  dispose(): void;
}

function firstExisting(values: readonly (string | undefined)[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value !== '' && existsSync(value));
}

/** 只探测已存在的本机运行时与模型，不在插件启动时联网下载。 */
export function createLocalAsr(options: { log: FileLogger }): LocalAsr {
  const { log } = options;
  const workspace = resolve(PACKAGE_ROOT, '..', '..', '..');
  const projectRoot = firstExisting([process.env.DSH_PET_PROJECT_ROOT, workspace]) ?? workspace;
  const python = firstExisting([
    process.env.DSH_PET_ASR_PYTHON,
    join(PACKAGE_ROOT, 'models', 'sherpa-onnx', '.venv', 'Scripts', 'python.exe'),
    join(projectRoot, 'speech-models', 'sherpa-onnx', '.venv', 'Scripts', 'python.exe'),
    join(projectRoot, 'speech-models', 'python-runtime', 'python.exe'),
    join(projectRoot, 'dsh-data', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe'),
  ]);
  const model = firstExisting([
    process.env.DSH_PET_ASR_MODEL,
    join(PACKAGE_ROOT, 'models', 'sherpa-onnx'),
    join(projectRoot, 'speech-models', 'sherpa-onnx'),
  ]);
  const workerFile =
    firstExisting([
      join(PACKAGE_ROOT, 'runtime', 'electron-helper', 'asr-worker.py'),
    ]) ?? '';
  const available = python !== undefined && model !== undefined && workerFile !== '';
  let child: ChildProcessWithoutNullStreams | null = null;
  let nextId = 0;
  let stdout = '';
  let disposed = false;
  const pending = new Map<number, Pending>();

  const failAll = (message: string): void => {
    for (const item of pending.values()) item.reject(new Error(message));
    pending.clear();
  };
  const ensureWorker = (): ChildProcessWithoutNullStreams => {
    if (!available || !python || !model) throw new Error('本地 ASR 运行时或模型未找到');
    if (disposed) throw new Error('本地 ASR 已停止');
    if (child && child.exitCode === null && !child.killed) return child;
    const proc = spawn(python, ['-E', '-B', '-u', '-X', 'utf8', workerFile, '--root', model], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    child = proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      for (;;) {
        const nl = stdout.indexOf('\n');
        if (nl < 0) break;
        const line = stdout.slice(0, nl).trim();
        stdout = stdout.slice(nl + 1);
        if (!line) continue;
        try {
          const result = JSON.parse(line) as {
            id?: unknown;
            ok?: unknown;
            text?: unknown;
            keyword?: unknown;
            message?: unknown;
          };
          const id = Number(result.id);
          const item = pending.get(id);
          if (!item) continue;
          pending.delete(id);
          if (result.ok === true)
            item.resolve({
              ...(typeof result.text === 'string' ? { text: result.text } : {}),
              ...(typeof result.keyword === 'string' ? { keyword: result.keyword } : {}),
            });
          else item.reject(new Error(typeof result.message === 'string' ? result.message : '本地识别失败'));
        } catch (error) {
          log.warn('[dsh-pet] 本地 ASR 返回无法解析：' + (error instanceof Error ? error.message : String(error)));
        }
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (text) log.info('[dsh-pet local-asr] ' + text);
    });
    proc.once('exit', (code) => {
      if (child === proc) child = null;
      failAll('本地 ASR 进程退出（code=' + String(code) + '）');
    });
    proc.stdin.on('error', (error) => failAll('本地 ASR 管道失败：' + error.message));
    log.info('[dsh-pet] 本地 ASR 已启动 model=' + model);
    return proc;
  };

  return {
    available,
    async transcribe(input, signal) {
      const proc = ensureWorker();
      const id = ++nextId;
      const result = await new Promise<{ text?: string }>((resolvePromise, reject) => {
        const onAbort = (): void => {
          pending.delete(id);
          reject(new Error('aborted'));
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener('abort', onAbort, { once: true });
        pending.set(id, {
          resolve: (text) => {
            signal?.removeEventListener('abort', onAbort);
            resolvePromise(text);
          },
          reject: (error) => {
            signal?.removeEventListener('abort', onAbort);
            reject(error);
          },
        });
        proc.stdin.write(
          JSON.stringify({
            id,
            op: 'transcribe',
            audio: Buffer.from(input.audio).toString('base64'),
            language: input.language || 'zh',
          }) + '\n',
        );
      });
      return result.text ?? '';
    },
    async spot(input, signal) {
      const proc = ensureWorker();
      const id = ++nextId;
      const result = await new Promise<{ keyword?: string }>((resolvePromise, reject) => {
        const onAbort = (): void => {
          pending.delete(id);
          reject(new Error('aborted'));
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener('abort', onAbort, { once: true });
        pending.set(id, {
          resolve: (value) => {
            signal?.removeEventListener('abort', onAbort);
            resolvePromise(value);
          },
          reject: (error) => {
            signal?.removeEventListener('abort', onAbort);
            reject(error);
          },
        });
        proc.stdin.write(
          JSON.stringify({
            id,
            op: 'kws',
            audio: Buffer.from(input.audio).toString('base64'),
            session: input.session,
            reset: input.reset === true,
          }) + '\n',
        );
      });
      return result.keyword ?? '';
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      failAll('本地 ASR 已停止');
      child?.kill();
      child = null;
    },
  };
}
