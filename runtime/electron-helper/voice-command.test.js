'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  correctKnownTerms, wakeMatch, parseMessageIntent, messageFollowupContent, vadProfile, windowsPlanBody,
  browserSearchIntent, closeApplicationIntent, delegatedDesktopFastPath, routeVoiceIntent, sessionCanHearWithoutWake,
  resolveActiveMs, voiceCaptureMode, createTurnGate,
} = require('./voice-command.js');

test('preserves message content after the wake word', () => {
  const match = wakeMatch('大肥鱼，给微信列表里的欢欢大王发消息：今晚八点见。', ['大肥鱼', '鲸鲸', '小鲸鱼', '小鲸']);
  assert.equal(match.word, '大肥鱼');
  assert.equal(match.rawCommand, '给微信列表里的欢欢大王发消息：今晚八点见。');
});

test('parses one-shot and follow-up message requests', () => {
  assert.deepEqual(parseMessageIntent('给微信列表里的欢欢大王发消息：今晚八点见'), {
    app: 'wechat', appName: '微信', recipient: '欢欢大王', content: '今晚八点见',
  });
  assert.deepEqual(parseMessageIntent('用QQ给张三发一个消息'), {
    app: 'qq', appName: 'QQ', recipient: '张三', content: '',
  });
  assert.deepEqual(parseMessageIntent('打开微信给李四发消息：收到请回复'), {
    app: 'wechat', appName: '微信', recipient: '李四', content: '收到请回复',
  });
});

test('applies conservative known-term correction and UU VAD floor', () => {
  assert.equal(correctKnownTerms('打开微性和记术本'), '打开微信和记事本');
  assert.deepEqual(vadProfile('麦克风阵列 (UU远程虚拟音频设备)', 'UU远程'), {
    remoteVirtual: true, silenceMs: 900, startFloor: 0.012, continueFloor: 0.0065,
  });
});

test('accepts the bracketed windows plan emitted by the visual model', () => {
  const body = windowsPlanBody('先填进去~\n[windows_plan]{"goal":"发消息","steps":[{"type":"type_text"}],"requiresConfirmation":false}');
  assert.equal(JSON.parse(body).goal, '发消息');
});

test('removes spoken connectors from the recipient name', () => {
  assert.deepEqual(parseMessageIntent('打开微信并给欢欢老大发消息：你到哪儿了'), {
    app: 'wechat', appName: '微信', recipient: '欢欢老大', content: '你到哪儿了',
  });
});

test('handles ASR filler and pronoun follow-up used in the failed real task', () => {
  assert.deepEqual(parseMessageIntent('一给欢欢老大发个消息'), {
    app: 'wechat', appName: '微信', recipient: '欢欢老大', content: '',
  });
  assert.equal(messageFollowupContent('给他发太厉害了', '欢欢老大'), '太厉害了');
  assert.equal(messageFollowupContent('内容是今晚八点见', '欢欢老大'), '今晚八点见');
});

test('routes natural browser and weather requests into real Windows work', () => {
  assert.equal(browserSearchIntent('去看一下今天成都的天气预报').query, '今天成都的天气预报');
  assert.equal(browserSearchIntent('这浏览器并搜索成都今天天气').query, '成都今天天气');
  assert.equal(routeVoiceIntent('帮我看看今天成都天气').type, 'windows_task');
  assert.equal(routeVoiceIntent('打开浏览器并搜索成都今天天气').fastPath.query, '成都今天天气');
  assert.equal(routeVoiceIntent('关闭浏览器吧').type, 'windows_task');
  assert.equal(routeVoiceIntent('关掉微信').type, 'windows_task');
  assert.deepEqual(closeApplicationIntent('关闭浏览器吧'), { type: 'close_app', app: 'browser', name: '浏览器' });
  assert.deepEqual(closeApplicationIntent('关掉网易云音乐'), { type: 'close_app_name', name: '网易云音乐' });
  assert.equal(routeVoiceIntent('今天心情怎么样').type, 'chat');
});

test('uses deterministic desktop actions for delegated open and close tasks', () => {
  assert.deepEqual(delegatedDesktopFastPath('打开 Windows 计算器，确认计算器窗口已经显示在桌面最前方后告诉我结果'), {
    goal: '打开 Windows 计算器，确认计算器窗口已经显示在桌面最前方后告诉我结果',
    steps: [{ type: 'open_app', app: 'calculator' }],
  });
  assert.deepEqual(delegatedDesktopFastPath('请关闭浏览器'), {
    goal: '请关闭浏览器',
    steps: [{ type: 'close_app', app: 'browser', name: '浏览器' }],
  });
  assert.equal(delegatedDesktopFastPath('打开浏览器，然后搜索成都天气'), null);
});

test('keeps an active task audible past idle timeout and supports explicit sleep', () => {
  assert.equal(sessionCanHearWithoutWake(31_000, 30_000, { awaitingInput: true }), true);
  assert.equal(sessionCanHearWithoutWake(31_000, 30_000, { awaitingConfirmation: true }), true);
  assert.equal(sessionCanHearWithoutWake(31_000, 30_000, {}), false);
  assert.equal(routeVoiceIntent('休息吧').type, 'sleep');
});

test('honors configured active time with safe bounds', () => {
  assert.equal(resolveActiveMs(undefined), 30000);
  assert.equal(resolveActiveMs(45000), 45000);
  assert.equal(resolveActiveMs(100), 5000);
  assert.equal(resolveActiveMs(999999), 300000);
});

test('uses keyword-only capture during TTS and the post-TTS cooldown', () => {
  assert.equal(voiceCaptureMode(1000, true, 0), 'keyword-only');
  assert.equal(voiceCaptureMode(1200, false, 1350), 'keyword-only');
  assert.equal(voiceCaptureMode(1350, false, 1350), 'normal');
});

test('accepts each final ASR turn exactly once', () => {
  const gate = createTurnGate(2);
  assert.equal(gate.accept('turn-1'), true);
  assert.equal(gate.accept('turn-1'), false);
  assert.equal(gate.accept('turn-2'), true);
  assert.equal(gate.accept('turn-3'), true);
  assert.equal(gate.has('turn-1'), false, 'old ids are evicted from the bounded cache');
});
