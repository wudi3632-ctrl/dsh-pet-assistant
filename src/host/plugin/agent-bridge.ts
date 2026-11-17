/** Submit pet voice turns through the normal DSH Session/Agent pipeline. */
import { lastAssistantText } from '../notify-events.ts';
import type { FileLogger } from '../log-file.ts';

const PET_AGENT_SESSION_ID = 'session-dsh-pet-assistant';
const TURN_TIMEOUT_MS = 10 * 60_000;

type SessionController = {
  create(request: { sessionId?: string; cwd?: string }): Promise<{ sessionId: string }>;
  prompt(
    request: {
      sessionId: string;
      requestId: string;
      mode: 'followup';
      content: Array<{ type: 'text'; text: string }>;
      clientTimeZone?: string;
    },
    signal: AbortSignal,
  ): Promise<{ accepted: boolean }>;
  resolveAgent(sessionId: string): Promise<{ agent: { whenIdle(): Promise<void> } } | { error: { code?: string } }>;
  selectModel(request: {
    sessionId: string;
    provider: string;
    model: string;
    reasoningEffort: 'low';
  }): Promise<unknown>;
};

type AgentBridgeContext = {
  on(name: 'session/event', listener: (session: unknown, event: unknown) => void): () => void;
  agentDefaultModel: { currentSelection(): { provider: string; model: string; reasoningEffort?: string } };
};

export type PetAgentTurnResult =
  | { ok: true; sessionId: string; text: string }
  | { ok: false; reason: 'unavailable' | 'failed'; message: string };

export function createPetAgentBridge(input: {
  ctx: AgentBridgeContext;
  log: FileLogger;
  optionalService(name: string): unknown;
}) {
  const { ctx, log, optionalService } = input;
  let sessionId = PET_AGENT_SESSION_ID;
  let ready: Promise<string> | undefined;
  let queue = Promise.resolve();

  const controller = (): SessionController | undefined => {
    const value = optionalService('sessionController') as Partial<SessionController> | undefined;
    return value && typeof value.prompt === 'function' && typeof value.resolveAgent === 'function'
      ? (value as SessionController)
      : undefined;
  };

  const ensureSession = async (service: SessionController): Promise<string> => {
    const resolved = await service.resolveAgent(sessionId);
    if ('error' in resolved) {
      const created = await service.create({ sessionId });
      sessionId = created.sessionId;
    }
    const selected = ctx.agentDefaultModel.currentSelection();
    try {
      await service.selectModel({
        sessionId,
        provider: selected.provider,
        model: selected.model,
        reasoningEffort: 'low',
      });
    } catch (error) {
      log.warn('[dsh-pet] Agent 会话无法显式设为 low，沿用模型当前配置：' + String(error));
    }
    return sessionId;
  };

  const submitOnce = async (text: string, turnId: string, signal?: AbortSignal): Promise<PetAgentTurnResult> => {
    const service = controller();
    if (!service) return { ok: false, reason: 'unavailable', message: 'DSH Session Controller 不可用' };
    try {
      ready ??= ensureSession(service).catch((error) => {
        ready = undefined;
        throw error;
      });
      const targetSessionId = await ready;
      const timeout = AbortSignal.timeout(TURN_TIMEOUT_MS);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let reply = '';
      const off = ctx.on('session/event', (session, event) => {
        const id = String(
          (session as { id?: unknown; header?: { id?: unknown } } | null)?.header?.id ??
            (session as { id?: unknown } | null)?.id ??
            '',
        );
        if (id !== targetSessionId || (event as { type?: string } | null)?.type !== 'assistant/message') return;
        reply = lastAssistantText(event as { type?: string; data?: Record<string, unknown> }) || reply;
      });
      try {
        const accepted = await service.prompt(
          {
            sessionId: targetSessionId,
            requestId: turnId,
            mode: 'followup',
            content: [{ type: 'text', text }],
            clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          combined,
        );
        if (!accepted.accepted) throw new Error('DSH 没有接受这次语音任务');
        const resolved = await service.resolveAgent(targetSessionId);
        if ('error' in resolved) throw new Error('DSH Agent 会话不可用');
        await Promise.race([
          resolved.agent.whenIdle(),
          new Promise<never>((_, reject) => {
            combined.addEventListener('abort', () => reject(combined.reason), { once: true });
          }),
        ]);
      } finally {
        off();
      }
      return { ok: true, sessionId: targetSessionId, text: reply.trim() || '任务已经处理完成。' };
    } catch (error) {
      log.warn('[dsh-pet] DSH Agent 语音任务失败：' + (error instanceof Error ? error.message : String(error)));
      return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
  };

  return {
    available: () => controller() !== undefined,
    submit(text: string, turnId: string, signal?: AbortSignal): Promise<PetAgentTurnResult> {
      const result = queue.then(() => submitOnce(text, turnId, signal));
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

export type PetAgentBridge = ReturnType<typeof createPetAgentBridge>;
