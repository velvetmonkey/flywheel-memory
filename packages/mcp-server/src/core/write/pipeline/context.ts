/**
 * Pipeline context + shared step state types (arch-review S9).
 *
 * Lives in its own module (below runner.ts and the steps-*.ts files) so the
 * step implementation modules can type against PipelineContext/PipelineState
 * without importing runner.ts — which would form an import cycle, since
 * runner.ts imports the step functions.
 */

import type { StateDb, EntitySearchResult } from '@velvetmonkey/vault-core';
import type { VaultIndex } from '../../read/types.js';
import type { CoalescedEvent, RenameEvent, EventBatch } from '../../read/watch/types.js';
import type { FlywheelConfig } from '../../read/config.js';
import type { VaultContext } from '../../../vault-types.js';
import type { IndexState } from '../../read/graph.js';
import type { IntegrityWorkerResult } from '../../read/integrity.js';
import type { createStepTracker } from '../../shared/indexActivity.js';
import type { DeferredStepScheduler } from './scheduler.js';

// Re-exported from index.ts — these are module-level functions that update both globals and VaultContext
export type IndexStateUpdater = (state: IndexState, error?: Error | null) => void;
export type VaultIndexUpdater = (index: VaultIndex) => void;
export type EntitiesUpdater = (vp?: string, sd?: StateDb | null) => Promise<void>;

export interface PipelineContext {
  /** Vault path (absolute) */
  vp: string;
  /** StateDb handle (per-vault) */
  sd: StateDb | null;
  /** VaultContext for per-vault mutable state */
  ctx: VaultContext;
  /** Filtered events (post content-hash gate) */
  events: CoalescedEvent[];
  /** Detected renames */
  renames: RenameEvent[];
  /** Original batch (for processBatch) */
  batch: EventBatch;
  /** Changed file paths (for logging/recording) */
  changedPaths: string[];
  /** Current flywheel config */
  flywheelConfig: FlywheelConfig;
  /** Module-level updaters (injected from index.ts) */
  updateIndexState: IndexStateUpdater;
  updateVaultIndex: VaultIndexUpdater;
  updateEntitiesInStateDb: EntitiesUpdater;
  /** Module-level vaultIndex getter */
  getVaultIndex: () => VaultIndex;
  /** buildVaultIndex function */
  buildVaultIndex: (vaultPath: string) => Promise<VaultIndex>;
  /** Deferred step scheduler (optional — set when watcher is active) */
  deferredScheduler?: DeferredStepScheduler;
  /** Shared async integrity runner */
  runIntegrityCheck: (ctx: VaultContext, source: string, options?: { force?: boolean }) => Promise<IntegrityWorkerResult>;
}

export type StepTracker = ReturnType<typeof createStepTracker>;

/**
 * Shared mutable state the step functions operate on. Structurally implemented
 * by PipelineRunner (runner.ts) — data flows between steps via these fields
 * (entitiesAfter, linkDiffs, etc.), exactly as it did when the steps were
 * private methods on the runner.
 */
export interface PipelineState {
  p: PipelineContext;
  tracker: StepTracker;

  // Shared state between steps
  entitiesAfter: EntitySearchResult[];
  entitiesBefore: EntitySearchResult[];
  hubBefore: Map<string, number>;
  hasEntityRelevantChanges: boolean;
  forwardLinkResults: Array<{ file: string; resolved: string[]; dead: string[] }>;
  linkDiffs: Array<{ file: string; added: string[]; removed: string[] }>;
  survivedLinks: Array<{ entity: string; file: string; count: number }>;
  suggestionResults: Array<{ file: string; top: Array<{ entity: string; score: number; confidence: string }> }>;
  lightIndexPaths: Set<string>;

  /** Events excluding light-index paths */
  normalEvents(): CoalescedEvent[];
}
