import { config } from '../../config/index.js';
import puppeteer from 'puppeteer-core';
import { SmartVerificationHandler } from './SmartVerificationHandler.js';

const BRAVE_BASE_URL = 'https://api.search.brave.com/res/v1/web/search';

function lightpandaEndpoint() {
  if (config.browser.token) {
    const region = config.browser.cloudRegion === 'uswest' ? 'uswest' : 'euwest';
    return `wss://${region}.cloud.lightpanda.io/ws?token=${encodeURIComponent(config.browser.token)}&browser=lightpanda`;
  }
  const raw = String(config.browser.cdpUrl || 'ws://127.0.0.1:9222').trim();
  if (raw.startsWith('ws://') || raw.startsWith('wss://')) return raw;
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const u = new URL(raw);
    return `ws${u.protocol === 'https:' ? 's' : ''}://${u.host}`;
  }
  throw new Error('Lightpanda: LIGHTPANDA_CDP_URL must be a ws://, wss://, http:// or https:// URL.');
}

/**
 * XOFT web research. Lightpanda is the default browser for page retrieval and,
 * when Brave credentials are absent, search via DuckDuckGo's HTML results page.
 * A configured Brave API remains an optional structured-search provider.
 */
export class SearchService {
  constructor() {
    this.verification = new SmartVerificationHandler({ waitMs: config.browser.verificationWaitMs });
  }

  async navigateAndVerify(page, url, options = { waitUntil: 'domcontentloaded' }) {
    await page.goto(url, options);
    await this.verification.waitForNormalCheck(page);
  }

  isConfigured() {
    return Boolean(config.search.braveApiKey) || config.browser.provider === 'lightpanda';
  }

  async withBrowser(work) {
    if (config.browser.provider !== 'lightpanda') {
      throw new Error(`Unsupported BROWSER_PROVIDER "${config.browser.provider}". Currently supported: lightpanda.`);
    }
    let browser;
    try {
      browser = await puppeteer.connect({
        browserWSEndpoint: lightpandaEndpoint(),
        timeout: config.browser.timeoutMs,
      });
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(config.browser.timeoutMs);
      try {
        return await work(page);
      } finally {
        await page.close().catch(() => {});
      }
    } catch (err) {
      if (err?.code === 'XOFT_VERIFICATION_REQUIRED') throw err;
      const hint = config.browser.token
        ? 'Check LPD_TOKEN, LIGHTPANDA_CLOUD_REGION, and your Lightpanda cloud access.'
        : 'Start Lightpanda CDP on LIGHTPANDA_CDP_URL or set LPD_TOKEN for Lightpanda Cloud.';
      throw new Error(`Lightpanda browser unavailable: ${err.message}. ${hint}`);
    } finally {
      if (browser) await browser.disconnect().catch(() => {});
    }
  }

  /** @param {string} query @param {number} count */
  async search(query, count = 5) {
    if (config.search.braveApiKey) {
      const res = await fetch(`${BRAVE_BASE_URL}?q=${encodeURIComponent(query)}&count=${Math.min(10, Math.max(1, count))}`, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': config.search.braveApiKey },
        signal: AbortSignal.timeout(config.browser.timeoutMs),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`SearchService: Brave API error ${res.status} - ${errText.slice(0, 500)}`);
      }
      const data = await res.json();
      return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, description: r.description }));
    }

    return this.withBrowser(async (page) => {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      await this.navigateAndVerify(page, url, { waitUntil: 'domcontentloaded' });
      return page.evaluate((limit) => Array.from(document.querySelectorAll('.result'))
        .map((node) => {
          const link = node.querySelector('.result__a');
          const snippet = node.querySelector('.result__snippet');
          return {
            title: (link?.innerText || '').trim(),
            url: link?.href || '',
            description: (snippet?.innerText || '').trim(),
          };
        })
        .filter((r) => r.title && /^https?:/.test(r.url))
        .slice(0, limit), Math.min(10, Math.max(1, Number(count) || 5)));
    });
  }

  /** Reads rendered page text through Lightpanda, falling back to basic HTTP fetch if the browser is unavailable. */
  async fetchPage(url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('SearchService: url must be a valid absolute URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('SearchService: only http/https URLs are allowed.');

    try {
      const text = await this.withBrowser(async (page) => {
        await this.navigateAndVerify(page, parsed.href, { waitUntil: 'domcontentloaded' });
        return page.evaluate(() => (document.body?.innerText || document.documentElement?.innerText || '').replace(/\s+/g, ' ').trim());
      });
      return text.slice(0, 12000);
    } catch (browserError) {
      if (browserError?.code === 'XOFT_VERIFICATION_REQUIRED') throw browserError;
      try {
        const res = await fetch(parsed.href, {
          headers: { 'User-Agent': 'XOFT-WebFetcher/1.0' },
          signal: AbortSignal.timeout(config.browser.timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        return html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/\s+/g, ' ')
          .trim().slice(0, 12000);
      } catch (fallbackError) {
        throw new Error(`SearchService: Lightpanda and HTTP page retrieval both failed. Browser: ${browserError.message}. Fetch: ${fallbackError.message}`);
      }
    }
  }
}
