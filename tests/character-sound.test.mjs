import test from 'node:test';
import assert from 'node:assert/strict';
import {CharacterSound} from '../public/character-sound.mjs';
test('character clips: no TTS, overlap prevention, pet/task/ambient cooldown and cancellation',async()=>{
  let time=0;const sounds=[],events=[];
  const engine=new CharacterSound(e=>events.push(e),{now:()=>time,audio:src=>{const a={src,play:async()=>{a.onplaying();},pause(){},removeAttribute(){},load(){}};sounds.push(a);return a;}});
  assert.equal(await engine.play(),false);
  engine.configure({mode:'clip',src:'/bark.wav',minGapMs:8000});
  let playing=engine.play('pet');assert.equal(await engine.play('pet'),false);sounds.at(-1).onended();assert.equal(await playing,true);
  time=7999;assert.equal(await engine.play('pet'),false);
  time=8000;playing=engine.play('task.ack');sounds.at(-1).onended();await playing;
  time=17000;assert.equal(await engine.play('task.result'),false);
  time=53000;playing=engine.play('task.result');sounds.at(-1).onended();await playing;
  time=100000;assert.equal(await engine.play('ambient'),false);
  time=233000;playing=engine.play('ambient');engine.configure({mode:'tts'});assert.equal(await playing,false);
  assert.equal(await engine.play('pet'),false);assert.equal(sounds.length,4);
  assert.equal(events.at(-1).type,'sound.ended');
});
