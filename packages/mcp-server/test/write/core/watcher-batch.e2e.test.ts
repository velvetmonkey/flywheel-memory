/**
 * Watcher batch-handling end-to-end characterisation (arch-review S9,
 * written BEFORE the watcher glue moves out of index.ts).
 *
 * Boots the REAL server over stdio and pins the externally-observable
 * contract of the index.ts handleBatch closure + watcher pipeline: a file
 * created on disk becomes searchable; a rename is tracked (old path gone,
 * new path present). These are the behaviours the S9 extraction must keep.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, renameSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnFlywheelStdio, type StdioServerConnection } from '../../helpers/stdioHarness.js';

let connection: StdioServerConnection;
let tempRoot: string;
let vault: string;

const resultText = (r: any) =>
  (r?.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n');

async function pollUntil(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`pollUntil timed out: ${label}`);
}

describe('watcher batch handling (e2e)', () => {
  beforeAll(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'fw-watch-e2e-'));
    vault = join(tempRoot, 'vault');
    mkdirSync(join(vault, '.obsidian'), { recursive: true });
    writeFileSync(join(vault, 'Inbox.md'), '# Inbox\n\nSeed.\n');
    connection = await spawnFlywheelStdio({ PROJECT_PATH: vault });
    // Files written before the watcher attaches (post-boot) are never evented —
    // wait for watcher readiness so the probes test BATCH handling, not boot.
    await pollUntil(async () => {
      const res = await connection.client.callTool({
        name: 'doctor',
        arguments: { action: 'health' },
      });
      return JSON.parse(resultText(res)).watcher_state === 'ready';
    }, 30000, 'watcher ready');
  }, 90000);

  afterAll(async () => {
    await connection?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('a file written to disk is picked up by the watcher and becomes findable', async () => {
    writeFileSync(
      join(vault, 'watcher-probe.md'),
      '# Watcher Probe\n\nZanzibar mechanism quarterly review.\n',
    );

    await pollUntil(async () => {
      const res = await connection.client.callTool({
        name: 'search',
        arguments: { query: 'Zanzibar', limit: 5 },
      });
      return resultText(res).includes('watcher-probe.md');
    }, 30000, 'new file indexed by watcher');
  }, 45000);

  it('a rename is tracked: old path disappears, new path appears', async () => {
    renameSync(join(vault, 'watcher-probe.md'), join(vault, 'renamed-probe.md'));

    await pollUntil(async () => {
      const res = await connection.client.callTool({
        name: 'read',
        arguments: { action: 'structure', path: 'renamed-probe.md' },
      });
      return resultText(res).includes('Watcher Probe');
    }, 30000, 'renamed file indexed');

    // Old path no longer resolves once the rename batch lands
    await pollUntil(async () => {
      const res = await connection.client.callTool({
        name: 'search',
        arguments: { query: 'Zanzibar', limit: 5 },
      });
      const text = resultText(res);
      return text.includes('renamed-probe.md') && !text.includes('watcher-probe.md');
    }, 30000, 'old path evicted from search');
  }, 45000);
});
