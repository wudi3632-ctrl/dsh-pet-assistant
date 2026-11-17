'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { highRisk, isProgress, validateAction } = require('./windows-control.js');

test('accepts the fixed low-risk action schema', () => {
  assert.deepEqual(validateAction({ type: 'open_app', app: 'NOTEPAD' }), { type: 'open_app', app: 'notepad' });
  assert.deepEqual(validateAction({ type: 'type_text', text: '你好' }), { type: 'type_text', target: '编辑区', text: '你好' });
  assert.deepEqual(validateAction({ type: 'open_app_name', name: '网易云音乐' }), { type: 'open_app_name', name: '网易云音乐' });
  assert.deepEqual(validateAction({ type: 'close_app', app: 'browser' }), { type: 'close_app', app: 'browser' });
  assert.deepEqual(validateAction({ type: 'close_app_name', name: '网易云音乐' }), { type: 'close_app_name', name: '网易云音乐' });
  assert.deepEqual(validateAction({ type: 'media_play' }), { type: 'media_play' });
  assert.deepEqual(validateAction({ type: 'navigate_url', url: 'https://www.bilibili.com' }), {
    type: 'navigate_url', url: 'https://www.bilibili.com/',
  });
  assert.deepEqual(validateAction({ type: 'double_click', target: '文件夹 1' }), { type: 'double_click', target: '文件夹 1' });
  assert.deepEqual(validateAction({ type: 'right_click_point', x: 20, y: -10 }), { type: 'right_click_point', x: 20, y: -10 });
  assert.deepEqual(validateAction({ type: 'scroll', amount: -3 }), { type: 'scroll', amount: -3 });
  assert.deepEqual(validateAction({ type: 'type_text', target: '名称', text: '小鲸鱼你好' }), {
    type: 'type_text', target: '名称', text: '小鲸鱼你好',
  });
  assert.deepEqual(validateAction({ type: 'hotkey', keys: 'CTRL+L' }), { type: 'hotkey', keys: 'ctrl+l' });
  assert.deepEqual(validateAction({ type: 'hotkey', keys: 'CTRL+N' }), { type: 'hotkey', keys: 'ctrl+n' });
  assert.deepEqual(validateAction({ type: 'wait_for', target: '保存', timeoutMs: 5000 }), {
    type: 'wait_for', target: '保存', timeoutMs: 5000,
  });
  assert.deepEqual(validateAction({ type: 'inspect_window', extra: 'ignored' }), { type: 'inspect_window' });
});

test('rejects scripts, arbitrary apps, invalid bounds and non-allowlisted hotkeys', () => {
  assert.equal(validateAction({ type: 'shell', command: 'whoami' }), null);
  assert.equal(validateAction({ type: 'open_app', app: 'cmd' }), null);
  assert.equal(validateAction({ type: 'open_app', app: 'terminal' }), null);
  assert.equal(validateAction({ type: 'open_app_name', name: '卸载某软件' }), null);
  assert.equal(validateAction({ type: 'navigate_url', url: 'javascript:alert(1)' }), null);
  assert.equal(validateAction({ type: 'navigate_url', url: 'https://user:secret@example.com' }), null);
  assert.equal(validateAction({ type: 'click_point', x: 999999, y: 10 }), null);
  assert.equal(validateAction({ type: 'scroll', amount: 0 }), null);
  assert.equal(validateAction({ type: 'scroll', amount: 11 }), null);
  assert.equal(validateAction({ type: 'hotkey', keys: 'alt+f4' }), null);
  assert.equal(validateAction({ type: 'wait_for', target: '按钮', timeoutMs: 10001 }), null);
  assert.equal(validateAction({ type: 'type_text', target: '输入框', text: '\u0000' }), null);
});

test('blocks high-risk targets before execution', () => {
  assert.equal(highRisk('点击发送按钮'), true);
  assert.equal(highRisk('purchase now'), true);
  assert.equal(validateAction({ type: 'click', target: '发送' }), null);
  assert.deepEqual(validateAction({ type: 'click', target: '发送' }, { allowHighRisk: true }), {
    type: 'click', target: '发送',
  });
  assert.equal(validateAction({ type: 'drag', from: '文件', to: '回收站' }), null);
  assert.equal(validateAction({ type: 'click', target: '普通选项' })?.type, 'click');
});

test('only accepts known operator progress stages', () => {
  assert.equal(isProgress({ type: 'progress', stage: 'carrying-pointer' }), true);
  assert.equal(isProgress({ type: 'progress', stage: 'discovering-app' }), true);
  assert.equal(isProgress({ type: 'progress', stage: 'restoring-app' }), true);
  assert.equal(isProgress({ type: 'progress', stage: 'launching-app' }), true);
  assert.equal(isProgress({ type: 'progress', stage: 'verifying-app' }), true);
  assert.equal(isProgress({ type: 'progress', stage: 'run-shell' }), false);
  assert.equal(isProgress({ type: 'result', stage: 'completed' }), false);
});
