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

```js
// api.js — single place the rest of the app talks to the XOFT backend.
//
// Features:
// - GET responses are cached locally and used as stale data when offline.
// - Mutating requests are queued when genuinely offline or unreachable.
// - Queued requests are replayed when the browser comes back online.
// - API-key authentication is handled centrally.
// - Blitz's explicit app-wakeup 503 response is retried once.
// - Ordinary HTTP errors are not silently queued by apiSend().

const CACHE_PREFIX = 'xoft_cache_';
const QUEUE_KEY = 'xoft_offline_queue';

function cacheKey(url) {
  return CACHE_PREFIX + url;
}

function getCached(url) {
  try {
    const raw = localStorage.getItem(cacheKey(url));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCached(url, data) {
  try {
    localStorage.setItem(cacheKey(url), JSON.stringify(data));
  } catch {
    // Storage full or unavailable. Caching is best-effort.
  }
}

function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function setQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // If storage is unavailable, queued requests cannot be persisted.
  }
}

export function queueLength() {
  return getQueue().length;
}

export const events = new EventTarget();

function apiKey() {
  try {
    return localStorage.getItem('xoft_api_key') || '';
  } catch {
    return '';
  }
}

// Prevent multiple simultaneous API-key prompts.
let keyPrompt = null;

function obtainKey(staleKey) {
  const current = apiKey();

  if (current && current !== staleKey) {
    return Promise.resolve(current);
  }

  if (!keyPrompt) {
    keyPrompt = Promise.resolve()
      .then(() => {
        const entered = window.prompt(
          'XOFT requires an API key. Enter your API key:'
        );

        if (!entered || !entered.trim()) {
          throw new Error('No API key provided.');
        }

        const trimmed = entered.trim();

        localStorage.setItem('xoft_api_key', trimmed);

        return trimmed;
      })
      .finally(() => {
        keyPrompt = null;
      });
  }

  return keyPrompt;
}

async function rawFetch(url, opts) {
  const headers = { ...(opts.headers || {}) };
  const key = apiKey();

  if (key) {
    headers['X-API-Key'] = key;
  }

  let res = await fetch(url, {
    ...opts,
    headers,
  });

  if (res.status === 401) {
    const entered = await obtainKey(key);

    res = await fetch(url, {
      ...opts,
      headers: {
        ...headers,
        'X-API-Key': entered,
      },
    });

    if (res.status === 401) {
      localStorage.removeItem('xoft_api_key');
      throw new Error('API key rejected.');
    }
  }

  return res;
}

/**
 * GET requests:
 * - Cache successful responses.
 * - Return cached responses when offline or a request fails.
 * - Mark cached fallback data with __stale: true.
 */
export async function apiGet(path) {
  const url = path;

  if (!navigator.onLine) {
    const cached = getCached(url);

    if (cached) {
      return { ...cached, __stale: true };
    }

    throw new Error('Offline and nothing cached yet for ' + path);
  }

  try {
    const res = await rawFetch(url, {
      method: 'GET',
    });

    if (!res.ok) {
      throw new Error(`${res.status} ${await res.text()}`);
    }

    const data = await res.json();

    setCached(url, data);

    return data;
  } catch (err) {
    const cached = getCached(url);

    if (cached) {
      return { ...cached, __stale: true };
    }

    throw err;
  }
}

/**
 * Retry only the specific 503 response returned by Blitz when
 * the app has just awakened. Other HTTP errors are not retried.
 */
async function retryBlitzWakeup(path, opts) {
  let res = await rawFetch(path, opts);

  if (res.status !== 503) {
    return res;
  }

  let wake = null;

  try {
    wake = await res.clone().json();
  } catch {
    // Not a JSON wake-up response.
  }

  const isBlitzWakeup =
    wake?.status === 'ready' &&
    wake?.message === 'The app is awake now. Try again.';

  if (!isBlitzWakeup) {
    return res;
  }

  // Give the host a moment to finish waking up.
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Retry exactly once. Do not loop indefinitely.
  return rawFetch(path, opts);
}

/**
 * Mutating requests:
 * - Queue immediately when the browser is offline.
 * - Retry Blitz's explicit wake-up response once.
 * - Queue only network-level TypeErrors.
 * - Throw ordinary HTTP errors to the caller.
 */
export async function apiSend(method, path, body) {
  if (!navigator.onLine) {
    queueRequest(method, path, body);

    events.dispatchEvent(
      new CustomEvent('queued', {
        detail: { method, path },
      })
    );

    return { __queued: true };
  }

  const opts = {
    method,
    headers:
      body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  try {
    const res = await retryBlitzWakeup(path, opts);

    if (!res.ok) {
      throw new Error(`${res.status} ${await res.text()}`);
    }

    const text = await res.text();

    return text ? JSON.parse(text) : {};
  } catch (err) {
    // TypeError normally indicates a network-level fetch failure.
    // Do not queue HTTP errors such as 401, 403, 429 or 503.
    if (err instanceof TypeError) {
      queueRequest(method, path, body);

      events.dispatchEvent(
        new CustomEvent('queued', {
          detail: { method, path },
        })
      );

      return { __queued: true };
    }

    throw err;
  }
}

function queueRequest(method, path, body) {
  const queue = getQueue();

  queue.push({
    method,
    path,
    body,
    ts: Date.now(),
  });

  setQueue(queue);
}

/**
 * Replay queued requests in order.
 * Failed requests remain queued for a later attempt.
 */
export async function flushQueue() {
  const queue = getQueue();

  if (!queue.length) {
    return;
  }

  const remaining = [];

  for (const item of queue) {
    try {
      const opts = {
        method: item.method,
        headers:
          item.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {},
        body:
          item.body !== undefined
            ? JSON.stringify(item.body)
            : undefined,
      };

      const res = await retryBlitzWakeup(item.path, opts);

      if (!res.ok) {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);

      // Stop if the connection or authentication fails.
      break;
    }
  }

  setQueue(remaining);

  events.dispatchEvent(
    new CustomEvent('queue-flushed', {
      detail: { remaining: remaining.length },
    })
  );
}

window.addEventListener('online', () => {
  flushQueue();

  events.dispatchEvent(new Event('online'));
});

window.addEventListener('offline', () => {
  events.dispatchEvent(new Event('offline'));
});

export const api = {
  get: apiGet,
  post: (path, body) => apiSend('POST', path, body),
  patch: (path, body) => apiSend('PATCH', path, body),
  put: (path, body) => apiSend('PUT', path, body),
  del: path => apiSend('DELETE', path),
};
```
