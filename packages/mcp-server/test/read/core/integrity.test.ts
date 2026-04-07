import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openStateDb } from '@velvetmonkey/vault-core';
import { runIntegrityWorker } from '../../../src/core/read/integrity.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('integrity worker', () => {
  test('runs quick_check in a worker and creates a backup', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'flywheel-integrity-'));
    tempDirs.push(tempDir);
    mkdirSync(join(tempDir, '.obsidian'));
    writeFileSync(join(tempDir, 'Inbox.md'), '# Inbox\n');

    const stateDb = openStateDb(tempDir);
    const dbPath = stateDb.dbPath;
    stateDb.close();

    const result = await runIntegrityWorker({
      dbPath,
      runBackup: true,
      busyTimeoutMs: 1_000,
    });

    expect(result.status).toBe('healthy');
    expect(result.backupCreated).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(existsSync(`${dbPath}.backup`)).toBe(true);
  });
});
