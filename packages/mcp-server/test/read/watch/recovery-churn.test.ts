import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

import { createVaultWatcher } from '../../../src/core/read/watch/index.js';
import { cleanupTempVault, createTempVault } from '../../helpers/testUtils.js';

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number = 4000,
  intervalMs: number = 25,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

describe('watcher recovery churn', () => {
  let vaultPath: string;

  function createTestWatcher(processed: string[][], state: { failNextBatch: boolean }) {
    return createVaultWatcher({
      vaultPath,
      config: {
        usePolling: true,
        pollInterval: 50,
        debounceMs: 40,
        flushMs: 80,
        batchSize: 8,
      },
      onBatch: async (batch) => {
        processed.push(batch.events.map((event) => event.path));
        if (state.failNextBatch) {
          state.failNextBatch = false;
          throw new Error('simulated watcher failure');
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
      },
    });
  }

  beforeEach(async () => {
    vaultPath = await createTempVault();
    await fs.writeFile(path.join(vaultPath, 'note.md'), '# Note\n\ninitial\n');
  });

  afterEach(async () => {
    await cleanupTempVault(vaultPath);
  });

  it('drains pending work across repeated restart and recovery cycles', async () => {
    const processed: string[][] = [];
    const state = { failNextBatch: true };

    const watcher = createTestWatcher(processed, state);

    watcher.start();
    await waitFor(() => watcher.status.state === 'ready');

    await fs.writeFile(path.join(vaultPath, 'note.md'), '# Note\n\nfirst change\n');
    await waitFor(() => watcher.status.state === 'error');
    expect(processed.length).toBe(1);

    await fs.writeFile(path.join(vaultPath, 'note.md'), '# Note\n\nsecond change\n');
    await fs.writeFile(path.join(vaultPath, 'note.md'), '# Note\n\nthird change\n');
    await waitFor(() => watcher.status.state === 'ready' && processed.length >= 2);
    await waitFor(() => watcher.pendingCount === 0);

    watcher.stop();
    expect(watcher.pendingCount).toBe(0);

    const restartedWatcher = createTestWatcher(processed, state);
    restartedWatcher.start();
    await waitFor(() => restartedWatcher.status.state === 'ready');
    await fs.writeFile(path.join(vaultPath, 'note.md'), '# Note\n\nfourth change\n');
    await waitFor(() => restartedWatcher.pendingCount > 0);
    restartedWatcher.flush();
    await waitFor(() => processed.length >= 3);
    await waitFor(() => restartedWatcher.pendingCount === 0);

    restartedWatcher.stop();
    expect(restartedWatcher.pendingCount).toBe(0);
    expect(processed.some((paths) => paths.some((entry) => entry.endsWith('/note.md') || entry === 'note.md'))).toBe(true);
  }, 10000);
});
