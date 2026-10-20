import { api } from '../api.js';
import { card, badge, fmtTime, esc, toast, guarded, onDelegate } from '../dom.js';

export const title = 'Project Delivery';
let filter = '';

const STAGES = ['proposal_draft','awaiting_client_confirmation','accepted','in_progress','quality_review','delivered','invoice_draft','payment_pending','paid','blocked','cancelled'];
const label = (s) => String(s ?? '').replaceAll('_',' ');
const money = (p) => p.quotedAmount == null ? 'Not set' : new Intl.NumberFormat('en-NG',{style:'currency',currency:p.currency || 'NGN',maximumFractionDigits:2}).format(p.quotedAmount);
const dateInput = (s) => s ? new Date(s).toISOString().slice(0,16) : '';

export async function render(container) {
  container.innerHTML = '<div class="empty">Loading delivery projects…</div>';
  let projects = [];
  let opportunities = [];
  let summary = {};
  try {
    [projects, opportunities, summary] = await Promise.all([
      api.get('/api/delivery/projects'),
      api.get('/api/opportunities'),
      api.get('/api/delivery/summary'),
    ]);
  } catch (err) {
    container.innerHTML = '<div class="empty">Could not load delivery projects. Check that the updated server is deployed and you are connected.</div>';
    return;
  }
  container.innerHTML = `
    <div class="grid">
      ${card('Delivery overview', `
        <div class="row"><span class="main">Active projects</span><strong>${summary.active ?? 0}</strong></div>
        <div class="row"><span class="main">In progress</span><strong>${summary.inProgress ?? 0}</strong></div>
        <div class="row"><span class="main">Delivered / invoiced</span><strong>${summary.delivered ?? 0}</strong></div>
        <div class="row"><span class="main">Awaiting payment</span><strong>${summary.paymentPending ?? 0}</strong></div>
        <div class="row"><span class="main">Confirmed paid</span><strong>${summary.paid ?? 0}</strong></div>
        <div class="row"><span class="main">Overdue</span><strong>${summary.overdue ?? 0}</strong></div>
      `)}
      ${card('Start from an opportunity', `
        <p class="muted">Create a project from a researched lead. This does not contact the client or imply they have accepted your offer.</p>
        <div class="form-row"><label for="delivery-opportunity">Opportunity</label><select id="delivery-opportunity"><option value="">Choose a lead…</option>${opportunities.filter((o) => !['lost'].includes(o.stage)).map((o) => `<option value="${esc(o.id)}">${esc(o.title)} · ${esc(o.company || 'Company not set')}</option>`).join('')}</select></div>
        <button id="delivery-create" class="primary">Create project draft</button>
      `)}
      ${card('Project pipeline', `
        <div class="form-row"><label for="delivery-search">Search projects</label><input id="delivery-search" placeholder="Title, client, scope…" /></div>
        <div class="form-row"><label for="delivery-stage-filter">Stage</label><select id="delivery-stage-filter"><option value="">All stages</option>${STAGES.map((s) => `<option value="${s}" ${filter === s ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select></div>
        <div id="delivery-list"></div>
      `, { span2: true })}
    </div>
  `;
  const list = container.querySelector('#delivery-list');
  const paint = () => {
    const q = container.querySelector('#delivery-search').value.trim().toLowerCase();
    const stage = container.querySelector('#delivery-stage-filter').value;
    const rows = projects.filter((p) => (!stage || p.stage === stage) && (!q || [p.title,p.company,p.clientName,p.scope,p.notes].some((v) => String(v ?? '').toLowerCase().includes(q))));
    list.innerHTML = rows.length ? rows.map((p) => `
      <article style="padding:16px 0;border-bottom:1px solid var(--border, #333)">
        <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">
          <strong>${esc(p.title)}</strong>${badge(label(p.stage), p.stage === 'paid' ? 'ok' : ['blocked','cancelled'].includes(p.stage) ? 'err' : ['payment_pending','awaiting_client_confirmation'].includes(p.stage) ? 'warn' : '')}
        </div>
        <div class="muted" style="margin:6px 0">${esc(p.clientName || p.company || 'Client not set')} · ${esc(money(p))} · Deadline: ${esc(p.deadline ? fmtTime(p.deadline) : 'not set')}</div>
        <div>${esc(p.scope || p.service || 'Scope not set')}</div>
        ${p.missionId ? `<div class="muted">Linked mission: ${esc(p.missionId)}</div>` : ''}
        <div class="form-row"><label for="delivery-scope-${esc(p.id)}">Scope / requirements</label><textarea id="delivery-scope-${esc(p.id)}" maxlength="8000">${esc(p.scope || '')}</textarea></div>
        <div class="form-row"><label for="delivery-price-${esc(p.id)}">Quoted amount (${esc(p.currency || 'NGN')})</label><input id="delivery-price-${esc(p.id)}" type="number" min="0" step="0.01" value="${p.quotedAmount == null ? '' : esc(p.quotedAmount)}" /></div>
        <div class="form-row"><label for="delivery-deadline-${esc(p.id)}">Deadline</label><input id="delivery-deadline-${esc(p.id)}" type="datetime-local" value="${dateInput(p.deadline)}" /></div>
        <div class="form-row"><label for="delivery-client-${esc(p.id)}">Client name</label><input id="delivery-client-${esc(p.id)}" maxlength="1000" value="${esc(p.clientName || '')}" /></div>
        <div class="form-row"><label for="delivery-email-${esc(p.id)}">Client email</label><input id="delivery-email-${esc(p.id)}" type="email" maxlength="1000" value="${esc(p.clientEmail || '')}" /></div>
        <div class="form-row"><label for="delivery-deliverables-${esc(p.id)}">Deliverables (one per line)</label><textarea id="delivery-deliverables-${esc(p.id)}">${esc((p.deliverables || []).join('\n'))}</textarea></div>
        <button data-delivery-save="${esc(p.id)}">Save project details</button>
        <details style="margin-top:10px"><summary>Proposal draft</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(p.proposalText || '')}</pre><button data-delivery-copy-proposal="${esc(p.id)}">Copy proposal</button></details>
        ${p.invoiceText ? `<details><summary>Invoice draft</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(p.invoiceText)}</pre><button data-delivery-copy-invoice="${esc(p.id)}">Copy invoice</button></details>` : ''}
        <div class="form-row"><label for="delivery-evidence-${esc(p.id)}">Evidence / action note</label><textarea id="delivery-evidence-${esc(p.id)}" placeholder="Client acceptance reference, deployed URL, invoice reference, or payment receipt reference"></textarea></div>
        <div class="inline" style="gap:6px;flex-wrap:wrap;margin-top:8px">
          ${actionsFor(p).map((a) => `<button data-delivery-action="${a.action}" data-delivery-id="${esc(p.id)}" class="${a.danger ? 'danger' : ''}">${esc(a.label)}</button>`).join('')}
        </div>
        <details style="margin-top:10px"><summary>History (${p.history?.length ?? 0})</summary>${(p.history || []).slice().reverse().map((h) => `<div class="muted" style="padding:4px 0">${esc(fmtTime(h.at))} · ${esc(label(h.stage))} — ${esc(h.note || '')}</div>`).join('')}</details>
      </article>
    `).join('') : '<div class="empty">No projects match this filter. Create one from an opportunity above.</div>';
  };
  function actionsFor(p) {
    const actions = {
      proposal_draft: [{action:'submit_proposal',label:'Mark proposal ready for client'}],
      awaiting_client_confirmation: [{action:'confirm_client_acceptance',label:'Record client acceptance'}],
      accepted: [{action:'start_work',label:'Start work'}],
      in_progress: [{action:'request_quality_review',label:'Send to quality review'}],
      quality_review: [{action:'approve_delivery',label:'Record delivery evidence'}],
      delivered: [{action:'create_invoice',label:'Generate invoice draft'}],
      invoice_draft: [{action:'mark_invoice_sent',label:'Record invoice sent'}],
      payment_pending: [{action:'confirm_payment',label:'Confirm payment with evidence'}],
      blocked: [{action:'unblock',label:'Unblock project'}],
    };
    const result = actions[p.stage] ? [...actions[p.stage]] : [];
    if (!['paid','cancelled'].includes(p.stage)) result.push({action:'block',label:'Mark blocked',danger:true},{action:'cancel',label:'Cancel project',danger:true});
    return result;
  }
  paint();
  onDelegate(container, 'input', '#delivery-search', paint);
  onDelegate(container, 'change', '#delivery-stage-filter', paint);
  onDelegate(container, 'click', '#delivery-create', async () => {
    const opportunityId = container.querySelector('#delivery-opportunity').value;
    if (!opportunityId) return toast('Choose an opportunity first', 'warn');
    const result = await guarded(() => api.post('/api/delivery/projects/from-opportunity', { opportunityId }), 'Create delivery project');
    if (result?.id) { toast('Project draft created', 'ok'); render(container); }
  });
  onDelegate(container, 'click', '[data-delivery-save]', async (el) => {
    const id = el.dataset.deliverySave;
    const amount = container.querySelector(`#delivery-price-${CSS.escape(id)}`).value;
    const deadline = container.querySelector(`#delivery-deadline-${CSS.escape(id)}`).value;
    const deliverables = container.querySelector(`#delivery-deliverables-${CSS.escape(id)}`).value.split('\n').map((v) => v.trim()).filter(Boolean);
    const payload = {
      scope: container.querySelector(`#delivery-scope-${CSS.escape(id)}`).value,
      quotedAmount: amount === '' ? null : Number(amount),
      deadline: deadline ? new Date(deadline).toISOString() : null,
      clientName: container.querySelector(`#delivery-client-${CSS.escape(id)}`).value,
      clientEmail: container.querySelector(`#delivery-email-${CSS.escape(id)}`).value,
      deliverables,
    };
    const result = await guarded(() => api.patch(`/api/delivery/projects/${encodeURIComponent(id)}`, payload), 'Save project details');
    if (result?.id) { toast('Project saved', 'ok'); render(container); }
  });
  onDelegate(container, 'click', '[data-delivery-action]', async (el) => {
    const id = el.dataset.deliveryId;
    const evidence = container.querySelector(`#delivery-evidence-${CSS.escape(id)}`).value.trim();
    const payload = { action: el.dataset.deliveryAction, evidence, note: evidence };
    if (payload.action === 'mark_invoice_sent') payload.invoiceReference = evidence;
    if (payload.action === 'confirm_payment') payload.paymentReference = evidence;
    const result = await guarded(() => api.post(`/api/delivery/projects/${encodeURIComponent(id)}/actions`, payload), 'Update project stage');
    if (result?.id) { toast('Project updated: ' + label(result.stage), 'ok'); render(container); }
  });
  onDelegate(container, 'click', '[data-delivery-copy-proposal]', async (el) => {
    const p = projects.find((x) => x.id === el.dataset.deliveryCopyProposal);
    if (p?.proposalText) { await navigator.clipboard.writeText(p.proposalText); toast('Proposal copied', 'ok'); }
  });
  onDelegate(container, 'click', '[data-delivery-copy-invoice]', async (el) => {
    const p = projects.find((x) => x.id === el.dataset.deliveryCopyInvoice);
    if (p?.invoiceText) { await navigator.clipboard.writeText(p.invoiceText); toast('Invoice copied', 'ok'); }
  });
}
