import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MotionDirector, PetState, actionFor, speechWindow, validateCatalog, stripWake, pcm16, wav16 } from '../public/core.mjs';
const catalog = JSON.parse(await readFile(new URL('../public/assets/motions.json', import.meta.url)));
test('60个唯一动作接入768交付包，保留未批准标记', () => {
  assert.equal(validateCatalog(catalog).motions.length, 60);
  assert.equal(new Set(catalog.motions.map(m => m.id)).size, 60);
  assert.ok(catalog.motions.every(m => m.enabled === true && m.approved === false));
  assert.equal(catalog.width, 768);
});

test('单次片从实际播放开始计时，迟到加载不能恢复已抢占动作', async () => {
  const timers = new Map(); let serial = 0, resolveRender;
  const director = new MotionDirector(catalog, () => new Promise(resolve => { resolveRender = resolve; }), {
    setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id),
  });
  director.play('wake', 'listen'); assert.equal(timers.size, 0);
  const oldResolve = resolveRender;
  director.play('interrupt', 'listen'); oldResolve(); await Promise.resolve();
  assert.equal(timers.size, 0);
  resolveRender(); await Promise.resolve(); assert.equal(timers.size, 1);
  [...timers.values()][0](); assert.equal(director.current.id, 'listen'); director.dispose();
});
test('真实事件映射方向、点击与情绪', () => {
  assert.equal(actionFor({ type: 'pointer.move', dx: -3 }), 'pull_left');
  assert.equal(actionFor({ type: 'pointer.move', dx: 4 }), 'pull_right');
  assert.equal(actionFor({ type: 'audio.started', emotion: 'angry' }), 'talk_pout');
  assert.equal(actionFor({ type: 'pointer.click', count: 2 }), 'double_click');
  assert.equal(actionFor({ type: 'unknown' }), null);
});
test('状态机去重，拒绝旧回合与乱序进度', () => {
  const state = new PetState();
  assert.equal(state.accept({ type: 'turn.accepted', turnId: 'a' }), true);
  assert.equal(state.accept({ type: 'turn.accepted', turnId: 'a' }), false);
  assert.equal(state.accept({ type: 'turn.thinking', turnId: 'b' }), false);
  assert.equal(state.accept({ type: 'task.plan', turnId: 'a', seq: 3, steps: [{ id: '1', label: '打开' }] }), true);
  assert.equal(state.accept({ type: 'tool.progress', turnId: 'a', seq: 2, stepId: '1', status: 'completed' }), false);
  assert.equal(state.task.steps[0].status, 'pending');
  state.accept({ type: 'tool.progress', turnId: 'a', seq: 4, stepId: '1', status: 'failed' });
  assert.equal(state.task.steps[0].status, 'failed');
});
test('30秒超时：任务和音频期间不能休眠', () => {
  let time = 0; const state = new PetState(() => time); state.activate();
  time = 30001; state.busy = true; assert.equal(state.tick(), false);
  state.busy = false; state.speaking = true; assert.equal(state.tick(), false);
  state.speaking = false; assert.equal(state.tick(), true); assert.equal(state.activeUntil, 0);
});
test('新任务卡替换旧内容，不能继承完成步骤', () => {
  const state = new PetState(); state.accept({ type: 'turn.accepted', turnId: '1', text: '打开记事本' });
  state.accept({ type: 'task.plan', steps: [{ id: 1, label: '打开' }] });
  state.accept({ type: 'turn.accepted', turnId: '2', text: '打开微信' });
  assert.equal(state.task.title, '打开微信'); assert.deepEqual(state.task.steps, []);
});
test('动作抢占清理旧计时，循环重复不重新加载', () => {
  let next = 0; const timers = new Map(), played = [];
  const director = new MotionDirector(catalog, m => played.push(m.id), { setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id) });
  director.play('wake', 'listen'); assert.equal(timers.size, 1);
  director.play('interrupt', 'listen'); assert.equal(timers.size, 1);
  [...timers.values()][0](); assert.equal(director.current.id, 'listen');
  const count = played.length; director.play('listen'); assert.equal(played.length, count);
  assert.equal(director.play('missing'), false); director.dispose();
});
test('字幕滚动尾窗有上限，保留emoji完整，未播放不显示正文', () => {
  assert.equal(speechWindow('你好🐳，再见。', 0), '');
  assert.equal(Array.from(speechWindow('🐳'.repeat(100), 1)).length, 64);
  assert.equal(speechWindow('你好', 1), '你好');
});
test('唤醒词只删除开头，不能删除命令内容中的名字', () => {
  assert.equal(stripWake('小鲸鱼，打开微信'), '打开微信');
  assert.equal(stripWake('给大肥鱼发消息'), '给大肥鱼发消息');
});
test('PCM边界与WAV头使用正确16k单声道格式', () => {
  const pcm = pcm16(new Float32Array([-1, 0, 1])); const view = new DataView(pcm.buffer);
  assert.equal(view.getInt16(0, true), -32768); assert.equal(view.getInt16(4, true), 32767);
  const wav = wav16(new Float32Array(16000)); const header = new DataView(wav.buffer);
  assert.equal(wav.length, 32044); assert.equal(header.getUint32(24, true), 16000); assert.equal(header.getUint16(22, true), 1);
});
