import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function bootServer(port) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-webhook-security-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      MEMORY_DATA_DIR: dataDir,
      STORAGE_MODE: 'json',
      AUTH_API_KEYS: '',
      TWILIO_PUBLIC_BASE_URL: '',
      WEBHOOK_RATE_LIMIT_PER_MIN: '1',
    },
    stdio: 'ignore',
  });

  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/status`);
      if ([200, 401].includes(res.status)) break;
    } catch {}
    if (child.exitCode !== null) throw new Error(`XOFT exited before listening (code ${child.exitCode})`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return {
    async stop() {
      child.kill();
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', resolve);
        setTimeout(resolve, 1500).unref();
      });
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

test('public Twilio status webhook fails closed and is rate limited', async () => {
  const port = 3117;
  const server = await bootServer(port);
  try {
    const url = `http://127.0.0.1:${port}/webhooks/twilio/status`;
    const first = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ CallSid: 'CA-untrusted', CallStatus: 'completed' }),
    });
    assert.equal(first.status, 403, 'unsigned callback must not be accepted when canonical URL is missing');
    assert.ok(first.headers.get('x-request-id'), 'webhook response should include request ID');
    assert.ok(first.headers.get('x-content-type-options'), 'Helmet headers should apply to webhook routes');

    const second = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ CallSid: 'CA-untrusted-2', CallStatus: 'completed' }),
    });
    assert.equal(second.status, 429, 'webhook limiter should reject a second request over the configured limit');
  } finally {
    await server.stop();
  }
});
