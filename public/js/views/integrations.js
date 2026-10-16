import { card, badge, esc, toast, onDelegate } from '../dom.js';

export const title = 'Plugins & Integrations';
const STORAGE_KEY = 'xoft_attached_apps_v1';
const CATALOG = [
  { id: 'google-workspace', name: 'Google Workspace', category: 'Productivity', icon: 'G', color: 'google', description: 'Gmail, Calendar, Drive and Docs.', url: 'https://workspace.google.com/', capabilities: ['Email', 'Calendar', 'Files'] },
  { id: 'whatsapp', name: 'WhatsApp', category: 'Communication', icon: 'W', color: 'whatsapp', description: 'Open WhatsApp for messaging and follow-up workflows.', url: 'https://web.whatsapp.com/', capabilities: ['Messaging', 'Follow-up'] },
  { id: 'github', name: 'GitHub', category: 'Development', icon: 'GH', color: 'github', description: 'Repositories, issues and development activity.', url: 'https://github.com/', capabilities: ['Repositories', 'Issues'] },
  { id: 'notion', name: 'Notion', category: 'Productivity', icon: 'N', color: 'notion', description: 'Notes, project spaces and knowledge bases.', url: 'https://www.notion.so/', capabilities: ['Notes', 'Knowledge'] },
  { id: 'slack', name: 'Slack', category: 'Communication', icon: 'S', color: 'slack', description: 'Team channels and work conversations.', url: 'https://slack.com/', capabilities: ['Messages', 'Channels'] },
  { id: 'trello', name: 'Trello', category: 'Productivity', icon: 'T', color: 'trello', description: 'Boards, cards and lightweight task tracking.', url: 'https://trello.com/', capabilities: ['Boards', 'Tasks'] },
  { id: 'canva', name: 'Canva', category: 'Creative', icon: 'C', color: 'canva', description: 'Designs, brand assets and creative projects.', url: 'https://www.canva.com/', capabilities: ['Design', 'Brand assets'] },
  { id: 'microsoft-365', name: 'Microsoft 365', category: 'Productivity', icon: 'M', color: 'microsoft', description: 'Outlook, OneDrive, Word and Excel.', url: 'https://www.microsoft365.com/', capabilities: ['Email', 'Documents', 'Files'] },
  { id: 'telegram', name: 'Telegram', category: 'Communication', icon: 'TG', color: 'telegram', description: 'Open Telegram for chats and channels.', url: 'https://web.telegram.org/', capabilities: ['Messaging', 'Channels'] },
  { id: 'figma', name: 'Figma', category: 'Creative', icon: 'F', color: 'figma', description: 'UI design files and collaborative prototypes.', url: 'https://www.figma.com/', capabilities: ['Design', 'Prototypes'] },
  { id: 'google-drive', name: 'Google Drive', category: 'Files', icon: 'D', color: 'google', description: 'Your cloud documents and shared files.', url: 'https://drive.google.com/', capabilities: ['Files', 'Sharing'] },
  { id: 'calendar', name: 'Google Calendar', category: 'Productivity', icon: '▦', color: 'google', description: 'Open your calendar and manage your day.', url: 'https://calendar.google.com/', capabilities: ['Schedule', 'Events'] },
];

function loadAttached() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
function saveAttached(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}
function isAdded(id, items) { return items.some((x) => x.id === id); }

export async function render(container) {
  let attached = loadAttached();
  let filter = 'All';
  let query = '';
  container.innerHTML = `
    <section class="plugin-hero">
      <div class="plugin-hero-copy">
        <span class="plugin-kicker">XOFT EXTENSION HUB</span>
        <h2>Connect your everyday workflow.</h2>
        <p>Bring your favorite apps into one personal workspace. Add quick-launch apps, save your own links, and build toward deeper XOFT automations.</p>
      </div>
      <div class="plugin-hero-stats">
        <div><strong id="plugin-count">${attached.length}</strong><span>MY APPS</span></div>
        <div><strong>${CATALOG.length}+</strong><span>STARTER APPS</span></div>
        <div><strong>24/7</strong><span>YOUR WORKSPACE</span></div>
      </div>
    </section>
    <div class="plugin-toolbar">
      <label class="plugin-search"><span aria-hidden="true">⌕</span><input id="plugin-search" type="search" placeholder="Search apps, tools and services…" aria-label="Search apps" /></label>
      <button id="plugin-custom-toggle" class="primary">＋ Add custom app</button>
    </div>
    <section id="plugin-custom-panel" class="card plugin-custom" hidden>
      <div class="plugin-section-head"><div><span class="plugin-kicker">PERSONAL CONNECTOR</span><h2>Add your own app</h2></div><button id="plugin-custom-cancel" aria-label="Close custom app form">Close</button></div>
      <div class="plugin-form-grid">
        <div class="form-row"><label for="custom-app-name">APP NAME</label><input id="custom-app-name" placeholder="e.g. My project manager" maxlength="60" /></div>
        <div class="form-row"><label for="custom-app-url">APP URL</label><input id="custom-app-url" type="url" placeholder="https://app.example.com" /></div>
        <div class="form-row"><label for="custom-app-category">CATEGORY</label><select id="custom-app-category"><option>Productivity</option><option>Communication</option><option>Development</option><option>Creative</option><option>Files</option><option>Finance</option><option>Other</option></select></div>
        <div class="form-row"><label for="custom-app-note">WHAT DO YOU USE IT FOR? (OPTIONAL)</label><input id="custom-app-note" maxlength="160" placeholder="Notes, client work, scheduling…" /></div>
      </div>
      <p class="plugin-safety-note">This saves a quick-launch link in this browser. It does not sign in to the service or grant XOFT API access.</p>
      <button id="plugin-custom-save" class="primary">Save app to XOFT</button>
    </section>
    <div class="plugin-section-head plugin-list-head"><div><span class="plugin-kicker">APP DIRECTORY</span><h2>Discover integrations</h2></div><span class="plugin-results" id="plugin-results"></span></div>
    <div class="plugin-filters" role="group" aria-label="Filter apps">
      ${['All','Productivity','Communication','Development','Creative','Files','Finance','Other'].map((x) => `<button type="button" data-plugin-filter="${x}" class="${x === filter ? 'active' : ''}">${x}</button>`).join('')}
    </div>
    <div id="plugin-grid" class="plugin-grid"></div>
    <section class="plugin-note card"><div class="plugin-note-icon">↗</div><div><h3>Quick launch is the first layer.</h3><p>Real actions—reading email, sending messages, editing files or running workflows—require a supported backend connector and explicit authorization. XOFT will not claim an app is API-connected just because it has been added here.</p></div></section>
  `;

  const grid = container.querySelector('#plugin-grid');
  const renderGrid = () => {
    const q = query.trim().toLowerCase();
    const all = [...CATALOG, ...attached.filter((x) => x.custom)];
    const shown = all.filter((app) => (filter === 'All' || app.category === filter) &&
      (!q || [app.name, app.category, app.description, ...(app.capabilities || [])].join(' ').toLowerCase().includes(q)));
    container.querySelector('#plugin-results').textContent = `${shown.length} apps`;
    container.querySelector('#plugin-count').textContent = attached.length;
    grid.innerHTML = shown.map((app) => {
      const added = isAdded(app.id, attached);
      const custom = Boolean(app.custom);
      return `
        <article class="plugin-card">
          <div class="plugin-card-top"><div class="plugin-app-icon ${esc(app.color || 'custom')}" aria-hidden="true">${esc(app.icon || app.name.slice(0,2).toUpperCase())}</div><span class="plugin-category">${esc(app.category)}</span></div>
          <h3>${esc(app.name)}</h3><p class="plugin-description">${esc(app.description || app.note || 'Your personal app shortcut.')}</p>
          <div class="plugin-capabilities">${(app.capabilities || ['Quick launch']).slice(0,3).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
          <div class="plugin-card-actions">
            ${added ? `<button class="plugin-open primary" data-plugin-open="${esc(app.id)}">Open app ↗</button><button class="plugin-remove" data-plugin-remove="${esc(app.id)}" aria-label="Remove ${esc(app.name)}" title="Remove app">×</button>` : `<button class="plugin-add" data-plugin-add="${esc(app.id)}">＋ Add to XOFT</button>`}
          </div>
          ${custom ? '<span class="plugin-custom-tag">PERSONAL APP</span>' : ''}
        </article>`;
    }).join('') || '<div class="card plugin-empty">No apps match this search. Try another term or add a custom app.</div>';
  };
  renderGrid();

  onDelegate(container, 'input', '#plugin-search', (el) => { query = el.value; renderGrid(); });
  onDelegate(container, 'click', '[data-plugin-filter]', (el) => {
    filter = el.dataset.pluginFilter;
    container.querySelectorAll('[data-plugin-filter]').forEach((b) => b.classList.toggle('active', b === el));
    renderGrid();
  });
  onDelegate(container, 'click', '#plugin-custom-toggle', () => { container.querySelector('#plugin-custom-panel').hidden = false; container.querySelector('#custom-app-name').focus(); });
  onDelegate(container, 'click', '#plugin-custom-cancel', () => { container.querySelector('#plugin-custom-panel').hidden = true; });
  onDelegate(container, 'click', '#plugin-custom-save', () => {
    const name = container.querySelector('#custom-app-name').value.trim();
    const rawUrl = container.querySelector('#custom-app-url').value.trim();
    const category = container.querySelector('#custom-app-category').value;
    const note = container.querySelector('#custom-app-note').value.trim();
    if (!name || !rawUrl) return toast('Enter an app name and URL.', 'warn');
    let url;
    try { url = new URL(rawUrl); } catch { return toast('Enter a valid full URL starting with https://', 'err'); }
    if (!['https:', 'http:'].includes(url.protocol)) return toast('Only HTTP and HTTPS app links are supported.', 'err');
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return toast('Use HTTPS for external apps.', 'err');
    const id = 'custom-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
    attached = [...attached, { id, name, url: url.href, category, note, description: note || 'Personal app shortcut.', icon: name.slice(0,2).toUpperCase(), custom: true, capabilities: ['Quick launch'] }];
    saveAttached(attached);
    container.querySelector('#custom-app-name').value = '';
    container.querySelector('#custom-app-url').value = '';
    container.querySelector('#custom-app-note').value = '';
    container.querySelector('#plugin-custom-panel').hidden = true;
    toast('App added to this XOFT browser.', 'ok');
    renderGrid();
  });
  onDelegate(container, 'click', '[data-plugin-add]', (el) => {
    const app = CATALOG.find((x) => x.id === el.dataset.pluginAdd);
    if (!app || isAdded(app.id, attached)) return;
    attached = [...attached, { ...app, custom: false }];
    saveAttached(attached);
    toast(`${app.name} added to your XOFT workspace.`, 'ok');
    renderGrid();
  });
  onDelegate(container, 'click', '[data-plugin-open]', (el) => {
    const app = attached.find((x) => x.id === el.dataset.pluginOpen);
    if (!app) return;
    const url = app.url || CATALOG.find((x) => x.id === app.id)?.url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  });
  onDelegate(container, 'click', '[data-plugin-remove]', (el) => {
    const app = attached.find((x) => x.id === el.dataset.pluginRemove);
    if (!app) return;
    attached = attached.filter((x) => x.id !== app.id);
    saveAttached(attached);
    toast(`${app.name} removed from your XOFT workspace.`, 'info');
    renderGrid();
  });
}
