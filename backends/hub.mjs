import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {taskWithReport} from './report.mjs';

export const BACKENDS = ['dsh'];
export function createBackendHub({ settings = {}, agentBase, publish }) {
  const pending = new Map();
  const cwd = settings.cwd || join(homedir(), 'dashifeiyu-pet-workspace');
  async function health() {
    try {
      const r=await fetch(new URL('/health',agentBase),{signal:AbortSignal.timeout(1500)});
      const h=await r.json();const ready=r.ok&&h.available===true&&h.uiConnected!==false;
      return [{id:'dsh',label:'DSH',installed:true,available:ready,busy:h.busy===true,phase:ready?(h.busy?'busy':'ready'):'unavailable',transport:'dsh-session-bridge',detail:ready?'专属会话自动接收任务，无需聊天持续等待':h.available&&h.uiConnected===false?'DSH桌宠客户端未加载，请刷新DSH界面':'DSH任务控制器未就绪',sessionId:h.sessionId}];
    } catch {return [{id:'dsh',label:'DSH',installed:true,available:false,phase:'disconnected',transport:'dsh-session-bridge',detail:'DSH任务桥未连接，请启动DSH并确认桌宠插件已加载'}];}
  }

  async function run(body, signal) {
    const id = body.backend || settings.defaultBackend || 'dsh';
    if(settings.lockHost&&id!==settings.lockHost)throw new Error('当前桌宠绑定 '+settings.lockHost+' 插件，请从目标宿主启用对应插件');
    if (!BACKENDS.includes(id)) throw new Error('未知任务后端');
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000 || !/^[a-zA-Z0-9_-]{1,80}$/.test(body.turnId || '')) throw new Error('任务文本或回合ID非法');
    const key = id + ':' + body.turnId;
    if (pending.has(key)) return pending.get(key);
    const execute = async () => {
      await mkdir(cwd, { recursive: true });
      const response = await fetch(new URL('/turn', agentBase), { method: 'POST', headers: { 'content-type': 'application/json', 'x-pet-client': '1' }, body: JSON.stringify({...body,text:taskWithReport(body.text)}), signal });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.message || 'DSH任务失败');
      return { ...result, backend: id };
    };
    const task = execute(); pending.set(key, task);
    while (pending.size > 64) pending.delete(pending.keys().next().value);
    return task;
  }
  return { health, run };
}
