import { api } from '../api.js';
import { esc, toast, onDelegate } from '../dom.js';

export const title = 'Chat';

const SESSION_KEY = 'xoft_chat_session';
function sessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(SESSION_KEY, id); }
  return id;
}

let mode = 'chat'; // 'chat' | 'advise'
const history = [];

export function render(container) {
  container.innerHTML = `
    <div class="tabs">
      <button data-mode="chat" class="${mode === 'chat' ? 'active' : ''}">Chat</button>
      <button data-mode="advise" class="${mode === 'advise' ? 'active' : ''}">Advisor</button>
    </div>
    <div id="chat-view">
      <div id="chat-log"></div>
      <div id="chat-input-row">
        <textarea id="chat-input" placeholder="${mode === 'chat' ? 'Ask XOFT to do something…' : 'Describe a problem to reason through…'}"></textarea>
        <button id="chat-send" class="primary">Send</button>
      </div>
    </div>
  `;
  renderLog(container);

  onDelegate(container, 'click', '[data-mode]', (el) => {
    mode = el.dataset.mode;
    render(container);
  });

  onDelegate(container, 'click', '#chat-send', () => send(container));
  container.querySelector('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(container); }
  });
}

function renderLog(container) {
  const log = container.querySelector('#chat-log');
  log.innerHTML = history.map((m) => `
    <div class="msg ${m.role}">
      <div class="meta">${m.role === 'user' ? 'You' : 'XOFT'}</div>
      ${esc(m.content)}
    </div>
  `).join('') || '<div class="empty">Say something to get started.</div>';
  log.scrollTop = log.scrollHeight;
}

async function send(container) {
  const input = container.querySelector('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  history.push({ role: 'user', content: text });
  renderLog(container);

  try {
    const endpoint = mode === 'chat' ? '/api/chat' : '/api/advise';
    const body = mode === 'chat' ? { message: text, sessionId: sessionId() } : { problem: text };
    const result = await api.post(endpoint, body);
    if (result.__queued) {
      history.push({ role: 'assistant', content: '(offline — this message is queued and will send once back online)' });
    } else {
      history.push({ role: 'assistant', content: result.reply ?? result.advice ?? JSON.stringify(result) });
    }
  } catch (err) {
    // The server answers AI outages with a structured body ({success:false,error:'NO_AI_PROVIDER_AVAILABLE'|'AI_PROVIDERS_FAILED',...});
    // api.js wraps it as "<status> <json>". Show a calm explanation instead of raw JSON — the rest of Xoft is unaffected.
    let friendly = null;
    try {
      const body = JSON.parse(String(err.message).replace(/^\d{3}\s+/, ''));
      if (body?.error === 'NO_AI_PROVIDER_AVAILABLE') friendly = 'No AI provider is currently configured or available. Everything else in Xoft still works — add a provider (API key, Ollama, FreeLLMAPI or LiteLLM) in Settings → AI providers to chat.';
      else if (body?.error === 'AI_PROVIDERS_FAILED') friendly = 'Every configured AI provider failed to answer just now. Check Settings → AI providers (connection test) and try again.';
    } catch { /* not a structured AI error */ }
    history.push({ role: 'assistant', content: friendly ?? `Error: ${err.message}` });
    toast(friendly ? 'AI is unavailable' : err.message, friendly ? 'warn' : 'err');
  }
  renderLog(container);
}
