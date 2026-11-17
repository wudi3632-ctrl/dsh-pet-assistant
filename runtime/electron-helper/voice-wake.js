/** 常驻 VAD → 本地 ASR → 唤醒词 → 对话/Windows 白名单操作。 */
'use strict';

let voiceWakeController = null;

function startVoiceWake(cfg) {
  if (voiceWakeController) voiceWakeController.dispose();
  voiceWakeController = null;
  if (!cfg || cfg.voiceWakeEnabled !== true || !navigator.mediaDevices?.getUserMedia) return;
  voiceWakeController = createVoiceWakeController(cfg);
  void voiceWakeController.start();
}

function createVoiceWakeController(cfg) {
  const VC = window.DshPetVoiceCommand;
  if (!VC) throw new Error('voice-command module is unavailable');
  const words = (cfg.voiceWakeWords || ['大肥鱼', '鲸鲸', '小鲸鱼', '小鲸'])
    .map((word) => String(word).trim())
    .filter(Boolean);
  // 一次唤醒后维持自然连续会话；任务等待状态不受空闲窗口影响。
  const activeMs = VC.resolveActiveMs(cfg.voiceWakeActiveMs);
  const ttsCooldownMs = 350;
  const sampleRate = 16000;
  const calibrationMs = 1800;
  const minSpeechMs = 350;
  let silenceMs = 650;
  let vadStartFloor = 0.008;
  let vadContinueFloor = 0.0045;
  const maxSpeechMs = 10000;
  const wakePreRollFrames = Math.ceil((sampleRate * 2) / 1024);
  let stream = null;
  let ctx = null;
  let processor = null;
  let source = null;
  let disposed = false;
  let busy = false;
  let commandBusy = false;
  let speaking = false;
  let ttsCooldownUntil = 0;
  let wakeInterruptingTts = false;
  let lastTtsText = '';
  let lastTtsInterruptedAt = 0;
  let activeUntil = 0;
  let speechStart = 0;
  let lastVoice = 0;
  let chunks = [];
  let preRoll = [];
  let statusTimer = null;
  let pageTimer = null;
  let activeTimer = null;
  let abort = null;
  let calibrating = true;
  let calibrationStarted = 0;
  let calibrationLevels = [];
  let startThreshold = 0.012;
  let continueThreshold = 0.006;
  let segmentPeak = 0;
  let activeTraceId = '';
  const kwsSession = 'kws-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  let kwsBatch = [];
  let kwsChain = Promise.resolve();
  let kwsMatched = '';
  let kwsAvailable = true;
  let operatorHome = null;
  let operatorAnim = '';
  let pendingWindowsPlan = null;
  let pendingAgentInput = null;
  let pendingMessageDraft = null;
  let operatorTaskCounter = 0;
  const turnGate = VC.createTurnGate(128);

  const sessionContext = () => ({
    awaitingInput: Boolean(pendingMessageDraft || pendingAgentInput),
    awaitingConfirmation: Boolean(pendingWindowsPlan),
    executing: commandBusy,
    verifying: false,
    hasTask: Boolean(pendingMessageDraft || pendingAgentInput || pendingWindowsPlan),
  });
  const sessionCanHear = () => VC.sessionCanHearWithoutWake(Date.now(), activeUntil, sessionContext());

  const log = (stage, data) => {
    const payload = { ...(activeTraceId ? { traceId: activeTraceId } : {}), stage, wallMs: Date.now(), ...(data || {}) };
    console.info('[dsh-pet-trace] ' + JSON.stringify(payload));
  };
  const newTraceId = () => 'vw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);

  const sprite = () => sprites && sprites[0];
  const targetLabel = (value, fallback) => typeof value === 'string' ? value : value?.label || fallback;
  const stepLabel = (step) => {
    if (!step || typeof step !== 'object') return '执行操作';
    if (step.type === 'open_app') {
      const names = { notepad: '记事本', calculator: '计算器', explorer: '资源管理器', paint: '画图', cloudmusic: '网易云音乐' };
      return '发现并恢复 ' + (names[step.app] || step.app);
    }
    if (step.type === 'open_app_name') return '发现并恢复 ' + step.name;
    if (step.type === 'close_app') return '关闭 ' + step.app;
    if (step.type === 'close_app_name') return '关闭 ' + step.name;
    if (step.type === 'navigate_url') {
      try { return '打开 ' + new URL(step.url).hostname; } catch { return '打开网页'; }
    }
    if (step.type === 'focus_window') return '切换到 ' + step.window;
    if (step.type === 'click' || step.type === 'click_point') return '点击 ' + targetLabel(step.target, '目标');
    if (step.type === 'double_click' || step.type === 'double_click_point') return '双击 ' + targetLabel(step.target, '目标');
    if (step.type === 'right_click' || step.type === 'right_click_point') return '右键 ' + targetLabel(step.target, '目标');
    if (step.type === 'drag' || step.type === 'drag_point') return '拖动 ' + targetLabel(step.from, '目标');
    if (step.type === 'scroll') return '滚动页面';
    if (step.type === 'type_text') return '输入文字';
    if (step.type === 'hotkey') return '按下 ' + step.keys;
    if (step.type === 'wait_for') return '等待 ' + (step.target?.label || '界面');
    if (step.type === 'media_play') return '播放音乐';
    if (step.type === 'history') return step.label || '已完成步骤';
    if (step.type === 'verify') return '验证执行结果';
    if (step.type === 'compose_text') return '生成正文';
    if (step.type === 'planning') return '理解并规划操作';
    return String(step.type || '执行操作');
  };
  const startOperatorTask = (title, steps) => {
    const task = { taskId: 'operator-' + Date.now().toString(36) + '-' + (++operatorTaskCounter), seq: 0 };
    sprite()?.operatorTask?.accept({
      taskId: task.taskId,
      title,
      steps: steps.map((step, index) => ({ id: String(index), label: stepLabel(step) })),
    });
    return task;
  };
  const updateOperatorTask = (task, stage, stepIndex, message) => {
    if (!task) return;
    sprite()?.operatorTask?.apply({
      taskId: task.taskId, seq: ++task.seq, stage, stepIndex,
      ...(message ? { message } : {}),
    });
  };
  const playOperatorAnimation = (name) => {
    const pet = sprite();
    if (!pet || operatorAnim === name) return;
    operatorAnim = name;
    pet.playOnce(name);
  };
  const pointerRatio = (point) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    // 把 Windows 物理屏幕坐标换成桌宠的视口局部 CSS 坐标，并把身体放在指针斜后方，避免遮住目标。
    const localX = toLocal(point.x) - VIEW.x;
    const localY = toLocal(point.y) - VIEW.y;
    const side = localX > VIEW.w / 2 ? -1 : 1;
    return {
      rx: (localX + side * toLocal(84)) / VIEW.w,
      ry: (localY - toLocal(58)) / VIEW.h,
    };
  };
  const onWindowsActionProgress = (progress) => {
    const pet = sprite();
    if (!pet || !progress || typeof progress.stage !== 'string') return;
    if (progress.stage === 'accepted') {
      pet.stopMove?.();
      operatorHome = {
        rx: (pet.pos.x + pet.halfW) / VIEW.w,
        ry: (pet.pos.y + pet.halfH) / VIEW.h,
      };
      operatorAnim = '';
      playOperatorAnimation('点击回应-元气挥手');
      show('executing', '交给我吧～');
      return;
    }
    if (progress.stage === 'discovering-app') {
      playOperatorAnimation('工作状态-忙碌点按');
      show('executing', '正在查找' + (progress.name || '软件') + '的运行状态…');
      return;
    }
    if (progress.stage === 'restoring-app') {
      playOperatorAnimation('点击回应-元气挥手');
      show('executing', '找到后台实例，正在把窗口叫回来～');
      return;
    }
    if (progress.stage === 'launching-app') {
      playOperatorAnimation('原地左转奔跑');
      show('executing', progress.alreadyRunning ? '后台窗口没能恢复，正在请求软件自己唤醒…' : '软件还没运行，正在启动～');
      return;
    }
    if (progress.stage === 'verifying-app') {
      playOperatorAnimation('工作状态-忙碌点按');
      show('verifying', '窗口出来啦，正在确认是不是目标界面…');
      return;
    }
    if (progress.stage === 'approaching-pointer') {
      pet.operatorTask?.setForcedCollapsed('operator', true);
      playOperatorAnimation('原地左转奔跑');
      const target = pointerRatio(progress.pointer);
      if (target) pet.moveToCenter(target.rx, target.ry, 'line', 140);
      return;
    }
    if (progress.stage === 'carrying-pointer') {
      const horizontal = Math.abs(Number(progress.target?.x) - Number(progress.pointer?.x));
      playOperatorAnimation(progress.action === 'drag' && horizontal > 220 ? '螃蟹走路' : '原地左转奔跑');
      const target = pointerRatio(progress.pointer);
      if (target) pet.moveToCenter(target.rx, target.ry, 'instant', 0);
      return;
    }
    if (progress.stage === 'committing') {
      playOperatorAnimation(progress.action === 'drag' ? '原地重力下蹲压缩' : '工作状态-忙碌点按');
      return;
    }
    if (progress.stage === 'returning') {
      pet.operatorTask?.setForcedCollapsed('operator', false);
      playOperatorAnimation('原地左转奔跑');
      if (operatorHome) pet.moveToCenter(operatorHome.rx, operatorHome.ry, 'line', 320);
      return;
    }
    if (progress.stage === 'completed') {
      pet.operatorTask?.setForcedCollapsed('operator', false);
      playOperatorAnimation('工作状态-雀跃庆祝');
      operatorHome = null;
      return;
    }
    if (progress.stage === 'failed' || progress.stage === 'cancelled') {
      pet.operatorTask?.setForcedCollapsed('operator', false);
      playOperatorAnimation('工作状态-垂头叹气冒汗');
      if (operatorHome) pet.moveToCenter(operatorHome.rx, operatorHome.ry, 'line', 260);
      operatorHome = null;
    }
  };
  window.petBridge?.setWindowsActionProgressHandler?.(onWindowsActionProgress);
  const show = (kind, text, holdMs) => {
    const pet = sprite();
    if (!pet) return;
    if (statusTimer !== null) clearTimeout(statusTimer);
    if (pageTimer !== null) clearInterval(pageTimer);
    statusTimer = null;
    pageTimer = null;
    pet.voiceSessionOn = true;
    pet.voiceSessionKind = kind;
    const pages = typeof S.voiceBubblePages === 'function' ? S.voiceBubblePages(text, 42) : [String(text || '')];
    let page = 0;
    const renderPage = () => {
      pet.voiceSessionText = pages[page] + (pages.length > 1 ? '  ' + (page + 1) + '/' + pages.length : '');
      pet.renderBubble();
    };
    renderPage();
    if (pages.length > 1) {
      pageTimer = setInterval(() => {
        page = (page + 1) % pages.length;
        renderPage();
      }, 2400);
    }
    if (holdMs) statusTimer = setTimeout(() => {
      if (kind === 'thinking' || kind === 'executing' || kind === 'verifying' || kind === 'transcribing') {
        if (sessionCanHear()) show('listening', '还在听哦…', 2200);
        else hide();
      } else {
        hide();
      }
    }, holdMs);
  };
  const showWaiting = () => {
    if (disposed) return;
    show('waiting', '等你叫我 · ' + words.join(' / '), 2800);
  };
  const armActiveExpiry = () => {
    if (activeTimer !== null) clearTimeout(activeTimer);
    const delay = Math.max(0, activeUntil - Date.now()) + 80;
    activeTimer = setTimeout(() => {
      activeTimer = null;
      if (disposed) return;
      if (sessionCanHear()) {
        if (Date.now() < activeUntil) armActiveExpiry();
        return;
      }
      const pet = sprite();
      if (!speaking && !busy && !speechStart && pet?.voiceSessionOn && pet.voiceSessionKind === 'listening') hide();
    }, delay);
  };
  const activate = () => {
    activeUntil = Date.now() + activeMs;
    armActiveExpiry();
  };
  const hide = () => {
    const pet = sprite();
    if (!pet) return;
    if (statusTimer !== null) clearTimeout(statusTimer);
    if (pageTimer !== null) clearInterval(pageTimer);
    statusTimer = null;
    pageTimer = null;
    pet.voiceSessionOn = false;
    pet.renderBubble();
  };

  const onVoiceEvent = S.subscribeVoiceUtterance((event) => {
    speaking = event.kind === 'start';
    log('tts-' + event.kind);
    if (speaking) {
      wakeInterruptingTts = false;
      ttsCooldownUntil = 0;
      lastTtsText = event.text;
      show('speaking', event.text);
    }
    else {
      if (wakeInterruptingTts) {
        wakeInterruptingTts = false;
        return;
      }
      ttsCooldownUntil = Date.now() + ttsCooldownMs;
      activate();
      show('listening', '好啦，继续说吧～', 2200);
    }
  });

  function normalize(text) {
    return String(text || '').trim().replace(/[\s，。！？、,.!?：:；;“”‘’"']/g, '');
  }
  function matchWake(text) {
    return VC.wakeMatch(text, words);
  }
  function rms(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.max(1, samples.length));
  }
  function waveBytes(parts) {
    const length = parts.reduce((n, part) => n + part.length, 0);
    const pcm = new Int16Array(length);
    let offset = 0;
    for (const part of parts) {
      for (let i = 0; i < part.length; i++) pcm[offset + i] = Math.max(-1, Math.min(1, part[i])) * (part[i] < 0 ? 32768 : 32767);
      offset += part.length;
    }
    const bytes = new Uint8Array(44 + pcm.byteLength);
    const view = new DataView(bytes.buffer);
    const ascii = (at, value) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
    ascii(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, pcm.byteLength, true);
    for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
    return bytes;
  }
  function base64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      const end = Math.min(bytes.length, offset + 8192);
      for (let i = offset; i < end; i++) binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  function pcmBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const bytes = new Uint8Array(length * 2);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    for (const part of parts) {
      for (let i = 0; i < part.length; i++) {
        const value = Math.max(-1, Math.min(1, part[i]));
        view.setInt16(offset, value * (value < 0 ? 32768 : 32767), true);
        offset += 2;
      }
    }
    return bytes;
  }
  function feedKws(input, keywordOnly) {
    if (!kwsAvailable || (!keywordOnly && Date.now() < activeUntil)) return;
    kwsBatch.push(input);
    if (kwsBatch.length < 3) return;
    const parts = kwsBatch;
    kwsBatch = [];
    kwsChain = kwsChain.then(async () => {
      const res = await fetch(BASE + '/voice/kws', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audio: base64(pcmBytes(parts)), session: kwsSession }),
      });
      const body = await res.json();
      if (body?.ok === true && body.keyword) {
        if (disposed || (!keywordOnly && Date.now() < activeUntil)) return;
        kwsMatched = String(body.keyword);
        if (speaking) {
          wakeInterruptingTts = true;
          lastTtsInterruptedAt = Date.now();
          log('tts-wake-interrupt', { keyword: kwsMatched });
          S.stopVoicePlayback?.();
          speaking = false;
          ttsCooldownUntil = 0;
        }
        activate();
        if (!speechStart && preRoll.length) {
          const buffered = preRoll.splice(0);
          const bufferedSamples = buffered.reduce((sum, part) => sum + part.length, 0);
          const now = performance.now();
          speechStart = now - (bufferedSamples / sampleRate) * 1000;
          lastVoice = now;
          chunks = buffered;
          segmentPeak = Math.max(...buffered.map(rms));
          activeTraceId = newTraceId();
          log('speech-start', {
            source: 'kws', keyword: kwsMatched, bufferedMs: Math.round((bufferedSamples / sampleRate) * 1000),
          });
        }
        log('kws-hit', { keyword: kwsMatched });
        show('listening', '听到“' + kwsMatched + '”啦，请说～');
      }
    }).catch((error) => {
      kwsAvailable = false;
      log('kws-fallback-to-asr', { message: error?.message || String(error) });
    });
  }
  async function transcribe(parts) {
    abort = new AbortController();
    log('asr-request', { audioMs: Math.round(parts.reduce((sum, part) => sum + part.length, 0) / sampleRate * 1000) });
    const res = await fetch(BASE + '/voice/hear', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audio: base64(waveBytes(parts)), traceId: activeTraceId }), signal: abort.signal,
    });
    const body = await res.json();
    if (!body || body.ok !== true) throw new Error(body?.message || body?.reason || '本地识别失败');
    return String(body.text || '').trim();
  }
  async function executeWindows(intent) {
    if (!intent || cfg.windowsControlEnabled !== true || !window.petBridge?.runWindowsAction) return null;
    activate();
    show('executing', '执行中：' + intent.label);
    const actions = Array.isArray(intent.actions) && intent.actions.length ? intent.actions : [intent.action];
    const task = startOperatorTask(intent.label, actions);
    log('action-start', intent);
    let result = null;
    for (const [index, action] of actions.entries()) {
      updateOperatorTask(task, 'step-start', index);
      result = await window.petBridge.runWindowsAction(action);
      log('action-result', { index, action, result });
      if (!result?.ok) {
        updateOperatorTask(task, result?.cancelled ? 'cancelled' : 'failed', index, result?.message);
        throw new Error(result?.message || '操作没有完成');
      }
      updateOperatorTask(task, 'step-completed', index);
    }
    updateOperatorTask(task, 'completed', actions.length - 1);
    activate();
    show('success', '✓ ' + (result.message || '完成啦'), 1800);
    return result;
  }
  function speakOutcome(text) {
    const value = String(text || '').trim();
    if (!value || typeof S.speakText !== 'function') return;
    S.speakText(value, (phase) => {
      if (disposed) return;
      if (phase === 'loading') show('thinking', value);
      else if (phase === 'playing') show('speaking', value);
      else if (phase === 'idle') {
        activate();
        show('listening', '还在听哦…', 2200);
      }
    });
  }
  async function submitDshAgentTurn(text, turnId) {
    show('thinking', '正在交给 DSH 处理…');
    const response = await fetch(BASE + '/agent/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, turnId }),
    });
    if (response.status === 404 || response.status === 503) {
      log('agent-unavailable', { status: response.status });
      return false;
    }
    const result = await response.json();
    if (!result?.ok) throw new Error(result?.message || 'DSH Agent 任务失败');
    log('agent-completed', { sessionId: result.sessionId, outputChars: String(result.text || '').length });
    speakOutcome(result.text || '任务已经处理完成。');
    return true;
  }
  function windowsIntent(command) {
    const sites = {
      哔哩哔哩: 'https://www.bilibili.com/', B站: 'https://www.bilibili.com/', bilibili: 'https://www.bilibili.com/',
      百度: 'https://www.baidu.com/', 知乎: 'https://www.zhihu.com/', GitHub: 'https://github.com/',
    };
    const requestedTarget = command.match(/^(?:帮我|请)?(?:打开|访问|进入)(.+)$/u)?.[1]?.trim() || '';
    const siteName = Object.keys(sites).find((name) => {
      const target = requestedTarget.toLocaleLowerCase();
      const key = name.toLocaleLowerCase();
      return target === key || target === key + '网站' || target === key + '网页';
    });
    if (siteName) {
      return { label: '打开' + siteName, action: { type: 'navigate_url', url: sites[siteName] } };
    }
    const aliases = { 记事本: 'notepad', 计算器: 'calculator', 资源管理器: 'explorer', 文件管理器: 'explorer', 设置: 'settings', 画图: 'paint', 浏览器: 'browser', 微信: 'wechat', QQ: 'qq' };
    const close = VC.closeApplicationIntent(command);
    if (close) return { label: '关闭' + close.name, action: close };
    const mediaCompound = command.match(/^(?:帮我|请)?打开(.+?)(?:并|然后|再|，|,)(?:帮我)?(?:播放|放)(?:一下)?(?:音乐|歌曲|歌)?$/u);
    if (mediaCompound) {
      const name = String(mediaCompound[1] || '').trim();
      const openAction = aliases[name]
        ? { type: 'open_app', app: aliases[name] }
        : { type: 'open_app_name', name };
      return { label: '打开' + name + '并播放音乐', actions: [openAction, { type: 'media_play' }] };
    }
    const open = command.match(/^(?:帮我|请)?打开(.+)$/);
    if (open) {
      const name = String(open[1] || '').trim();
      if (/(?:并|然后|再|给.+(?:发|发送)|搜索|播放|写|输入|点击|选择)/u.test(name)) return null;
      if (aliases[name]) return { label: '打开' + name, action: { type: 'open_app', app: aliases[name] } };
      if (name.length <= 80 && /^[\p{L}\p{N}_\- .（）()]+$/u.test(name)
        && !/(卸载|终端|命令提示符|PowerShell|注册表|控制面板|安全中心|管理员工具|脚本)/iu.test(name)) {
        return { label: '打开' + name, action: { type: 'open_app_name', name } };
      }
    }
    const dragPoint = command.match(/^(?:把)?(?:鼠标)?从(\d{1,5})[,， ](\d{1,5})拖(?:到|至)(\d{1,5})[,， ](\d{1,5})$/);
    if (dragPoint) return { label: '拖拽鼠标', action: { type: 'drag_point', fromX: +dragPoint[1], fromY: +dragPoint[2], toX: +dragPoint[3], toY: +dragPoint[4] } };
    const clickPoint = command.match(/^(?:点击|点一下|点)(\d{1,5})[,， ](\d{1,5})$/);
    if (clickPoint) return { label: '点击指定位置', action: { type: 'click_point', x: +clickPoint[1], y: +clickPoint[2] } };
    const safe = (value) => value && value.length <= 40 && /^[\p{L}\p{N}_\- ]+$/u.test(value) && !/(删除|移除|卸载|发送|提交|支付|付款|购买|订阅|密码|验证码|回收站|覆盖|安装|允许|授权)/i.test(value);
    const drag = command.match(/^(?:把)?(.{1,40}?)拖(?:到|至)(.{1,40})$/);
    if (drag && safe(drag[1]) && safe(drag[2])) return { label: '把' + drag[1] + '拖到' + drag[2], action: { type: 'drag', from: drag[1], to: drag[2] } };
    const click = command.match(/^(?:点击|点一下|点)(.{1,40})$/);
    if (click && safe(click[1])) return { label: '点击' + click[1], action: { type: 'click', target: click[1] } };
    return null;
  }
  function notepadWritingIntent(command) {
    const source = String(command || '').trim();
    const writing = source.match(/(?:写|输入|键入|编辑)(?:一段|一份|一下)?(?:关于)?(.+)$/u);
    if (!writing) return null;
    const mentionsNotepad = /记事本/u.test(source);
    const naturalFollowUp = /^(?:帮我|请)?(?:写|输入|键入|编辑)/u.test(source);
    if (!mentionsNotepad && !naturalFollowUp) return null;
    const request = String(writing[1] || '').replace(/^[：:，,\s]+/u, '').trim();
    if (!request || request.length > 240) return null;
    return {
      goal: source,
      request,
      open: /打开[^，。]*记事本/u.test(source),
    };
  }
  async function executeMessageIntent(intent, pet) {
    log('message-intent', { app: intent.app, recipientChars: intent.recipient.length, hasContent: Boolean(intent.content), contentChars: intent.content.length });
    if (!intent.content) {
      pendingMessageDraft = intent;
      const task = startOperatorTask('给' + intent.recipient + '发送消息', [
        { type: 'history', label: '确认收件人：' + intent.recipient },
        { type: 'history', label: '等待消息内容' },
      ]);
      updateOperatorTask(task, 'step-completed', 0);
      updateOperatorTask(task, 'waiting-confirmation', 1, '等待消息内容');
      show('waiting', '要给' + intent.recipient + '发什么内容呀？', 6000);
      speakOutcome('要给' + intent.recipient + '发什么内容呀？');
      return { ok: false, waitingForContent: true };
    }
    pendingMessageDraft = null;
    const goal = '使用' + intent.appName + '给联系人“' + intent.recipient + '”发送消息：“' + intent.content + '”';
    return runWindowsAgent(goal, pet, { type: 'open_app_name', name: intent.appName });
  }
  function looksLikeWindowsTask(command) {
    return /(?:打开|关闭|关掉|退出|点击|点一下|双击|右键|拖到|滚动|输入|填写|写|编辑|键入|切换到|找到|选择|勾选|取消勾选|关闭窗口|操作电脑|帮我在|帮我把|发消息|发送|回复|播放|暂停|新建|保存|微信|QQ)/u.test(command);
  }
  function leadingAppIntent(command) {
    const match = String(command || '').match(/^(?:帮我|请)?打开(.+?)(?=(?:并|然后|再|给|，|,))/u);
    if (!match) return null;
    const name = String(match[1] || '').trim();
    if (!name || name.length > 80 || !/^[\p{L}\p{N}_\- .（）()]+$/u.test(name)) return null;
    if (/(卸载|终端|命令提示符|PowerShell|注册表|控制面板|安全中心|管理员工具|脚本)/iu.test(name)) return null;
    return { type: 'open_app_name', name };
  }
  function targetPoint(target, capture) {
    const box = target && Array.isArray(target.bbox) ? target.bbox.map(Number) : null;
    if (!box || box.length !== 4 || box.some((part) => !Number.isFinite(part) || part < 0 || part > 1)) return null;
    if (!(Number(target.confidence) >= 0.82)) return null;
    const width = Number(capture.screenWidth || capture.width);
    const height = Number(capture.screenHeight || capture.height);
    return {
      x: Math.round(Number(capture.originX || 0) + ((box[0] + box[2]) / 2) * width),
      y: Math.round(Number(capture.originY || 0) + ((box[1] + box[3]) / 2) * height),
    };
  }
  function executorAction(step, capture) {
    if (!step || typeof step !== 'object') return null;
    if (step.type === 'open_app') {
      const fixed = new Set(['notepad', 'calculator', 'explorer', 'settings', 'paint', 'browser']);
      return fixed.has(String(step.app || '').toLowerCase())
        ? { type: 'open_app', app: step.app }
        : { type: 'open_app_name', name: String(step.name || step.app || '') };
    }
    if (step.type === 'open_app_name') return { type: 'open_app_name', name: step.name };
    if (step.type === 'close_app') return { type: 'close_app', app: step.app };
    if (step.type === 'close_app_name') return { type: 'close_app_name', name: step.name };
    if (step.type === 'navigate_url') return { type: 'navigate_url', url: step.url };
    if (step.type === 'focus_window') return { type: 'focus_window', window: step.window };
    if (step.type === 'hotkey') return { type: 'hotkey', keys: step.keys };
    if (step.type === 'scroll') return { type: 'scroll', amount: step.amount, ...(step.target ? { target: step.target.label } : {}) };
    if (step.type === 'type_text') return { type: 'type_text', target: step.target?.label, text: step.text };
    if (step.type === 'wait_for') return { type: 'wait_for', target: step.target?.label, timeoutMs: step.timeoutMs };
    if (step.type === 'click' || step.type === 'double_click' || step.type === 'right_click') {
      const point = targetPoint(step.target, capture);
      return point ? { type: step.type + '_point', ...point } : { type: step.type, target: step.target?.label };
    }
    if (step.type === 'drag') {
      const from = targetPoint(step.from, capture);
      const to = targetPoint(step.to, capture);
      return from && to
        ? { type: 'drag_point', fromX: from.x, fromY: from.y, toX: to.x, toY: to.y }
        : { type: 'drag', from: step.from?.label, to: step.to?.label };
    }
    return null;
  }
  async function executeWindowsPlan(plan, capture, confirmed = false, task = null, startIndex = 0, taskOffset = 0, finalize = true) {
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error('没有可靠找到要操作的位置');
    const activeTask = task || startOperatorTask(plan.goal || '执行桌面任务', plan.steps);
    const executed = [];
    for (const [offset, step] of plan.steps.slice(startIndex, 12).entries()) {
      const index = startIndex + offset;
      const taskIndex = taskOffset + index;
      updateOperatorTask(activeTask, 'step-start', taskIndex);
      const action = executorAction(step, capture);
      if (!action) {
        updateOperatorTask(activeTask, 'failed', taskIndex, '视觉计划里有不支持的操作');
        throw new Error('视觉计划里有不支持的操作');
      }
      let result = await window.petBridge.runWindowsAction(action);
      if (result?.confirmationRequired && confirmed) {
        const prepared = await window.petBridge.prepareWindowsConfirmation?.(action);
        if (!prepared?.ok || !prepared.token) throw new Error(prepared?.message || '关键操作确认失败');
        result = await window.petBridge.runConfirmedWindowsAction?.(action, prepared.token);
      }
      if (!result?.ok) {
        updateOperatorTask(activeTask, result?.cancelled ? 'cancelled' : 'failed', taskIndex, result?.message);
        throw new Error(result?.message || '操作没有完成');
      }
      updateOperatorTask(activeTask, 'step-completed', taskIndex);
      executed.push({ step, action, result, confirmed });
    }
    if (finalize) updateOperatorTask(activeTask, 'completed', taskOffset + plan.steps.length - 1);
    return executed;
  }
  async function executeNotepadWriting(intent, pet) {
    const steps = [
      { type: 'compose_text' },
      intent.open ? { type: 'open_app', app: 'notepad' } : { type: 'focus_window', window: '记事本' },
      { type: 'hotkey', keys: 'ctrl+n' },
      { type: 'type_text', target: { label: '文本编辑器' }, text: '' },
      { type: 'verify' },
    ];
    const task = startOperatorTask(intent.goal, steps);
    show('thinking', '正在给主人组织文字…');
    const prompt = '请为记事本生成可直接使用的中文正文。只输出正文，不要解释，不要使用 Markdown。写作要求：' + intent.request;
    const response = await S.sendChat(
      BASE + '/chat?pet=' + encodeURIComponent(pet.pet.id) + '&surface=desktop',
      prompt,
      undefined,
      activeTraceId,
      false,
    );
    if (!response?.ok) {
      updateOperatorTask(task, 'failed', 0, response?.message || response?.reason || '正文生成失败');
      throw new Error(response?.message || response?.reason || '正文生成失败');
    }
    const text = String(response.text || '')
      .replace(/^```(?:text|txt|markdown)?\s*/iu, '')
      .replace(/\s*```$/u, '')
      .trim()
      .slice(0, 1000);
    if (!text) {
      updateOperatorTask(task, 'failed', 0, '没有生成可写入的正文');
      throw new Error('没有生成可写入的正文');
    }
    steps[3].text = text;
    updateOperatorTask(task, 'step-completed', 0);
    show('executing', intent.open ? '正文写好啦，正在打开记事本～' : '正文写好啦，正在写进记事本～');
    const actionSteps = steps.slice(1, 4);
    const executedBatch = await executeWindowsPlan(
      { goal: intent.goal, steps: actionSteps }, null, false, task, 0, 1, false,
    );
    const state = {
      goal: intent.goal,
      completed: steps.slice(0, 4).map(stepLabel),
      executed: executedBatch,
      turns: 0,
      actionCount: actionSteps.length,
      lastTask: task,
      verifyIndex: 4,
      lastTaskLastIndex: 4,
      validationNote: '',
    };
    updateOperatorTask(task, 'step-start', state.verifyIndex);
    await continueWindowsAgent(state, pet);
  }
  function windowsAgentPrompt(state) {
    const completed = state.completed.length ? state.completed.map((item, index) => `${index + 1}. ${item}`).join('\n') : '无';
    const validation = state.validationNote ? '\n上轮完成验收未通过：' + state.validationNote : '';
    return [
      '你正在继续执行一个 Windows 桌面任务。',
      '原始目标（不可缩减或改写）：' + state.goal,
      '已经真实执行并通过上一轮检查的步骤：\n' + completed,
      validation,
      '请只根据本轮最新截图规划下一小批动作，最多 3 步。任何会改变窗口、页面或对话框的动作后就结束本批，下一轮会重新截图。',
      '不要重复已完成步骤，不要声称已经执行。只有截图明确证明原始目标的每一部分都已完成，才可输出 goal="__DONE__:可见证据"、steps=[]。证据必须描述当前截图中可见的完成状态。',
      '例如目标要求登录/进入微信，而截图仍有“进入微信”按钮时绝对不能完成；目标要求发送消息时，必须经过用户确认并能看到已发送消息。',
      '若原始目标只是打开/切换到软件，而截图出现登录、扫码、验证码、更新、崩溃或权限页面，不要点击这些入口；输出 goal="__BLOCKED__:当前界面及需要用户处理的事项"、steps=[]。只有用户明确要求登录时才可点击普通登录入口。',
      '已执行“打开软件”不等于任务完成；必须从最新截图确认目标软件的正确主窗口或目标页面已经位于前台。',
      '若缺少联系人、消息正文或其他必要信息，输出 goal="__BLOCKED__:缺少的信息"、steps=[]，不要猜。',
      '消息任务必须先确认当前聊天标题与目标联系人完全一致；搜索结果没有完全同名项、出现多个同名项或无法看清名称时，输出 __BLOCKED__，禁止选择近似联系人。',
      '填写消息正文后先从最新截图核对聊天标题和输入框内容。点击“发送”必须是单独一轮且 requiresConfirmation=true；确认发送后还要从新截图看到消息出现在聊天记录中才能完成。',
      '发送消息、提交、删除、付款、安装或授权必须单独放在一个批次，并设置 requiresConfirmation=true；不要把它和前面的安全步骤放在同一批。',
      '点击用户明确要求进入的应用登录入口属于低风险，不需要确认；遇到密码、验证码、扫码或身份验证时停止并要求用户处理。',
      '不要输出解释、寒暄、Markdown 或代码块。必须严格只输出：<windows_plan>{"goal":"原始目标或__DONE__:证据","steps":[{"type":"click","target":{"label":"按钮名称","bbox":[0.1,0.1,0.2,0.2],"confidence":0.95}}],"requiresConfirmation":false}</windows_plan>',
    ].join('\n');
  }
  function parseLooseWindowsPlan(text, capture) {
    const source = String(text || '').trim();
    if (!source) return null;
    let raw = null;
    const body = VC.windowsPlanBody(source);
    if (body) {
      try {
        raw = JSON.parse(body);
      } catch {
        const goal = body.match(/\bgoal\s*=\s*["']([^"']{1,200})["']/u)?.[1];
        const requiresConfirmation = /\brequiresConfirmation\s*=\s*true\b/iu.test(body);
        const stepsAt = body.search(/\bsteps\s*=/iu);
        const arrayStart = stepsAt >= 0 ? body.indexOf('[', stepsAt) : -1;
        if (goal && arrayStart >= 0) {
          let depth = 0;
          let quoted = false;
          let escaped = false;
          let arrayEnd = -1;
          for (let index = arrayStart; index < body.length; index += 1) {
            const char = body[index];
            if (quoted) {
              if (escaped) escaped = false;
              else if (char === '\\') escaped = true;
              else if (char === '"') quoted = false;
              continue;
            }
            if (char === '"') quoted = true;
            else if (char === '[') depth += 1;
            else if (char === ']' && --depth === 0) {
              arrayEnd = index + 1;
              break;
            }
          }
          if (arrayEnd > arrayStart) {
            try {
              raw = { goal, steps: JSON.parse(body.slice(arrayStart, arrayEnd)), requiresConfirmation };
            } catch {}
          }
        }
      }
    }
    if (!raw || typeof raw !== 'object' || typeof raw.goal !== 'string' || !Array.isArray(raw.steps) || raw.steps.length > 3) return null;
    const allowed = new Set(['open_app', 'open_app_name', 'close_app', 'close_app_name', 'navigate_url', 'focus_window', 'click', 'double_click', 'right_click', 'drag', 'scroll', 'type_text', 'hotkey', 'wait_for']);
    const width = Number(capture?.screenWidth || capture?.width);
    const height = Number(capture?.screenHeight || capture?.height);
    const steps = raw.steps.map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const type = String(entry.type || entry.action || '').toLowerCase();
      if (!allowed.has(type)) return null;
      const step = { ...entry, type };
      delete step.action;
      if ((type === 'click' || type === 'double_click' || type === 'right_click') && !step.target && typeof entry.param === 'string') {
        const point = entry.param.match(/(?:约\s*)?(\d{1,5})\s*[,，]\s*(\d{1,5})/u);
        const label = entry.param.replace(/[（(]?\s*约?\s*\d{1,5}\s*[,，]\s*\d{1,5}\s*[）)]?/u, '').replace(/[「」]/gu, '').trim() || '目标控件';
        if (point && width > 0 && height > 0) {
          const x = Number(point[1]) / width;
          const y = Number(point[2]) / height;
          step.target = { label, bbox: [Math.max(0, x - 0.006), Math.max(0, y - 0.006), Math.min(1, x + 0.006), Math.min(1, y + 0.006)], confidence: 0.9 };
        } else {
          step.target = { label };
        }
      }
      delete step.param;
      return step;
    });
    if (steps.some((step) => !step)) return null;
    const risk = /(?:发送|提交|删除|付款|支付|购买|安装|授权|公开|send|submit|delete|pay|install|authorize)/iu.test(JSON.stringify(steps));
    return {
      goal: raw.goal.slice(0, 200),
      steps,
      requiresConfirmation: raw.requiresConfirmation === true || risk,
    };
  }
  function executedTarget(step) {
    return String(step?.target?.label || step?.target || step?.name || step?.app || step?.window || '');
  }
  function completionMissing(state, evidence) {
    const goal = state.goal;
    const executed = state.executed || [];
    const has = (predicate) => executed.some((item) => predicate(item.step, item.confirmed, item.result));
    const missing = [];
    if (!String(evidence || '').trim()) missing.push('缺少最新截图中的可见完成证据');
    if (/(?:打开|启动|切换到|进入)(?!登录|登陆)/u.test(goal)) {
      const activated = has((step, _confirmed, result) => /^(?:open_app|open_app_name|navigate_url|focus_window)$/u.test(String(step?.type))
        && result?.ok === true);
      const visiblyOpen = /(?:前台|主界面|窗口|页面|标签页|聊天列表|联系人列表|编辑区|已打开|正在播放)/u.test(evidence);
      if (!activated) missing.push('尚未执行并验证应用激活或页面导航');
      if (!visiblyOpen) missing.push('最新截图没有明确证明目标应用或页面已经在前台');
      if (!/(?:登录|登陆|扫码)/u.test(goal) && /(?:登录页|登录界面|扫码|验证码|进入微信按钮|尚未登录)/u.test(evidence)) {
        missing.push('当前是登录或验证界面，不能当作“打开应用”完成');
      }
    }
    if (/(?:登录|登陆|进入微信)/u.test(goal)) {
      const acted = has((step) => /^(?:click|double_click|click_point|double_click_point)$/u.test(String(step?.type))
        && /(?:进入微信|登录|登陆)/u.test(executedTarget(step)));
      const visibleMain = /(?:微信主界面|聊天列表|联系人列表|搜索框)/u.test(evidence)
        && !/(?:仍有|显示|停在).{0,8}进入微信/u.test(evidence);
      if (!acted && !visibleMain) missing.push('尚未证明已经进入微信主界面，当前登录入口不能当作完成');
    }
    if (/(?:发消息|发送消息|回复消息|发给)/u.test(goal)) {
      const sent = has((step, confirmed) => confirmed === true
        && /^(?:click|double_click|click_point|double_click_point)$/u.test(String(step?.type))
        && /(?:发送|send)/iu.test(executedTarget(step)));
      if (!sent) missing.push('尚未经过确认并执行发送动作');
      const recipient = goal.match(/给联系人[“"]([^”"]+)[”"]发送消息/u)?.[1];
      if (recipient && !String(evidence || '').includes(recipient)) missing.push('最新截图证据没有明确显示目标联系人“' + recipient + '”');
      if (!/(?:聊天记录|消息气泡|已发送|出现在会话|会话中可见)/u.test(evidence)) missing.push('最新截图没有证明消息已经出现在聊天记录中');
    }
    if (/(?:写入|输入|填写|写一段|编辑)/u.test(goal)
      && !has((step) => step?.type === 'type_text')) missing.push('尚未执行文字输入');
    if (/(?:写入|输入|填写|写一段|编辑)/u.test(goal)
      && !/(?:编辑区|正文|文本|内容|记事本).{0,18}(?:可见|显示|已经|写入)|(?:可见|显示|已经|写入).{0,18}(?:编辑区|正文|文本|内容|记事本)/u.test(evidence)) {
      missing.push('最新截图没有明确证明文字已经出现在编辑区');
    }
    if (/(?:播放音乐|播放歌曲|播放一首|放音乐)/u.test(goal)) {
      const played = has((step) => step?.type === 'media_play'
        || (/^(?:click|double_click|click_point|double_click_point)$/u.test(String(step?.type)) && /(?:播放|play)/iu.test(executedTarget(step))));
      if (!played && !/(?:暂停按钮|正在播放|播放进度)/u.test(evidence)) missing.push('尚未证明音乐正在播放');
    }
    return missing;
  }
  async function requestWindowsAgentBatch(state, pet) {
    activate();
    show(state.completed.length ? 'verifying' : 'thinking', state.completed.length ? '正在验证并看下一步…' : '让我看看屏幕并拆解任务…');
    const capture = await window.petBridge.captureScreen();
    const response = await S.sendChat(
      BASE + '/chat?pet=' + encodeURIComponent(pet.pet.id) + '&surface=desktop',
      windowsAgentPrompt(state),
      { mediaType: capture.mediaType, data: capture.data },
      activeTraceId,
      true,
    );
    S.stopVoicePlayback?.();
    if (!response?.ok) throw new Error(response?.message || response?.reason || '视觉规划失败');
    if (!response.windowsPlan && response.text) response.windowsPlan = parseLooseWindowsPlan(response.text, capture);
    return { response, capture };
  }
  async function continueWindowsAgent(state, pet) {
    while (state.turns < 12 && state.actionCount < 24) {
      const { response, capture } = await requestWindowsAgentBatch(state, pet);
      const rawPlan = response.windowsPlan;
      const plan = rawPlan && Array.isArray(rawPlan.steps) && rawPlan.steps.length > 1
        ? { ...rawPlan, steps: rawPlan.steps.slice(0, 1) }
        : rawPlan;
      if (!plan) {
        if (state.lastTask && state.verifyIndex >= 0) updateOperatorTask(state.lastTask, 'failed', state.verifyIndex, '视觉模型没有返回可执行计划');
        throw new Error('视觉模型没有返回可执行计划');
      }
      const goal = String(plan.goal || '');
      const doneClaim = goal === '__DONE__' || goal.startsWith('__DONE__:');
      const evidence = goal.startsWith('__DONE__:') ? goal.slice('__DONE__:'.length) : '';
      if (doneClaim || (plan.steps.length === 0 && state.completed.length > 0 && !goal.startsWith('__BLOCKED__'))) {
        const missing = completionMissing(state, evidence);
        if (missing.length) {
          state.validationNote = missing.join('；');
          state.turns += 1;
          if (state.lastTask && state.verifyIndex >= 0) updateOperatorTask(state.lastTask, 'failed', state.verifyIndex, state.validationNote);
          continue;
        }
        if (state.lastTask && state.verifyIndex >= 0) {
          updateOperatorTask(state.lastTask, 'step-completed', state.verifyIndex);
          state.verifyIndex = -1;
        }
        if (state.lastTask) updateOperatorTask(state.lastTask, 'completed', Math.max(0, state.lastTaskLastIndex || 0));
        show('success', '✓ 已验证任务完成', 1800);
        activate();
        speakOutcome('任务已经完成啦～');
        return { ok: true };
      }
      if (goal.startsWith('__BLOCKED__:')) {
        const reason = goal.slice('__BLOCKED__:'.length) || '缺少继续执行所需的信息';
        if (state.lastTask && state.verifyIndex >= 0) updateOperatorTask(state.lastTask, 'failed', state.verifyIndex, reason);
        pendingAgentInput = state;
        activate();
        show('waiting', '还需要你补充：' + reason);
        speakOutcome('还需要你补充一下：' + reason);
        return { ok: false, blocked: true, reason };
      }
      if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error('没有可靠找到下一步操作');
      if (state.actionCount + plan.steps.length > 24) throw new Error('任务步骤过多，已安全停止');

      if (state.lastTask && state.verifyIndex >= 0) {
        updateOperatorTask(state.lastTask, 'step-completed', state.verifyIndex);
        state.verifyIndex = -1;
      }

      const historySteps = state.completed.map((label) => ({ type: 'history', label }));
      const displaySteps = [...historySteps, ...plan.steps, { type: 'verify' }];
      const task = startOperatorTask(state.goal, displaySteps);
      for (let index = 0; index < historySteps.length; index += 1) updateOperatorTask(task, 'step-completed', index);
      const taskOffset = historySteps.length;
      if (plan.requiresConfirmation) {
        updateOperatorTask(task, 'waiting-confirmation', taskOffset);
        pendingWindowsPlan = { plan, capture, task, taskOffset, agentState: state };
        activate();
        show('waiting', '下一步会产生外部影响，请说“确认”或“取消”～');
        return { ok: false, pending: true };
      }

      const executedBatch = await executeWindowsPlan(plan, capture, false, task, 0, taskOffset, false);
      state.completed.push(...plan.steps.map(stepLabel));
      state.executed.push(...executedBatch);
      state.validationNote = '';
      state.actionCount += plan.steps.length;
      state.turns += 1;
      state.lastTask = task;
      state.verifyIndex = displaySteps.length - 1;
      state.lastTaskLastIndex = displaySteps.length - 1;
      updateOperatorTask(task, 'step-start', state.verifyIndex);
    }
    throw new Error('多轮执行达到安全上限，已停止');
  }
  async function runWindowsAgent(goal, pet, initialAction = null) {
    commandBusy = true;
    activate();
    try {
      const state = { goal, completed: [], executed: [], turns: 0, actionCount: 0, lastTask: null, verifyIndex: -1, lastTaskLastIndex: 0, validationNote: '' };
      if (initialAction) {
        const initialSteps = Array.isArray(initialAction) ? initialAction : [initialAction];
        const displaySteps = [...initialSteps, { type: 'verify' }];
        const task = startOperatorTask(goal, displaySteps);
        const executedBatch = await executeWindowsPlan({ goal, steps: initialSteps }, null, false, task, 0, 0, false);
        state.completed.push(...initialSteps.map(stepLabel));
        state.executed.push(...executedBatch);
        state.actionCount = initialSteps.length;
        state.lastTask = task;
        state.verifyIndex = initialSteps.length;
        state.lastTaskLastIndex = initialSteps.length;
        updateOperatorTask(task, 'step-start', state.verifyIndex);
      }
      return await continueWindowsAgent(state, pet);
    } finally {
      commandBusy = false;
      activate();
    }
  }
  async function handleText(text, turnId) {
    if (!turnGate.accept(turnId)) {
      log('turn-duplicate-suppressed', { turnId });
      return;
    }
    log('turn-accepted', { turnId });
    log('asr-result', { chars: String(text || '').length, empty: !text });
    const rawHeard = String(text || '').trim();
    const heard = normalize(rawHeard);
    const spoken = normalize(lastTtsText);
    const looksLikeEcho = Date.now() - lastTtsInterruptedAt < 5000 && heard.length >= 4 && spoken.length >= 4
      && (spoken.includes(heard) || heard.includes(spoken.slice(0, Math.min(spoken.length, 12))));
    if (looksLikeEcho) {
      log('barge-in-echo-rejected', { chars: String(text || '').length });
      show('listening', '刚才是我自己的声音，再说一次吧～', 1800);
      return;
    }
    if (!text) {
      show('recognized', '没有听清，再说一次吧～', 1600);
      return;
    }
    show('recognized', '识别到：' + text);
    const active = sessionCanHear();
    const wake = matchWake(rawHeard);
    log('wake-match', wake || { matched: false, active });
    if (!active && !wake && !pendingMessageDraft && !pendingWindowsPlan && !pendingAgentInput) { showWaiting(); return; }
    activate();
    const rawCommand = VC.correctKnownTerms(wake ? (wake.rawCommand || wake.command) : rawHeard);
    const command = normalize(rawCommand);
    if (!command) { show('listening', '我在呢，请说～'); return; }
    const routed = VC.routeVoiceIntent(rawCommand, sessionContext());
    log('intent-route', { type: routed.type, fastPath: routed.fastPath?.type || '', hasTask: sessionContext().hasTask });
    if (routed.type === 'sleep') {
      const cancelledTask = pendingWindowsPlan?.task;
      pendingWindowsPlan = null;
      pendingAgentInput = null;
      pendingMessageDraft = null;
      activeUntil = 0;
      window.petBridge?.cancelWindowsAction?.();
      updateOperatorTask(cancelledTask, 'cancelled', 0, '会话已结束');
      show('waiting', '那我先待机啦～', 1800);
      return;
    }
    if (/^(?:停下|停止|取消|别动了|不要操作)/u.test(command)) {
      const cancelledTask = pendingWindowsPlan?.task;
      pendingWindowsPlan = null;
      pendingAgentInput = null;
      pendingMessageDraft = null;
      window.petBridge?.cancelWindowsAction?.();
      updateOperatorTask(cancelledTask, 'cancelled', 0, '用户取消');
      show('waiting', '好哒，已经停下啦');
      return;
    }
    if (commandBusy) {
      show('executing', '当前任务还在执行中；想中止请说“停下”～', 3000);
      return;
    }
    if (pendingMessageDraft) {
      const content = VC.messageFollowupContent(rawCommand, pendingMessageDraft.recipient);
      if (!content || content.length > 1000) {
        show('waiting', content.length > 1000 ? '消息太长啦，请控制在一千字以内～' : '没有听到消息内容，再说一次吧～', 3500);
        return;
      }
      const draft = { ...pendingMessageDraft, content };
      pendingMessageDraft = null;
      await executeMessageIntent(draft, sprite());
      return;
    }
    if (pendingAgentInput && routed.type !== 'windows_task') {
      const state = pendingAgentInput;
      pendingAgentInput = null;
      state.goal += '\n用户补充：' + command;
      activate();
      await continueWindowsAgent(state, sprite());
      return;
    }
    if (/^(?:确认|确定|执行吧|继续|确认发送|发送吧|可以发送)$/u.test(command) && pendingWindowsPlan) {
      const pending = pendingWindowsPlan;
      pendingWindowsPlan = null;
      show('executing', '收到确认，开始执行～');
      if (pending.agentState) {
        const executedBatch = await executeWindowsPlan(pending.plan, pending.capture, true, pending.task, 0, pending.taskOffset || 0, false);
        pending.agentState.completed.push(...pending.plan.steps.map(stepLabel));
        pending.agentState.executed.push(...executedBatch);
        pending.agentState.validationNote = '';
        pending.agentState.actionCount += pending.plan.steps.length;
        pending.agentState.turns += 1;
        pending.agentState.lastTask = pending.task;
        pending.agentState.verifyIndex = (pending.taskOffset || 0) + pending.plan.steps.length;
        pending.agentState.lastTaskLastIndex = pending.agentState.verifyIndex;
        updateOperatorTask(pending.task, 'step-start', pending.agentState.verifyIndex);
        await continueWindowsAgent(pending.agentState, sprite());
      } else {
        await executeWindowsPlan(pending.plan, pending.capture, true, pending.task);
        show('success', '✓ 任务完成啦', 1800);
      }
      return;
    }
    sprite()?.operatorTask?.clear?.();
    const pet = sprite();
    if (await submitDshAgentTurn(rawCommand, turnId)) return;
    const messageIntent = VC.parseMessageIntent(rawCommand);
    if (messageIntent) {
      await executeMessageIntent(messageIntent, pet);
      return;
    }
    if (routed.type === 'windows_task' && routed.fastPath?.type === 'browser_search') {
      await runWindowsAgent(routed.goal, pet, { type: 'navigate_url', url: routed.fastPath.url });
      return;
    }
    if (/(?:给(?:他|她|对方)|发(?:一条|一个|个)?(?:消息|信息)|发送(?:消息|信息)|微信.{0,12}发|QQ.{0,12}发)/iu.test(rawCommand)) {
      log('message-intent-miss', { chars: rawCommand.length });
      show('waiting', '这条消息还缺少明确的联系人或正文，请说“给某某发消息：内容”～', 4500);
      speakOutcome('还缺少明确的联系人或消息内容，请再说完整一点哦。');
      return;
    }
    const writingIntent = notepadWritingIntent(command);
    if (writingIntent) {
      await executeNotepadWriting(writingIntent, pet);
      return;
    }
    const intent = windowsIntent(command);
    if (intent) {
      if (window.petBridge?.captureScreen) {
        // 复合命令只先执行第一步；打开窗口后必须重新截图，后续播放/搜索/输入由下一轮决定。
        await runWindowsAgent(command, pet, intent.actions?.[0] || intent.action);
      } else {
        const result = await executeWindows(intent);
        speakOutcome(result?.message || '任务完成啦');
      }
      return;
    }
    const leadingAction = leadingAppIntent(command);
    if (leadingAction && window.petBridge?.captureScreen) {
      await runWindowsAgent(command, pet, leadingAction);
      return;
    }
    show('thinking', '正在想…');
    log('chat-start', { inputChars: command.length });
    const useWindowsAgent = !intent
      && (routed.type === 'windows_task' || routed.type === 'task_followup' || looksLikeWindowsTask(command))
      && window.petBridge?.captureScreen;
    if (useWindowsAgent) {
      await runWindowsAgent(routed.goal || rawCommand, pet);
      return;
    }
    const response = await S.sendChat(
      BASE + '/chat?pet=' + encodeURIComponent(pet.pet.id) + '&surface=desktop',
      command,
      undefined,
      activeTraceId,
      false,
    );
    log('chat-result', {
      ok: response?.ok,
      outputChars: typeof response?.text === 'string' ? response.text.length : undefined,
      emotion: response?.emotion,
      speed: response?.speed,
      tag: response?.tag,
      action: response?.action,
    });
    if (!response.ok) throw new Error(response.message || response.reason || '对话失败');
    // 最终正文、情绪动作与 TTS 会从 /state 的 say 叶子进入原链路。
    hide();
  }
  async function finishSegment() {
    if (busy || chunks.length === 0) return;
    const parts = chunks;
    const samples = parts.reduce((sum, part) => sum + part.length, 0);
    const peak = segmentPeak;
    const turnId = activeTraceId || newTraceId();
    chunks = []; speechStart = 0; lastVoice = 0; segmentPeak = 0; busy = true;
    log('speech-end', { durationMs: Math.round((samples / sampleRate) * 1000), peak: Number(peak.toFixed(5)) });
    try {
      await kwsChain;
      if (kwsAvailable && !sessionCanHear() && !kwsMatched) {
        log('kws-rejected', { audioMs: Math.round(samples / sampleRate * 1000) });
        showWaiting();
        return;
      }
      show('transcribing', '识别中…');
      const text = await transcribe(parts);
      // ASR 已经取走本段音频；后续任务可以很久，但麦克风必须立刻恢复以便听到“停下”。
      busy = false;
      await handleText(text, turnId);
    } catch (error) {
      if (!disposed) show('error', '呜…' + (error?.message || String(error)), 3500);
    } finally { busy = false; kwsMatched = ''; }
  }
  const audioConstraints = (deviceId, explicitVirtualInput = false) => ({
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    // Remote virtual devices already apply their own gain. Browser AGC pumps
    // their always-on noise floor and makes silence look like continuous speech.
    autoGainControl: !explicitVirtualInput,
    sampleRate: { ideal: sampleRate },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  });
  async function acquireStream() {
    let current = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints('') });
    const pattern = String(cfg.voiceWakeDevicePattern || '').trim().toLocaleLowerCase();
    if (pattern && navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const match = devices.find(
        (device) => device.kind === 'audioinput' && String(device.label || '').toLocaleLowerCase().includes(pattern),
      );
      if (match && current.getAudioTracks()[0]?.getSettings?.().deviceId !== match.deviceId) {
        for (const track of current.getTracks()) track.stop();
        current = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(match.deviceId, true) });
      } else if (!match) {
        log('device-pattern-miss', { pattern, devices: devices.filter((d) => d.kind === 'audioinput').map((d) => d.label) });
      }
    }
    return current;
  }
  async function start() {
    show('waiting', '正在申请麦克风…');
    try {
      stream = await acquireStream();
      const track = stream.getAudioTracks()[0];
      const vad = VC.vadProfile(track?.label, cfg.voiceWakeDevicePattern);
      silenceMs = vad.silenceMs;
      vadStartFloor = vad.startFloor;
      vadContinueFloor = vad.continueFloor;
      log('device-ready', {
        label: track?.label || 'unknown', settings: track?.getSettings?.() || {},
        remoteVirtual: vad.remoteVirtual, silenceMs,
      });
      ctx = new AudioContext({ sampleRate }); source = ctx.createMediaStreamSource(stream);
      processor = ctx.createScriptProcessor(1024, 1, 1);
      calibrationStarted = performance.now();
      show('waiting', '正在校准麦克风：' + (track?.label || '默认输入'));
      processor.onaudioprocess = (event) => {
        if (disposed || busy) return;
        const now = performance.now();
        const input = new Float32Array(event.inputBuffer.getChannelData(0));
        const level = rms(input);
        if (calibrating) {
          calibrationLevels.push(level);
          if (now - calibrationStarted < calibrationMs) return;
          const thresholds = typeof S.calibrateVoiceVad === 'function'
            ? S.calibrateVoiceVad(calibrationLevels)
            : { noiseFloor: 0.003, startThreshold: 0.008, continueThreshold: 0.004 };
          startThreshold = Math.max(vadStartFloor, thresholds.startThreshold);
          continueThreshold = Math.max(vadContinueFloor, Math.min(startThreshold * 0.72, thresholds.continueThreshold));
          calibrating = false;
          calibrationLevels = [];
          log('vad-calibrated', {
            noiseFloor: Number(thresholds.noiseFloor.toFixed(5)),
            startThreshold: Number(startThreshold.toFixed(5)),
            continueThreshold: Number(continueThreshold.toFixed(5)),
            sampleRate: ctx.sampleRate,
          });
          showWaiting();
          return;
        }
        const captureMode = VC.voiceCaptureMode(Date.now(), speaking, ttsCooldownUntil);
        if (captureMode === 'keyword-only') {
          preRoll.push(input);
          while (preRoll.length > wakePreRollFrames) preRoll.shift();
          feedKws(input, true);
          return;
        }
        feedKws(input, false);
        if (!speechStart) {
          preRoll.push(input);
          const inactiveKws = kwsAvailable && !sessionCanHear();
          const preRollLimit = inactiveKws ? wakePreRollFrames : 4;
          while (preRoll.length > preRollLimit) preRoll.shift();
          // Before a keyword hit, KWS owns the always-on audio stream. Do not
          // let virtual-device noise create ordinary ASR segments or a false
          // permanent "listening" state. If KWS is unavailable, retain the
          // old ASR wake-word fallback.
          if (inactiveKws) return;
          if (level < startThreshold) return;
          speechStart = now; lastVoice = now; segmentPeak = level; chunks = preRoll.splice(0);
          activeTraceId = newTraceId();
          kwsMatched = '';
          log('speech-start', { level: Number(level.toFixed(5)), startThreshold: Number(startThreshold.toFixed(5)) });
          show('listening', '正在听…');
        }
        chunks.push(input);
        segmentPeak = Math.max(segmentPeak, level);
        if (level >= continueThreshold) lastVoice = now;
        const elapsed = now - speechStart;
        if ((elapsed >= minSpeechMs && now - lastVoice >= silenceMs) || elapsed >= maxSpeechMs) void finishSegment();
      };
      source.connect(processor); processor.connect(ctx.destination); await ctx.resume();
      log('audio-context', { state: ctx.state, sampleRate: ctx.sampleRate });
    } catch (error) {
      log('microphone-error', { name: error?.name, message: error?.message || String(error) });
      show('error', '麦克风不可用：' + (error?.message || String(error)));
    }
  }
  function dispose() {
    disposed = true; abort?.abort(); onVoiceEvent?.(); if (statusTimer !== null) clearTimeout(statusTimer);
    if (activeTimer !== null) clearTimeout(activeTimer);
    window.petBridge?.setWindowsActionProgressHandler?.(null);
    if (pageTimer !== null) clearInterval(pageTimer);
    if (processor) processor.onaudioprocess = null;
    try { source?.disconnect(); processor?.disconnect(); } catch {}
    for (const track of stream?.getTracks?.() || []) track.stop();
    void ctx?.close?.(); hide();
  }
  return { start, dispose };
}
