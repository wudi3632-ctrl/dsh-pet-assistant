'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOperatorTaskStore } = require('./operator-task-store.js');

function plan() {
  return { taskId: 'task-1', title: '打开哔哩哔哩', steps: [{ label: '打开浏览器' }, { label: '导航到 Bilibili' }, { label: '确认结果' }] };
}

test('initializes a task and advances completed steps', () => {
  const store = createOperatorTaskStore();
  let state = store.accept(plan());
  assert.equal(state.steps[0].status, 'running');
  state = store.apply({ taskId: 'task-1', seq: 1, stage: 'step-completed', stepIndex: 0 });
  assert.equal(state.steps[0].status, 'completed');
  assert.equal(state.steps[1].status, 'running');
  assert.equal(state.percent, 33);
});

test('represents confirmation, failure and cancellation', () => {
  const store = createOperatorTaskStore();
  store.accept(plan());
  assert.equal(store.apply({ taskId: 'task-1', seq: 1, stage: 'waiting-confirmation', stepIndex: 0 }).status, 'waiting-confirmation');
  assert.equal(store.apply({ taskId: 'task-1', seq: 2, stage: 'failed', stepIndex: 0, message: '没找到按钮' }).steps[0].message, '没找到按钮');
  store.accept(plan());
  assert.equal(store.apply({ taskId: 'task-1', seq: 3, stage: 'cancelled', stepIndex: 0 }).status, 'cancelled');
});

test('drops stale or foreign events', () => {
  const store = createOperatorTaskStore();
  store.accept(plan());
  store.apply({ taskId: 'task-1', seq: 2, stage: 'step-completed', stepIndex: 0 });
  assert.equal(store.apply({ taskId: 'task-1', seq: 1, stage: 'failed', stepIndex: 1 }).status, 'running');
  assert.equal(store.apply({ taskId: 'other', seq: 9, stage: 'failed', stepIndex: 1 }).status, 'running');
});

test('auto-collapses six seconds after completion', () => {
  let time = 1000;
  const store = createOperatorTaskStore({ now: () => time });
  store.accept(plan());
  store.apply({ taskId: 'task-1', seq: 1, stage: 'completed' });
  time = 6999;
  assert.equal(store.tick().collapsed, false);
  time = 7000;
  assert.equal(store.tick().collapsed, true);
});

test('invalid plans fail visibly instead of showing fake progress', () => {
  const state = createOperatorTaskStore().accept({ taskId: '', title: '', steps: [] });
  assert.equal(state.status, 'failed');
  assert.equal(state.total, 0);
});
