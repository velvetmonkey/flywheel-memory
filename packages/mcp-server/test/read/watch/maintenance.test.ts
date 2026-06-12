/**
 * Maintenance timer characterisation (arch-review S9, written BEFORE the
 * pipeline relocation). Pins the timer lifecycle and the idle-skip guard —
 * maintenance.ts previously had zero direct tests (G1 §8: sole importer was
 * untested index.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startMaintenanceTimer,
  stopMaintenanceTimer,
  type MaintenanceConfig,
} from '../../../src/core/write/pipeline/maintenance.js';
import { createEmptyPipelineActivity } from '../../../src/core/write/pipeline/activity.js';
import type { VaultContext } from '../../../src/vault-types.js';
import type { VaultIndex } from '../../../src/core/read/types.js';

function mockContext(name: string): VaultContext {
  return {
    name,
    vaultPath: `/tmp/maint-${name}`,
    caseInsensitive: false,
    stateDb: null,
    vaultIndex: { notes: new Map(), entities: new Map() } as unknown as VaultIndex,
    flywheelConfig: {},
    watcher: null,
    cooccurrenceIndex: null,
    embeddingsBuilding: false,
    writeEntityIndex: null,
    writeEntityIndexReady: false,
    writeEntityIndexError: null,
    writeEntityIndexLastLoadedAt: 0,
    writeRecencyIndex: null,
    taskCacheBuilding: false,
    entityEmbeddingsMap: new Map(),
    inferredCategoriesMap: new Map(),
    mutedWatcherPaths: new Set(),
    dirtyMutedWatcherPaths: new Set(),
    reconcileMutedWatcherPaths: null,
    deferredScheduler: null,
    lastPurgeAt: 0,
    indexState: 'ready',
    indexError: null,
    lastCooccurrenceRebuildAt: 0,
    lastEdgeWeightRebuildAt: 0,
    lastEntityScanAt: 0,
    lastHubScoreRebuildAt: 0,
    lastIndexCacheSaveAt: 0,
    pipelineActivity: createEmptyPipelineActivity(),
    bootState: 'ready',
    integrityState: 'healthy',
    integrityCheckInProgress: false,
    integrityStartedAt: null,
    integritySource: null,
    lastIntegrityCheckedAt: null,
    lastIntegrityDurationMs: null,
    lastIntegrityDetail: null,
    lastBackupAt: null,
  };
}

function mockConfig(name: string, overrides: Partial<MaintenanceConfig> = {}): {
  cfg: MaintenanceConfig;
  entityScanCalls: () => number;
} {
  let entityScans = 0;
  const cfg: MaintenanceConfig = {
    ctx: mockContext(name),
    vp: `/tmp/maint-${name}`,
    sd: null,
    getVaultIndex: () => ({ notes: new Map(), entities: new Map() }) as unknown as VaultIndex,
    updateEntitiesInStateDb: async () => { entityScans++; },
    updateFlywheelConfig: () => {},
    getLastMcpRequestAt: () => 0,
    getLastFullRebuildAt: () => 0,
    ...overrides,
  };
  return { cfg, entityScanCalls: () => entityScans };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  stopMaintenanceTimer('timer-a');
  stopMaintenanceTimer('timer-b');
  stopMaintenanceTimer('idle-skip');
  vi.useRealTimers();
});

describe('maintenance timer lifecycle', () => {
  it('start schedules a timer; stop clears it', () => {
    const { cfg } = mockConfig('timer-a');
    const before = vi.getTimerCount();
    startMaintenanceTimer(cfg, 15 * 60 * 1000);
    expect(vi.getTimerCount()).toBe(before + 1);

    stopMaintenanceTimer('timer-a');
    expect(vi.getTimerCount()).toBe(before);
  });

  it('restart replaces the pending timer instead of stacking', () => {
    const { cfg } = mockConfig('timer-b');
    const before = vi.getTimerCount();
    startMaintenanceTimer(cfg, 15 * 60 * 1000);
    startMaintenanceTimer(cfg, 15 * 60 * 1000);
    expect(vi.getTimerCount()).toBe(before + 1);
  });

  it('a fired run during active MCP traffic skips work and reschedules (idle guard)', async () => {
    const { cfg, entityScanCalls } = mockConfig('idle-skip', {
      // "Request just happened" — inside IDLE_THRESHOLD_MS forever
      getLastMcpRequestAt: () => Date.now(),
    });
    const before = vi.getTimerCount();
    startMaintenanceTimer(cfg, 15 * 60 * 1000);

    // Fire the scheduled run (jitter keeps it within ~±15% of the interval)
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);

    // No maintenance work happened, and the loop rescheduled itself
    expect(entityScanCalls()).toBe(0);
    expect(vi.getTimerCount()).toBe(before + 1);
  });
});
