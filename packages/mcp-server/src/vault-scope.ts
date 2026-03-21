/**
 * VaultScope — Bundles per-vault mutable state into a single swappable object.
 *
 * Invariant: Every piece of per-vault mutable state must live in VaultScope
 * or be swapped by activateVault(). If you add a new module-level `let` in core/,
 * add it to VaultScope or activateVault.
 *
 * Module-level setters still exist for backward compatibility — VaultScope
 * provides an incremental migration path where modules can read from
 * getActiveScope() instead of their own module-level variables.
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import type { CooccurrenceIndex } from './core/shared/cooccurrence.js';
import type { FlywheelConfig } from './core/read/config.js';
import type { IndexState } from './core/read/graph.js';

export interface VaultScope {
  readonly name: string;
  readonly vaultPath: string;
  readonly stateDb: StateDb | null;
  readonly flywheelConfig: FlywheelConfig;
  cooccurrenceIndex: CooccurrenceIndex | null;
  indexState: IndexState;
  indexError: Error | null;
  embeddingsBuilding: boolean;
}

let activeScope: VaultScope | null = null;

/** Get the currently active VaultScope. Throws if no vault is active. */
export function getActiveScope(): VaultScope {
  if (!activeScope) throw new Error('No vault scope active — activateVault() has not been called');
  return activeScope;
}

/** Get the active VaultScope, or null if none is active (safe for startup). */
export function getActiveScopeOrNull(): VaultScope | null {
  return activeScope;
}

/** Set the active VaultScope. Called by activateVault() in index.ts. */
export function setActiveScope(scope: VaultScope): void {
  activeScope = scope;
}
