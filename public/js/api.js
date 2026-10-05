// api.js — single place the rest of the app talks to the XOFT backend through.
//
// Offline behavior (this is the "still use it offline" part):
//  - GET requests: on success, the response is cached (localStorage). If the
//    network is down or the request fails, the last cached response is
//    returned instead, tagged {__stale: true} so views can show "offline —
//    showing cached data" instead of silently pretending it's live.
//  - Mutating requests (POST/PUT/PATCH/DELETE): if offline, the request is
//    queued (localStorage) instead of thrown away, and replayed in order the
//    moment the browser fires an 'online' event (see flushQueue()).

const CACHE_PREFIX = 'xoft_cache_';
const QUEUE_KEY = 'xoft_offline_queue';

function cacheKey(url) { return CACHE_PREFIX + url; }

function getCached(url) {
  try {
    const raw = localStorage.getItem(cacheKey(url));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setCached(url, data) {
  try { localStorage.setItem(cacheKey(url), JSON.stringify(data)); } catch { /* storage full — ignore, caching is best-effort */ }
}

function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}
function setQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

export function queueLength() { return getQueue().length; }

export const events = new EventTarget();

function apiKey() { return localStorage.getItem('xoft_api_key') || ''; }

// One prompt at a time: when several requests hit a 401 together (the Command
// Center loads ~9 endpoints at once) they share a single prompt instead of
// asking the user once per request, and a request whose 401 predates a key
// another request already obtained simply retries with that key.
let keyPrompt = null;
function obtainKey(staleKey) {
  const current = apiKey();
  if (current && current !== staleKey) return Promise.resolve(current);
  if (!keyPrompt) {
    keyPrompt = Promise.resolve()
      .then(() => {
        const entered = window.prompt('XOFT requires an API key (AUTH_API_KEYS is set on the server). Enter it:');
        if (!entered) throw new Error('No API key provided.');
        localStorage.setItem('xoft_api_key', entered.trim());
        return entered.trim();
      })
      .finally(() => { keyPrompt = null; });
  }
  return keyPrompt;
}

async function rawFetch(url, opts) {
  const headers = { ...(opts.headers || {}) };
  const key = apiKey();
  if (key) headers['X-API-Key'] = key;
  let res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    const entered = await obtainKey(key);
    res = await fetch(url, { ...opts, headers: { ...headers, 'X-API-Key': entered } });
    if (res.status === 401) {
      localStorage.removeItem('xoft_api_key');
      throw new Error('API key rejected.');
    }
  }
  return res;
}

/** GET with cache-on-success / cache-fallback-on-failure. */
export async function apiGet(path) {
  const url = path;
  if (!navigator.onLine) {
    const cached = getCached(url);
    if (cached) return { ...cached, __stale: true };
    throw new Error('Offline and nothing cached yet for ' + path);
  }
  try {
    const res = await rawFetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const data = await res.json();
    setCached(url, data);
    return data;
  } catch (err) {
    const cached = getCached(url);
    if (cached) return { ...cached, __stale: true };
    throw err;
  }
}

/** Mutating call. Queues itself for later if offline / unreachable. */
export async function apiSend(method, path, body) {
  if (!navigator.onLine) {
    queueRequest(method, path, body);
    events.dispatchEvent(new CustomEvent('queued', { detail: { method, path } }));
    return { __queued: true };
  }
  try {
    const res = await rawFetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch (err) {
    // Network-level failure (server unreachable) vs. a real 4xx/5xx from a
    // reachable server — only the former is safe to silently queue and retry
    // later, otherwise a rejected/invalid request would replay forever.
    if (err instanceof TypeError) {
      queueRequest(method, path, body);
      events.dispatchEvent(new CustomEvent('queued', { detail: { method, path } }));
      return { __queued: true };
    }
    throw err;
  }
}

function queueRequest(method, path, body) {
  const q = getQueue();
  q.push({ method, path, body, ts: Date.now() });
  setQueue(q);
}

export async function flushQueue() {
  const q = getQueue();
  if (!q.length) return;
  const remaining = [];
  for (const item of q) {
    try {
      const res = await rawFetch(item.path, {
        method: item.method,
        headers: item.body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: item.body !== undefined ? JSON.stringify(item.body) : undefined,
      });
      if (!res.ok) remaining.push(item); // keep for retry, don't drop silently
    } catch {
      remaining.push(item);
      break; // still offline / unreachable — stop, try again on next 'online' event
    }
  }
  setQueue(remaining);
  events.dispatchEvent(new CustomEvent('queue-flushed', { detail: { remaining: remaining.length } }));
}

window.addEventListener('online', () => { flushQueue(); events.dispatchEvent(new Event('online')); });
window.addEventListener('offline', () => events.dispatchEvent(new Event('offline')));

export const api = {
  get: apiGet,
  post: (path, body) => apiSend('POST', path, body),
  patch: (path, body) => apiSend('PATCH', path, body),
  put: (path, body) => apiSend('PUT', path, body),
  del: (path) => apiSend('DELETE', path),
};
