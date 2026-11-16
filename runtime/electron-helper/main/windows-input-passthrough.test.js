'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createWindows } = require('./windows.js');

function fixture() {
  const calls = [];
  const win = {
    id: 7,
    isDestroyed: () => false,
    setIgnoreMouseEvents: (ignore, options) => calls.push({ ignore, options }),
  };
  const petWindows = createWindows({
    BrowserWindow: function BrowserWindow() {},
    screen: {},
    buildDeskGeometry: () => ({}),
    dpi: {},
    helperDir: '',
    isBridge: false,
    openTarget: 'desktop',
    platform: 'win32',
    shouldReassertTopmost: () => false,
    topmostLevel: () => 'screen-saver',
    taskbarWatchdogEnabled: false,
  });
  petWindows.state.windows.set('main', win);
  return { calls, petWindows, win };
}

test('forces pet windows to pass through automation clicks and restores interaction', () => {
  const { calls, petWindows, win } = fixture();
  petWindows.setWindowIgnore(win, false);
  const release = petWindows.beginInputPassthrough();
  petWindows.setWindowIgnore(win, false);

  assert.deepEqual(calls.map((item) => item.ignore), [false, true]);
  assert.equal(petWindows.state.windowIgnore.get(win.id), true);

  release();
  assert.deepEqual(calls.map((item) => item.ignore), [false, true, false]);
  assert.equal(petWindows.state.windowIgnore.get(win.id), false);
  release();
  assert.equal(calls.length, 3, 'release is idempotent');
});

test('nested pointer actions keep passthrough until the final release', () => {
  const { calls, petWindows, win } = fixture();
  petWindows.setWindowIgnore(win, false);
  const releaseFirst = petWindows.beginInputPassthrough();
  const releaseSecond = petWindows.beginInputPassthrough();

  releaseFirst();
  assert.equal(petWindows.state.windowIgnore.get(win.id), true);
  releaseSecond();
  assert.equal(petWindows.state.windowIgnore.get(win.id), false);
  assert.deepEqual(calls.map((item) => item.ignore), [false, true, false]);
});
