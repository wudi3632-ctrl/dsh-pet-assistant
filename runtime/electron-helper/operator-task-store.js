/** Agent 临时任务卡的纯状态机；浏览器经典脚本与 Node 单测共用。 */
'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DshPetOperatorTask = api;
})(typeof window === 'undefined' ? null : window, function build() {
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

  function cleanStep(value, index) {
    if (!value || typeof value !== 'object') return null;
    const label = String(value.label || value.title || value.type || '').trim();
    if (!label || label.length > 100) return null;
    return { id: String(value.id || index), label, status: 'pending', message: '' };
  }

  function blank() {
    return {
      taskId: '', title: '', status: 'hidden', steps: [], current: -1, seq: -1,
      collapsed: false, autoCollapseAt: 0,
    };
  }

  function snapshot(state) {
    const done = state.steps.filter((step) => TERMINAL.has(step.status)).length;
    return {
      ...state,
      steps: state.steps.map((step) => ({ ...step })),
      done,
      total: state.steps.length,
      percent: state.steps.length === 0 ? 0 : Math.round((done / state.steps.length) * 100),
    };
  }

  function createOperatorTaskStore(options = {}) {
    const now = typeof options.now === 'function' ? options.now : Date.now;
    let state = blank();

    function accept(plan) {
      const taskId = String(plan?.taskId || '').trim();
      const title = String(plan?.title || plan?.goal || '').trim();
      const source = Array.isArray(plan?.steps) ? plan.steps.slice(0, 12) : [];
      const steps = source.map(cleanStep);
      if (!taskId || !title || steps.length === 0 || steps.some((step) => step === null)) {
        state = { ...blank(), taskId: taskId || 'invalid', title: title || '任务计划不可用', status: 'failed' };
        return snapshot(state);
      }
      state = {
        taskId, title: title.slice(0, 200), status: 'running', steps, current: 0, seq: -1,
        collapsed: false, autoCollapseAt: 0,
      };
      state.steps[0].status = 'running';
      return snapshot(state);
    }

    function apply(event) {
      if (!event || event.taskId !== state.taskId || !Number.isInteger(event.seq) || event.seq <= state.seq) {
        return snapshot(state);
      }
      state.seq = event.seq;
      const index = Number.isInteger(event.stepIndex) ? event.stepIndex : state.current;
      const item = state.steps[index];
      if (event.stage === 'step-start' && item) {
        for (const step of state.steps) if (step.status === 'running') step.status = 'pending';
        item.status = 'running';
        item.message = '';
        state.current = index;
        state.status = 'running';
      } else if (event.stage === 'waiting-confirmation' && item) {
        item.status = 'waiting-confirmation';
        state.current = index;
        state.status = 'waiting-confirmation';
      } else if (event.stage === 'step-completed' && item) {
        item.status = 'completed';
        item.message = '';
        const next = state.steps.findIndex((step, stepIndex) => stepIndex > index && step.status === 'pending');
        state.current = next;
        if (next >= 0) state.steps[next].status = 'running';
      } else if (event.stage === 'failed' && item) {
        item.status = 'failed';
        item.message = String(event.message || '操作失败').slice(0, 120);
        state.status = 'failed';
      } else if (event.stage === 'cancelled') {
        if (item && !TERMINAL.has(item.status)) item.status = 'cancelled';
        state.status = 'cancelled';
      } else if (event.stage === 'completed') {
        for (const step of state.steps) if (step.status === 'running') step.status = 'completed';
        state.status = 'completed';
        state.current = -1;
        state.autoCollapseAt = now() + 6000;
      }
      return snapshot(state);
    }

    function setCollapsed(value) {
      state.collapsed = Boolean(value);
      return snapshot(state);
    }

    function tick() {
      if (state.autoCollapseAt > 0 && now() >= state.autoCollapseAt) state.collapsed = true;
      return snapshot(state);
    }

    function clear() {
      state = blank();
      return snapshot(state);
    }

    return { accept, apply, clear, read: () => snapshot(state), setCollapsed, tick };
  }

  return { createOperatorTaskStore };
});
