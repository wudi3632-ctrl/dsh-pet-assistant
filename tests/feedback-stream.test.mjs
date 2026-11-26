import test from 'node:test';
import assert from 'node:assert/strict';
import {PCMFrames} from '../public/pcm.mjs';
import {withTaskFeedback} from '../public/task-feedback.mjs';
import {replyText} from '../public/reply-text.mjs';
test('host formatting becomes matching readable subtitle/TTS text without losing results',()=>{
  assert.equal(replyText('搞定～<data>语音验收.txt</data>\n- **系统版本**：`Windows 11`'),'搞定～语音验收.txt\n系统版本：Windows 11');
  assert.equal(replyText('## 结果\n[查看文件](/tmp/result.txt)\n```text\n版本 26100\n```'),'结果\n查看文件\n\n版本 26100');
  assert.equal(replyText('a < b，2 ** 3 = 8'),'a < b，2 ** 3 = 8');
});
test('stream parser handles every byte boundary, terminal and corruption',()=>{
  const bytes=Buffer.alloc(12);bytes.writeUInt32LE(4);bytes.writeInt16LE(16384,4);bytes.writeInt16LE(-16384,6);
  const parser=new PCMFrames(),frames=[];
  for(const byte of bytes)frames.push(...parser.push(Uint8Array.of(byte)));
  parser.finish();assert.deepEqual([...frames[0]],[.5,-.5]);
  assert.throws(()=>parser.push(Uint8Array.of(1)),/尾部/);
  const truncated=new PCMFrames();truncated.push(bytes.subarray(0,9));assert.throws(()=>truncated.finish(),/不完整/);
  const corrupt=new PCMFrames();assert.throws(()=>corrupt.push(Uint8Array.of(3,0,0,0)),/损坏/);
});
test('acknowledgement runs alongside execution, result waits without overlapping speech',async()=>{
  let release;const ack=new Promise(r=>release=r);let dispatched=false,finished=false;
  const pending=withTaskFeedback({run:async()=>{dispatched=true;return 'actual result';},acknowledge:()=>ack,current:()=>true}).then(r=>{finished=true;return r;});
  await Promise.resolve();assert.equal(dispatched,true);assert.equal(finished,false);release();assert.equal(await pending,'actual result');
});
test('TTS failure does not fail execution; interrupted turns cannot report completion',async()=>{
  assert.equal(await withTaskFeedback({run:async()=>42,acknowledge:()=>{throw Error('TTS offline');},current:()=>true}),42);
  assert.equal(await withTaskFeedback({run:async()=>42,acknowledge:async()=>{},current:()=>false}),null);
  await assert.rejects(withTaskFeedback({run:async()=>{throw Error('host unavailable');},acknowledge:async()=>{},current:()=>true}),/host unavailable/);
});
