/** Windows 操作白名单。所有外部进程参数均为固定脚本 + base64 JSON，不经过 shell 拼接。 */
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const APPS = Object.freeze({
  notepad: ['notepad.exe'], calculator: ['calc.exe'], explorer: ['explorer.exe'], paint: ['mspaint.exe'],
});
const ALLOWED_APPS = new Set([...Object.keys(APPS), 'settings', 'browser', 'wechat', 'qq']);
const ALLOWED_HOTKEYS = new Set([
  'escape', 'tab', 'shift+tab', 'alt+tab', 'ctrl+a', 'ctrl+c', 'ctrl+f', 'ctrl+l', 'ctrl+n', 'ctrl+v', 'ctrl+x',
]);
const PROGRESS_STAGES = new Set([
  'accepted', 'discovering-app', 'restoring-app', 'launching-app', 'verifying-app',
  'approaching-pointer', 'carrying-pointer', 'committing', 'returning', 'completed', 'failed', 'cancelled',
]);

function safeText(value, max = 80) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
    && /^[\p{L}\p{N}_\- .:：/\\()（）]+$/u.test(value.trim());
}

function safeInput(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1000
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
}

function finitePoint(x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= -32768 && x <= 32767 && y >= -32768 && y <= 32767;
}

function safeUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function highRisk(text) {
  return /(删除|移除|卸载|发送|提交|支付|付款|购买|订阅|密码|验证码|回收站|覆盖|安装|允许|授权|公开发布|delete|remove|uninstall|send|submit|pay|purchase|subscribe|password|otp|install|allow|authorize)/i.test(String(text));
}

function validateAction(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = String(raw.type || '');
  const safeRisk = (value) => options.allowHighRisk === true || !highRisk(value);
  if (type === 'open_app' && typeof raw.app === 'string' && ALLOWED_APPS.has(raw.app.toLowerCase())) {
    return { type, app: raw.app.toLowerCase() };
  }
  if (type === 'open_app_name' && safeText(raw.name) && safeRisk(raw.name)) {
    return { type, name: raw.name.trim() };
  }
  if (type === 'close_app' && typeof raw.app === 'string' && ALLOWED_APPS.has(raw.app.toLowerCase())) {
    return { type, app: raw.app.toLowerCase() };
  }
  if (type === 'close_app_name' && safeText(raw.name) && safeRisk(raw.name)) {
    return { type, name: raw.name.trim() };
  }
  if (type === 'media_play') return { type };
  if (type === 'navigate_url') {
    const url = safeUrl(raw.url);
    return url ? { type, url } : null;
  }
  if (type === 'focus_window' && safeText(raw.window) && safeRisk(raw.window)) {
    return { type, window: raw.window.trim() };
  }
  if ((type === 'click' || type === 'double_click' || type === 'right_click') && safeText(raw.target) && safeRisk(raw.target)) {
    return { type, target: raw.target.trim() };
  }
  if (type === 'drag' && safeText(raw.from) && safeText(raw.to) && safeRisk(raw.from + raw.to)) {
    return { type, from: raw.from.trim(), to: raw.to.trim() };
  }
  if ((type === 'click_point' || type === 'double_click_point' || type === 'right_click_point') && finitePoint(raw.x, raw.y)) {
    return { type, x: raw.x, y: raw.y };
  }
  if (type === 'drag_point' && finitePoint(raw.fromX, raw.fromY) && finitePoint(raw.toX, raw.toY)) {
    return { type, fromX: raw.fromX, fromY: raw.fromY, toX: raw.toX, toY: raw.toY };
  }
  if (type === 'scroll' && Number.isInteger(raw.amount) && raw.amount !== 0 && Math.abs(raw.amount) <= 10
    && (raw.target === undefined || (safeText(raw.target) && safeRisk(raw.target)))) {
    return { type, amount: raw.amount, ...(raw.target === undefined ? {} : { target: raw.target.trim() }) };
  }
  if (type === 'type_text') {
    const target = raw.target === undefined ? '编辑区' : raw.target;
    if (safeText(target) && safeInput(raw.text) && safeRisk(String(target) + raw.text)) {
      return { type, target: String(target).trim(), text: raw.text };
    }
  }
  if (type === 'hotkey' && typeof raw.keys === 'string' && ALLOWED_HOTKEYS.has(raw.keys.toLowerCase())) {
    return { type, keys: raw.keys.toLowerCase() };
  }
  if (type === 'wait_for' && safeText(raw.target) && Number.isInteger(raw.timeoutMs)
    && raw.timeoutMs >= 100 && raw.timeoutMs <= 10000 && safeRisk(raw.target)) {
    return { type, target: raw.target.trim(), timeoutMs: raw.timeoutMs };
  }
  if (type === 'inspect_window') return { type };
  return null;
}

function isProgress(value) {
  return value && value.type === 'progress' && PROGRESS_STAGES.has(value.stage);
}

function runScript(action, options = {}) {
  const script = path.join(__dirname, 'windows-control.ps1');
  const cancelPath = path.join(os.tmpdir(), `dsh-pet-cancel-${process.pid}-${crypto.randomUUID()}`);
  const payload = Buffer.from(JSON.stringify({ ...action, _cancelPath: cancelPath }), 'utf8').toString('base64');
  // Windows PowerShell 5 treats a BOM-less `-File` as the system ANSI code page. The controller contains
  // localized app names, so load it explicitly as UTF-8 and keep the untrusted payload out of the command text.
  const quotedScript = script.replace(/'/g, "''");
  const bootstrap = `$code=[IO.File]::ReadAllText('${quotedScript}',[Text.UTF8Encoding]::new($false)); & ([ScriptBlock]::Create($code)) -Payload $env:DSH_PET_ACTION_PAYLOAD`;
  const encodedBootstrap = Buffer.from(bootstrap, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedBootstrap],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_PET_ACTION_PAYLOAD: payload } },
    );
    let stdout = '';
    let stderr = '';
    let result = null;
    let settled = false;
    let timer = null;
    let forceKillTimer = null;
    const cleanupCancelFile = () => { try { fs.unlinkSync(cancelPath); } catch {} };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      options.signal?.removeEventListener?.('abort', cancel);
      cleanupCancelFile();
      resolve(value);
    };
    const consume = (line) => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        if (isProgress(parsed)) options.onProgress?.(parsed);
        else if (parsed && parsed.type === 'result') result = parsed;
      } catch {
        stderr += (stderr ? '\n' : '') + line;
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/u);
      stdout = lines.pop() || '';
      for (const line of lines) consume(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      cleanupCancelFile();
      finish({ ok: false, message: error.message });
    });
    child.on('close', () => {
      consume(stdout);
      cleanupCancelFile();
      if (settled) return;
      if (result) finish({ ok: result.ok === true, message: String(result.message || ''), ...(result.data ? { data: result.data } : {}) });
      else finish({ ok: false, message: stderr.trim() || 'Windows 操作返回了无效结果' });
    });
    function cancel() {
      try { fs.writeFileSync(cancelPath, 'cancel', { flag: 'wx' }); } catch {}
      options.onProgress?.({ type: 'progress', stage: 'cancelled', message: '操作已取消' });
      if (!settled) {
        settled = true;
        if (timer !== null) clearTimeout(timer);
        options.signal?.removeEventListener?.('abort', cancel);
        resolve({ ok: false, cancelled: true, message: '操作已取消' });
      }
      // 正常路径由 PowerShell 轮询到信号，先 Mouse-Up 再退出；仅失联时才在 2 秒后兜底终止。
      if (forceKillTimer === null) {
        forceKillTimer = setTimeout(() => { if (!child.killed) child.kill(); }, 2000);
        forceKillTimer.unref?.();
      }
    }
    timer = setTimeout(() => {
      cancel();
    }, 15000);
    timer.unref?.();
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener?.('abort', cancel, { once: true });
  });
}

function actionMessage(action) {
  if (action.type === 'click' || action.type === 'double_click' || action.type === 'right_click') return `点到“${action.target}”啦`;
  if (action.type === 'drag') return `已经把“${action.from}”拖到“${action.to}”啦`;
  if (action.type === 'type_text') return '文字输入好啦';
  if (action.type === 'media_play') return '音乐播放啦';
  if (action.type === 'scroll') return '滚动好啦';
  if (action.type === 'hotkey') return '快捷键按好啦';
  if (action.type === 'wait_for') return `找到“${action.target}”啦`;
  if (action.type === 'focus_window') return '窗口放到最前面啦';
  if (action.type === 'inspect_window') return '看清当前窗口啦';
  if (action.type === 'navigate_url') return '网页打开啦';
  if (action.type === 'close_app' || action.type === 'close_app_name') return '已请求关闭窗口';
  if (action.type.includes('point')) return action.type.startsWith('drag') ? '拖拽完成啦' : '点好啦';
  return '完成啦';
}

async function runWindowsAction(raw, shell, options = {}) {
  if (process.platform !== 'win32') return { ok: false, message: '当前不是 Windows' };
  const action = validateAction(raw, { allowHighRisk: options.confirmed === true });
  if (!action) return { ok: false, message: highRisk(JSON.stringify(raw)) ? '这个关键操作需要先确认' : '这个操作不在安全白名单里' };
  if (action.type === 'navigate_url') {
    options.onProgress?.({ type: 'progress', stage: 'accepted', action: action.type });
    await shell.openExternal(action.url);
    const focused = await runScript({ type: 'focus_app', app: 'browser' }, options);
    return focused.ok ? { ok: true, message: '网页打开并放到最前面啦' } : focused;
  }
  if (action.type === 'open_app_name') {
    const result = await runScript(action, options);
    return result.ok ? { ...result, message: `${action.name}打开并放到最前面啦` } : result;
  }
  if (action.type === 'close_app' || action.type === 'close_app_name') {
    const result = await runScript(action, options);
    return result.ok ? { ...result, message: '窗口关闭请求已经执行' } : result;
  }
  if (action.type !== 'open_app') {
    const result = await runScript(action, options);
    return result.ok ? { ...result, message: actionMessage(action) } : result;
  }
  options.onProgress?.({ type: 'progress', stage: 'accepted', action: action.type });
  if (action.app === 'settings') {
    const existing = await runScript({ type: 'focus_app', app: 'settings' }, options);
    if (existing.ok) return { ok: true, message: '设置窗口已经恢复到最前面啦', data: { method: 'existing-window' } };
    await shell.openExternal('ms-settings:');
    const focused = await runScript({ type: 'focus_app', app: 'settings' }, options);
    return focused.ok ? { ok: true, message: '设置打开并放到最前面啦' } : focused;
  }
  if (action.app === 'browser') {
    const existing = await runScript({ type: 'focus_app', app: 'browser' }, options);
    if (existing.ok) return { ok: true, message: '浏览器窗口已经恢复到最前面啦', data: { method: 'existing-window' } };
    await shell.openExternal('https://www.bing.com');
    const focused = await runScript({ type: 'focus_app', app: 'browser' }, options);
    return focused.ok ? { ok: true, message: '浏览器打开并放到最前面啦' } : focused;
  }
  if (action.app === 'wechat' || action.app === 'qq') {
    return runWindowsAction({ type: 'open_app_name', name: action.app }, shell, options);
  }
  const argv = APPS[action.app];
  if (!argv) return { ok: false, message: '这个软件不在白名单里' };
  const result = await runScript({ type: 'open_app', app: action.app }, options);
  return result.ok ? { ok: true, message: '软件打开并放到最前面啦' } : result;
}

module.exports = { ALLOWED_HOTKEYS, highRisk, isProgress, runScript, runWindowsAction, validateAction };
