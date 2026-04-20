import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteStateDb,
  openStateDb,
  type StateDb,
} from '@velvetmonkey/vault-core';

import {
  getBenchmarkHistory,
  getBenchmarkTrends,
  purgeOldBenchmarks,
  recordBenchmark,
} from '../../../src/core/shared/benchmarks.js';
import { cleanupTempVault, createTempVault } from '../helpers/testUtils.js';

describe('benchmark persistence helpers', () => {
  let vaultPath: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    vaultPath = await createTempVault();
    stateDb = openStateDb(vaultPath);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    stateDb.close();
    deleteStateDb(vaultPath);
    await cleanupTempVault(vaultPath);
  });

  it('records history, computes trends, and purges expired rows', () => {
    const now = Date.UTC(2026, 3, 20, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(now - 40 * 86400000);
    recordBenchmark(stateDb, {
      benchmark: 'search',
      version: '2.12.0',
      mean_ms: 100,
      p50_ms: 95,
      p95_ms: 110,
      iterations: 10,
    });

    nowSpy.mockReturnValue(now - 5 * 86400000);
    recordBenchmark(stateDb, {
      benchmark: 'search',
      version: '2.12.1',
      mean_ms: 110,
      p50_ms: 105,
      p95_ms: 120,
      iterations: 10,
    });

    nowSpy.mockReturnValue(now);
    recordBenchmark(stateDb, {
      benchmark: 'search',
      version: '2.12.2',
      mean_ms: 140,
      p50_ms: 130,
      p95_ms: 150,
      iterations: 10,
    });

    const history = getBenchmarkHistory(stateDb, 'search', 2) as Array<{ version: string }>;
    expect(history.map((row) => row.version)).toEqual(['2.12.2', '2.12.1']);

    const trends = getBenchmarkTrends(stateDb, 'search', 30);
    expect(trends).toMatchObject({
      benchmark: 'search',
      data_points: 2,
      latest: { version: '2.12.2', mean_ms: 140 },
      trend: 'regression',
    });
    expect(trends.delta_pct).toBe(12);

    purgeOldBenchmarks(stateDb, 30);
    const remaining = getBenchmarkHistory(stateDb, 'search', 10) as Array<{ version: string }>;
    expect(remaining.map((row) => row.version)).toEqual(['2.12.2', '2.12.1']);
  });
});
