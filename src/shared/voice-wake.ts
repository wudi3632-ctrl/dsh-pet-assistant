/** 免手语音唤醒的纯判定：文本规范化、唤醒词提取与轻量 Windows 指令解析。 */

export const DEFAULT_WAKE_WORDS = ['大肥鱼', '鲸鲸', '小鲸鱼', '小鲸'] as const;

export interface WakeMatch {
  readonly wakeWord: string;
  readonly command: string;
}

export interface VoiceVadThresholds {
  readonly noiseFloor: number;
  readonly startThreshold: number;
  readonly continueThreshold: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * 从启动阶段的 RMS 样本估算远控/实体麦克风的 VAD 门限。
 * 取较低分位避免用户恰好在校准时说话把整段当成底噪；上下限则兼容数字静音与高底噪虚拟设备。
 */
export function calibrateVoiceVad(levels: readonly number[]): VoiceVadThresholds {
  const sorted = levels.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const noiseFloor = sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.35))];
  const startThreshold = clamp(Math.max(noiseFloor * 2.2, noiseFloor + 0.003), 0.003, 0.08);
  const continueThreshold = clamp(Math.max(noiseFloor * 1.35, startThreshold * 0.45), 0.0015, startThreshold * 0.85);
  return { noiseFloor, startThreshold, continueThreshold };
}

/** 将长气泡按标点优先切页；每页仍由 CSS 控制为最多三行，完整原文不会被截断。 */
export function voiceBubblePages(text: string, maxChars = 42): string[] {
  const source = String(text || '').trim();
  if (!source) return [''];
  const limit = Math.max(12, Math.floor(maxChars));
  const pages: string[] = [];
  let rest = source;
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    const minBreak = Math.floor(limit * 0.55);
    let cut = -1;
    for (let i = window.length - 1; i >= minBreak; i -= 1) {
      if (/[，。！？；、,.!?;\s]/u.test(window[i])) {
        cut = i + 1;
        break;
      }
    }
    if (cut < 1) cut = limit;
    pages.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest || pages.length === 0) pages.push(rest);
  return pages;
}

const WAKE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  大肥鱼: ['大飞鱼'],
  鲸鲸: ['静静', '晶晶', '京京'],
  小鲸鱼: ['小金鱼'],
  小鲸: ['小静', '小晶'],
};

/** 去掉 ASR 常见标点与空白，但保留中文、字母和数字。 */
export function normalizeWakeText(text: string): string {
  return text.trim().replace(/[\s，。！？、,.!?：:；;“”‘’"']/g, '');
}

/** 只允许句首唤醒，避免普通对话中提到名字就误触发。长词优先，防“小鲸鱼”先命中“小鲸”。 */
export function matchWakeWord(text: string, words: readonly string[] = DEFAULT_WAKE_WORDS): WakeMatch | null {
  const normalized = normalizeWakeText(text);
  const ordered = words
    .filter(Boolean)
    .flatMap((word) => [word, ...(WAKE_ALIASES[word] ?? [])].map((spoken) => ({ word, spoken })))
    .sort((a, b) => b.spoken.length - a.spoken.length);
  const match = ordered.find(({ spoken }) => normalized.startsWith(normalizeWakeText(spoken)));
  if (!match) return null;
  const command = normalized.slice(normalizeWakeText(match.spoken).length);
  // 热词模型在长背景语音上偶尔会吐出“鲸鲸鱼、鲸鲸鱼”一类纯名字回声；它没有真实语义，不能进入对话。
  const wakeAlphabet = new Set(ordered.flatMap(({ spoken }) => [...normalizeWakeText(spoken)]));
  if (command.length >= 2 && [...command].every((char) => wakeAlphabet.has(char))) return null;
  return { wakeWord: match.word, command };
}

export type LocalWindowsIntent =
  | { readonly type: 'open_app'; readonly app: string }
  | { readonly type: 'click'; readonly target: string }
  | { readonly type: 'drag'; readonly from: string; readonly to: string }
  | { readonly type: 'click_point'; readonly x: number; readonly y: number }
  | { readonly type: 'drag_point'; readonly fromX: number; readonly fromY: number; readonly toX: number; readonly toY: number };

const APP_ALIASES: Readonly<Record<string, string>> = {
  记事本: 'notepad',
  计算器: 'calculator',
  资源管理器: 'explorer',
  文件管理器: 'explorer',
  设置: 'settings',
  画图: 'paint',
  微信: 'wechat',
  QQ: 'qq',
  浏览器: 'browser',
  终端: 'terminal',
};

/**
 * 解析确定性、低风险的本机动作。它不是 LLM 工具解析器：不识别删除、发送、安装，也不生成 Shell。
 * 可访问名称允许中文、字母、数字、空格、下划线和短横线，其余符号拒绝。
 */
export function parseLocalWindowsIntent(text: string): LocalWindowsIntent | null {
  const source = text.trim();
  const open = source.match(/^(?:帮我|请)?打开(.+)$/);
  if (open) {
    const name = open[1].trim();
    const app = APP_ALIASES[name];
    return app ? { type: 'open_app', app } : null;
  }
  const dragPoint = source.match(/^(?:把)?(?:鼠标)?从\s*(\d{1,5})\s*[,， ]\s*(\d{1,5})\s*拖(?:到|至)\s*(\d{1,5})\s*[,， ]\s*(\d{1,5})$/);
  if (dragPoint) {
    return {
      type: 'drag_point',
      fromX: Number(dragPoint[1]),
      fromY: Number(dragPoint[2]),
      toX: Number(dragPoint[3]),
      toY: Number(dragPoint[4]),
    };
  }
  const clickPoint = source.match(/^(?:点击|点一下|点)\s*(\d{1,5})\s*[,， ]\s*(\d{1,5})$/);
  if (clickPoint) return { type: 'click_point', x: Number(clickPoint[1]), y: Number(clickPoint[2]) };
  const drag = source.match(/^(?:把)?(.{1,40}?)拖(?:到|至)(.{1,40})$/);
  if (drag && safeTarget(drag[1]) && safeTarget(drag[2])) {
    return { type: 'drag', from: drag[1].trim(), to: drag[2].trim() };
  }
  const click = source.match(/^(?:点击|点一下|点)(.{1,40})$/);
  if (click && safeTarget(click[1])) return { type: 'click', target: click[1].trim() };
  return null;
}

function safeTarget(value: string): boolean {
  const target = value.trim();
  return (
    target.length > 0 &&
    target.length <= 40 &&
    /^[\p{L}\p{N}_\- ]+$/u.test(target) &&
    !/(删除|移除|卸载|发送|提交|支付|付款|购买|订阅|密码|验证码|回收站|覆盖|安装|允许|授权)/i.test(target)
  );
}
