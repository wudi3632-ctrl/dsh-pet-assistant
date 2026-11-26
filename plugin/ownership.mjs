import {existsSync,mkdirSync,openSync,writeFileSync,closeSync,readFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
// One explicitly activated voice owner per project, regardless of host/chat.
export async function claimVoice({root,host,instanceId}){
  const dir=join(root,'.runtime/plugin-hosts');mkdirSync(dir,{recursive:true});
  const path=join(dir,'voice-owner.json');let claimed=false;
  const release=()=>{try{if(JSON.parse(readFileSync(path,'utf8')).instanceId===instanceId)unlinkSync(path);}catch{}};
  for(let attempt=0;attempt<3;attempt++){
    try{
      const fd=openSync(path,'wx');
      try{writeFileSync(fd,JSON.stringify({pid:process.pid,host,instanceId}));}finally{closeSync(fd);}
      claimed=true;break;
    }catch(e){
      if(e.code!=='EEXIST')throw e;
      let owner;try{owner=JSON.parse(readFileSync(path,'utf8'));}catch{throw new Error('另一个原生会话正在启用大肥鱼，请稍后再试');}
      if(owner.instanceId===instanceId)return ()=>release();
      if(alive(owner.pid))throw new Error(`大肥鱼已由 ${owner.host} 的另一个原生会话启用，请先在那个会话停用；不会抢占麦克风或任务`);
      let recovery;
      try{
        recovery=openSync(path+'.recovery','wx');
        const latest=JSON.parse(readFileSync(path,'utf8'));
        if(alive(latest.pid))throw new Error('另一个原生会话已取得归属，请先停用它');
        unlinkSync(path);
      }catch(err){if(err.code==='EEXIST')throw new Error('正在回收失效会话归属，请稍后再试');if(err.code!=='ENOENT')throw err;}
      finally{if(recovery!==undefined){closeSync(recovery);try{unlinkSync(path+'.recovery');}catch{}}}
    }
  }
  if(!claimed)throw new Error('无法取得桌宠语音归属');
  try{
    // Detect an already-running pre-lock plugin before migrating its descriptor.
    for(const candidate of ['workbuddy','codex']){
      const file=join(dir,candidate+'.json');if(!existsSync(file))continue;
      let d;try{d=JSON.parse(readFileSync(file,'utf8'));}catch{continue;}
      if(d.instanceId===instanceId||!alive(d.pid))continue;
      const url=new URL(d.base);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')continue;
      let h;try{h=await(await fetch(new URL('/health',url),{headers:{'x-pet-capability':d.capability},redirect:'error',signal:AbortSignal.timeout(1000)})).json();}catch{continue;}
      if(h.enabled)throw new Error(`${candidate} 的现有语音会话仍在运行，请先停用，不能覆盖它的配对`);
    }
    return release;
  }catch(e){release();throw e;}
}
