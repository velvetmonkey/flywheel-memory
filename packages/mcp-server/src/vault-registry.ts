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
import type { StateDb } from '@velvetmonkey/vault-core';

export interface VaultContext {
  name: string;
  vaultPath: string;
  stateDb: StateDb | null;
  vaultIndex: VaultIndex;
  flywheelConfig: FlywheelConfig;
  watcher: VaultWatcher | null;
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
    if (colonIdx <= 0) continue; // skip malformed entries
    // Handle Windows paths (e.g., "name:C:\path") — colon at index > 1 is the separator
    // For single-char names followed by Windows path, look for second colon
    let name: string;
    let vaultPath: string;
    if (colonIdx === 1 && trimmed.length > 2 && (trimmed[2] === '\\' || trimmed[2] === '/')) {
      // Looks like "C:\..." — treat entire thing as path, not name:path
      // Skip this entry — ambiguous
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
