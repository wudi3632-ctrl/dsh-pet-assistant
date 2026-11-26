import test from 'node:test';
import assert from 'node:assert/strict';
import {wakeWordsFor,wakeEnabledHint,stripWake,PetState} from '../public/core.mjs';
import {VoiceInput} from '../public/voice.mjs';
import {faceCenter,mirrorMask} from '../public/facing.mjs';
test('character wake words and prefix removal change together',()=>{
  assert.deepEqual(wakeWordsFor({id:'dog',name:'小鸡毛'}),['小鸡毛']);
  assert.equal(wakeEnabledHint(['小鸡毛']),'语音唤醒已开启，可以叫“小鸡毛”。');
  assert.ok(wakeWordsFor({id:'dashifeiyu'}).includes('鲸鲸'));
  assert.equal(stripWake('小鸡毛，打开记事本','小鸡毛',['小鸡毛']),'打开记事本');
  assert.equal(stripWake('小金毛打开记事本','小鸡毛',['小鸡毛']),'打开记事本');
  assert.equal(stripWake('小金毛打开记事本','',['小鸡毛']),'小金毛打开记事本');
  assert.equal(stripWake('打开小鸡毛的文件','','小鸡毛'.split()),'打开小鸡毛的文件');
  assert.equal(stripWake('大肥鱼，打开记事本','',['小鸡毛']),'大肥鱼，打开记事本');
});
test('switching character rejects old and in-flight wake detections without stopping microphone',async()=>{
  const events=[];let finish;
  const voice=new VoiceInput({state:new PetState(),request:()=>new Promise(r=>finish=r),emit:e=>events.push(e),interrupt(){},report(){},level(){}});
  voice.running=true;voice.pre=[];
  const pending=voice.keyword(new Float32Array(100));voice.setWakeWords(['小鸡毛']);finish({keyword:'大肥鱼'});await pending;
  assert.equal(events.length,0);assert.equal(voice.running,true);assert.equal(voice.kwsBusy,false);
  voice.request=async()=>({keyword:'大肥鱼'});await voice.keyword(new Float32Array(100));assert.equal(events.length,0);
  voice.request=async()=>({keyword:'小鸡毛'});await voice.keyword(new Float32Array(100));assert.equal(events.at(-1).type,'voice.wake');
});
test('auto facing uses screen center and hysteresis; transparent hit mask follows mirrored image',()=>{
  assert.equal(faceCenter(100,500),'right');assert.equal(faceCenter(900,500),'left');
  assert.equal(faceCenter(510,500,'right'),'right');assert.equal(faceCenter(490,500,'left'),'left');
  assert.deepEqual(mirrorMask([1,0,0,0],2),[0,1,0,0]);
});
