import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import vm from 'node:vm';import http from 'node:http';
import {apply} from '../dsh-bridge/index.mjs';import {VoiceInput} from '../public/voice.mjs';import {PetState} from '../public/core.mjs';
test('DSH client package registers a visible tab and acknowledges only the session actually selected',async()=>{
 const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));assert.equal(manifest.name,'dsh-dashifeiyu-pet');assert.ok(manifest.dsh.bundle.patch);assert.ok(manifest.exports['./client']);
 let mod,stream,selected,tab;const requests=[];
 class Events{constructor(){stream=this;}close(){}}
 const context={window:{__ModuleLoader__:{load:v=>mod=v.factory(()=>({}))},focus(){}},EventSource:Events,fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true})};},console};
 vm.runInNewContext(readFileSync(new URL('../dsh/client.js',import.meta.url),'utf8'),context);
 const ctx={effect(){},uiWorkspace:{openSession:id=>selected=id,selection:{getSnapshot:()=>({sessionId:selected})}},slots:{inject:(_name,fn)=>fn(),register:row=>{if(row.id)tab=row;}}};mod.apply(ctx);assert.equal(tab.id,'dashifeiyu-pet');
 stream.onmessage({data:JSON.stringify({type:'ui.open-session',sessionId:'real-id',requestId:'r1'})});await new Promise(r=>setImmediate(r));assert.equal(selected,'real-id');assert.equal(requests[0].ok,true);
});
test('ASR stops being busy before slow agent execution completes',async()=>{
 let submitted=false;const voice=new VoiceInput({state:new PetState(),request:async()=>({text:'打开记事本',decodeMs:12}),report(){},emit(){},submit:()=>{submitted=true;return new Promise(()=>{});}});
 await voice.transcribe(new Float32Array(16000));assert.equal(submitted,true);assert.equal(voice.busy,false);assert.equal(voice.lastMetrics.decodeMs,12);
});
test('visible workspace session uses actual created id and refuses hidden execution until client ack',async t=>{
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 let cleanup,listener,prompts=0;const ids=[];const service={resolveAgent:async id=>ids.includes(id)?{agent:{whenIdle:async()=>{}}}:{error:'missing'},create:async()=>{ids.push('actual-new-session');return {sessionId:'actual-new-session'};},selectModel:async()=>{},prompt:async req=>{prompts++;assert.equal(req.sessionId,'actual-new-session');listener({id:req.sessionId},{type:'assistant/message',data:{message:{content:[{type:'text',text:'真实会话结果'}]}}});return {accepted:true};}};
 const workspace={create:async()=>({workspace:{workspaceId:'pet-workspace',sessionIds:[...ids]}}),rename:async()=>{}};
 apply({get:name=>name==='workspaceController'?workspace:service,agentDefaultModel:{currentSelection:()=>({provider:'test',model:'test'})},on:(_name,fn)=>{listener=fn;return()=>{};},effect:fn=>cleanup=fn()},{port,ownershipRoot:mkdtempSync(join(tmpdir(),'dsh-package-')),cwd:tmpdir(),ensureWorkspace:true,requireUI:true,allowedOrigins:()=>['dsh-app://app']});t.after(()=>cleanup());
 const base='http://127.0.0.1:'+port,post=(path,body)=>fetch(base+path,{method:'POST',headers:{'x-pet-client':'1','content-type':'application/json'},body:JSON.stringify(body)});
 const blocked=await post('/turn',{turnId:'without-ui',text:'不能隐藏执行'});assert.equal(blocked.status,502);assert.equal(prompts,0);
 const abort=new AbortController();t.after(()=>abort.abort());const feed=await fetch(base+'/ui/events',{signal:abort.signal,headers:{origin:'dsh-app://app'}});assert.equal(feed.headers.get('access-control-allow-origin'),'dsh-app://app');const reader=feed.body.getReader();
 const result=post('/turn',{turnId:'with-ui',text:'打开可见会话'});let frames='';while(!frames.includes('ui.open-session'))frames+=new TextDecoder().decode((await reader.read()).value);
 const message=JSON.parse(frames.split('\n').find(l=>l.startsWith('data: ')).slice(6));await post('/ui/ack',{...message,ok:true});const reply=await(await result).json();assert.equal(reply.sessionId,'actual-new-session');assert.equal(reply.text,'真实会话结果');assert.equal(prompts,1);await reader.cancel();
});
