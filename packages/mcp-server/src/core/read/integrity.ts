/**
 * Integrity runtime helpers.
 *
 * Runs SQLite integrity checks in a worker thread so MCP request handling
 * remains responsive during startup and periodic maintenance.
 */

import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export const INTEGRITY_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const INTEGRITY_CHECK_TIMEOUT_MS = 2 * 60 * 1000;
export const INTEGRITY_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const INTEGRITY_METADATA_KEYS = {
  checkedAt: 'last_integrity_check',
  status: 'last_integrity_status',
  durationMs: 'last_integrity_duration_ms',
  detail: 'last_integrity_detail',
} as const;

export type IntegrityWorkerStatus = 'healthy' | 'failed' | 'error';

export interface IntegrityWorkerResult {
  status: IntegrityWorkerStatus;
  detail: string | null;
  durationMs: number;
  backupCreated: boolean;
}

interface IntegrityWorkerMessage {
  dbPath: string;
  runBackup: boolean;
  busyTimeoutMs: number;
}

function resolveWorkerSpec(): { filename: string; execArgv?: string[] } {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);

  const prodPath = path.join(thisDir, 'integrity-worker.js');
  if (existsSync(prodPath)) return { filename: prodPath };

  const distPath = path.resolve(thisDir, '..', '..', '..', 'dist', 'integrity-worker.js');
  if (existsSync(distPath)) return { filename: distPath };

  const srcPath = path.join(thisDir, 'integrity-worker.ts');
  return { filename: srcPath, execArgv: ['--import', 'tsx'] };
}

export async function runIntegrityWorker(
  message: IntegrityWorkerMessage,
  timeoutMs: number = INTEGRITY_CHECK_TIMEOUT_MS,
): Promise<IntegrityWorkerResult> {
  const workerSpec = resolveWorkerSpec();

  return new Promise<IntegrityWorkerResult>((resolve) => {
    const worker = new Worker(workerSpec.filename, {
      execArgv: workerSpec.execArgv,
    });
    let settled = false;

    const finish = (result: IntegrityWorkerResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => {});
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        status: 'error',
        detail: `Integrity worker timed out after ${timeoutMs}ms`,
        durationMs: timeoutMs,
        backupCreated: false,
      });
    }, timeoutMs);

    worker.once('message', (result: IntegrityWorkerResult) => finish(result));
    worker.once('error', (err) => {
      finish({
        status: 'error',
        detail: err.message,
        durationMs: 0,
        backupCreated: false,
      });
    });
    worker.once('exit', (code) => {
      if (settled || code === 0) return;
      finish({
        status: 'error',
        detail: `Integrity worker exited with code ${code}`,
        durationMs: 0,
        backupCreated: false,
      });
    });

    worker.postMessage(message);
  });
}
