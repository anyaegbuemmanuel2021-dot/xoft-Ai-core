import { api } from '../api.js';
import { esc, toast, onDelegate } from '../dom.js';
import { canSpeakOut, isSpeakOutEnabled, setSpeakOutEnabled, speakOut, stopSpeaking } from '../voice/speak-out.js';

export const title = 'Chat';

const SESSION_KEY = 'xoft_chat_session';
function sessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(SESSION_KEY, id); }
  return id;
}

let mode = 'chat'; // 'chat' | 'advise'
let activeController = null;
const history = [];

// Navigation away from Chat must cancel the browser request so the server can abort upstream model work.
export function cleanup() {
  activeController?.abort();
}

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
        <button id="chat-stop" type="button" disabled>Stop generating</button>
        <button id="chat-speak-toggle" type="button" aria-pressed="${isSpeakOutEnabled()}" ${canSpeakOut() ? '' : 'disabled'}>${isSpeakOutEnabled() ? 'Speak Out: ON' : 'Speak Out: OFF'}</button>
        <button id="chat-speak-stop" type="button" ${canSpeakOut() ? '' : 'disabled'}>Stop Speaking</button>
      </div>
    </div>
  `;
  renderLog(container);

  onDelegate(container, 'click', '[data-mode]', (el) => {
    if (activeController) return;
    mode = el.dataset.mode;
    render(container);
  });

  onDelegate(container, 'click', '#chat-send', () => send(container));
  onDelegate(container, 'click', '#chat-stop', () => activeController?.abort());
  onDelegate(container, 'click', '#chat-speak-toggle', (button) => {
    const enabled = !isSpeakOutEnabled();
    setSpeakOutEnabled(enabled);
    window.dispatchEvent(new CustomEvent('xoft:speakout-change'));
    button.textContent = enabled ? 'Speak Out: ON' : 'Speak Out: OFF';
    button.setAttribute('aria-pressed', String(enabled));
    toast(enabled ? 'Speak Out enabled — XOFT replies will be read aloud.' : 'Speak Out disabled.', 'info');
  });
  onDelegate(container, 'click', '#chat-speak-stop', () => stopSpeaking());
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
  // Ignore Enter/button events while a request is active; otherwise a second
  // blank assistant entry could be added while the first stream is running.
  if (activeController) return;
  const input = container.querySelector('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  history.push({ role: 'user', content: text });
  const assistantMessage = { role: 'assistant', content: '' };
  history.push(assistantMessage);
  renderLog(container);

  const sendButton = container.querySelector('#chat-send');
  const stopButton = container.querySelector('#chat-stop');
  sendButton.disabled = true;
  try {
    if (mode !== 'chat') {
      history.pop();
      const result = await api.post('/api/advise', { problem: text });
      const reply = result.advice ?? JSON.stringify(result);
      history.push({ role: 'assistant', content: reply });
      speakOut(reply);
      renderLog(container);
      return;
    }
    if (!navigator.onLine) throw new Error('You are offline. XOFT streaming chat cannot be queued safely; reconnect and try again.');

    activeController = new AbortController();
    stopButton.disabled = false;
    const response = await api.streamPost('/api/chat', { message: text, sessionId: sessionId(), stream: true }, { signal: activeController.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = null;
    let serverError = null;
    const handleEvent = (raw) => {
      let eventName = 'message';
      const dataLines = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) return;
      let payload;
      try { payload = JSON.parse(dataLines.join('\n')); } catch { return; }
      if (eventName === 'delta') {
        assistantMessage.content += String(payload.delta ?? '');
        renderLog(container);
      } else if (eventName === 'done') {
        finalResult = payload;
        assistantMessage.content = String(payload.reply ?? assistantMessage.content);
        renderLog(container);
      } else if (eventName === 'error') {
        serverError = String(payload.message ?? payload.error ?? 'XOFT streaming request failed.');
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const event of events) handleEvent(event);
        if (done) break;
      }
      if (buffer.trim()) handleEvent(buffer);
    } finally {
      reader.releaseLock();
    }
    if (serverError) throw new Error(serverError);
    if (!finalResult) throw new Error('XOFT stream ended before a final result was received.');
    speakOut(assistantMessage.content);
  } catch (err) {
    if (activeController?.signal.aborted || err?.name === 'AbortError') {
      if (assistantMessage.content) assistantMessage.content += '\n\n[Generation stopped]';
      else assistantMessage.content = '[Generation stopped]';
      renderLog(container);
      return;
    }
    if (!history.includes(assistantMessage)) history.push(assistantMessage);
    let friendly = null;
    try {
      const body = JSON.parse(String(err.message).replace(/^\d{3}\s+/, ''));
      if (body?.error === 'NO_AI_PROVIDER_AVAILABLE') {
        friendly = 'No AI provider is currently configured or available. Everything else in Xoft still works — add a provider (API key, Ollama, FreeLLMAPI or LiteLLM) in Settings → AI providers to chat.';
      } else if (body?.error === 'AI_PROVIDERS_FAILED') {
        const providerAdvice = (body.attempts ?? []).map((attempt) => {
          const name = ({ openai: 'OpenAI', gemini: 'Gemini', claude: 'Claude', grok: 'Grok', ollama: 'Ollama', experiential: 'Experiential Labs', freellmapi: 'FreeLLMAPI', litellm: 'LiteLLM' })[attempt.provider] ?? attempt.provider;
          if (attempt.errorType === 'rate_limit') return `${name} hit a rate, usage, or quota limit; check its API usage, billing/credits, and rate limits.`;
          if (attempt.errorType === 'auth') return `${name} rejected its credentials; check the API key in deployment settings.`;
          if (attempt.errorType === 'invalid_request') return `${name} rejected the configured model or request; check its model name.`;
          if (['timeout', 'unavailable', 'server_error'].includes(attempt.errorType)) return `${name} is temporarily unavailable; try again shortly.`;
          return `${name} failed; check its API key and model configuration.`;
        });
        friendly = ['XOFT is running, but its configured AI providers could not answer.', ...providerAdvice, 'Fix the provider issue, then retry. Check Settings → AI providers for configuration and connection tests.'].join(' ');
      }
    } catch { /* not a structured AI error */ }
    if (assistantMessage.content) assistantMessage.content += `\n\n[Stream interrupted: ${friendly ?? err.message}]`;
    else assistantMessage.content = friendly ?? `Error: ${err.message}`;
    toast(friendly ? 'AI is unavailable' : err.message, friendly ? 'warn' : 'err');
  } finally {
    activeController = null;
    sendButton.disabled = false;
    stopButton.disabled = true;
  }
  renderLog(container);
}
