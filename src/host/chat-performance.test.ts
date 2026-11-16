import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractPerformance } from './chat-performance.ts';

const cases = [
  ['好耶，今天也一起加油！\n[情绪:happy;语速:fast;语气:laughter]', 'happy', 'fast', '[laughter]'],
  ['别怕，我会陪着你的。\n[情绪:gentle;语速:slow;语气:none]', 'gentle', 'slow', ''],
  ['唔……我真的有点难过。\n[情绪:sad;语速:slow;语气:sigh]', 'sad', 'slow', '[sigh]'],
  ['不许再这样欺负自己了！\n[情绪:angry;语速:fast;语气:none]', 'angry', 'fast', ''],
  ['这个操作有风险，请先保存文件。\n[情绪:serious;语速:normal;语气:none]', 'serious', 'normal', ''],
  ['我在这里。\n[情绪:neutral;语速:normal;语气:none]', 'neutral', 'normal', ''],
] as const;

for (const [input, emotion, speed, tag] of cases) {
  test(`解析 ${emotion} 表演且隐藏控制标记`, () => {
    const result = extractPerformance(input);
    assert.equal(result.performance.emotion, emotion);
    assert.equal(result.performance.speed, speed);
    assert.equal(result.performance.tag, tag);
    assert.doesNotMatch(result.text, /情绪:|语速:|语气:/u);
  });
}

test('模型漏标记时按回答语义兜底', () => {
  assert.deepEqual(extractPerformance('别怕，慢慢来，我会陪着你的。').performance, {
    emotion: 'gentle',
    speed: 'slow',
    tag: '',
  });
});

test('非法标记会被剥离并按正文兜底', () => {
  const result = extractPerformance('好耶！\n[情绪:excited;语速:turbo;语气:giggle]');
  assert.equal(result.performance.emotion, 'happy');
  assert.doesNotMatch(result.text, /\[情绪:/u);
});
