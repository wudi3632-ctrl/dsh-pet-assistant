import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPetServer} from '../server.mjs';
test('DSH-only runtime ignores stale host config and rejects other host tasks',async t=>{
  assert.throws(()=>createPetServer({host:'workbuddy'}),/DSH专用/);
  let healthCalls=0;
  const bridge=http.createServer((req,res)=>{if(req.url==='/health')healthCalls++;res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,available:true,sessionId:'dedicated',text:'DSH结果'}));});
  await new Promise(r=>bridge.listen(0,'127.0.0.1',r));
  const server=createPetServer({agent:'http://127.0.0.1:'+bridge.address().port,control:()=>{}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();bridge.closeAllConnections();bridge.close();});
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await(await fetch(base+'/api/desktop/status')).json()).desktop,true);assert.equal(healthCalls,0,'desktop liveness must not recurse into host health');
  const h=await(await fetch(base+'/api/backends')).json();assert.equal(h.integration,'dsh-plugin');assert.equal(h.lockedHost,'dsh');assert.deepEqual(h.backends.map(b=>b.id),['dsh']);
  const options={method:'POST',headers:{'x-pet-client':'1','content-type':'application/json'}};
  const rejected=await fetch(base+'/api/turn',{...options,body:JSON.stringify({backend:'codex',text:'不能转发',turnId:'old-host'})});assert.equal(rejected.status,502);
  const success=await(await fetch(base+'/api/turn',{...options,body:JSON.stringify({text:'直接执行',turnId:'new-dsh'})})).json();assert.equal(success.text,'DSH结果');
});
