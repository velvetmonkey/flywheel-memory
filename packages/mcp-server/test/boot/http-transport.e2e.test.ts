/**
 * HTTP transport e2e (arch-review S10).
 *
 * Spawns the REAL dist bundle (the same artifact production runs, rebuilt if
 * stale via npm run build — same approach as test/helpers/stdioHarness.ts)
 * with FLYWHEEL_TRANSPORT=http on a free port, then verifies:
 *
 *   1. POST /mcp initialize handshake succeeds (SDK StreamableHTTP client);
 *   2. tools/list returns the 13-tool agent-preset surface (compared against
 *      the committed initialize-freeze fixture so the two stay in lockstep);
 *   3. GET /health returns 200 with its JSON shape — field NAMES only are
 *      pinned, never values.
 *
 * Timeouts are generous: the child boots a full vault index before /health
 * flips ready, and the dist build itself can take a while on cold caches.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer } from 'net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PACKAGE_DIR = join(__dirname, '../..');
const FIXTURE_PATH = join(PACKAGE_DIR, 'test/catalog/__fixtures__/initialize.single.json');

let child: ChildProcess | null = null;
let client: Client | null = null;
let transport: StreamableHTTPClientTransport | null = null;
let tempRoot: string | null = null;
let port = 0;
const childStderr: string[] = [];

function ensureFreshDist(): void {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: PACKAGE_DIR,
    stdio: 'pipe',
    timeout: 180_000,
    // Node >=18.20/20.12/22 refuses to execFile a .cmd/.bat without a shell
    // (CVE-2024-27980), throwing EINVAL on Windows. The build command is static.
    shell: process.platform === 'win32',
  });
}

function makeVault(root: string, name: string): string {
  const vaultDir = join(root, name);
  mkdirSync(join(vaultDir, '.obsidian'), { recursive: true });
  writeFileSync(join(vaultDir, 'Inbox.md'), `# Inbox\n\n${name} http e2e fixture note.\n`);
  return vaultDir;
}

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address && typeof address === 'object') {
        const freePort = address.port;
        srv.close(() => resolve(freePort));
      } else {
        srv.close(() => reject(new Error('no port assigned')));
      }
    });
  });
}

async function waitForHealth(healthPort: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(
        `server exited early (code ${child.exitCode}). stderr:\n${childStderr.join('')}`,
      );
    }
    try {
      const res = await fetch(`http://127.0.0.1:${healthPort}/health`);
      if (res.status === 200) return;
      lastErr = new Error(`health status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `server never became healthy within ${timeoutMs}ms: ${lastErr}\nstderr:\n${childStderr.join('')}`,
  );
}

describe('HTTP transport e2e (arch-review S10)', () => {
  beforeAll(async () => {
    ensureFreshDist();

    tempRoot = mkdtempSync(join(tmpdir(), 'fw-http-e2e-'));
    const vault = makeVault(tempRoot, 'solo');
    port = await getFreePort();

    // Explicit minimal env, mirroring test/helpers/stdioHarness.ts: no
    // CLAUDECODE leak (memory tool stays visible), embeddings build disabled.
    child = spawn(process.execPath, [join(PACKAGE_DIR, 'dist', 'index.js')], {
      cwd: PACKAGE_DIR,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        FLYWHEEL_SKIP_EMBEDDINGS: 'true',
        FLYWHEEL_TRANSPORT: 'http',
        FLYWHEEL_HTTP_PORT: String(port),
        PROJECT_PATH: vault,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      childStderr.push(chunk.toString());
    });

    await waitForHealth(port, 90_000);
  }, 180_000);

  afterAll(async () => {
    try { await client?.close(); } catch { /* best-effort */ }
    try { await transport?.close(); } catch { /* best-effort */ }
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => {
        child!.once('exit', () => resolve());
        setTimeout(() => { try { child!.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 5_000).unref();
      });
      child.kill('SIGTERM');
      await exited;
    }
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  }, 30_000);

  it('POST /mcp initialize handshake succeeds', async () => {
    transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    client = new Client(
      { name: 's10-http-e2e-harness', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport); // performs initialize + initialized notification

    expect(client.getServerVersion()?.name).toBe('flywheel-memory');
    expect(client.getServerCapabilities()).toBeDefined();
    expect(client.getInstructions()).toBeTruthy();
  }, 60_000);

  it('tools/list returns the 13-tool agent-preset surface', async () => {
    expect(client, 'initialize test must run first').not.toBeNull();
    const tools = await client!.listTools();
    const names = tools.tools.map((t) => t.name).sort();

    expect(names).toHaveLength(13);
    // Same surface the initialize-freeze snapshot pins for the stdio boot.
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as { tools: string[] };
    expect(names).toEqual(fixture.tools);
  }, 60_000);

  it('GET /health returns 200 with the pinned field names', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');

    const health = (await res.json()) as Record<string, unknown>;
    // Field NAMES only — values are runtime-dependent. Single-vault boot, so
    // the multi-vault-only 'vaults' key must be absent.
    expect(Object.keys(health).sort()).toEqual([
      'capabilities',
      'http',
      'memory',
      'ready',
      'status',
      'uptime_s',
      'vault',
      'version',
    ]);
    expect(Object.keys(health.memory as Record<string, unknown>).sort()).toEqual([
      'external_mb',
      'heap_total_mb',
      'heap_used_mb',
      'rss_mb',
    ]);
    expect(Object.keys(health.http as Record<string, unknown>).sort()).toEqual([
      'pool_available',
      'pool_max',
      'requests',
      'servers_created',
      'servers_discarded',
      'servers_reused',
    ]);
  }, 60_000);
});
