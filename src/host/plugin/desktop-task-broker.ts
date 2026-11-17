/** In-process handoff between a DSH tool call and the visible desktop helper. */
import { randomUUID } from 'node:crypto';

export type DesktopTaskResult = {
  ok: boolean;
  message?: string;
  blocked?: boolean;
  pending?: boolean;
  reason?: string;
};

type PendingTask = {
  id: string;
  goal: string;
  claimed: boolean;
  resolve(result: DesktopTaskResult): void;
  reject(error: unknown): void;
  signal: AbortSignal;
};

const pendingTasks = new WeakMap<DesktopTaskBroker, PendingTask>();

export class DesktopTaskBroker {
  available(): boolean {
    return !pendingTasks.has(this);
  }

  submit(goal: string, signal: AbortSignal): Promise<DesktopTaskResult> {
    if (pendingTasks.has(this)) return Promise.resolve({ ok: false, message: '桌面助手正在执行另一项任务' });
    return new Promise((resolve, reject) => {
      const task: PendingTask = { id: randomUUID(), goal, claimed: false, resolve, reject, signal };
      pendingTasks.set(this, task);
      signal.addEventListener(
        'abort',
        () => {
          if (pendingTasks.get(this) === task) pendingTasks.delete(this);
          reject(signal.reason ?? new Error('桌面任务已取消'));
        },
        { once: true },
      );
    });
  }

  claim(): { id: string; goal: string } | null {
    const task = pendingTasks.get(this);
    if (!task || task.claimed || task.signal.aborted) return null;
    task.claimed = true;
    return { id: task.id, goal: task.goal };
  }

  complete(id: string, result: DesktopTaskResult): boolean {
    const task = pendingTasks.get(this);
    if (!task || task.id !== id) return false;
    pendingTasks.delete(this);
    task.resolve(result);
    return true;
  }
}
