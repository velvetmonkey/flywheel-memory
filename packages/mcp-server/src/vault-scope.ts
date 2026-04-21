/**
 * VaultScope — Per-request vault isolation via AsyncLocalStorage.
 *
 * Each MCP tool handler runs inside `runInVaultScope(scope, fn)`, which binds
 * a VaultScope to the current async context. Getters like `getActiveScope()`
 * read from AsyncLocalStorage first, falling back to a module-level fallback
 * for code paths outside ALS context (startup, watcher callbacks).
 *
 * This ensures that interleaved async handlers for different vaults cannot
 * observe each other's state — even across `await` boundaries.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { EntityIndex, StateDb } from '@velvetmonkey/vault-core';
import type { CooccurrenceIndex } from './core/shared/cooccurrence.js';
import type { FlywheelConfig } from './core/read/config.js';
import type { IndexState } from './core/read/graph.js';
import type { InferredCategory } from './core/read/embeddings.js';
import type { VaultIndex } from './core/shared/types.js';
import type { RecencyIndex } from './core/shared/recency.js';
import type { PipelineActivity } from './core/read/watch/pipeline.js';
import type { IntegrityState, VaultBootState } from './vault-registry.js';

export interface VaultScope {
  readonly name: string;
  readonly vaultPath: string;
  readonly stateDb: StateDb | null;
  readonly flywheelConfig: FlywheelConfig;
  readonly vaultIndex: VaultIndex;
  cooccurrenceIndex: CooccurrenceIndex | null;
  indexState: IndexState;
  indexError: Error | null;
  embeddingsBuilding: boolean;
  writeEntityIndex: EntityIndex | null;
  writeEntityIndexReady: boolean;
  writeEntityIndexError: Error | null;
  writeEntityIndexLastLoadedAt: number;
  writeRecencyIndex: RecencyIndex | null;
  taskCacheBuilding: boolean;
  entityEmbeddingsMap: Map<string, Float32Array>;
  inferredCategoriesMap: Map<string, InferredCategory>;
  mutedWatcherPaths: Set<string>;
  dirtyMutedWatcherPaths: Set<string>;
  reconcileMutedWatcherPaths: ((paths: string[]) => Promise<void>) | null;
  pipelineActivity: PipelineActivity;
  bootState: VaultBootState;
  integrityState: IntegrityState;
  integrityCheckInProgress: boolean;
  integrityStartedAt: number | null;
  integritySource: string | null;
  lastIntegrityCheckedAt: number | null;
  lastIntegrityDurationMs: number | null;
  lastIntegrityDetail: string | null;
  lastBackupAt: number | null;
}

const vaultAls = new AsyncLocalStorage<VaultScope>();

// Fallback for code paths outside ALS context (startup, watcher callbacks)
let fallbackScope: VaultScope | null = null;

/** Get the currently active VaultScope. Throws if no vault is active. */
export function getActiveScope(): VaultScope {
  const scope = vaultAls.getStore() ?? fallbackScope;
  if (!scope) throw new Error('No vault scope active — activateVault() has not been called');
  return scope;
}

/** Get the active VaultScope, or null if none is active (safe for startup). */
export function getActiveScopeOrNull(): VaultScope | null {
  return vaultAls.getStore() ?? fallbackScope;
}

/** Run a function within a vault's async context. */
export function runInVaultScope<T>(scope: VaultScope, fn: () => T): T {
  return vaultAls.run(scope, fn);
}

/** Set fallback scope (startup, single-vault, watcher). NOT per-request safe. */
export function setFallbackScope(scope: VaultScope): void {
  fallbackScope = scope;
}

/** @deprecated Use setFallbackScope for startup/watcher, runInVaultScope for requests. */
export const setActiveScope = setFallbackScope;
