import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopTaskBroker } from './desktop-task-broker.ts';

test('accepts only one pending desktop task at a time', async () => {
  const broker = new DesktopTaskBroker();
  const firstController = new AbortController();
  const first = broker.submit('打开计算器', firstController.signal);

  assert.equal(broker.available(), false);
  assert.deepEqual(await broker.submit('打开记事本', new AbortController().signal), {
    ok: false,
    message: '桌面助手正在执行另一项任务',
  });

  firstController.abort();
  await assert.rejects(first);
  assert.equal(broker.available(), true);
});

test('a pending task can only be claimed once', async () => {
  const broker = new DesktopTaskBroker();
  const controller = new AbortController();
  const result = broker.submit('打开计算器', controller.signal);

  const claimed = broker.claim();
  assert.ok(claimed && claimed.kind === 'goal');
  assert.equal(claimed.goal, '打开计算器');
  assert.equal(broker.claim(), null);

  controller.abort();
  await assert.rejects(result);
});

test('passes observation and action requests to the desktop helper without reshaping them', async () => {
  const broker = new DesktopTaskBroker();
  const controller = new AbortController();
  const observed = broker.submitRequest({ kind: 'observe' }, controller.signal);
  const observationTask = broker.claim();
  assert.ok(observationTask);
  assert.equal(observationTask.kind, 'observe');
  assert.equal(broker.complete(observationTask.id, { ok: true, message: '已截图' }), true);
  await observed;

  const action = { type: 'click_point', x: 100, y: 200 };
  const acted = broker.submitRequest({ kind: 'action', action }, new AbortController().signal);
  const actionTask = broker.claim();
  assert.ok(actionTask && actionTask.kind === 'action');
  assert.deepEqual(actionTask.action, action);
  broker.complete(actionTask.id, { ok: true, message: '点击完成' });
  await acted;
});

test('completing the claimed task resolves the submitter and clears the broker', async () => {
  const broker = new DesktopTaskBroker();
  const submitted = broker.submit('打开计算器', new AbortController().signal);
  const claimed = broker.claim();
  assert.ok(claimed);

  const completion = { ok: true, message: '计算器已打开' };
  assert.equal(broker.complete('wrong-id', completion), false);
  assert.equal(broker.complete(claimed.id, completion), true);
  assert.deepEqual(await submitted, completion);
  assert.equal(broker.available(), true);
  assert.equal(broker.complete(claimed.id, completion), false);
});

test('aborting a task rejects it and makes room for the next task', async () => {
  const broker = new DesktopTaskBroker();
  const controller = new AbortController();
  const submitted = broker.submit('打开计算器', controller.signal);

  controller.abort(new Error('用户取消'));
  await assert.rejects(submitted, /用户取消/);
  assert.equal(broker.claim(), null);
  assert.equal(broker.available(), true);
});
