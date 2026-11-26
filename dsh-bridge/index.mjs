// Independent Cordis plugin: DSH owns the session, tools, model and permissions.
import http from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import { claimVoice } from '../plugin/ownership.mjs';
export const name = 'dashifeiyu-original-pet-bridge';
export const inject = ['agentDefaultModel'];
export function apply(ctx, config = {}) {
  const clients = new Set(), turns = new Map();
  let active = null, sequence = 0;
  let releaseVoice=null;
  const instanceId=randomUUID(),root=config.ownershipRoot||fileURLToPath(new URL('../',import.meta.url));
  const statePath=join(root,'.runtime/dsh-session.json');
  let sessionId=config.sessionId||'session-dashifeiyu-original-pet',workspaceId=null;
  if(config.ensureWorkspace)try{const saved=JSON.parse(readFileSync(statePath));sessionId=saved.sessionId;workspaceId=saved.workspaceId;}catch{}
  const uiClients=new Set();let uiRevealed=null;const uiWaiters=new Map();
  async function prepareSession(service){
    if(!config.ensureWorkspace)return;
    const workspaces=ctx.get?.('workspaceController',false)||ctx.workspaceController;
    if(!workspaces?.create)throw Error('DSH工作区服务未就绪');
    const workspace=await workspaces.create({path:config.cwd});workspaceId=workspace.workspace.workspaceId;
    if(workspaces.rename)await workspaces.rename({workspaceId,title:'桌宠语音'});
    const old=await service.resolveAgent(sessionId);
    if('error' in old||!workspace.workspace.sessionIds.includes(sessionId)){
      const created=await service.create({workspaceId});sessionId=created.sessionId;
      if(typeof sessionId!=='string')throw Error('DSH未返回创建的会话ID');
    }
    mkdirSync(join(root,'.runtime'),{recursive:true});writeFileSync(statePath,JSON.stringify({sessionId,workspaceId}));
  }
  function reveal(){
    if(!config.requireUI)return Promise.resolve();
    if(!uiClients.size)throw Error('DSH桌宠客户端尚未加载，请重载DSH插件或刷新DSH界面；不会在隐藏会话执行');
    const requestId=randomUUID();
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{uiWaiters.delete(requestId);reject(Error('DSH界面没有确认打开桌宠会话，本次任务尚未执行'));},5000);uiWaiters.set(requestId,{sessionId,resolve:()=>{clearTimeout(timer);uiWaiters.delete(requestId);resolve();}});for(const client of uiClients)client.write('data: '+JSON.stringify({type:'ui.open-session',sessionId,workspaceId,requestId})+'\n\n');});
  }
  const getController = () => typeof ctx.get === 'function' ? ctx.get('sessionController', false) : ctx.sessionController;
  const publish = event => { const value = { ...event, turnId: active?.turnId, seq: ++sequence }; for (const client of clients) client.write(`data: ${JSON.stringify(value)}\n\n`); };
  const send = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  ctx.effect(() => {
    const off = ctx.on('session/event', (session, event) => {
      if (!active || (session?.header?.id ?? session?.id) !== sessionId) return;
      if (event?.type === 'assistant/message') {
        const content = event.data?.message?.content;
        if (Array.isArray(content)) {
          const text = content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
          if (text.trim()) active.reply = text.trim();
        }
      }
      if (event?.type === 'tool/call') publish({ type: 'tool.started', text: String(event.data?.name || '执行工具') });
      if (event?.type === 'approval/asked') publish({ type: 'approval.required', text: String(event.data?.reason || '请在DSH中确认操作') });
      if (event?.type === 'turn/end' && event.data?.reason?.kind === 'error') active.error = event.data.reason.error?.message || 'DSH任务失败';
    });
    const server = http.createServer(async (req, res) => {
      try {
        if ((req.headers.origin&&!(config.allowedOrigins?.()||[]).includes(req.headers.origin)) || !/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) return send(res, 403, { ok: false, message: '只允许本机桌宠服务连接' });
        const path = new URL(req.url, 'http://localhost').pathname;
        if(req.headers.origin){res.setHeader('access-control-allow-origin',req.headers.origin);res.setHeader('vary','Origin');}
        if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'x-pet-client,content-type'});return res.end();}
        const service = getController();
        if(path==='/ui/events'&&req.method==='GET'){
          res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});res.write(': connected\n\n');uiClients.add(res);
          const heartbeat=setInterval(()=>res.write(': alive\n\n'),15000);req.on('close',()=>{uiClients.delete(res);clearInterval(heartbeat);});return;
        }
        if(path.startsWith('/ui/')&&req.method==='POST'){
          if(req.headers['x-pet-client']!=='1')return send(res,403,{ok:false,message:'缺少桌宠标识'});
          if(path==='/ui/ack'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw Error('确认过长');}const ack=JSON.parse(raw),pending=uiWaiters.get(ack.requestId);if(pending&&ack.sessionId===pending.sessionId&&ack.ok===true){uiRevealed={sessionId,at:Date.now()};pending.resolve();}return send(res,200,{ok:true});}
          const action=path.slice(4);if(['start','stop','show','settings'].includes(action)){await config.control?.(action);return send(res,200,{ok:true});}
          if(action==='open'){await prepareSession(service);await reveal();return send(res,200,{ok:true,sessionId});}
        }
        if (path === '/health' && req.method === 'GET') return send(res, 200, { ok: true, available: Boolean(service?.prompt && service?.resolveAgent), enabled:Boolean(releaseVoice),busy:Boolean(active),sessionId,workspace:config.cwd||resolve(process.cwd(),'dsh-pet-workspace'),pluginVersion:'0.3.0',workspaceId,uiConnected:uiClients.size>0,uiRevealed,desktop:await config.desktopStatus?.() });
        if(path==='/deactivate'&&req.method==='POST'){
          if(req.headers['x-pet-client']!=='1')return send(res,403,{ok:false,message:'缺少桌宠客户端标识'});
          if(active)return send(res,409,{ok:false,message:'DSH任务正在执行，请先停止任务再停用'});
          releaseVoice?.();releaseVoice=null;return send(res,200,{ok:true});
        }
        if (path === '/events' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.write(': connected\n\n'); clients.add(res);
          const timer = setInterval(() => res.write(': alive\n\n'), 15000);
          res.on('close', () => { clients.delete(res); clearInterval(timer); }); return;
        }
        if (path !== '/turn' || req.method !== 'POST') return send(res, 404, { ok: false, message: '路由不存在' });
        if (req.headers['x-pet-client'] !== '1') return send(res, 403, { ok: false, message: '缺少桌宠客户端标识' });
        if (!service?.prompt || !service?.resolveAgent) return send(res, 503, { ok: false, message: 'DSH Session Controller未就绪' });
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16000) throw new Error('正文过长'); }
        const body = JSON.parse(raw);
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text || text.length > 2000 || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.turnId || '')) return send(res, 400, { ok: false, message: '任务文本或turnId非法' });
        if (turns.has(body.turnId)) return send(res, 200, await turns.get(body.turnId));
        if (active) return send(res, 409, { ok: false, message: 'DSH正在收尾上一回合，请稍后再说' });
        const abort = new AbortController(); const close = () => { if (!res.writableEnded) abort.abort(); }; res.on('close', close);
        const run = async () => {
          active = { turnId: body.turnId, reply: '', error: '' }; sequence = 0;
          try {
            await prepareSession(service);await reveal();
            releaseVoice ||= await claimVoice({root,host:'dsh',instanceId});
            let resolved = await service.resolveAgent(sessionId);
            if ('error' in resolved) {
              const created=await service.create({ sessionId, cwd: config.cwd || resolve(process.cwd(), 'dsh-pet-workspace') });
              if(created?.sessionId)sessionId=created.sessionId;
              if(created&&'error' in created)throw new Error('无法创建桌宠工作区会话：'+String(created.error?.message||created.error));
            }
            const selection = ctx.agentDefaultModel.currentSelection();
            await service.selectModel({ sessionId, provider: selection.provider, model: selection.model, reasoningEffort: 'low' });
            publish({ type: 'turn.accepted', text }); publish({ type: 'turn.thinking' });
            const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(600000)]);
            const accepted = await service.prompt({ sessionId, requestId: body.turnId, mode: 'followup', content: [{ type: 'text', text: '你是用户的桌宠助手。自然简洁地回应。电脑操作交给当前DSH可用工具，遵循宿主权限流程，根据实际工具结果汇报；没有执行或验证的事情不能声称完成。\n\n' + text }], clientTimeZone: 'Asia/Shanghai' }, signal);
            if (!accepted.accepted) throw new Error('DSH未接受回合');
            resolved = await service.resolveAgent(sessionId); if ('error' in resolved) throw new Error('会话不可用');
            let rejectAbort;
            try {
              await Promise.race([resolved.agent.whenIdle(), new Promise((_, reject) => { rejectAbort = () => reject(new Error('回合已中止或超时')); if (signal.aborted) rejectAbort(); else signal.addEventListener('abort', rejectAbort, { once: true }); })]);
            } finally { signal.removeEventListener('abort', rejectAbort); }
            if (active.error) throw new Error(active.error);
            if (!active.reply) throw new Error('DSH未返回正文');
            const result = { ok: true, sessionId, text: active.reply };
            publish({type:'turn.replied'});
            return result;
          } catch (error) { publish({ type: 'turn.failed', message: error.message }); return { ok: false, message: error.message }; }
          finally { active = null; }
        };
        const pending = run(); turns.set(body.turnId, pending);
        while (turns.size > 64) turns.delete(turns.keys().next().value);
        const result = await pending; res.off('close', close);
        if (!res.destroyed) send(res, result.ok ? 200 : 502, result);
      } catch (error) { if (!res.headersSent && !res.destroyed) send(res, 500, { ok: false, message: error.message }); }
    });
    server.on('error', error => ctx.logger?.warn?.('大肥鱼任务桥启动失败：' + error.message));
    server.listen(Number(config.port ?? 57833), '127.0.0.1');
    return () => { releaseVoice?.();releaseVoice=null;off?.(); for (const client of [...clients,...uiClients]) client.end(); server.closeAllConnections(); server.close(); };
  }, 'dashifeiyu original pet bridge');
}
