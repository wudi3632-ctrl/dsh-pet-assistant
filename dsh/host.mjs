import {readFileSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {apply as bridge} from '../dsh-bridge/index.mjs';
import {readSettings,findElectron} from '../scripts/runtime.mjs';
export const name='dashifeiyu-pet';
export const inject=['agentDefaultModel','sessionController','workspaceController','webServer'];
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function apply(ctx,config={}){
  const settings=readSettings(root),cwd=config.cwd||settings.cwd||join(homedir(),'dashifeiyu-pet-workspace');
  mkdirSync(cwd,{recursive:true});
  async function desktopStatus(){try{const state=JSON.parse(readFileSync(join(root,'artifacts/desktop-state.json')));if(state.root!==root)return {running:false};const r=await fetch(state.base+'/api/desktop/status',{signal:AbortSignal.timeout(1200)});const info=await r.json();return {running:r.ok&&info.desktop===true&&info.pid===state.pid,base:state.base,revision:'host-2'};}catch{return {running:false};}}
  async function performControl(action){
    const status=await desktopStatus();
    if(!status.running){
      if(action==='stop')return;
      const electron=findElectron(root,settings);if(!electron)throw Error('请先准备Electron运行时，详见INSTALL.md');
      mkdirSync(join(root,'artifacts'),{recursive:true});const fd=openSync(join(root,'artifacts/dsh-desktop.log'),'a');
      const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
      const child=spawn(electron,[join(root,'desktop/main.cjs'),'--show'],{cwd:root,env,windowsHide:true,stdio:['ignore',fd,fd]});closeSync(fd);child.on('error',e=>ctx.logger?.warn?.('桌宠启动失败：'+e.message));child.unref();
      for(let i=0;i<50;i++){if((await desktopStatus()).running)return;await new Promise(resolve=>setTimeout(resolve,100));}
      throw Error('桌宠启动后没有就绪，请检查artifacts/dsh-desktop.log');
    }
    const r=await fetch(status.base+'/api/desktop/control',{method:'POST',headers:{'content-type':'application/json','x-pet-client':'1'},body:JSON.stringify({action:action==='start'?'show':action}),signal:AbortSignal.timeout(2000)});if(!r.ok)throw Error('桌宠控制失败：'+r.status);
    if(action==='stop')for(let i=0;i<25&&(await desktopStatus()).running;i++)await new Promise(resolve=>setTimeout(resolve,100));
  }
  const queue=globalThis[Symbol.for('dsh-pet-control:'+root)]||={tail:Promise.resolve()};
  function control(action){const next=queue.tail.catch(()=>{}).then(()=>performControl(action));queue.tail=next;return next;}
  bridge(ctx,{...config,cwd,ensureWorkspace:true,requireUI:true,allowedOrigins:()=>['dsh-app://app',ctx.webServer.getOrigin()],desktopStatus,control});
  ctx.effect(()=>()=>control('stop').catch(()=>{}));
  if(config.autoStart!==false)void control('start').catch(e=>ctx.logger?.warn?.(e.message));
}
