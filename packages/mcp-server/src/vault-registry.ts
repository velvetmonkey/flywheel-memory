/**
 * VaultContext + VaultRegistry — Multi-vault support
 *
 * VaultContext holds per-vault state (stateDb, vaultIndex, config, watcher).
 * VaultRegistry maps vault names → contexts and tracks the primary vault.
 *
 * Singleton swapping (useVault) lives in index.ts where the setter imports are.
 */

import type { VaultIndex } from './core/read/types.js';
import type { FlywheelConfig } from './core/read/config.js';
import type { VaultWatcher } from './core/read/watch/index.js';
import type { EntityIndex, StateDb } from '@velvetmonkey/vault-core';
import type { CooccurrenceIndex } from './core/shared/cooccurrence.js';
import type { IndexState } from './core/read/graph.js';
import type { DeferredStepScheduler, PipelineActivity } from './core/read/watch/pipeline.js';
import type { InferredCategory } from './core/read/embeddings.js';
import type { RecencyIndex } from './core/shared/recency.js';

export type VaultBootState = 'transport_connected' | 'booting' | 'ready' | 'degraded';
export type IntegrityState = 'unknown' | 'checking' | 'healthy' | 'failed' | 'error';

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
  deferredScheduler: DeferredStepScheduler | null;
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

export class VaultRegistry {
  private contexts = new Map<string, VaultContext>();
  private _primaryName: string;

  constructor(primaryName: string) {
    this._primaryName = primaryName;
  }

  get primaryName(): string { return this._primaryName; }
  get size(): number { return this.contexts.size; }
  get isMultiVault(): boolean { return this.contexts.size > 1; }

  addContext(ctx: VaultContext): void {
    this.contexts.set(ctx.name, ctx);
  }

  getContext(name?: string): VaultContext {
    const key = name ?? this._primaryName;
    const ctx = this.contexts.get(key);
    if (!ctx) {
      const available = Array.from(this.contexts.keys()).join(', ');
      throw new Error(`Vault "${key}" not found. Available: ${available}`);
    }
    return ctx;
  }

  getAllContexts(): VaultContext[] {
    return Array.from(this.contexts.values());
  }

  getVaultNames(): string[] {
    return Array.from(this.contexts.keys());
  }
}

/**
 * Parse FLYWHEEL_VAULTS env var into vault name → path pairs.
 * Format: "name1:/path/to/vault1,name2:/path/to/vault2"
 * Returns null if not set (single-vault mode).
 */
export function parseVaultConfig(): Array<{ name: string; path: string }> | null {
  const envValue = process.env.FLYWHEEL_VAULTS?.trim();
  if (!envValue) return null;

  const vaults: Array<{ name: string; path: string }> = [];
  for (const entry of envValue.split(',')) {
    const trimmed = entry.trim();
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) {
      console.error(`[flywheel] Warning: skipping malformed FLYWHEEL_VAULTS entry: "${trimmed}" (expected name:/path)`);
      continue;
    }
    // Handle Windows paths (e.g., "name:C:\path") — colon at index > 1 is the separator
    // For single-char names followed by Windows path, look for second colon
    let name: string;
    let vaultPath: string;
    if (colonIdx === 1 && trimmed.length > 2 && (trimmed[2] === '\\' || trimmed[2] === '/')) {
      // Looks like "C:\..." — treat entire thing as path, not name:path
      console.error(`[flywheel] Warning: skipping ambiguous FLYWHEEL_VAULTS entry: "${trimmed}" (looks like a Windows path, not name:path)`);
      continue;
    }
    name = trimmed.substring(0, colonIdx);
    vaultPath = trimmed.substring(colonIdx + 1);
    if (name && vaultPath) {
      vaults.push({ name, path: vaultPath });
    }
  }

  return vaults.length > 0 ? vaults : null;
}
