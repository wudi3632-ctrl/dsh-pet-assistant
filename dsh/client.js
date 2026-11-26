window.__ModuleLoader__.load({id:'dsh-dashifeiyu-pet',factory(require){
  const React=require('react'),h=React.createElement;
  return {inject:['slots','uiWorkspace'],apply(ctx){
    const base='http://127.0.0.1:57833';
    async function call(action,payload={}){const r=await fetch(base+'/ui/'+action,{method:'POST',headers:{'content-type':'application/json','x-pet-client':'1'},body:JSON.stringify(payload)});const result=await r.json();if(!r.ok||result.ok===false)throw Error(result.message||'桌宠请求失败');return result;}
    const source=new EventSource(base+'/ui/events');
    source.onmessage=event=>{void(async()=>{const message=JSON.parse(event.data);if(message.type!=='ui.open-session')return;ctx.uiWorkspace.openSession(message.sessionId);const selected=ctx.uiWorkspace.selection.getSnapshot().sessionId;if(selected!==message.sessionId)throw Error('DSH会话导航未生效');window.focus();await call('ack',{requestId:message.requestId,sessionId:selected,ok:true});})().catch(e=>console.error('[DSH桌宠]',e.message));};
    ctx.effect(()=>()=>source.close());
    function Panel(){
      const [status,setStatus]=React.useState('正在检查桌宠…'),[busy,setBusy]=React.useState(false);
      React.useEffect(()=>{let live=true;const refresh=()=>fetch(base+'/health').then(r=>r.json()).then(v=>{if(live)setStatus(v.desktop?.running?'桌宠已运行 · '+(v.uiConnected?'会话已连接':'等待客户端'):'桌宠已停止');}).catch(()=>{if(live)setStatus('宿主插件未就绪，请重载插件');});refresh();const timer=setInterval(refresh,3000);return()=>{live=false;clearInterval(timer);};},[]);
      const button=(label,action)=>h('button',{disabled:busy,style:{font:'inherit',fontSize:13,padding:'8px 12px',borderRadius:10,border:'1px solid var(--dsw-alias-border-l2,#555)',background:'var(--dsw-alias-fill-secondary,#292929)',color:'inherit',cursor:'pointer'},onClick:async()=>{setBusy(true);try{await call(action);setStatus('操作已提交');}catch(e){setStatus(e.message);}finally{setBusy(false);}}},label);
      return h('section',{style:{padding:16,display:'grid',gap:12}},h('h3',null,'大肥鱼桌宠'),h('p',{role:'status'},status),h('p',null,'独立 WebM 桌宠。大肥鱼用 TTS，小鸡毛用本地狗叫；任务在“桌宠语音”工作区执行。'),h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},button('启用 / 显示桌宠','start'),button('桌宠设置','settings'),button('打开任务会话','open'),button('退出桌宠','stop')));
    }
    ctx.slots.inject('settings.plugins.tab',()=>ctx.slots.register({name:'settings.plugins.tab',id:'dashifeiyu-pet',label:'桌宠',order:20},Panel));
    ctx.slots.inject('plugins.bundle.config',()=>ctx.slots.register({name:'plugins.bundle.config',key:'dsh-dashifeiyu-pet'},Panel));
  }};
}});

