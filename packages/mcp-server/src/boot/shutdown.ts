/**
 * Graceful shutdown (arch-review S10 — extracted verbatim from index.ts).
 *
 * installShutdownHandlers() is called by index.ts at module load, right
 * after main()/CLI dispatch — the same registration point as before.
 */

import { stopSweepTimer } from './../core/read/sweep.js';
import { stopMaintenanceTimer } from './../core/write/pipeline/maintenance.js';
import { flushLogs } from './../core/write/logging.js';
import {
  watchdogTimer,
  httpListener,
  vaultRegistry,
  watcherInstance,
  setShutdownRequested,
} from './state.js';

// Graceful shutdown on signals (beforeExit does NOT fire on SIGTERM/SIGINT)
function gracefulShutdown(signal: string) {
  setShutdownRequested(true);
  console.error(`[Memory] Received ${signal}, shutting down...`);
  if (watchdogTimer) clearInterval(watchdogTimer);
  if (httpListener) httpListener.close();
  for (const ctx of vaultRegistry?.getAllContexts() ?? []) {
    try { ctx.watcher?.stop(); } catch { /* best-effort */ }
    try { ctx.deferredScheduler?.cancelAll(); } catch { /* best-effort */ }
  }
  try { watcherInstance?.stop(); } catch {}
  stopSweepTimer();
  stopMaintenanceTimer();
  flushLogs()
    .catch(() => {})
    .finally(() => process.exit(0));
  // Force exit after 2s if flushLogs hangs
  setTimeout(() => process.exit(0), 2000).unref();
}

export function installShutdownHandlers(): void {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Cleanup on natural event-loop drain
  process.on('beforeExit', async () => {
    stopSweepTimer();
    await flushLogs();
  });
}
