/**
 * Boot state (arch-review S10 — extracted verbatim from index.ts).
 *
 * Module-level PROCESS SINGLETONS shared across the boot modules. These keep
 * the exact semantics they had in index.ts: one mutable slot per process,
 * swapped by activateVault() for multi-vault. Reads go through ESM live
 * bindings (importers always see the current value); writes go through the
 * exported setters (ESM imports are read-only views).
 */

import type { VaultIndex } from './../core/read/types.js';
import type { FlywheelConfig } from './../core/read/config.js';
import type { VaultWatcher, WatcherStatus } from './../core/read/watch/index.js';
import type { VaultFile } from './../core/read/vault.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import type { VaultRegistry } from './../vault-registry.js';

/** package.json — loaded in index.ts at import time (the path only resolves
 *  correctly from a src-root/dist-root file) and injected here via setPkg(). */
export let pkg: { version: string };
export function setPkg(value: { version: string }): void { pkg = value; }

// Auto-detect vault root — resolved at startup in main(), not at import time
export let vaultPath: string;
export let resolvedVaultPath: string;
export function setVaultPath(value: string): void { vaultPath = value; }
export function setResolvedVaultPath(value: string): void { resolvedVaultPath = value; }

// State variables (module-level singletons — swapped by activateVault for multi-vault)
export let vaultIndex: VaultIndex;
export let flywheelConfig: FlywheelConfig = {};
export let stateDb: StateDb | null = null;
export let watcherInstance: VaultWatcher | null = null;
export function setVaultIndex(value: VaultIndex): void { vaultIndex = value; }
export function setFlywheelConfig(value: FlywheelConfig): void { flywheelConfig = value; }
export function setStateDb(value: StateDb | null): void { stateDb = value; }
export function setWatcherInstance(value: VaultWatcher | null): void { watcherInstance = value; }

// Multi-vault registry (populated in main())
export let vaultRegistry: VaultRegistry | null = null;
export function setVaultRegistry(value: VaultRegistry | null): void { vaultRegistry = value; }

/** HTTP listener handle for graceful shutdown */
export let httpListener: ReturnType<typeof import('net').createServer> | null = null;
export function setHttpListener(value: ReturnType<typeof import('net').createServer> | null): void { httpListener = value; }

/** Watchdog self-ping timer */
export let watchdogTimer: ReturnType<typeof setInterval> | null = null;
export function setWatchdogTimer(value: ReturnType<typeof setInterval> | null): void { watchdogTimer = value; }

/** True once primary vault boot completes */
export let serverReady = false;
export function setServerReady(value: boolean): void { serverReady = value; }

/** Set during graceful shutdown to suppress watchdog exit */
export let shutdownRequested = false;
export function setShutdownRequested(value: boolean): void { shutdownRequested = value; }

/** Timestamp of last MCP tool request (for idle-awareness) */
export let lastMcpRequestAt = 0;
export function setLastMcpRequestAt(value: number): void { lastMcpRequestAt = value; }

/** Timestamp of last full rebuild (startup_build or manual_refresh) */
export let lastFullRebuildAt = 0;
export function setLastFullRebuildAt(value: number): void { lastFullRebuildAt = value; }

/** Scanned vault files from bootVault — reused by startup catch-up to avoid duplicate filesystem walk */
export let startupScanFiles: VaultFile[] | null = null;
export function setStartupScanFiles(value: VaultFile[] | null): void { startupScanFiles = value; }

/** Current watcher status (live — reads state at call time, not a stale snapshot). */
export function getWatcherStatus(): WatcherStatus | null {
  if (vaultRegistry) {
    const name = (globalThis as any).__flywheel_active_vault;
    if (name) {
      try { return vaultRegistry.getContext(name).watcher?.status ?? null; } catch { /* fall through */ }
    }
  }
  return watcherInstance?.status ?? null;
}
