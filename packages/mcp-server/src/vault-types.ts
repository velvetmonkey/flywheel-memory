/**
 * Leaf type module for per-vault runtime state (arch-review S1).
 *
 * VaultContext, its lifecycle enums, and the deferred-scheduler contract live
 * here — with imports ONLY from other leaf type modules and @velvetmonkey/
 * vault-core — so that vault-scope.ts, vault-registry.ts, and the watcher
 * pipeline can all type against per-vault state without forming import
 * cycles. Implementation classes (VaultRegistry, DeferredStepScheduler)
 * remain in their original modules.
 */

import type { EntityIndex, StateDb } from '@velvetmonkey/vault-core';
import type { VaultIndex, CooccurrenceIndex, RecencyIndex } from './core/shared/types.js';
import type { FlywheelConfig, IndexState, InferredCategory } from './core/read/types.js';
import type { VaultWatcher, PipelineActivity } from './core/read/watch/types.js';

export type VaultBootState = 'transport_connected' | 'booting' | 'ready' | 'degraded';
export type IntegrityState = 'unknown' | 'checking' | 'healthy' | 'failed' | 'error';

export type DeferredStepName = 'entity_scan' | 'hub_scores' | 'recency' | 'cooccurrence' | 'edge_weights';

export interface DeferredStepExecutor {
  ctx: VaultContext;
  vp: string;
  sd: StateDb | null;
  getVaultIndex: () => VaultIndex;
  updateEntitiesInStateDb: (vp: string, sd: StateDb | null) => Promise<void>;
  runWithScope?: <T>(fn: () => T) => T;
}

/**
 * Structural contract for the deferred step scheduler (implemented by
 * DeferredStepScheduler in core/read/watch/pipeline.ts). VaultContext types
 * against this interface so this module stays a leaf.
 */
export interface DeferredStepSchedulerHandle {
  setExecutor(exec: DeferredStepExecutor): void;
  schedule(step: DeferredStepName, delayMs: number): void;
  cancel(step: DeferredStepName): void;
  cancelAll(): void;
  readonly pendingCount: number;
}

export interface VaultContext {
  name: string;
  vaultPath: string;
  /** True on case-insensitive filesystems (Windows NTFS, macOS APFS default, CIFS/SMB mounts). Probed at boot. */
  caseInsensitive: boolean;
  stateDb: StateDb | null;
  vaultIndex: VaultIndex;
  flywheelConfig: FlywheelConfig;
  watcher: VaultWatcher | null;
  /** Per-vault co-occurrence index (loaded from StateDb cache on startup) */
  cooccurrenceIndex: CooccurrenceIndex | null;
  /** Per-vault embedding build flag */
  embeddingsBuilding: boolean;
  /** Per-vault write-side entity index cache */
  writeEntityIndex: EntityIndex | null;
  /** Per-vault write-side entity index readiness */
  writeEntityIndexReady: boolean;
  /** Per-vault write-side entity index error */
  writeEntityIndexError: Error | null;
  /** Per-vault timestamp: last write-side entity index load */
  writeEntityIndexLastLoadedAt: number;
  /** Per-vault write-side recency index cache */
  writeRecencyIndex: RecencyIndex | null;
  /** Per-vault task cache build flag */
  taskCacheBuilding: boolean;
  /** Per-vault in-memory entity embeddings for semantic suggestions */
  entityEmbeddingsMap: Map<string, Float32Array>;
  /** Per-vault inferred semantic categories */
  inferredCategoriesMap: Map<string, InferredCategory>;
  /** Watcher-muted paths during live policy execution */
  mutedWatcherPaths: Set<string>;
  /** Paths changed while muted and awaiting final reconciliation */
  dirtyMutedWatcherPaths: Set<string>;
  /** Per-vault watcher reconciliation callback for muted writes */
  reconcileMutedWatcherPaths: ((paths: string[]) => Promise<void>) | null;
  /** Per-vault deferred step scheduler for throttled watcher work */
  deferredScheduler: DeferredStepSchedulerHandle | null;
  /** Per-vault timestamp: last periodic purge run */
  lastPurgeAt: number;
  /** Per-vault index build state */
  indexState: IndexState;
  /** Per-vault index error */
  indexError: Error | null;
  /** Per-vault timestamp: last co-occurrence rebuild */
  lastCooccurrenceRebuildAt: number;
  /** Per-vault timestamp: last edge weight rebuild */
  lastEdgeWeightRebuildAt: number;
  /** Per-vault timestamp: last entity scan */
  lastEntityScanAt: number;
  /** Per-vault timestamp: last hub score rebuild */
  lastHubScoreRebuildAt: number;
  /** Per-vault timestamp: last index cache save */
  lastIndexCacheSaveAt: number;
  /** Per-vault live watcher pipeline activity */
  pipelineActivity: PipelineActivity;
  /** Per-vault boot lifecycle state */
  bootState: VaultBootState;
  /** Per-vault integrity status */
  integrityState: IntegrityState;
  /** True while an integrity check is in flight */
  integrityCheckInProgress: boolean;
  /** Current integrity check start time (epoch ms) */
  integrityStartedAt: number | null;
  /** Source of current/last integrity check */
  integritySource: string | null;
  /** Last completed integrity check time (epoch ms) */
  lastIntegrityCheckedAt: number | null;
  /** Last completed integrity duration (ms) */
  lastIntegrityDurationMs: number | null;
  /** Last integrity detail text */
  lastIntegrityDetail: string | null;
  /** Last successful backup time (epoch ms) */
  lastBackupAt: number | null;
}
