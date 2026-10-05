import { AIProvider } from './AIProvider.js';
import { config } from '../config/index.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiProvider extends AIProvider {
  name = 'gemini';
  capabilities = ['fast', 'long-context', 'general'];

  constructor() {
    super();
    this.model = config.providers.gemini.model;
  }

  isConfigured() {
    return Boolean(config.providers.gemini.apiKey);
  }

  async complete({ messages, system, maxTokens = 1024 }) {
    if (!this.isConfigured()) {
      throw new Error('GeminiProvider: GEMINI_API_KEY is not set');
    }

    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const res = await fetch(
      `${BASE_URL}/models/${this.model}:generateContent?key=${config.providers.gemini.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GeminiProvider: API error ${res.status} - ${errText}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';

    return {
      text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      raw: 'gemini',
    };
  }
}
