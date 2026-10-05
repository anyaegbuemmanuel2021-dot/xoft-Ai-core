import { registerRoute, startRouter } from './router.js';
import { events, queueLength } from './api.js';
import { toast } from './dom.js';
import { connect as wsConnect, isConnected as wsIsConnected, wsEvents } from './ws.js';

import * as command from './dashboard/XoftCommandCenter.js';
import * as overview from './views/overview.js';
import * as chat from './views/chat.js';
import * as tasks from './views/tasks.js';
import * as missions from './views/missions.js';
import * as memory from './views/memory.js';
import * as devices from './views/devices.js';
import * as runtime from './views/runtime.js';
import * as engines from './views/engines.js';
import * as approvals from './views/approvals.js';
import * as automation from './views/automation.js';
import * as activity from './views/activity.js';
import * as settings from './views/settings.js';

const NAV = [
  { group: 'Core', items: [['command', 'Command Center', command], ['overview', 'Overview', overview], ['chat', 'Chat', chat]] },
  { group: 'Planning', items: [['tasks', 'Tasks', tasks], ['engines', 'Engines', engines], ['missions', 'Missions & Goals', missions]] },
  { group: 'Knowledge', items: [['memory', 'Memory', memory]] },
  { group: 'Automation', items: [['automation', 'Automation', automation], ['approvals', 'Approvals', approvals]] },
  { group: 'System', items: [['devices', 'Devices', devices], ['runtime', 'Device Runtime', runtime], ['activity', 'Activity', activity], ['settings', 'Settings', settings]] },
];

function buildSidebar() {
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV.map((g) => `
    <div class="group-label">${g.group}</div>
    ${g.items.map(([route, label]) => `<a href="#${route}" data-route="${route}"><span class="label">${label}</span></a>`).join('')}
  `).join('');
}

function wireConnectivity() {
  const banner = document.getElementById('offline-banner');
  const indicator = document.getElementById('conn-indicator');

  function paint() {
    const online = navigator.onLine;
    banner.classList.toggle('show', !online);
    const q = queueLength();
    const live = wsIsConnected();
    const liveTag = online ? (live ? 'live' : 'polling') : '';
    indicator.innerHTML = online
      ? (q ? '<span class="dot warn"></span> online \u00b7 ' + liveTag + ' \u00b7 ' + q + ' queued' : '<span class="dot ' + (live ? 'ok' : 'warn') + '"></span> online \u00b7 ' + liveTag)
      : '<span class="dot err"></span> offline' + (q ? ' \u00b7 ' + q + ' queued' : '');
  }

  window.addEventListener('online', () => { paint(); wsConnect(); });
  window.addEventListener('offline', paint);
  wsEvents.addEventListener('open', paint);
  wsEvents.addEventListener('close', paint);
  events.addEventListener('queued', () => { paint(); toast('Offline — request queued', 'warn'); });
  events.addEventListener('queue-flushed', (e) => { paint(); if (e.detail.remaining === 0) toast('Back online — queue synced', 'ok'); });
  paint();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline shell is best-effort */ });
  }
}

for (const g of NAV) for (const [route, , mod] of g.items) registerRoute(route, mod);

buildSidebar();
wireConnectivity();
registerServiceWorker();
wsConnect();
startRouter();
