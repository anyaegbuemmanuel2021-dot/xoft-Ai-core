import { OpenAICompatibleGateway } from './OpenAICompatibleGateway.js';

/**
 * OpenRouter — hosted OpenAI-compatible API for many models, including free model variants.
 * The default model alias "openrouter/free" asks OpenRouter to select an available free model.
 * Free availability, rate limits, tool support, and latency depend on the upstream model/provider;
 * XOFT's ProviderRouter handles request failures and attempts the next configured provider.
 *
 * Optional and disabled by default. Requires an OpenRouter API key and never falls back to paid
 * models intentionally when using the openrouter/free alias.
 */
export class OpenRouterProvider extends OpenAICompatibleGateway {
  constructor(opts = {}) {
    super({ id: 'openrouter', ...opts });
    this.capabilities = ['gateway', 'free-models', 'multi-model', 'fallback', 'general', 'coding', 'reasoning', 'tools'];
  }
}
