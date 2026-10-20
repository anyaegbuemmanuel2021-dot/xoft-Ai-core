import { api } from '../api.js';
import { card, badge, rows, fmtTime, esc, toast, guarded, onDelegate } from '../dom.js';

export const title = 'Missions & Goals';
let tab = 'missions';

export async function render(container) {
  container.innerHTML = `
    <div class="tabs">
      <button data-tab="missions" class="${tab === 'missions' ? 'active' : ''}">Missions</button>
      <button data-tab="goals" class="${tab === 'goals' ? 'active' : ''}">Goals</button>
    </div>
    <div id="tab-body"><div class="empty">Loading…</div></div>
  `;
  onDelegate(container, 'click', '[data-tab]', (el) => { tab = el.dataset.tab; render(container); });
  tab === 'missions' ? await renderMissions(container) : await renderGoals(container);
}

async function renderMissions(container) {
  const missions = await api.get('/api/missions');
  let autopilot = { enabled: false, intervalSeconds: 60, maxMissionsPerCycle: 1, lastRunStatus: 'not available', lastRunAt: null, nextRunAt: null };
  try { autopilot = { ...autopilot, ...(await api.get('/api/autopilot/status')) }; } catch { /* keep safe disabled defaults when API is unavailable */ }
  const body = container.querySelector('#tab-body');
  body.innerHTML = `
    ${card('New mission', `
      <div class="form-row"><label>Goal</label><textarea id="new-mission-goal" placeholder="a larger, multi-step objective"></textarea></div>
      <button id="create-mission" class="primary">Create</button>
    `)}
    ${card('Autonomous mission runner', `
      <p class="muted">When enabled, XOFT automatically selects existing created/planned missions using priority and deadline urgency. It still obeys permissions, approval gates, mission budgets, stuck detection and the emergency stop.</p>
      <div id="mission-autopilot-status" class="muted">Loading autopilot status…</div>
      <div class="form-row"><label for="mission-autopilot-enabled">Automatic execution</label><select id="mission-autopilot-enabled"><option value="false">Disabled</option><option value="true">Enabled</option></select></div>
      <div class="form-row"><label for="mission-autopilot-interval">Cycle interval</label><select id="mission-autopilot-interval"><option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option><option value="300">5 minutes</option><option value="600">10 minutes</option><option value="1800">30 minutes</option><option value="3600">60 minutes</option></select></div>
      <div class="form-row"><label for="mission-autopilot-count">Maximum missions per cycle</label><select id="mission-autopilot-count"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></div>
      <button id="mission-autopilot-save" class="primary">Save autopilot settings</button>
      <button id="mission-autopilot-run">Run next mission now</button>
      <div id="mission-autopilot-result" class="muted" aria-live="polite"></div>
    `, { span2: true })}
    ${card('Missions', rows(missions.slice().reverse(), missionRow, 'No missions yet.'), { span2: true })}
  `;
  body.querySelector('#mission-autopilot-enabled').value = String(Boolean(autopilot.enabled));
  body.querySelector('#mission-autopilot-interval').value = String(autopilot.intervalSeconds ?? 60);
  body.querySelector('#mission-autopilot-count').value = String(autopilot.maxMissionsPerCycle ?? 1);
  body.querySelector('#mission-autopilot-status').textContent = `Status: ${autopilot.enabled ? 'enabled' : 'disabled'} · Last cycle: ${autopilot.lastRunStatus ?? 'not run'}${autopilot.lastRunAt ? ` · ${fmtTime(autopilot.lastRunAt)}` : ''} · Next cycle: ${autopilot.nextRunAt ? fmtTime(autopilot.nextRunAt) : 'not scheduled'}`;
  onDelegate(body, 'click', '#mission-autopilot-save', async () => {
    const button = body.querySelector('#mission-autopilot-save');
    button.disabled = true;
    try {
      const result = await guarded(() => api.patch('/api/autopilot/settings', {
        enabled: body.querySelector('#mission-autopilot-enabled').value === 'true',
        intervalSeconds: Number(body.querySelector('#mission-autopilot-interval').value),
        maxMissionsPerCycle: Number(body.querySelector('#mission-autopilot-count').value),
      }), 'Save mission autopilot settings');
      if (result) { toast('Autopilot settings saved', 'ok'); render(container); }
    } finally { button.disabled = false; }
  });
  onDelegate(body, 'click', '#mission-autopilot-run', async () => {
    const button = body.querySelector('#mission-autopilot-run');
    const output = body.querySelector('#mission-autopilot-result');
    button.disabled = true;
    button.textContent = 'Working…';
    output.textContent = 'Checking mission priority, deadlines, provider health and safety gates.';
    try {
      const result = await guarded(() => api.post('/api/autopilot/run', {}), 'Run mission autopilot');
      if (result && !result.__queued) {
        output.textContent = `Cycle: ${result.status}. Selected ${result.selected ?? 0} mission(s); ${result.skipped ?? 0} skipped. Check mission status and approvals for outcomes.`;
        render(container);
      }
    } finally { button.disabled = false; button.textContent = 'Run next mission now'; }
  });
  onDelegate(body, 'click', '#create-mission', async () => {
    const goal = body.querySelector('#new-mission-goal').value.trim();
    if (!goal) return;
    await guarded(() => api.post('/api/missions', { goal }), 'Create mission');
    toast('Mission created', 'ok');
    render(container);
  });
  onDelegate(body, 'click', '[data-plan]', async (el) => { await guarded(() => api.post(`/api/missions/${el.dataset.plan}/plan`), 'Plan'); render(container); });
  onDelegate(body, 'click', '[data-run]', async (el) => { await guarded(() => api.post(`/api/missions/${el.dataset.run}/run`), 'Run'); render(container); });
  onDelegate(body, 'click', '[data-cancel-mission]', async (el) => { await guarded(() => api.post(`/api/missions/${el.dataset.cancelMission}/cancel`), 'Cancel'); render(container); });
}

function missionRow(m) {
  return `
    <div class="row" style="flex-direction:column; align-items:stretch;">
      <div style="display:flex; justify-content:space-between;">
        <span class="main">${esc(m.goal)}</span>
        ${badge(m.status, m.status === 'completed' ? 'ok' : m.status === 'failed' ? 'err' : '')}
      </div>
      <div class="muted" style="margin:4px 0;">created ${fmtTime(m.createdAt)}</div>
      <div class="inline" style="gap:6px;">
        ${!m.taskId ? `<button data-plan="${m.id}">Plan</button>` : `<button data-run="${m.id}">Run</button>`}
        <button data-cancel-mission="${m.id}" class="danger">Cancel</button>
      </div>
    </div>
  `;
}

async function renderGoals(container) {
  const goals = await api.get('/api/goals');
  const body = container.querySelector('#tab-body');
  body.innerHTML = `
    ${card('New goal', `
      <div class="form-row"><label>Description</label><input id="new-goal-desc" placeholder="e.g. launch the new landing page" /></div>
      <button id="create-goal" class="primary">Create</button>
    `)}
    ${card('Goals', rows(goals.slice().reverse(), goalRow, 'No goals yet.'), { span2: true })}
  `;
  onDelegate(body, 'click', '#create-goal', async () => {
    const description = body.querySelector('#new-goal-desc').value.trim();
    if (!description) return;
    await guarded(() => api.post('/api/goals', { description }), 'Create goal');
    toast('Goal created', 'ok');
    render(container);
  });
  onDelegate(body, 'click', '[data-add-project]', async (el) => {
    const name = window.prompt('Project name:');
    if (!name) return;
    await guarded(() => api.post(`/api/goals/${el.dataset.addProject}/projects`, { name }), 'Add project');
    render(container);
  });
}

function goalRow(g) {
  return `
    <div class="row" style="flex-direction:column; align-items:stretch;">
      <div class="main">${esc(g.description)}</div>
      <div class="muted" style="margin:4px 0;">${(g.projects ?? []).length} project(s) · created ${fmtTime(g.createdAt)}</div>
      <div><button data-add-project="${g.id}">+ Project</button></div>
    </div>
  `;
}
