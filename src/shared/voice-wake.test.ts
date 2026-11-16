import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calibrateVoiceVad,
  matchWakeWord,
  normalizeWakeText,
  parseLocalWindowsIntent,
  voiceBubblePages,
} from './voice-wake.ts';

test('规范化 ASR 标点并命中四个唤醒词', () => {
  assert.equal(normalizeWakeText('  小鲸鱼，打开记事本！ '), '小鲸鱼打开记事本');
  assert.deepEqual(matchWakeWord('小鲸鱼，打开记事本'), { wakeWord: '小鲸鱼', command: '打开记事本' });
  assert.deepEqual(matchWakeWord('鲸鲸！'), { wakeWord: '鲸鲸', command: '' });
  assert.deepEqual(matchWakeWord('大肥鱼 帮我打开微信'), { wakeWord: '大肥鱼', command: '帮我打开微信' });
  assert.deepEqual(matchWakeWord('小鲸，点确认'), { wakeWord: '小鲸', command: '点确认' });
  assert.deepEqual(matchWakeWord('晶晶，打开记事本'), { wakeWord: '鲸鲸', command: '打开记事本' });
  assert.deepEqual(matchWakeWord('小金鱼你好'), { wakeWord: '小鲸鱼', command: '你好' });
});

test('只在句首唤醒且长词优先', () => {
  assert.equal(matchWakeWord('我刚才喊了小鲸'), null);
  assert.equal(matchWakeWord('今天的小鲸鱼真可爱'), null);
  assert.equal(matchWakeWord('小鲸鱼你好')?.wakeWord, '小鲸鱼');
  assert.equal(matchWakeWord('鲸鲸鱼，鲸鲸鱼'), null, '纯唤醒词回声不能误触发');
});

test('解析低风险 Windows 指令，不接受任意应用或危险目标', () => {
  assert.deepEqual(parseLocalWindowsIntent('帮我打开记事本'), { type: 'open_app', app: 'notepad' });
  assert.deepEqual(parseLocalWindowsIntent('点击确认'), { type: 'click', target: '确认' });
  assert.deepEqual(parseLocalWindowsIntent('把图片拖到上传区域'), { type: 'drag', from: '图片', to: '上传区域' });
  assert.deepEqual(parseLocalWindowsIntent('点 120，300'), { type: 'click_point', x: 120, y: 300 });
  assert.deepEqual(parseLocalWindowsIntent('鼠标从 10,20 拖到 300,400'), {
    type: 'drag_point', fromX: 10, fromY: 20, toX: 300, toY: 400,
  });
  assert.equal(parseLocalWindowsIntent('打开 powershell -enc xxx'), null);
  assert.equal(parseLocalWindowsIntent('点击确认; rm -rf'), null);
  assert.equal(parseLocalWindowsIntent('把文件拖到回收站'), null);
});

test('VAD 校准兼容数字静音、低电平实体麦克风与高底噪远控输入', () => {
  assert.deepEqual(calibrateVoiceVad([0, 0, 0]), {
    noiseFloor: 0,
    startThreshold: 0.003,
    continueThreshold: 0.0015,
  });
  const quiet = calibrateVoiceVad([0.002, 0.0025, 0.003, 0.02]);
  assert.ok(quiet.startThreshold < 0.01);
  assert.ok(quiet.continueThreshold < quiet.startThreshold);
  const remote = calibrateVoiceVad([0.03, 0.035, 0.04, 0.5]);
  assert.ok(Math.abs(remote.startThreshold - 0.077) < 1e-9);
  assert.ok(remote.continueThreshold < remote.startThreshold);
});

test('长气泡按标点分页且不丢字', () => {
  const text = '鲸鲸已经听见你说话啦，现在正在打开记事本。接下来我还会继续测试回复、情绪动作和本地语音播放。';
  const pages = voiceBubblePages(text, 24);
  assert.ok(pages.length > 1);
  assert.equal(pages.join(''), text);
  assert.ok(pages.every((page) => page.length <= 25));
});
