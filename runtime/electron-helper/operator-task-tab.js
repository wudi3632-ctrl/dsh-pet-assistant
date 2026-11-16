/** 桌宠侧边 Agent 任务卡：DOM/样式/折叠，状态判定委托 operator-task-store。 */
'use strict';

(function expose(root, factory) {
  const api = factory(root && root.DshPetOperatorTask);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DshPetOperatorTaskTab = api;
})(typeof window === 'undefined' ? null : window, function build(storeApi) {
  const STATUS = {
    pending: ['○', '未完成'], running: ['●', '执行中'], completed: ['✓', '已完成'],
    failed: ['!', '失败'], 'waiting-confirmation': ['◷', '等待确认'], cancelled: ['■', '已停止'],
  };

  function injectCss(doc) {
    if (doc.querySelector('style[data-dsh-pet-operator-task]')) return;
    const style = doc.createElement('style');
    style.dataset.dshPetOperatorTask = '1';
    style.textContent = `
.dsh-pet-operator-task{--ot-accent:#6689ef;position:absolute;z-index:5;top:34%;width:min(15.2em,calc(var(--pet-size)*.5));font-size:var(--dsh-pet-font-tip,13px);font-family:var(--dsh-pet-font-family,'Microsoft YaHei UI',sans-serif);color:#28344a;pointer-events:auto;filter:drop-shadow(0 .55em 1.1em rgba(60,78,120,.2));transition:opacity .18s ease,transform .18s ease}
.dsh-pet-operator-task.is-hidden{display:none}.dsh-pet-operator-task.is-left{right:calc(68.75% + .55em)}.dsh-pet-operator-task.is-right{left:calc(68.75% + .55em)}
.dsh-pet-operator-task.is-left::after,.dsh-pet-operator-task.is-right::after{content:'';position:absolute;top:2.5em;border:.55em solid transparent}.dsh-pet-operator-task.is-left::after{right:-1.05em;border-left-color:rgba(255,255,255,.96)}.dsh-pet-operator-task.is-right::after{left:-1.05em;border-right-color:rgba(255,255,255,.96)}
.dsh-pet-operator-card{background:rgba(255,255,255,.96);border:1px solid rgba(112,142,214,.22);border-radius:1.05em;overflow:hidden}.dsh-pet-operator-head{display:grid;grid-template-columns:1fr auto;align-items:center;column-gap:.5em;row-gap:.18em;padding:.72em .82em .42em}.dsh-pet-operator-title{grid-column:1/-1;min-width:0;font-weight:700;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.dsh-pet-operator-count{grid-column:1;color:#7c889e;font-size:.82em;white-space:nowrap}.dsh-pet-operator-actions{grid-column:2;grid-row:2;display:flex;gap:.18em}.dsh-pet-operator-btn{border:0;background:transparent;color:#7c889e;width:1.65em;height:1.65em;border-radius:.55em;cursor:pointer}.dsh-pet-operator-btn:hover{background:#edf2ff;color:#385ec8}.dsh-pet-operator-btn.is-stop:hover{background:#fff0ef;color:#c84a42}.dsh-pet-operator-btn:disabled{opacity:.42;cursor:default}
.dsh-pet-operator-progress{height:.28em;background:#edf1f8;margin:0 .82em .6em;border-radius:9em;overflow:hidden}.dsh-pet-operator-progress>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#79a0ff,#7d77ed);border-radius:inherit;transition:width .25s ease}
.dsh-pet-operator-list{list-style:none;margin:0;padding:0 .58em .65em;max-height:12.6em;overflow:auto}.dsh-pet-operator-step{display:grid;grid-template-columns:1.2em 1fr;gap:.4em;padding:.36em .28em;border-radius:.55em;line-height:1.32}.dsh-pet-operator-step.is-running{background:#eef4ff;color:#315bbd}.dsh-pet-operator-step.is-completed{color:#6f7e92}.dsh-pet-operator-step.is-completed .dsh-pet-operator-mark{color:#35a263}.dsh-pet-operator-step.is-failed{background:#fff2f0;color:#be443a}.dsh-pet-operator-step.is-waiting-confirmation{background:#fff7e8;color:#b66d19}.dsh-pet-operator-mark{font-weight:800;text-align:center}.dsh-pet-operator-message{display:block;margin-top:.15em;font-size:.82em;opacity:.78}
.dsh-pet-operator-capsule{display:none;align-items:center;gap:.42em;max-width:13em;background:rgba(255,255,255,.96);border:1px solid rgba(112,142,214,.22);border-radius:99em;padding:.48em .7em;cursor:pointer}.dsh-pet-operator-task.is-collapsed .dsh-pet-operator-card{display:none}.dsh-pet-operator-task.is-collapsed .dsh-pet-operator-capsule{display:flex}.dsh-pet-operator-capsule-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}.dsh-pet-operator-capsule-percent{color:#64738d;font-size:.82em;white-space:nowrap}.dsh-pet-operator-pulse{width:.58em;height:.58em;border-radius:50%;background:var(--ot-accent);box-shadow:0 0 0 0 rgba(102,137,239,.45);animation:dshPetOperatorPulse 1.25s ease-out infinite}@keyframes dshPetOperatorPulse{70%{box-shadow:0 0 0 .6em rgba(102,137,239,0)}100%{box-shadow:0 0 0 0 rgba(102,137,239,0)}}
@media(prefers-reduced-motion:reduce){.dsh-pet-operator-task,.dsh-pet-operator-progress>i{transition:none}.dsh-pet-operator-pulse{animation:none}}
`;
    doc.head.appendChild(style);
  }

  function createOperatorTaskTab(options) {
    const doc = options.document || document;
    injectCss(doc);
    const store = (options.storeApi || storeApi).createOperatorTaskStore({ now: options.now });
    const root = doc.createElement('aside');
    root.className = 'dsh-pet-operator-task is-hidden';
    root.setAttribute('aria-live', 'polite');
    root.innerHTML = '<div class="dsh-pet-operator-card"><div class="dsh-pet-operator-head"><div class="dsh-pet-operator-title"></div><span class="dsh-pet-operator-count"></span><div class="dsh-pet-operator-actions"><button class="dsh-pet-operator-btn is-stop" aria-label="停止任务">■</button><button class="dsh-pet-operator-btn is-collapse" aria-label="收起任务">−</button></div></div><div class="dsh-pet-operator-progress"><i></i></div><ol class="dsh-pet-operator-list"></ol></div><button class="dsh-pet-operator-capsule" aria-label="展开任务"><span class="dsh-pet-operator-pulse"></span><span class="dsh-pet-operator-capsule-title"></span><span class="dsh-pet-operator-capsule-percent"></span></button>';
    options.mount.appendChild(root);
    const title = root.querySelector('.dsh-pet-operator-title');
    const count = root.querySelector('.dsh-pet-operator-count');
    const fill = root.querySelector('.dsh-pet-operator-progress>i');
    const list = root.querySelector('.dsh-pet-operator-list');
    const stop = root.querySelector('.is-stop');
    const collapse = root.querySelector('.is-collapse');
    const capsule = root.querySelector('.dsh-pet-operator-capsule');
    const capsuleTitle = root.querySelector('.dsh-pet-operator-capsule-title');
    const capsulePercent = root.querySelector('.dsh-pet-operator-capsule-percent');
    const forcedReasons = new Set();
    let collapseTimer = null;
    let cancelSent = false;

    function render() {
      const state = store.read();
      const hidden = state.status === 'hidden';
      const collapsed = !hidden && (state.collapsed || forcedReasons.size > 0);
      root.classList.toggle('is-hidden', hidden);
      root.classList.toggle('is-collapsed', collapsed);
      title.textContent = state.title;
      count.textContent = state.total ? `${state.done} / ${state.total}` : '';
      fill.style.width = state.percent + '%';
      capsuleTitle.textContent = state.title;
      capsulePercent.textContent = state.percent + '%';
      stop.disabled = !['running', 'waiting-confirmation'].includes(state.status) || cancelSent;
      list.replaceChildren();
      for (const step of state.steps) {
        const row = doc.createElement('li');
        row.className = 'dsh-pet-operator-step is-' + step.status;
        const mark = doc.createElement('span');
        mark.className = 'dsh-pet-operator-mark';
        mark.textContent = (STATUS[step.status] || STATUS.pending)[0];
        const body = doc.createElement('span');
        body.textContent = step.label;
        if (step.message) {
          const message = doc.createElement('small');
          message.className = 'dsh-pet-operator-message';
          message.textContent = step.message;
          body.appendChild(message);
        }
        row.append(mark, body);
        list.appendChild(row);
      }
      options.onLayout?.();
    }

    function scheduleCollapse() {
      if (collapseTimer !== null) clearTimeout(collapseTimer);
      const state = store.read();
      if (state.status !== 'completed' || state.collapsed) return;
      collapseTimer = setTimeout(() => { store.tick(); render(); }, Math.max(0, state.autoCollapseAt - Date.now()));
    }

    stop.addEventListener('click', (event) => {
      event.stopPropagation();
      if (cancelSent || stop.disabled) return;
      cancelSent = true;
      stop.disabled = true;
      options.onCancel?.();
    });
    collapse.addEventListener('click', (event) => { event.stopPropagation(); store.setCollapsed(true); render(); });
    capsule.addEventListener('click', (event) => { event.stopPropagation(); store.setCollapsed(false); render(); });

    return {
      el: root,
      accept(plan) { cancelSent = false; store.accept(plan); render(); },
      apply(event) { store.apply(event); render(); scheduleCollapse(); },
      setForcedCollapsed(reason, value) {
        if (value) forcedReasons.add(String(reason));
        else forcedReasons.delete(String(reason));
        render();
      },
      clear() { store.clear(); render(); },
      interactive() { return !root.classList.contains('is-hidden'); },
      place(side) { root.classList.toggle('is-left', side === 'left'); root.classList.toggle('is-right', side !== 'left'); },
      read: store.read,
      dispose() { if (collapseTimer !== null) clearTimeout(collapseTimer); root.remove(); },
    };
  }

  return { createOperatorTaskTab, injectCss };
});
