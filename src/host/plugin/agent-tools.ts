/** Register the visible desktop helper as a normal DSH Agent tool. */
// @ts-expect-error DSH supplies this private peer at runtime; it is not published for standalone installs.
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { DesktopTaskBroker } from './desktop-task-broker.ts';
import type { FileLogger } from '../log-file.ts';
import type { PetImageSink } from '../image-attachment.ts';

function renderJson(value: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(value) as { message?: string; attachment?: unknown; width?: number; height?: number };
    const blocks: Array<Record<string, unknown>> = [{
      type: 'text',
      text: parsed.message ?? (parsed.width && parsed.height ? `已观察当前桌面（${parsed.width}×${parsed.height}）。` : value),
    }];
    if (parsed.attachment) blocks.push({ type: 'image', attachment: parsed.attachment });
    return blocks;
  } catch {
    return [{ type: 'text', text: value }];
  }
}

export function registerPetAgentTools(input: {
  ctx: { effect(setup: () => (() => void) | void, label: string): void };
  broker: DesktopTaskBroker;
  log: FileLogger;
  optionalService(name: string): unknown;
}): void {
  const tools = input.optionalService('tools') as { register(tool: unknown): () => void } | undefined;
  if (!tools || typeof tools.register !== 'function') {
    input.log.warn('[dsh-pet] DSH tools 服务不可用，桌面任务工具未注册');
    return;
  }
  input.ctx.effect(
    () => {
      const dispose = [
        tools.register(
        defineTool({
          name: 'pet_desktop_task',
          description:
            'Use only for one simple open or close of a visible Windows application. Keep goal concise and literal (for example: "打开计算器" or "关闭浏览器"). For clicking, typing, dragging, scrolling, or multi-step work, do not use this tool; use pet_desktop_observe and pet_desktop_action instead.',
          parameters: {
            goal: {
              type: 'string',
              required: true,
              description: 'A complete, concise description of the visible Windows task and its success condition.',
            },
          },
          output: {
            schema: { type: 'string' },
            render: (_args: unknown, value: string) => renderJson(value),
          },
          timeoutMs: 180_000,
          async execute(args: { goal: string }, exec: { signal: AbortSignal }) {
            const result = await input.broker.submit(args.goal.trim(), exec.signal);
            return JSON.stringify(result);
          },
        }),
        ),
        tools.register(defineTool({
          name: 'pet_desktop_observe',
          description:
            'Capture the real signed-in Windows desktop and return it as an image with its pixel dimensions. Use this before coordinate actions and again after each action to verify visible state. The pet overlay is made click-through during actions.',
          parameters: {},
          output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => renderJson(value) },
          timeoutMs: 30_000,
          async execute(_args: Record<string, never>, exec: { signal: AbortSignal }) {
            const result = await input.broker.submitRequest({ kind: 'observe' }, exec.signal);
            const shot = result.observation;
            if (!result.ok || !shot) return JSON.stringify({ ok: false, message: result.message || '屏幕截图失败' });
            const sink = input.optionalService('attachments') as PetImageSink | undefined;
            if (typeof sink?.saveImages !== 'function') {
              return JSON.stringify({ ok: false, message: '当前 DSH 附件服务不可用，无法把截图交给 Agent' });
            }
            const bytes = Buffer.from(shot.data, 'base64');
            if (Math.abs(bytes.length - shot.bytes) > 2 || bytes.length === 0) {
              return JSON.stringify({ ok: false, message: '桌面截图数据校验失败' });
            }
            const [attachment] = await sink.saveImages([{ data: new Uint8Array(bytes), mediaType: shot.mediaType }]);
            if (!attachment) return JSON.stringify({ ok: false, message: '桌面截图保存失败' });
            return JSON.stringify({
              ok: true,
              message: `已观察当前桌面（${shot.width}×${shot.height}）。`,
              width: shot.width, height: shot.height,
              screenWidth: shot.screenWidth ?? shot.width, screenHeight: shot.screenHeight ?? shot.height,
              originX: shot.originX ?? 0, originY: shot.originY ?? 0, attachment,
            });
          },
        })),
        tools.register(defineTool({
          name: 'pet_desktop_action',
          description:
            'Execute exactly one allowlisted action in the real Windows desktop. Observe first, use absolute screen pixels for *_point actions, then observe again. Supported type values: open_app, open_app_name, close_app, close_app_name, navigate_url, focus_window, click, double_click, right_click, click_point, double_click_point, right_click_point, drag, drag_point, scroll, type_text, hotkey, wait_for, inspect_window. Mutating or external-impact actions may be blocked for confirmation.',
          parameters: {
            type: { type: 'string', required: true, description: 'One supported action type.' },
            app: { type: 'string', description: 'Fixed app id such as notepad, calculator, explorer, settings, browser, wechat, qq.' },
            name: { type: 'string', description: 'Installed app name for open_app_name or close_app_name.' },
            url: { type: 'string', description: 'http/https URL for navigate_url.' },
            window: { type: 'string', description: 'Window title/name for focus_window.' },
            target: { type: 'string', description: 'Optional accessible control label. type_text may omit it to auto-find the active editable area.' },
            text: { type: 'string', description: 'Text for type_text, maximum 1000 characters. type_text writes through UI Automation; no clipboard or preliminary click is needed.' },
            keys: { type: 'string', description: 'Allowlisted hotkey such as ctrl+n, ctrl+a, ctrl+v, tab, escape.' },
            amount: { type: 'integer', description: 'Scroll amount from -10 to 10, excluding 0.' },
            x: { type: 'integer', description: 'Absolute screen X for point click actions.' },
            y: { type: 'integer', description: 'Absolute screen Y for point click actions.' },
            fromX: { type: 'integer' }, fromY: { type: 'integer' }, toX: { type: 'integer' }, toY: { type: 'integer' },
            from: { type: 'string', description: 'Accessible source label for drag.' },
            to: { type: 'string', description: 'Accessible destination label for drag.' },
            timeoutMs: { type: 'integer', description: 'wait_for timeout between 100 and 10000 ms.' },
          },
          output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => renderJson(value) },
          timeoutMs: 45_000,
          async execute(args: Record<string, unknown>, exec: { signal: AbortSignal }) {
            const action = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
            return JSON.stringify(await input.broker.submitRequest({ kind: 'action', action }, exec.signal));
          },
        })),
      ];
      return () => { for (const unregister of dispose.reverse()) unregister(); };
    },
    'dsh-pet: visible desktop Agent tool',
  );
}
