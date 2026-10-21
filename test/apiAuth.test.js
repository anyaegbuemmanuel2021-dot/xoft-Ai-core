import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Spawns the real src/index.js as a child process on a scratch data dir/port, waits until it answers, and returns a cleanup fn. */
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  return port;
}

async function bootServer(env, port = null) {
  port = port ?? await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xoft-auth-test-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), MEMORY_DATA_DIR: dataDir, ...env, STORAGE_MODE: env.STORAGE_MODE ?? 'json' },
    stdio: 'pipe',
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/status`, { headers: env.AUTH_API_KEYS ? { 'X-API-Key': env.AUTH_API_KEYS.split(',')[0] } : {} });
      if (res.status === 200 || res.status === 401) break; // either means the server is actually up
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200));
    if (child.exitCode !== null) throw new Error(`Server exited early (code ${child.exitCode}): ${stderr}`);
  }

  return {
    port,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill();
        await new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once('exit', resolve);
          const fallback = setTimeout(resolve, 2000);
          fallback.unref?.();
        });
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

describe('API authentication (real server, integration)', { concurrency: false }, () => {
  test('with no AUTH_API_KEYS set, the API stays open (backward compatible)', async () => {
    const server = await bootServer({});
    try {
      const res = await fetch(`http://localhost:${server.port}/api/status`);
      assert.equal(res.status, 200);
    } finally {
      await server.stop();
    }
  });

  test('with AUTH_API_KEYS set, requests without a key are rejected', async () => {
    const server = await bootServer({ AUTH_API_KEYS: 'secretA,secretB' });
    try {
      const res = await fetch(`http://localhost:${server.port}/api/status`);
      assert.equal(res.status, 401);
    } finally {
      await server.stop();
    }
  });

  test('with AUTH_API_KEYS set, a wrong key is rejected and either configured key is accepted', async () => {
    const server = await bootServer({ AUTH_API_KEYS: 'secretA,secretB' });
    try {
      const wrong = await fetch(`http://localhost:${server.port}/api/status`, { headers: { 'X-API-Key': 'nope' } });
      assert.equal(wrong.status, 401);

      const first = await fetch(`http://localhost:${server.port}/api/status`, { headers: { 'X-API-Key': 'secretA' } });
      assert.equal(first.status, 200);

      const second = await fetch(`http://localhost:${server.port}/api/status`, { headers: { Authorization: 'Bearer secretB' } });
      assert.equal(second.status, 200);
    } finally {
      await server.stop();
    }
  });

  test('device pairing routes are covered by auth too, not just /api/status', async () => {
    const server = await bootServer({ AUTH_API_KEYS: 'secretA' });
    try {
      const res = await fetch(`http://localhost:${server.port}/api/devices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', platform: 'desktop' }) });
      assert.equal(res.status, 401);

      const authed = await fetch(`http://localhost:${server.port}/api/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'secretA' },
        body: JSON.stringify({ name: 'x', platform: 'desktop' }),
      });
      assert.equal(authed.status, 200);
    } finally {
      await server.stop();
    }
  });
});
