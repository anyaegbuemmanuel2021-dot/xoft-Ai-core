import { api } from '../api.js';
import { card, rows, fmtTime, esc, onDelegate, debounce } from '../dom.js';
import { onEvent } from '../ws.js';

export const title = 'Activity';
export let cleanup = null;
let tab = 'log';

export async function render(container) {
  container.innerHTML = `
    <div class="tabs">
      <button data-tab="log" class="${tab === 'log' ? 'active' : ''}">Activity log</button>
      <button data-tab="events" class="${tab === 'events' ? 'active' : ''}">Event stream</button>
      <button data-tab="incidents" class="${tab === 'incidents' ? 'active' : ''}">Incidents</button>
    </div>
    <div id="tab-body"><div class="empty">Loading…</div></div>
  `;
  onDelegate(container, 'click', '[data-tab]', (el) => { tab = el.dataset.tab; render(container); });

  const body = container.querySelector('#tab-body');
  if (tab === 'log') {
    const entries = await api.get('/api/activity');
    body.innerHTML = card(`Recent activity (${entries.length})`, rows(entries.slice().reverse().slice(0, 200), logRow, 'Nothing logged yet.'));
    const refresh = debounce(() => render(container), 600);
    cleanup = onEvent(['*'], refresh);
  } else if (tab === 'events') {
    const events = await api.get('/api/events?limit=100');
    const list = events.slice().reverse();
    body.innerHTML = card(`Recent events (${list.length})`, rows(list, eventRow, 'No events yet.'), { id: 'events-card' });
    // Genuinely live here, no re-fetch: prepend each incoming event as it
    // arrives instead of waiting for a debounced full reload.
    cleanup = onEvent(['*'], (event) => {
      const listEl = body.querySelector('#events-card');
      if (!listEl) return;
      const empty = listEl.querySelector('.empty');
      if (empty) empty.remove();
      listEl.insertAdjacentHTML('beforeend', eventRow(event));
    });
  } else {
    const result = await api.get('/api/incidents?limit=100');
    const incidents = result.incidents ?? [];
    const summary = result.summary ?? {};
    body.innerHTML = `
      ${card('Incident overview', `
        <div class="row"><span class="main">Open incidents</span>${summary.open ?? 0}</div>
        <div class="row"><span class="main">Critical</span>${summary.critical ?? 0}</div>
        <div class="row"><span class="main">Errors</span>${summary.errors ?? 0}</div>
        <div class="row"><span class="main">Warnings</span>${summary.warnings ?? 0}</div>
        <p class="muted">Repeated identical open errors are grouped. Messages, stacks, and context are redacted before storage.</p>
      `)}
      ${card(`Incident records (${incidents.length})`, rows(incidents, incidentRow, 'No incidents recorded.'), { span2: true, id: 'incident-list' })}
    `;
    onDelegate(container, 'click', '[data-resolve-incident]', async (el) => {
      const note = window.prompt('Resolution note (optional):', 'Reviewed');
      if (note === null) return;
      try {
        await api.post(`/api/incidents/${encodeURIComponent(el.dataset.resolveIncident)}/resolve`, { resolvedBy: 'dashboard operator', note });
        render(container);
      } catch (error) {
        alert('Could not resolve incident: ' + error.message);
      }
    });
    onDelegate(container, 'click', '[data-triage-incident]', async (el) => {
      if (!window.confirm('Run AI triage and a sandbox test for this incident? XOFT will not apply code automatically. This can take several minutes.')) return;
      el.disabled = true;
      try {
        const result = await api.post(`/api/incidents/${encodeURIComponent(el.dataset.triageIncident)}/triage`, {});
        const actions = (result.recommendedActions ?? []).map((item) => '• ' + item).join('\n');
        const proposal = result.repairProposal
          ? `\n\nRepair proposal: ${result.repairProposal.id}\nStatus: ${result.repairProposal.status}\nA passing proposal still requires explicit human approval before applying.`
          : `\n\nNo repair proposal created. ${result.repairRejectedReason || 'The triage found no safe automatic patch candidate.'}`;
        window.alert(`XOFT incident triage\n\n${result.diagnosis || 'No diagnosis returned.'}${actions ? '\n\nRecommended next steps:\n' + actions : ''}${proposal}`);
        render(container);
      } catch (error) {
        window.alert('Incident triage failed: ' + error.message);
        el.disabled = false;
      }
    });
    cleanup = onEvent(['incident.created', 'incident.updated', 'incident.resolved', 'incident.triaged'], debounce(() => render(container), 500));
  }
}

function logRow(e) {
  return `
    <div class="row" style="flex-direction:column; align-items:stretch;">
      <div class="main">${esc(e.type)}</div>
      <div class="muted" style="margin:2px 0;">${fmtTime(e.timestamp ?? e.createdAt)}${e.taskId ? ' · task ' + e.taskId.slice(0, 8) : ''}</div>
      ${e.detail ? `<pre>${esc(JSON.stringify(e.detail)).slice(0, 300)}</pre>` : ''}
    </div>
  `;
}

function eventRow(e) {
  return `
    <div class="row" style="flex-direction:column; align-items:stretch;">
      <div class="main">${esc(e.type)}</div>
      <div class="muted" style="margin:2px 0;">${fmtTime(e.ts)}</div>
      ${e.payload ? `<pre>${esc(JSON.stringify(e.payload)).slice(0, 300)}</pre>` : ''}
    </div>
  `;
}


function incidentRow(incident) {
  const severity = String(incident.severity || 'error').toUpperCase();
  const error = incident.error ?? {};
  const context = (incident.recentEvents ?? []).slice(-3);
  return `
    <div class="row" style="flex-direction:column; align-items:stretch; gap:6px;">
      <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
        <span class="main">${esc(error.name || 'Error')} · ${esc(incident.source || 'unknown source')}</span>
        <span class="badge" data-tone="${severity === 'CRITICAL' ? 'err' : severity === 'ERROR' ? 'warn' : ''}">${esc(severity)} · ${esc(incident.status || 'open')}</span>
      </div>
      <div>${esc(error.message || 'No error message')}</div>
      <div class="muted">${esc(incident.count || 1)} occurrence(s) · first ${fmtTime(incident.firstSeenAt)} · last ${fmtTime(incident.lastSeenAt)}</div>
      <div class="muted">Correlation ID: ${esc(incident.lastCorrelationId || 'not recorded')}</div>
      <details><summary>Technical context</summary><pre>${esc(JSON.stringify({ stack: error.stack, recentEvents: context }, null, 2)).slice(0, 5000)}</pre></details>
      ${incident.status === 'open' ? `<div style="display:flex; gap:8px; flex-wrap:wrap;"><button type="button" data-triage-incident="${esc(incident.id)}">AI triage + sandbox</button><button type="button" data-resolve-incident="${esc(incident.id)}">Mark resolved</button></div>` : incident.resolution ? `<div class="muted">Resolved by ${esc(incident.resolution.by || 'operator')} at ${fmtTime(incident.resolution.at)}: ${esc(incident.resolution.note || '')}</div>` : ''}
    </div>
  `;
}
