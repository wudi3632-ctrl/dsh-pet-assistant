/** DSH Agent-backed voice turn endpoint. */
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

export async function handleAgentRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  if (input.rest === 'agent/desktop-task/next') {
    if (input.method !== 'GET') return methodNotAllowed();
    return okResult({ ok: true, task: deps.desktopTaskBroker?.claim() ?? null });
  }
  if (input.rest === 'agent/desktop-task/result') {
    if (input.method !== 'POST') return methodNotAllowed();
    let body: Record<string, unknown>;
    try {
      body = (JSON.parse(input.body ?? 'null') as Record<string, unknown> | null) ?? {};
    } catch {
      return invalidJson();
    }
    const id = typeof body.id === 'string' ? body.id : '';
    const raw = body.result;
    if (!id || !raw || typeof raw !== 'object') return failResult('bad-request', '桌面任务结果非法');
    const result = raw as Record<string, unknown>;
    const accepted = deps.desktopTaskBroker?.complete(id, {
      ok: result.ok === true,
      ...(typeof result.message === 'string' ? { message: result.message } : {}),
      ...(result.blocked === true ? { blocked: true } : {}),
      ...(result.pending === true ? { pending: true } : {}),
      ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
    });
    return accepted ? okResult({ ok: true }) : failResult('bad-request', '桌面任务已过期');
  }
  if (input.rest !== 'agent/turn') return undefined;
  if (input.method !== 'POST') return methodNotAllowed();
  let body: Record<string, unknown>;
  try {
    body = (JSON.parse(input.body ?? 'null') as Record<string, unknown> | null) ?? {};
  } catch {
    return invalidJson();
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const turnId = typeof body.turnId === 'string' ? body.turnId.trim() : '';
  if (!text || text.length > 2000) return failResult('bad-request', '语音任务正文必须为 1–2000 字');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(turnId)) return failResult('bad-request', 'turnId 非法');
  if (!deps.agentBridge?.available()) {
    return { kind: 'json', status: 503, obj: { ok: false, reason: 'unsupported', message: 'DSH Agent 不可用' } };
  }
  const result = await deps.agentBridge.submit(text, turnId, input.signal);
  return result.ok ? okResult(result) : failResult('generate-error', result.message);
}
