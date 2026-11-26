import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createLocalSpeech } from './speech/local.mjs';
import { createBackendHub } from './backends/hub.mjs';
import { synthesizeQwen, streamQwen } from './speech/tts.mjs';
import {createCharacterStore} from './characters/store.mjs';

const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.png': 'image/png', '.ogg':'audio/ogg','.wav':'audio/wav' };
const UPSTREAM = new Map([['turn', ['POST', 'agent/turn']], ['hear', ['POST', 'voice/hear']], ['kws', ['POST', 'voice/kws']], ['speak', ['POST', 'voice/speak']]]);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
async function readBody(req,limit=8*1024*1024) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new Error('请求大小超过限制');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function createPetServer(options = {}) {
  let local = {};
  try { local = JSON.parse(readFileSync(new URL('./settings.local.json', import.meta.url), 'utf8')); } catch { /* optional local configuration */ }
  if(options.host&&options.host!=='dsh')throw new Error('本项目现为DSH专用插件，不再支持其他宿主');
  local={...local,integration:'dsh-plugin',defaultBackend:'dsh',lockHost:'dsh'};
  const target = new URL(options.backend || process.env.DFY_DSH_URL || local.backend || 'http://127.0.0.1:3080');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !['http:', 'https:'].includes(target.protocol)) throw new Error('DSH服务必须是本机HTTP地址');
  const token = options.token || process.env.DFY_DSH_TOKEN || '';
  const agentBase = new URL(options.agent || process.env.DFY_AGENT_URL || local.agent || 'http://127.0.0.1:57833');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(agentBase.hostname)) throw new Error('任务桥必须是本机地址');
  const speech = createLocalSpeech();
  const clients = new Set();
  const publish = event => { for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`); };
  const hub = createBackendHub({ settings: local, agentBase, publish });
  const characters=createCharacterStore(options.root||dirname(fileURLToPath(import.meta.url)));
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) return json(res, 403, { message: '无效Host' });
      const origin = `http://${host}`;
      if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { message: '仅允许本机同源访问' });
      const url = new URL(req.url, origin);
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'");
      if(url.pathname==='/api/characters'&&req.method==='GET')return json(res,200,await characters.list());
      if(url.pathname==='/api/desktop/status'&&req.method==='GET')return json(res,200,{ok:true,desktop:Boolean(options.control),pid:process.pid,...options.desktopStatus?.()});
      if(url.pathname==='/api/desktop/control'&&req.method==='POST'){
        if(req.headers['x-pet-client']!=='1')return json(res,403,{ok:false,message:'缺少桌宠标识'});
        const {action}=JSON.parse((await readBody(req,4096)).toString());
        if(!['show','stop','settings'].includes(action)||!options.control)return json(res,400,{ok:false,message:'桌面控制不可用'});
        if(action==='stop'){json(res,200,{ok:true});setTimeout(()=>options.control(action),0);return;}
        options.control(action);return json(res,200,{ok:true,...options.desktopStatus?.()});
      }
      if(['/api/characters/select','/api/characters/import'].includes(url.pathname)&&req.method==='POST'){
        if(req.headers['x-pet-client']!=='1')return json(res,403,{ok:false,message:'缺少桌宠客户端标识'});
        const info=url.pathname.endsWith('/import')?await characters.import(await readBody(req,160*1024*1024)):await characters.select(JSON.parse((await readBody(req)).toString()).id);
        publish({type:'appearance.changed',characterId:info.selected});return json(res,200,info);
      }
      if (url.pathname === '/api/health') {
        const selected=local.lockHost||local.defaultBackend||'dsh';
        const backends=await hub.health();const host=backends.find(b=>b.id===selected);
        return json(res, 200, { ok: true, host:selected, lockedHost:local.lockHost||null, integration:local.integration||'legacy-adapter', connected:host?.available===true, detail:host?.detail, transport:host?.transport, localSpeech: speech.available, speech:speech.status(), tts:local.tts?.provider||null, ttsURL:local.tts?.baseURL||target.origin });
      }
      if (url.pathname === '/api/backends' && req.method === 'GET') return json(res, 200, { ok: true, backends: await hub.health(), defaultBackend: local.defaultBackend || 'dsh',lockedHost:local.lockHost||null,integration:local.integration||'legacy-adapter' });
      if (url.pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': connected\n\n'); clients.add(res);
        const keep = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        res.on('close', () => { clients.delete(res); clearInterval(keep); }); return;
      }
      if (url.pathname === '/api/events' && req.method === 'POST') {
        if (req.headers['x-pet-client'] !== '1') return json(res, 403, { message: '缺少桌宠客户端标识' });
        const event = JSON.parse((await readBody(req)).toString());
        if (!event || typeof event.type !== 'string' || JSON.stringify(event).length > 65536) return json(res, 400, { message: '事件非法' });
        for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
        return json(res, 200, { ok: true });
      }
      const route = UPSTREAM.get(url.pathname.replace(/^\/api\//, ''));
      if (url.pathname.startsWith('/api/') && route) {
        if (req.method !== route[0]) return json(res, 405, { message: '方法不支持' });
        if (req.method === 'POST' && req.headers['x-pet-client'] !== '1') return json(res, 403, { message: '缺少桌宠客户端标识' });
        const abort = new AbortController();
        res.on('close', () => { if (!res.writableEnded) abort.abort(); });
        if (route[1] === 'voice/speak' && local.tts?.provider === 'qwen') {
          const payload=JSON.parse((await readBody(req)).toString());
          if(payload.stream===true){
            const upstream=await streamQwen(local.tts,payload,abort.signal);
            res.writeHead(200,{'content-type':'application/x-dfy-pcm16','x-pcm-sample-rate':upstream.headers.get('x-pcm-sample-rate')||'24000','cache-control':'no-store'});
            res.flushHeaders();
            await pipeline(Readable.fromWeb(upstream.body),res);return;
          }
          const audio = await synthesizeQwen(local.tts,payload,abort.signal);
          res.writeHead(200,{'content-type':'audio/wav','content-length':audio.length,'cache-control':'no-store'}); res.end(audio); return;
        }
        if (speech.available && ['hear', 'kws'].includes(url.pathname.slice(5))) {
          const payload = JSON.parse((await readBody(req)).toString());
          return json(res, 200, await speech.request(url.pathname.slice(5), payload, abort.signal));
        }
        if (route[1] === 'agent/turn') {
          const body = JSON.parse((await readBody(req)).toString());
          return json(res, 200, await hub.run(body, AbortSignal.any([abort.signal, AbortSignal.timeout(610000)])));
        }
        return json(res,503,{ok:false,message:route[1]==='voice/speak'?'请配置独立Qwen TTS服务':'本地ASR/KWS模型未准备好；本插件不依赖dsh-pet'});
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { message: '方法不支持' });
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = resolve(publicRoot, '.' + pathname);
      if (!file.startsWith(publicRoot + sep) || /(^|[\\/])\./.test(pathname)) return json(res, 403, { message: '路径非法' });
      if (!(await stat(file)).isFile()) return json(res, 404, { message: '资源未找到' });
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      json(res, error.code === 'ENOENT' ? 404 : 502, { ok: false, message: error.code === 'ENOENT' ? '资源未找到' : '服务请求失败：' + error.message });
    }
  });
  // Forward only actual host events; retry quietly while DSH is restarting.
  const eventsAbort = new AbortController();
  let retryTimer;
  async function connectEvents() {
    try {
      const response = await fetch(new URL('/events', agentBase), { signal: eventsAbort.signal });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('任务桥事件未就绪');
      const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
      while (!eventsAbort.signal.aborted) {
        const part = await reader.read(); if (part.done) break;
        pending += decoder.decode(part.value, { stream: true });
        if (pending.length > 256000) throw new Error('事件过长');
        while (pending.includes('\n\n')) {
          const end = pending.indexOf('\n\n'), frame = pending.slice(0, end); pending = pending.slice(end + 2);
          if (frame.startsWith('data: ')) {
            try { publish({ ...JSON.parse(frame.slice(6)), backend: 'dsh' }); } catch { /* malformed host event */ }
          }
        }
      }
    } catch { /* health exposes availability */ }
    if (!eventsAbort.signal.aborted) retryTimer = setTimeout(connectEvents, 2000);
  }
  server.on('listening', () => {
    void connectEvents();
    if(speech.available)void speech.warmup().then(status=>publish({type:'speech.ready',...status})).catch(error=>publish({type:'speech.failed',message:error.message}));
  });
  server.on('close', () => { eventsAbort.abort(); clearTimeout(retryTimer); });
  server.on('close', () => speech.close());
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createPetServer();
  server.listen(Number(process.env.DFY_PORT || 57832), '127.0.0.1', () => console.log(`大肥鱼桌宠：http://127.0.0.1:${server.address().port}`));
}
