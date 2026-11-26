import test from 'node:test';
import assert from 'node:assert/strict';
import {framedPCMToWav} from '../speech/tts.mjs';
test('Qwen framed PCM becomes valid WAV; rejects truncated synthesis',()=>{
  const frames=Buffer.from([4,0,0,0,1,0,2,0,0,0,0,0]);
  const wav=framedPCMToWav(frames,24000);
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(40),4);assert.equal(wav.length,48);assert.equal(wav.readUInt32LE(24),24000);
  assert.throws(()=>framedPCMToWav(frames.subarray(0,8)),/不完整/);
  assert.throws(()=>framedPCMToWav(Buffer.from([5,0,0,0,1,2])),/损坏/);
});
