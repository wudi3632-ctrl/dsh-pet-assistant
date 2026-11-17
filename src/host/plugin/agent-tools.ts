/** Register the visible desktop helper as a normal DSH Agent tool. */
// @ts-expect-error DSH supplies this private peer at runtime; it is not published for standalone installs.
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { DesktopTaskBroker } from './desktop-task-broker.ts';
import type { FileLogger } from '../log-file.ts';

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
    () =>
      tools.register(
        defineTool({
          name: 'pet_desktop_task',
          description:
            'Use the visible dsh-pet desktop helper for every interactive Windows GUI task: open/focus/close apps, click, type, drag, scroll, and verify visible results. This helper runs in the real signed-in desktop session. Always call it instead of shell/process commands for visible applications, even if shell tools report that explorer or an interactive desktop is unavailable. For a simple open or close, keep goal concise and literal (for example: "打开计算器" or "关闭浏览器") so the deterministic fast path can execute it immediately.',
          parameters: {
            goal: {
              type: 'string',
              required: true,
              description: 'A complete, concise description of the visible Windows task and its success condition.',
            },
          },
          output: {
            schema: { type: 'string' },
            render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
          },
          timeoutMs: 180_000,
          async execute(args: { goal: string }, exec: { signal: AbortSignal }) {
            const result = await input.broker.submit(args.goal.trim(), exec.signal);
            return JSON.stringify(result);
          },
        }),
      ),
    'dsh-pet: visible desktop Agent tool',
  );
}
