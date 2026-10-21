import { api } from '../api.js';
import { card, badge, rows, fmtTime, esc, toast, guarded, onDelegate } from '../dom.js';

export const title = 'Schedule & Jobs';
export let cleanup = null;

let viewGeneration = 0;
let refreshTimer = null;
let currentJobs = [];

const BUDGETS = [
  [60_000, '1 minute'],
  [120_000, '2 minutes'],
  [300_000, '5 minutes'],
  [600_000, '10 minutes'],
];

function riskRank(tool) {
  if (Number.isFinite(tool?.riskLevel)) return tool.riskLevel;
  return ({ SAFE: 0, LOW: 1, EXTERNAL: 2, HIGH_IMPACT: 3 })[String(tool?.riskLevel ?? '').toUpperCase()] ?? 99;
}

function safeTools(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) => tool.status === 'implemented' && riskRank(tool) <= 1)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function budgetOptions(selected = 120_000) {
  return BUDGETS.map(([ms, label]) => `<option value="${ms}" ${ms === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function statusBadge(status) {
  const kind = {
    completed: 'ok', running: 'ok', scheduled: 'warn', retry_wait: 'warn',
    paused: 'warn', interrupted: 'warn', waiting_approval: 'warn',
    waiting_verification: 'warn', blocked: 'warn', timed_out: 'err',
    failed: 'err', cancelled: '',
  }[status] ?? '';
  return badge(status || 'unknown', kind);
}

function jobRow(job) {
  const label = job.kind === 'task' ? (job.goal || `Task ${job.taskId || ''}`) : (job.toolName || 'Tool job');
  const details = [
    job.kind === 'task' ? 'Task' : 'Tool',
    job.runAt ? `next run ${fmtTime(job.runAt)}` : '',
    job.lastRunAt ? `last run ${fmtTime(job.lastRunAt)}` : '',
    Number.isFinite(job.maxRunMs) ? `budget ${Math.round(job.maxRunMs / 1000)}s` : '',
    job.attempts ? `attempts ${job.attempts}` : '',
  ].filter(Boolean).join(' · ');
  const actions = [];
  if (job.kind === 'task' && ['waiting_approval','waiting_verification','blocked'].includes(job.status)) {
    actions.push('<a class="button" href="#tasks">Open task</a>');
  }
  if (['scheduled', 'retry_wait'].includes(job.status)) {
    actions.push(`<button data-job-action="pause" data-job-id="${esc(job.id)}">Pause</button>`);
    actions.push(`<button data-job-action="cancel" data-job-id="${esc(job.id)}" class="danger">Cancel</button>`);
  } else if (['paused', 'interrupted', 'failed', 'timed_out'].includes(job.status)) {
    actions.push(`<button data-job-action="resume" data-job-id="${esc(job.id)}" class="primary">Resume</button>`);
    actions.push(`<button data-job-action="cancel" data-job-id="${esc(job.id)}" class="danger">Cancel</button>`);
  } else if (['running', 'waiting_approval', 'waiting_verification', 'blocked'].includes(job.status)) {
    actions.push(`<button data-job-action="cancel" data-job-id="${esc(job.id)}" class="danger">Cancel</button>`);
  }
  return `
    <div class="row" style="flex-direction:column;align-items:stretch;gap:8px;">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;">
        <div style="min-width:0;flex:1;"><div class="main">${esc(label)}</div><div class="muted">${esc(details)}</div></div>
        ${statusBadge(job.status)}
      </div>
      ${job.sideEffectOutcomeUncertain ? '<div class="muted" role="status">The external action may have happened before cancellation. Check the provider or activity log before resuming.</div>' : ''}
      ${job.lastError ? `<div class="muted">Last issue: ${esc(job.lastError)}</div>` : ''}
      ${actions.length ? `<div class="inline" style="gap:6px;flex-wrap:wrap;">${actions.join('')}</div>` : ''}
    </div>`;
}

function jobsHtml(jobs) {
  const sorted = [...(Array.isArray(jobs) ? jobs : [])].sort((a, b) => {
    const aTime = Date.parse(a.runAt || a.updatedAt || a.createdAt || 0) || 0;
    const bTime = Date.parse(b.runAt || b.updatedAt || b.createdAt || 0) || 0;
    return aTime - bTime;
  });
  return rows(sorted, jobRow, 'No scheduled jobs yet.');
}

async function fetchJobs() {
  const result = await api.get('/api/jobs');
  return Array.isArray(result) ? result : (result?.jobs ?? []);
}

async function refreshJobs(container, generation) {
  if (generation !== viewGeneration || !container.isConnected) return;
  const list = container.querySelector('#schedule-job-list');
  if (!list) return;
  try {
    const jobs = await fetchJobs();
    if (generation === viewGeneration && container.isConnected) {
      currentJobs = jobs;
      list.innerHTML = jobsHtml(jobs);
    }
  } catch (error) {
    if (generation === viewGeneration && container.isConnected) {
      list.innerHTML = `<div class="empty">Could not refresh jobs: ${esc(error.message)} <button data-job-action="refresh">Retry</button></div>`;
    }
  }
}

export async function render(container) {
  clearInterval(refreshTimer);
  const generation = ++viewGeneration;
  const isCurrent = () => generation === viewGeneration && container.isConnected;
  let jobs = [];
  let tools = [];
  let loadError = '';
  try {
    const [jobResult, toolResult] = await Promise.all([api.get('/api/jobs'), api.get('/api/tools')]);
    jobs = Array.isArray(jobResult) ? jobResult : (jobResult?.jobs ?? []);
    tools = safeTools(toolResult);
  } catch (error) {
    loadError = error.message || 'Could not load schedule data.';
  }
  if (!isCurrent()) return;

  currentJobs = jobs;
  const toolOptions = tools.length
    ? tools.map((tool) => `<option value="${esc(tool.name)}">${esc(tool.name)} — ${esc(tool.description || 'SAFE/LOW risk')}</option>`).join('')
    : '<option value="">No implemented SAFE/LOW-risk tools available</option>';

  container.innerHTML = `
    ${card('Schedule a task', `
      <p class="muted">Plan a goal to run at a future time. EXTERNAL/HIGH_IMPACT steps will still wait for approval when required.</p>
      <form id="schedule-task-form">
        <div class="form-row"><label for="schedule-task-goal">Goal</label><textarea id="schedule-task-goal" required maxlength="2000" placeholder="e.g. prepare tomorrow's meeting brief"></textarea></div>
        <div class="form-row"><label for="schedule-task-at">Run at (your local time)</label><input id="schedule-task-at" type="datetime-local" required></div>
        <div class="form-row"><label for="schedule-task-budget">Maximum runtime</label><select id="schedule-task-budget">${budgetOptions(300_000)}</select></div>
        <button type="submit" class="primary">Schedule task</button>
      </form>
    `)}
    ${card('Schedule a SAFE/LOW-risk tool', `
      <p class="muted">Only implemented SAFE/LOW-risk tools are listed. The server enforces this boundary too. Recurring jobs start after the selected interval.</p>
      <form id="schedule-tool-form">
        <div class="form-row"><label for="schedule-tool-name">Tool</label><select id="schedule-tool-name" required>${toolOptions}</select></div>
        <div class="form-row"><label for="schedule-tool-input">Input (JSON)</label><textarea id="schedule-tool-input" spellcheck="false">{}</textarea></div>
        <div class="form-row"><label for="schedule-tool-delay">Run after (minutes, one-time jobs)</label><input id="schedule-tool-delay" type="number" min="1" max="10080" value="1" required></div>
        <div class="form-row"><label for="schedule-tool-repeat">Repeat every (minutes; 0 = one-time)</label><input id="schedule-tool-repeat" type="number" min="0" max="10080" value="0" required></div>
        <div class="form-row"><label for="schedule-tool-budget">Maximum runtime</label><select id="schedule-tool-budget">${budgetOptions(120_000)}</select></div>
        <button type="submit" class="primary" ${tools.length ? '' : 'disabled'}>Schedule tool</button>
      </form>
    `)}
    ${card('Scheduled jobs', `
      <div class="inline" style="justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span class="muted">Refreshes automatically every 15 seconds while this page is open.</span>
        <button data-job-action="refresh">Refresh now</button>
      </div>
      <div id="schedule-job-list">${jobsHtml(jobs)}</div>
      ${loadError ? `<p class="muted" role="alert">Initial load warning: ${esc(loadError)}</p>` : ''}
    `, { span2: true, id: 'schedule-jobs-card' })}
    <p class="muted" style="grid-column:1/-1;">Important: scheduled work runs only while XOFT's backend is awake and connected. This page schedules actions; a separate push-notification-only reminder service is not yet verified.</p>
  `;

  onDelegate(container, 'submit', '#schedule-task-form', async (form, event) => {
    event.preventDefault();
    if (!isCurrent()) return;
    const goal = container.querySelector('#schedule-task-goal').value.trim();
    const localDate = container.querySelector('#schedule-task-at').value;
    const maxRunMs = Number(container.querySelector('#schedule-task-budget').value);
    const executeAt = new Date(localDate);
    if (!goal || !localDate || !Number.isFinite(executeAt.getTime()) || executeAt.getTime() <= Date.now()) {
      toast('Enter a goal and a future local time.', 'err');
      return;
    }
    try {
      await guarded(() => api.post('/api/task-schedules', { goal, executeAt: executeAt.toISOString(), maxRunMs }), 'Schedule task');
      if (!isCurrent()) return;
      container.querySelector('#schedule-task-form').reset();
      toast('Task scheduled. Approval checks remain active.', 'ok');
      await refreshJobs(container, generation);
    } catch { /* guarded already showed the error */ }
  });

  onDelegate(container, 'submit', '#schedule-tool-form', async (form, event) => {
    event.preventDefault();
    if (!isCurrent()) return;
    const toolName = container.querySelector('#schedule-tool-name').value;
    const rawInput = container.querySelector('#schedule-tool-input').value.trim() || '{}';
    const delayMinutes = Number(container.querySelector('#schedule-tool-delay').value);
    const repeatMinutes = Number(container.querySelector('#schedule-tool-repeat').value);
    const maxRunMs = Number(container.querySelector('#schedule-tool-budget').value);
    let input;
    try { input = JSON.parse(rawInput); } catch { toast('Tool input must be valid JSON.', 'err'); return; }
    if (!toolName || !Number.isFinite(delayMinutes) || delayMinutes < 1 || !Number.isFinite(repeatMinutes) || repeatMinutes < 0) {
      toast('Choose a tool and valid delay/repeat minutes.', 'err');
      return;
    }
    try {
      const body = { toolName, input, maxRunMs };
      if (repeatMinutes > 0) body.intervalMs = repeatMinutes * 60_000;
      else body.delayMs = delayMinutes * 60_000;
      await guarded(() => api.post('/api/jobs', body), 'Schedule tool');
      if (!isCurrent()) return;
      toast(repeatMinutes > 0 ? 'Recurring tool job scheduled.' : 'Tool job scheduled.', 'ok');
      container.querySelector('#schedule-tool-input').value = '{}';
      await refreshJobs(container, generation);
    } catch { /* guarded already showed the error */ }
  });

  onDelegate(container, 'click', '[data-job-action]', async (button) => {
    if (!isCurrent()) return;
    const action = button.dataset.jobAction;
    if (action === 'refresh') { await refreshJobs(container, generation); return; }
    const id = button.dataset.jobId;
    if (!id) return;
    const job = currentJobs.find((item) => item.id === id);
    if (action === 'cancel') {
      const running = job?.status === 'running';
      const warning = running
        ? 'Cancel this running job? A tool that ignores cancellation may still finish an external side effect.'
        : 'Cancel this scheduled job?';
      if (!window.confirm(warning)) return;
    }
    if (action === 'resume' && ['timed_out','interrupted','failed'].includes(job?.status)) {
      if (!window.confirm('The last run may have had an uncertain outcome. Check the provider/activity log before resuming.')) return;
    }
    try {
      await guarded(() => api.post(`/api/jobs/${encodeURIComponent(id)}/${action}`, {}), action);
      if (!isCurrent()) return;
      toast(action === 'cancel' ? 'Cancellation requested.' : action === 'pause' ? 'Job paused.' : action === 'resume' ? 'Job resumed.' : 'Jobs refreshed.', 'ok');
      await refreshJobs(container, generation);
    } catch { /* guarded already showed the error */ }
  });

  refreshTimer = setInterval(() => refreshJobs(container, generation), 15_000);
  cleanup = () => {
    if (generation === viewGeneration) viewGeneration += 1;
    clearInterval(refreshTimer);
  };
}
