import { AIProvider } from './AIProvider.js';
import { config } from '../config/index.js';

const BASE_URL = 'https://api.openai.com/v1';

export class OpenAIProvider extends AIProvider {
  name = 'openai';
  capabilities = ['fast', 'cheap', 'coding', 'general', 'embeddings'];

  constructor({ fast = false } = {}) {
    super();
    this.model = fast ? config.providers.openai.fastModel : config.providers.openai.chatModel;
  }

  isConfigured() {
    return Boolean(config.providers.openai.apiKey);
  }

  async complete({ messages, system, tools, maxTokens = 1024 }) {
    if (!this.isConfigured()) {
      throw new Error('OpenAIProvider: OPENAI_API_KEY is not set');
    }

    const body = {
      model: this.model,
      max_tokens: maxTokens,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    };

    if (tools?.length) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.providers.openai.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAIProvider: API error ${res.status} - ${errText}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const toolCalls = choice?.message?.tool_calls?.map((tc) => ({
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments || '{}'),
    }));

    return {
      text: choice?.message?.content ?? '',
      toolCalls,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      raw: 'openai',
    };
  }

  /**
   * Native server-sent-event streaming for low-latency conversational replies.
   * Tool-enabled requests use complete() until incremental tool-call assembly is covered.
   * Yields the provider-neutral events consumed by ProviderRouter.stream().
   */
  async *stream(params = {}) {
    if (params.tools?.length) {
      const result = await this.complete(params);
      if (result.text) yield { type: 'text', delta: result.text };
      yield { type: 'done', result };
      return;
    }
    if (!this.isConfigured()) {
      throw new Error('OpenAIProvider: OPENAI_API_KEY is not set');
    }

    const { messages, system, maxTokens = 1024, signal } = params;
    const body = {
      model: this.model,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    };
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.providers.openai.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAIProvider: API error ${res.status} - ${errText}`);
    }
    if (!res.body) throw new Error('OpenAIProvider: streaming response has no body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let usage = { inputTokens: 0, outputTokens: 0 };
    let finished = false;

    const processEvent = (raw) => {
      const data = raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') return;
      let payload;
      try { payload = JSON.parse(data); } catch { return; }
      const delta = payload.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length) {
        text += delta;
        return { type: 'text', delta };
      }
      if (payload.usage) {
        usage = {
          inputTokens: payload.usage.prompt_tokens ?? 0,
          outputTokens: payload.usage.completion_tokens ?? 0,
        };
      }
      if (payload.choices?.[0]?.finish_reason) finished = true;
      return null;
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const event of events) {
          const out = processEvent(event);
          if (out) yield out;
        }
        if (done) break;
      }
      if (buffer.trim()) {
        const out = processEvent(buffer);
        if (out) yield out;
      }
      if (!finished && !text) throw new Error('OpenAIProvider: stream ended without response text');
      yield { type: 'done', result: { text, usage, raw: 'openai' } };
    } finally {
      reader.releaseLock();
    }
  }

  async embed(input) {
    if (!this.isConfigured()) {
      throw new Error('OpenAIProvider: OPENAI_API_KEY is not set');
    }
    const res = await fetch(`${BASE_URL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.providers.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.providers.openai.embeddingModel,
        input,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAIProvider: embeddings error ${res.status} - ${errText}`);
    }

    const data = await res.json();
    const vectors = data.data.map((d) => d.embedding);
    return Array.isArray(input) ? vectors : vectors[0];
  }
}
