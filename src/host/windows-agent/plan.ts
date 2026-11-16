/** GLM 视觉 Windows 计划的提示词与严格解析。模型只描述固定动作，不产生可执行代码。 */

export interface NormalizedTarget {
  readonly label: string;
  readonly window?: string;
  readonly bbox?: readonly [number, number, number, number];
  readonly confidence: number;
}

export type WindowsAgentStep =
  | { readonly type: 'open_app'; readonly app: string }
  | { readonly type: 'navigate_url'; readonly url: string }
  | { readonly type: 'focus_window'; readonly window: string }
  | { readonly type: 'click' | 'double_click' | 'right_click'; readonly target: NormalizedTarget }
  | { readonly type: 'drag'; readonly from: NormalizedTarget; readonly to: NormalizedTarget }
  | { readonly type: 'scroll'; readonly amount: number; readonly target?: NormalizedTarget }
  | { readonly type: 'type_text'; readonly target: NormalizedTarget; readonly text: string }
  | { readonly type: 'hotkey'; readonly keys: string }
  | { readonly type: 'wait_for'; readonly target: NormalizedTarget; readonly timeoutMs: number };

export interface WindowsAgentPlan {
  readonly goal: string;
  readonly steps: readonly WindowsAgentStep[];
  readonly requiresConfirmation: boolean;
}

const APPS = new Set(['notepad', 'calculator', 'explorer', 'paint', 'terminal', 'settings', 'browser', 'wechat', 'qq']);
const HOTKEYS = new Set(['escape', 'tab', 'shift+tab', 'alt+tab', 'ctrl+a', 'ctrl+c', 'ctrl+f', 'ctrl+l', 'ctrl+v', 'ctrl+x']);
const RISK = /(删除|移除|卸载|发送|提交|支付|付款|购买|订阅|密码|验证码|回收站|覆盖|安装|允许|授权|公开发布|delete|remove|uninstall|send|submit|pay|purchase|subscribe|password|otp|install|allow|authorize)/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function short(value: unknown, max = 80): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
}

function target(value: unknown): NormalizedTarget | null {
  const item = record(value);
  if (!item) return null;
  const label = short(item.label);
  const confidence = Number(item.confidence);
  if (!label || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  let bbox: readonly [number, number, number, number] | undefined;
  if (item.bbox !== undefined) {
    if (!Array.isArray(item.bbox) || item.bbox.length !== 4) return null;
    const values = item.bbox.map(Number);
    if (values.some((part) => !Number.isFinite(part) || part < 0 || part > 1)) return null;
    if (values[2] <= values[0] || values[3] <= values[1]) return null;
    bbox = values as [number, number, number, number];
  }
  const window = item.window === undefined ? undefined : short(item.window);
  if (item.window !== undefined && !window) return null;
  return { label, confidence, ...(window ? { window } : {}), ...(bbox ? { bbox } : {}) };
}

function step(value: unknown): WindowsAgentStep | null {
  const item = record(value);
  const type = short(item?.type, 30);
  if (!item || !type) return null;
  if (type === 'open_app') {
    const app = short(item.app, 30)?.toLowerCase();
    return app && APPS.has(app) ? { type, app } : null;
  }
  if (type === 'navigate_url') {
    const url = short(item.url, 2048);
    if (!url) return null;
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname && !parsed.username && !parsed.password
        ? { type, url: parsed.href }
        : null;
    } catch {
      return null;
    }
  }
  if (type === 'focus_window') {
    const window = short(item.window);
    return window ? { type, window } : null;
  }
  if (type === 'click' || type === 'double_click' || type === 'right_click') {
    const resolved = target(item.target);
    return resolved ? { type, target: resolved } : null;
  }
  if (type === 'drag') {
    const from = target(item.from);
    const to = target(item.to);
    return from && to ? { type, from, to } : null;
  }
  if (type === 'scroll') {
    const amount = Number(item.amount);
    const resolved = item.target === undefined ? undefined : target(item.target);
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 10 || (item.target !== undefined && !resolved)) return null;
    return { type, amount, ...(resolved ? { target: resolved } : {}) };
  }
  if (type === 'type_text') {
    const resolved = target(item.target);
    const text = typeof item.text === 'string' && item.text.length > 0 && item.text.length <= 1000 ? item.text : null;
    return resolved && text ? { type, target: resolved, text } : null;
  }
  if (type === 'hotkey') {
    const keys = short(item.keys, 30)?.toLowerCase();
    return keys && HOTKEYS.has(keys) ? { type, keys } : null;
  }
  if (type === 'wait_for') {
    const resolved = target(item.target);
    const timeoutMs = Number(item.timeoutMs);
    return resolved && Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 10000
      ? { type, target: resolved, timeoutMs }
      : null;
  }
  return null;
}

export function windowsAgentInstruction(): string {
  return `\n\n[Windows视觉代理]\n用户要求你操作当前 Windows 桌面。先用截图和文字理解界面，只能选择以下固定动作：open_app、navigate_url、focus_window、click、double_click、right_click、drag、scroll、type_text、hotkey、wait_for。打开明确网址时必须优先使用 navigate_url，不要模拟点击地址栏、输入网址和回车。禁止输出 Shell、PowerShell、CMD、脚本、文件路径或任意代码。每个视觉目标写 label、可选 window、bbox=[x1,y1,x2,y2]（相对截图的 0..1 坐标）和 confidence。最多 12 步；界面变化后应以 wait_for 结束本批。回复可先用一句简短可爱的话说明，然后必须在末尾输出：<windows_plan>{"goal":"...","steps":[...],"requiresConfirmation":false}</windows_plan>。发送、删除、覆盖、安装、付款、授权、公开发布、向第三方提交表单等动作必须把 requiresConfirmation 设为 true。无法可靠定位时 steps 留空，不要猜坐标。`;
}

export function extractWindowsAgentPlan(text: string): { text: string; plan?: WindowsAgentPlan } {
  const start = text.lastIndexOf('<windows_plan>');
  const end = text.lastIndexOf('</windows_plan>');
  if (start < 0 || end <= start) return { text };
  const visible = (text.slice(0, start) + text.slice(end + '</windows_plan>'.length)).trim();
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start + '<windows_plan>'.length, end));
  } catch {
    return { text: visible };
  }
  const item = record(raw);
  const goal = short(item?.goal, 200);
  if (!item || !goal || !Array.isArray(item.steps) || item.steps.length > 12) return { text: visible };
  const steps = item.steps.map(step);
  if (steps.some((entry) => entry === null)) return { text: visible };
  const riskFromSteps = RISK.test(JSON.stringify(item.steps));
  const requiresConfirmation = item.requiresConfirmation === true || riskFromSteps;
  return { text: visible, plan: { goal, steps: steps as WindowsAgentStep[], requiresConfirmation } };
}
