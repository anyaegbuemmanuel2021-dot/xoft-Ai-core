import { api } from '../api.js';
import { card, badge, esc, toast, guarded, onDelegate, fmtTime } from '../dom.js';

export const title = 'Opportunities';

const STAGES = ['researched', 'qualified', 'draft_prepared', 'approval_required', 'contacted', 'replied', 'meeting', 'won', 'lost', 'follow_up_due'];

export async function render(container) {
  let data;
  let summary;
  try {
    [data, summary] = await Promise.all([api.get('/api/opportunities'), api.get('/api/opportunities/summary')]);
  } catch (error) {
    container.innerHTML = '<div class="empty">Could not load opportunities. Check the connection and API permissions, then retry.</div>';
    return;
  }
  const opportunities = Array.isArray(data) ? data : [];
  container.innerHTML = `
    <div class="grid">
      ${card('Pipeline summary', `
        <div class="row"><span class="main">Active opportunities</span><strong>${summary.active ?? 0}</strong></div>
        <div class="row"><span class="main">Follow-ups due</span><strong>${summary.followUpsDue ?? 0}</strong></div>
        <div class="row"><span class="main">Won</span><strong>${summary.won ?? 0}</strong></div>
        <div class="row"><span class="main">Lost</span><strong>${summary.lost ?? 0}</strong></div>
        <p class="muted">Estimated value is not confirmed income. Mark work as won only when the opportunity is genuinely secured.</p>
      `)}
      ${card('Discover public opportunities', `
        <p class="muted">Search public web results for potential clients or paid projects. XOFT saves sourced results for review; it does not treat search snippets as verified clients or guaranteed income.</p>
        <div class="form-row"><label for="opp-discover-query">What should XOFT look for?</label><input id="opp-discover-query" maxlength="300" placeholder="small businesses in Enugu looking for website development" /></div>
        <button id="opp-discover" class="primary">Search and save leads</button>
        <div id="opp-discover-result" class="muted" aria-live="polite"></div>
      `)}
      ${card('Add opportunity', `
        <div class="form-row"><label for="opp-title">Opportunity / project *</label><input id="opp-title" maxlength="180" placeholder="Business website project" required /></div>
        <div class="form-row"><label for="opp-company">Company</label><input id="opp-company" maxlength="180" placeholder="Company or client" /></div>
        <div class="form-row"><label for="opp-url">Public source URL</label><input id="opp-url" type="url" placeholder="https://..." /></div>
        <div class="form-row"><label for="opp-service">Relevant service</label><input id="opp-service" maxlength="180" placeholder="Website development / automation" /></div>
        <div class="form-row"><label for="opp-value">Estimated value (NGN)</label><input id="opp-value" type="number" min="0" step="1" placeholder="Optional estimate" /></div>
        <div class="form-row"><label for="opp-fit">Why it may fit</label><textarea id="opp-fit" maxlength="4000" placeholder="Evidence-based reason this could fit your services"></textarea></div>
        <div class="form-row"><label for="opp-next">Next action</label><input id="opp-next" maxlength="1000" placeholder="Review requirements and prepare a draft" /></div>
        <div class="form-row"><label for="opp-followup">Follow-up time</label><input id="opp-followup" type="datetime-local" /></div>
        <button id="opp-create" class="primary">Save opportunity</button>
      `)}
      ${card('Opportunity pipeline', `
        <div class="form-row"><label for="opp-search">Search</label><input id="opp-search" placeholder="Search title, company or service" /></div>
        <div id="opp-list"></div>
      `, { span2: true })}
    </div>
  `;
  const body = container.querySelector('#opp-list');
  const paintList = (query = '') => {
    const filtered = opportunities.filter((item) => [item.title, item.company, item.service, item.fitRationale].some((v) => String(v ?? '').toLowerCase().includes(query.toLowerCase())));
    body.innerHTML = filtered.length ? filtered.map((item) => `
      <article class="row" style="display:block; padding:14px 0;">
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap">
          <strong>${esc(item.title)}</strong>
          ${badge(item.stage, item.stage === 'won' ? 'ok' : item.stage === 'lost' ? 'err' : item.stage === 'follow_up_due' ? 'warn' : '')}
        </div>
        <div class="muted" style="margin:5px 0">${esc(item.company || 'Company not set')} · ${esc(item.service || 'Service not set')}</div>
        ${item.sourceUrl ? `<div><a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source</a></div>` : ''}
        ${item.fitRationale ? `<p>${esc(item.fitRationale)}</p>` : ''}
        <div class="muted">Estimated value: ${item.estimatedValue == null ? 'Not estimated' : '₦' + Number(item.estimatedValue).toLocaleString()} · Updated ${esc(fmtTime(item.updatedAt))}</div>
        ${item.nextAction ? `<div>Next: ${esc(item.nextAction)}</div>` : ''}
        ${item.nextFollowUpAt ? `<div class="muted">Follow-up: ${esc(fmtTime(item.nextFollowUpAt))}</div>` : ''}
        <div class="inline" style="gap:8px;margin-top:8px">
          <label for="stage-${esc(item.id)}" class="muted">Stage</label>
          <select id="stage-${esc(item.id)}" data-stage-select="${esc(item.id)}">${STAGES.map((stage) => `<option value="${stage}" ${stage === item.stage ? 'selected' : ''}>${stage.replaceAll('_', ' ')}</option>`).join('')}</select>
          <button data-stage-save="${esc(item.id)}">Update</button>
        </div>
      </article>
    `).join('') : '<div class="empty">No matching opportunities yet. Save a real lead or project to start tracking it.</div>';
  };
  paintList();
  onDelegate(container, 'input', '#opp-search', (el) => paintList(el.value.trim()));
  onDelegate(container, 'click', '#opp-discover', async () => {
    const query = container.querySelector('#opp-discover-query').value.trim();
    if (!query) { toast('Enter what you want XOFT to search for', 'warn'); return; }
    const button = container.querySelector('#opp-discover');
    button.disabled = true;
    button.textContent = 'Searching…';
    const result = await guarded(() => api.post('/api/opportunities/discover', { query, count: 5 }), 'Discover opportunities');
    button.disabled = false;
    button.textContent = 'Search and save leads';
    if (result?.__queued) {
      toast('Research needs a live connection; no results have been confirmed', 'warn');
      return;
    }
    if (result && Array.isArray(result.saved)) {
      const note = `Searched ${result.searched}; saved ${result.saved.length}; duplicates ${result.duplicates}; skipped ${result.skipped}. Review every source before outreach.`;
      container.querySelector('#opp-discover-result').textContent = note;
      toast(`Saved ${result.saved.length} sourced results for review`, 'ok');
      render(container);
    }
  });
  onDelegate(container, 'click', '#opp-create', async () => {
    const value = container.querySelector('#opp-value').value;
    const followup = container.querySelector('#opp-followup').value;
    const payload = {
      title: container.querySelector('#opp-title').value.trim(),
      company: container.querySelector('#opp-company').value.trim(),
      sourceUrl: container.querySelector('#opp-url').value.trim(),
      service: container.querySelector('#opp-service').value.trim(),
      estimatedValue: value === '' ? null : Number(value),
      fitRationale: container.querySelector('#opp-fit').value.trim(),
      nextAction: container.querySelector('#opp-next').value.trim(),
      nextFollowUpAt: followup ? new Date(followup).toISOString() : null,
    };
    if (!payload.title) { toast('Enter an opportunity title', 'warn'); return; }
    const result = await guarded(() => api.post('/api/opportunities', payload), 'Save opportunity');
    if (result?.__queued) { toast('Queued while offline; verify the saved record when reconnected', 'warn'); return; }
    if (result?.id) {
      toast('Opportunity saved', 'ok');
      render(container);
    }
  });
  onDelegate(container, 'click', '[data-stage-save]', async (el) => {
    const id = el.dataset.stageSave;
    const stage = container.querySelector(`[data-stage-select="${CSS.escape(id)}"]`).value;
    const result = await guarded(() => api.patch(`/api/opportunities/${encodeURIComponent(id)}`, { stage }), 'Update opportunity');
    if (result?.id) { toast('Opportunity stage updated', 'ok'); render(container); }
  });
}
