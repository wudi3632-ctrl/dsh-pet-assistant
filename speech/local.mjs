import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {speechPaths} from './paths.mjs';
import {readSettings} from '../scripts/runtime.mjs';
const here = dirname(fileURLToPath(import.meta.url));
export function createLocalSpeech() {
  const paths=speechPaths(resolve(here,'..'),readSettings(resolve(here,'..')));
  const {root,python,available}=paths;
  let child, id = 0, output = '', closed = false, warming, phase='stopped', loadMs=null, lastError='';
  const pending = new Map();
  const fail = error => { for (const item of pending.values()) item.reject(error); pending.clear(); };
  function start() {
    if (closed) throw new Error('本地识别已停止');
    if (child) return child;
    child = spawn(python, ['-E', '-B', '-u', '-X', 'utf8', resolve(here, 'worker.py'), '--root', root], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const proc = child; output = '';
    phase='loading';lastError='';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 1024 * 1024) { proc.kill(); return; }
      while (output.includes('\n')) {
        const index = output.indexOf('\n'), line = output.slice(0, index); output = output.slice(index + 1);
        try {
          const result = JSON.parse(line), item = pending.get(result.id);
          if (!item) continue;
          pending.delete(result.id);
          if (result.ok) {phase='ready';item.resolve(result);} else item.reject(new Error(result.message));
        } catch { /* protocol noise cannot become a command */ }
      }
    });
    let diagnostic = '';
    proc.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-2000); });
    proc.stdin.on('error', error => fail(error));
    proc.on('error', error => { if (child === proc) {child = null;warming=null;phase='failed';lastError=error.message;} fail(error); });
    proc.on('exit', code => { if (child === proc) {child = null;warming=null;phase='stopped';} fail(new Error(`本地识别进程退出(${code})：${diagnostic}`)); });
    return proc;
  }
  const api = {
    available,
    status(){return {available,phase,pid:child?.pid||null,loadMs,lastError,missing:paths.missing};},
    warmup(){
      if(!available)return Promise.reject(new Error('未配置本地识别模型和Python'));
      if(warming)return warming;
      const started=performance.now();
      warming=api.request('warmup',{audio:''}).then(()=>{phase='ready';loadMs=Math.round(performance.now()-started);return api.status();}).catch(error=>{warming=null;phase='failed';lastError=error.message;throw error;});
      return warming;
    },
    request(op, payload, signal) {
      if (!available) return Promise.reject(new Error('未配置本地识别模型和Python'));
      if (pending.size >= 4) return Promise.reject(new Error('识别繁忙，请稍后重试'));
      if (!payload || typeof payload.audio !== 'string') return Promise.reject(new Error('缺少音频'));
      const proc = start(), requestId = ++id;
      return new Promise((resolvePromise, reject) => {
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); pending.delete(requestId); };
        const abort = () => { cleanup(); reject(new Error('识别已取消')); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('本地识别超时')); }, 30000);
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        pending.set(requestId, { resolve: result => { cleanup(); resolvePromise(result); }, reject: error => { cleanup(); reject(error); } });
        proc.stdin.write(JSON.stringify({ ...payload, id: requestId, op }) + '\n');
      });
    },
    close() { closed = true; phase='stopped';fail(new Error('桌宠退出')); child?.kill(); child = null; },
  };
  return api;
}
