import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { apply } from '../dsh-bridge/index.mjs';
import {claimVoice} from '../plugin/ownership.mjs';
test('独立DSH任务桥：专属会话、low推理、回复与同回合去重', async t => {
  const ownershipRoot=await mkdtemp(join(tmpdir(),'dfy-dsh-'));t.after(()=>rm(ownershipRoot,{recursive:true,force:true}));
  const probe = http.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  let listener, calls = 0, selection, cleanup;
  const service = {
    resolveAgent: async () => ({ agent: { whenIdle: async () => {} } }),
    selectModel: async value => { selection = value; },
    prompt: async request => {
      calls++;
      assert.equal(request.sessionId, 'session-dashifeiyu-original-pet');
      listener({ header: { id: request.sessionId } }, { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: '隐藏思考' }, { type: 'text', text: '你好，我是大肥鱼。' }] } } });
      return { accepted: true };
    },
  };
  apply({ get: () => service, on: (_name, fn) => { listener = fn; return () => {}; }, effect: fn => { cleanup = fn(); }, agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'glm-test' }) } }, { port,ownershipRoot });
  t.after(() => cleanup());
  const base = `http://127.0.0.1:${port}`;
  const health = await (await fetch(base + '/health')).json(); assert.equal(health.available, true);
  const eventAbort=new AbortController();t.after(()=>eventAbort.abort());
  const eventFeed=await fetch(base+'/events',{signal:eventAbort.signal});
  const eventReader=eventFeed.body.getReader();let eventText='';
  const request = { method: 'POST', headers: { 'x-pet-client': '1' }, body: JSON.stringify({ text: '你好', turnId: 'unit-turn' }) };
  const response = await (await fetch(base + '/turn', request)).json(); assert.equal(response.text, '你好，我是大肥鱼。');
  while(!eventText.includes('turn.replied')){const chunk=await eventReader.read();assert.equal(chunk.done,false);eventText+=new TextDecoder().decode(chunk.value);}
  assert.match(eventText,/"turnId":"unit-turn"/);await eventReader.cancel();
  assert.equal(selection.reasoningEffort, 'low');
  await fetch(base + '/turn', request); assert.equal(calls, 1);
  assert.equal((await fetch(base + '/turn', { ...request, headers: { ...request.headers, origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(base + '/turn', { ...request, headers: {} })).status, 403);
  const release=await claimVoice({root:ownershipRoot,host:'dsh',instanceId:'second-dsh-test'}).catch(()=>null);
  assert.equal(release,null);
  assert.equal((await fetch(base+'/deactivate',{method:'POST',headers:{'x-pet-client':'1'}})).status,200);
  const resumed=await fetch(base+'/turn',{...request,body:JSON.stringify({text:'恢复',turnId:'dsh-resumed'})});
  assert.equal(resumed.status,200);assert.equal(calls,2);
});
