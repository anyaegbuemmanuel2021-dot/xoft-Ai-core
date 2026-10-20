import { api, queueLength, flushQueue } from '../api.js';
import { card, badge, rows, esc, toast, guarded, onDelegate } from '../dom.js';
import { mountAiGateways } from './aiGateways.js';

export const title = 'Settings';

export async function render(container) {
  const [health, personality, connectors, tools, briefing] = await Promise.all([
    api.get('/api/model-health').catch(() => ({})),
    api.get('/api/personality').catch(() => ({})),
    api.get('/api/connectors').catch(() => []),
    api.get('/api/tools').catch(() => []),
    api.get('/api/briefings').catch(() => null),
  ]);

  container.innerHTML = `
    <div class="grid">
      ${card('Executive briefing schedule', `
        <p class="muted">XOFT prepares a morning briefing and evening wrap-up from saved tasks, missions, opportunities and activity. Default times use Nigeria time (Africa/Lagos): 08:00 and 20:00.</p>
        <div class="row"><span class="main">Scheduler process</span>${badge(briefing?.schedulerRunning ? 'running' : 'not running', briefing?.schedulerRunning ? 'ok' : 'warn')}</div>
        <div class="row"><span class="main">Schedule state</span>${badge(briefing?.settings?.enabled === false ? 'disabled' : 'enabled', briefing?.settings?.enabled === false ? 'warn' : 'ok')}</div>
        <div class="row"><span class="main">Saved phone destination</span>${badge(briefing?.settings?.phoneNumber ? 'configured' : 'not set', briefing?.settings?.phoneNumber ? 'ok' : 'warn')}</div>
        <div class="row"><span class="main">Delivery mode</span><span>${esc(({sms:'SMS',call:'Phone call',either:'SMS then call fallback',dashboard:'Dashboard only'})[briefing?.settings?.channel || 'sms'] || 'Unknown')}</span></div>
        <div class="muted" style="margin:8px 0 14px">
          ${!briefing?.schedulerRunning ? 'The scheduler is not running in this server process. Saved times will not trigger until it starts.' : briefing?.settings?.enabled === false ? 'The scheduler is running, but scheduled briefings are disabled.' : (briefing?.settings?.channel !== 'dashboard' && !briefing?.settings?.phoneNumber) ? 'A phone destination is missing. Add one below before expecting SMS or calls.' : 'The scheduler is running. Actual SMS/call delivery still depends on valid server-side provider credentials, webhook configuration, account permissions and provider acceptance.'}
        </div>
        <div class="form-row"><label for="briefing-enabled">Scheduled briefings</label><select id="briefing-enabled"><option value="true" ${briefing?.settings?.enabled !== false ? 'selected' : ''}>Enabled</option><option value="false" ${briefing?.settings?.enabled === false ? 'selected' : ''}>Disabled</option></select></div>
        <div class="form-row"><label for="briefing-morning">Morning time</label><input id="briefing-morning" type="time" value="${esc(briefing?.settings?.morningTime || '08:00')}" /></div>
        <div class="form-row"><label for="briefing-evening">Evening time</label><input id="briefing-evening" type="time" value="${esc(briefing?.settings?.eveningTime || '20:00')}" /></div>
        <div class="form-row"><label for="briefing-timezone">Timezone</label><input id="briefing-timezone" value="${esc(briefing?.settings?.timezone || 'Africa/Lagos')}" placeholder="Africa/Lagos" /></div>
        <div class="form-row"><label for="briefing-channel">Delivery channel</label><select id="briefing-channel">
          ${[['sms','SMS'],['call','Phone call'],['either','SMS, then call fallback'],['dashboard','Dashboard/activity only']].map(([v,l]) => `<option value="${v}" ${(briefing?.settings?.channel || 'sms') === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
        <div class="form-row"><label for="briefing-phone">Phone number (international format)</label><input id="briefing-phone" type="tel" maxlength="30" placeholder="${briefing?.settings?.phoneNumber ? 'Number saved; leave blank to keep' : '+2348012345678'}" /></div>
        <div class="form-row"><label><input id="briefing-clear-phone" type="checkbox" /> Clear saved phone number</label></div>
        <button id="briefing-save" class="primary">Save briefing settings</button>
        <button id="briefing-preview">Preview briefing</button>
        <div id="briefing-result" class="muted" aria-live="polite">${briefing?.lastAttempt ? `Last attempt: ${esc(briefing.lastAttempt.status || 'unknown')} — ${esc(briefing.lastAttempt.error || briefing.lastAttempt.at || '')}` : 'No briefing delivery attempt recorded yet.'}</div>
        <p class="muted">Important: a saved schedule is not an Android alarm and does not guarantee a call. XOFT must remain running on a server; phone delivery requires valid Twilio server credentials and public HTTPS voice webhooks. “Provider accepted” means Twilio accepted the request, not that your phone rang or you answered. Use Dashboard/activity only to test the schedule without sending a phone message.</p>
      ` , { span2: true })}
      ${card('API key', `
        <div class="form-row"><label>Key used by this browser</label><input id="api-key-input" placeholder="leave blank if AUTH_API_KEYS is unset" value="${esc(localStorage.getItem('xoft_api_key') || '')}" /></div>
        <button id="api-key-save" class="primary">Save</button>
      `)}
      ${card('Offline queue', `
        <div class="row"><span class="main">Pending requests</span><span>${queueLength()}</span></div>
        <button id="flush-queue">Retry now</button>
      `)}
      ${card('Model health', rows(Object.entries(health), ([name, h]) => `
        <div class="row"><span class="main">${esc(name)}</span>${badge(h.healthy === false ? 'unhealthy' : 'healthy', h.healthy === false ? 'err' : 'ok')}</div>
      `, 'No data yet.'))}
      ${card('Personality traits', `<pre>${esc(JSON.stringify(personality, null, 2)).slice(0, 800)}</pre>`)}
      ${card('Connectors', rows(connectors, (c) => `<div class="row"><span class="main">${esc(c.id ?? c.name)}</span>${badge(c.enabled ? 'enabled' : 'disabled', c.enabled ? 'ok' : '')}</div>`, 'None configured.'))}
      <div id="ai-gateways" style="grid-column: 1 / -1"></div>
      ${card('Registered tools', `<div class="muted">${tools.length} tool(s) available to the AI planner.</div>`)}
    </div>
  `;

  // Optional AI gateways (FreeLLMAPI / LiteLLM). Isolated: if this section fails to load, the rest of Settings is unaffected.
  mountAiGateways(container.querySelector('#ai-gateways')).catch((err) => { const n = container.querySelector('#ai-gateways'); if (n) n.innerHTML = `<div class="empty">AI provider settings could not be loaded: ${esc(err.message)}</div>`; });

  onDelegate(container, 'click', '#briefing-save', async () => {
    const payload = {
      enabled: container.querySelector('#briefing-enabled').value === 'true',
      morningTime: container.querySelector('#briefing-morning').value,
      eveningTime: container.querySelector('#briefing-evening').value,
      timezone: container.querySelector('#briefing-timezone').value.trim(),
      channel: container.querySelector('#briefing-channel').value,
    };
    const phone = container.querySelector('#briefing-phone').value.trim();
    if (phone) payload.phoneNumber = phone;
    if (container.querySelector('#briefing-clear-phone').checked) payload.phoneNumber = '';
    const result = await guarded(() => api.patch('/api/briefings/settings', payload), 'Save briefing settings');
    if (result && !result.__queued) {
      toast('Briefing schedule saved', 'ok');
      const out = container.querySelector('#briefing-result');
      if (out) out.textContent = 'Settings saved. Provider delivery still depends on configured SMS/voice integrations.';
    }
  });

  onDelegate(container, 'click', '#briefing-preview', async () => {
    const result = await guarded(() => api.post('/api/briefings/preview', {}), 'Preview briefing');
    if (result?.preview) {
      const out = container.querySelector('#briefing-result');
      if (out) out.textContent = result.preview;
    }
  });

  onDelegate(container, 'click', '#api-key-save', () => {
    const val = container.querySelector('#api-key-input').value.trim();
    if (val) localStorage.setItem('xoft_api_key', val); else localStorage.removeItem('xoft_api_key');
    toast('Saved', 'ok');
  });

  onDelegate(container, 'click', '#flush-queue', async () => {
    await guarded(() => flushQueue(), 'Flush queue');
    toast('Queue processed', 'ok');
    render(container);
  });
}
