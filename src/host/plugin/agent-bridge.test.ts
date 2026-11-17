import assert from 'node:assert/strict';
import test from 'node:test';
import { createPetAgentBridge } from './agent-bridge.ts';

test('submits a voice turn through one persistent DSH session with low reasoning', async () => {
  const listeners = new Set<(session: unknown, event: unknown) => void>();
  const prompts: unknown[] = [];
  const selections: unknown[] = [];
  let exists = false;
  const expectedSessionId = 'session-dsh-pet-assistant-35c193d8bdbf';
  const agent = {
    async whenIdle() {
      for (const listener of listeners) {
        listener(
          { id: expectedSessionId },
          {
            type: 'assistant/message',
            data: { message: { content: [{ type: 'text', text: '已经打开计算器。' }] } },
          },
        );
      }
    },
  };
  const service = {
    async resolveAgent() {
      return exists ? { agent } : { error: { code: 'session/not-found' } };
    },
    async create(request: { sessionId: string }) {
      exists = true;
      return { sessionId: request.sessionId };
    },
    async selectModel(request: unknown) {
      selections.push(request);
    },
    async prompt(request: unknown) {
      prompts.push(request);
      return { accepted: true };
    },
  };
  const bridge = createPetAgentBridge({
    ctx: {
      on(_name, listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'zhipu', model: 'glm-5.3-flash' }),
      },
    },
    log: { warn() {} } as never,
    optionalService: () => service,
  });

  const result = await bridge.submit('打开计算器', 'vw-test-1');
  assert.deepEqual(result, {
    ok: true,
    sessionId: expectedSessionId,
    text: '已经打开计算器。',
  });
  assert.equal(prompts.length, 1);
  assert.equal((prompts[0] as { requestId: string }).requestId, 'vw-test-1');
  assert.equal((selections[0] as { reasoningEffort: string }).reasoningEffort, 'low');
});

test('reports unavailable without creating a fake reply', async () => {
  const bridge = createPetAgentBridge({
    ctx: {
      on() {
        return () => undefined;
      },
      agentDefaultModel: { currentSelection: () => ({ provider: '', model: '' }) },
    },
    log: { warn() {} } as never,
    optionalService: () => undefined,
  });
  assert.equal(bridge.available(), false);
  assert.deepEqual(await bridge.submit('你好', 'vw-test-2'), {
    ok: false,
    reason: 'unavailable',
    message: 'DSH Session Controller 不可用',
  });
});
