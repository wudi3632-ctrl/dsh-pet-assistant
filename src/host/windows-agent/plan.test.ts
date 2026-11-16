import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractWindowsAgentPlan, windowsAgentInstruction } from './plan.ts';

test('parses a bounded visual click and strips the control block', () => {
  const result = extractWindowsAgentPlan('我去点一下～\n<windows_plan>{"goal":"打开菜单","steps":[{"type":"click","target":{"label":"菜单","bbox":[0.8,0.1,0.9,0.2],"confidence":0.93}}],"requiresConfirmation":false}</windows_plan>');
  assert.equal(result.text, '我去点一下～');
  assert.equal(result.plan?.steps[0]?.type, 'click');
  assert.equal(result.plan?.requiresConfirmation, false);
});

test('uses a fixed URL navigation action instead of address-bar keystrokes', () => {
  const result = extractWindowsAgentPlan('<windows_plan>{"goal":"打开B站","steps":[{"type":"navigate_url","url":"https://www.bilibili.com"}],"requiresConfirmation":false}</windows_plan>');
  assert.deepEqual(result.plan?.steps, [{ type: 'navigate_url', url: 'https://www.bilibili.com/' }]);
  assert.match(windowsAgentInstruction(), /必须优先使用 navigate_url/);
});

test('rejects malformed coordinates and unknown actions', () => {
  for (const body of [
    '{"goal":"x","steps":[{"type":"shell","command":"whoami"}]}',
    '{"goal":"x","steps":[{"type":"click","target":{"label":"x","bbox":[0.8,0.2,0.1,0.4],"confidence":1}}]}',
  ]) {
    assert.equal(extractWindowsAgentPlan(`<windows_plan>${body}</windows_plan>`).plan, undefined);
  }
});

test('forces confirmation when step text is high risk', () => {
  const result = extractWindowsAgentPlan('<windows_plan>{"goal":"发送","steps":[{"type":"click","target":{"label":"发送","confidence":0.9}}],"requiresConfirmation":false}</windows_plan>');
  assert.equal(result.plan?.requiresConfirmation, true);
});

test('instruction forbids code and caps the plan', () => {
  const instruction = windowsAgentInstruction();
  assert.match(instruction, /禁止输出 Shell/);
  assert.match(instruction, /最多 12 步/);
});
