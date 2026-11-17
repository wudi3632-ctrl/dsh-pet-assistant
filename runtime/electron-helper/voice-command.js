/** 语音命令的纯解析逻辑：可在浏览器运行，也可由 Node 单测。 */
'use strict';

(function init(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DshPetVoiceCommand = api;
})(typeof window !== 'undefined' ? window : globalThis, function factory() {
  const punctuation = /[\s，。！？、,.!?：:；;“”‘’"']/gu;
  const compact = (value) => String(value || '').trim().replace(punctuation, '');

  function correctKnownTerms(value) {
    return String(value || '')
      .replace(/微[性兴星鑫]/gu, '微信')
      .replace(/记[事世式术]本/gu, '记事本')
      .replace(/网[易一亿]云/gu, '网易云')
      .replace(/浏[览蓝]器/gu, '浏览器')
      .replace(/哔哩哔哩|比利比利/gu, '哔哩哔哩');
  }

  function wakeMatch(text, words) {
    const source = String(text || '').trim();
    const normalized = compact(source);
    const aliases = { 大肥鱼: ['大飞鱼'], 鲸鲸: ['静静', '晶晶', '京京'], 小鲸鱼: ['小金鱼'], 小鲸: ['小静', '小晶', '小金'] };
    const match = words.flatMap((word) => [word, ...(aliases[word] || [])].map((spoken) => ({ word, spoken })))
      .sort((a, b) => b.spoken.length - a.spoken.length)
      .find((item) => normalized.startsWith(compact(item.spoken)));
    if (!match) return null;
    const compactCommand = normalized.slice(compact(match.spoken).length);
    const wakeAlphabet = new Set(words.flatMap((word) => [word, ...(aliases[word] || [])]).flatMap((spoken) => [...compact(spoken)]));
    if (compactCommand.length >= 2 && [...compactCommand].every((char) => wakeAlphabet.has(char))) return null;

    // ASR 通常把唤醒词放在句首；只删除句首这一次，保留正文中的标点和空格。
    const escaped = [...match.spoken].map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s，。！？、,.!?：:；;“”‘’"\']*');
    const rawCommand = source.replace(new RegExp('^[\\s，。！？、,.!?：:；;“”‘’"\']*' + escaped + '[\\s，。！？、,.!?：:；;“”‘’"\']*', 'u'), '').trim();
    return { word: match.word, command: compactCommand, rawCommand };
  }

  function cleanMessageContent(value) {
    return String(value || '')
      .replace(/^[\s：:，,。]*/u, '')
      .replace(/^(?:内容是|内容为|说(?:一下)?|告诉(?:他|她)?)[\s：:，,。]*/u, '')
      .trim();
  }

  function parseMessageIntent(input) {
    const source = correctKnownTerms(String(input || '').trim())
      // 远控 ASR 偶尔会在句首多出语气字；仅在它紧邻明确动作词时清理，避免改写正文。
      .replace(/^(?:嗯|呃|额|那个|一)+(?=给|打开|用)/u, '');
    if (!/(?:发|发送|回复).{0,4}(?:消息|信息)|发微信|发QQ/iu.test(source)) return null;
    const patterns = [
      /^(?:帮我|请)?(?:打开)?(?:给)?(微信|QQ)(?:的)?(?:联系人|好友|列表)?(?:里的|中的|里|中)?(?:(?:并|然后|再)?给)?(.{1,40}?)(?:发|发送)(?:一条|一个|个)?(?:微信|QQ)?(?:消息|信息)([\s\S]*)$/iu,
      /^(?:帮我|请)?用(微信|QQ)给(.{1,40}?)(?:发|发送)(?:一条|一个|个)?(?:消息|信息)([\s\S]*)$/iu,
      /^(?:帮我|请)?给(.{1,40}?)(?:发|发送)(?:一条|一个|个)?(微信|QQ)?(?:消息|信息)([\s\S]*)$/iu,
    ];
    let app = 'wechat';
    let recipient = '';
    let content = '';
    let match = source.match(patterns[0]);
    if (match) {
      app = /^qq$/iu.test(match[1]) ? 'qq' : 'wechat';
      recipient = match[2]; content = match[3];
    } else if ((match = source.match(patterns[1]))) {
      app = /^qq$/iu.test(match[1]) ? 'qq' : 'wechat';
      recipient = match[2]; content = match[3];
    } else if ((match = source.match(patterns[2]))) {
      app = /^qq$/iu.test(match[2]) ? 'qq' : 'wechat';
      recipient = match[1]; content = match[3];
    } else {
      return null;
    }
    recipient = String(recipient || '')
      .replace(/^(?:并|然后|再)?给/u, '')
      .replace(/^的/u, '')
      .replace(/^(?:列表|联系人|好友)(?:里的|中的|里|中)?/u, '')
      .replace(/[：:，,。\s]+$/u, '')
      .trim();
    content = cleanMessageContent(content);
    if (!recipient || recipient.length > 40 || content.length > 1000) return null;
    return { app, appName: app === 'qq' ? 'QQ' : '微信', recipient, content };
  }

  function messageFollowupContent(input, recipient) {
    let value = String(input || '').trim();
    const escapedRecipient = String(recipient || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const recipientPart = escapedRecipient ? '(?:' + escapedRecipient + '|他|她|对方)' : '(?:他|她|对方)';
    value = value.replace(new RegExp('^(?:消息)?(?:内容)?(?:是|为)?[\\s：:，,。]*(?:给' + recipientPart + ')?(?:发|发送)?(?:一条|一个|个)?(?:消息|信息)?[\\s：:，,。]*', 'u'), '');
    return value.trim();
  }

  function vadProfile(label, configuredPattern) {
    const text = (String(label || '') + ' ' + String(configuredPattern || '')).toLocaleLowerCase();
    const remoteVirtual = /uu远程|virtual|虚拟音频|remote/u.test(text);
    return remoteVirtual
      ? { remoteVirtual: true, silenceMs: 900, startFloor: 0.012, continueFloor: 0.0065 }
      : { remoteVirtual: false, silenceMs: 650, startFloor: 0.008, continueFloor: 0.0045 };
  }

  function windowsPlanBody(value) {
    const source = String(value || '').trim();
    return source.match(/<windows_plan>\s*([\s\S]*?)\s*<\/windows_plan>/iu)?.[1]
      || source.match(/```windows_plan\s*([\s\S]*?)\s*```/iu)?.[1]
      || source.match(/\[windows_plan\]\s*([\s\S]*?)\s*$/iu)?.[1]
      || '';
  }

  function browserSearchIntent(input) {
    const source = correctKnownTerms(String(input || '').trim())
      .replace(/^(?:嗯|呃|额|那个)+/u, '');
    const patterns = [
      /^(?:帮我|请)?(?:打开|这|用|在|去)?(?:默认)?浏览器(?:里|中)?(?:并|然后|再)?(?:帮我)?(?:搜索|搜一下|搜|查询|查一下|查)(.+)$/u,
      /^(?:帮我|请|去)?(?:搜索|搜一下|搜|查询|查一下|查|看一下|看看|了解一下)(.+(?:天气预报|天气).*)$/u,
      /^(?:帮我|请|去)?(?:看一下|看看)(今天|明天|后天)?(.{1,40}?)(?:的)?(天气预报|天气)$/u,
    ];
    let query = '';
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (!match) continue;
      query = match.slice(1).filter(Boolean).join('').trim();
      break;
    }
    query = query.replace(/^[\s：:，,。]+|[\s。]+$/gu, '').trim();
    if (!query || query.length > 200) return null;
    return {
      type: 'browser_search',
      query,
      goal: '在浏览器中搜索“' + query + '”',
      url: 'https://www.baidu.com/s?wd=' + encodeURIComponent(query),
    };
  }

  function closeApplicationIntent(input) {
    const source = correctKnownTerms(String(input || '').trim());
    const match = source.match(/^(?:帮我|请)?(?:关闭|关掉|退出)(.+?)(?:吧|一下)?$/u);
    if (!match) return null;
    const name = String(match[1] || '').replace(/(?:窗口|软件|应用)$/u, '').trim();
    if (!name || name.length > 80 || !/^[\p{L}\p{N}_\- .（）()]+$/u.test(name)) return null;
    if (/(终端|命令提示符|PowerShell|注册表|控制面板|安全中心|管理员工具|脚本)/iu.test(name)) return null;
    const aliases = { 记事本: 'notepad', 计算器: 'calculator', 资源管理器: 'explorer', 文件管理器: 'explorer', 设置: 'settings', 画图: 'paint', 浏览器: 'browser', 微信: 'wechat', QQ: 'qq' };
    return aliases[name] ? { type: 'close_app', app: aliases[name], name } : { type: 'close_app_name', name };
  }

  function routeVoiceIntent(input, context) {
    const source = correctKnownTerms(String(input || '').trim());
    const compacted = compact(source);
    if (!compacted) return { type: 'clarify', reason: 'empty' };
    if (/^(?:休息吧|结束对话|别听了|退出会话)$/u.test(compacted)) return { type: 'sleep' };
    if (/^(?:停下|停止|取消|别动了|不要操作)$/u.test(compacted)) return { type: 'cancel' };
    if (/^(?:确认|确定|执行吧|继续|确认发送|发送吧|可以发送)$/u.test(compacted)) return { type: 'confirm' };
    const close = closeApplicationIntent(source);
    if (close) return { type: 'windows_task', fastPath: close, goal: '关闭' + close.name };
    const message = parseMessageIntent(source);
    if (message) return { type: 'message', message };
    const search = browserSearchIntent(source);
    if (search) return { type: 'windows_task', fastPath: search, goal: search.goal };
    const taskPattern = /(?:打开|关闭|关掉|退出|访问|进入|切换到|点击|点一下|双击|右键|拖到|滚动|输入|填写|写入|编辑|键入|选择|勾选|播放|暂停|新建|保存|搜索|查询|查一下|搜一下|发送|回复|操作电脑|帮我在|帮我把)/u;
    const taskObject = /(?:浏览器|网页|网站|软件|应用|窗口|记事本|计算器|资源管理器|文件管理器|微信|QQ|网易云|文档|表格|表单|输入框|按钮|天气)/iu;
    if (taskPattern.test(source) || (taskObject.test(source) && /(?:帮我|请|去|给|把|在|用|并)/u.test(source))) {
      return { type: context?.hasTask ? 'task_followup' : 'windows_task', goal: source };
    }
    return { type: 'chat' };
  }

  function sessionCanHearWithoutWake(now, activeUntil, context) {
    if (Number(now) < Number(activeUntil)) return true;
    return Boolean(context?.awaitingInput || context?.awaitingConfirmation || context?.executing || context?.verifying);
  }

  function resolveActiveMs(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 30000;
    return Math.min(300000, Math.max(5000, Math.round(parsed)));
  }

  function voiceCaptureMode(now, speaking, cooldownUntil) {
    return speaking || Number(now) < Number(cooldownUntil) ? 'keyword-only' : 'normal';
  }

  function createTurnGate(limit) {
    const maximum = Number.isInteger(limit) && limit > 0 ? limit : 128;
    const accepted = new Set();
    return {
      accept(turnId) {
        const id = String(turnId || '').trim();
        if (!id || accepted.has(id)) return false;
        accepted.add(id);
        while (accepted.size > maximum) accepted.delete(accepted.values().next().value);
        return true;
      },
      has(turnId) {
        return accepted.has(String(turnId || '').trim());
      },
    };
  }

  return {
    compact, correctKnownTerms, wakeMatch, parseMessageIntent, messageFollowupContent,
    vadProfile, windowsPlanBody, browserSearchIntent, closeApplicationIntent, routeVoiceIntent, sessionCanHearWithoutWake,
    resolveActiveMs, voiceCaptureMode, createTurnGate,
  };
});
