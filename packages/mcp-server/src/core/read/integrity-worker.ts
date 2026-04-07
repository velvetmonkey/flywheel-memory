/**
 * Integrity Worker Thread
 *
 * Runs PRAGMA quick_check and safe backup off the main event loop.
 */

import Database from 'better-sqlite3';
import { parentPort } from 'node:worker_threads';
import { checkDbIntegrity, safeBackupAsync } from '@velvetmonkey/vault-core';

if (!parentPort) {
  throw new Error('integrity-worker.ts must be run as a worker thread');
}

const port = parentPort;

type RequestMessage = {
  dbPath: string;
  runBackup: boolean;
  busyTimeoutMs: number;
};

port.on('message', async (msg: RequestMessage) => {
  const startedAt = Date.now();
  let db: Database.Database | null = null;

  try {
    db = new Database(msg.dbPath, { readonly: true, fileMustExist: true });
    db.pragma(`busy_timeout = ${msg.busyTimeoutMs}`);

    const integrity = checkDbIntegrity(db);
    if (!integrity.ok) {
      port.postMessage({
        status: 'failed',
        detail: integrity.detail ?? 'unknown integrity failure',
        durationMs: Date.now() - startedAt,
        backupCreated: false,
      });
      return;
    }

    let backupCreated = false;
    if (msg.runBackup) {
      backupCreated = await safeBackupAsync(db, msg.dbPath);
    }

    port.postMessage({
      status: 'healthy',
      detail: null,
      durationMs: Date.now() - startedAt,
      backupCreated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    port.postMessage({
      status: 'error',
      detail: message,
      durationMs: Date.now() - startedAt,
      backupCreated: false,
    });
  } finally {
    try { db?.close(); } catch { /* best effort */ }
  }
});
