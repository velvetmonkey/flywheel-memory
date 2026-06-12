/**
 * Watcher pipeline steps — maintenance & integrity (arch-review S9, moved
 * verbatim from PipelineRunner methods in core/read/watch/pipeline.ts).
 *
 * Steps: integrity_check, maintenance (incremental vacuum + WAL checkpoint).
 */

import { serverLog } from '../../shared/serverLog.js';
import type { PipelineState } from './context.js';

/** Periodic integrity check — staleness-gated to once every 6 hours. */
export async function integrityCheck(s: PipelineState): Promise<Record<string, unknown>> {
  const { p } = s;
  if (!p.sd) return { skipped: true, reason: 'no statedb' };
  const result = await p.runIntegrityCheck(p.ctx, 'watcher');
  if (result.status === 'healthy') {
    return { integrity: 'ok', backed_up: result.backupCreated };
  }
  if (result.status === 'failed') {
    serverLog('watcher', `Integrity check FAILED: ${result.detail}`, 'error');
    return { integrity: 'failed', detail: result.detail };
  }
  return { skipped: true, reason: result.detail ?? 'integrity runner unavailable' };
}

// ── Maintenance: periodic incremental vacuum ─────────────────────

export async function maintenance(s: PipelineState): Promise<Record<string, unknown>> {
  const { p } = s;
  if (!p.sd) return { skipped: true, reason: 'no statedb' };

  const VACUUM_INTERVAL_MS = 60 * 60 * 1000; // hourly
  const lastRow = p.sd.getMetadataValue.get('last_incremental_vacuum') as { value: string } | undefined;
  const lastVacuum = lastRow ? parseInt(lastRow.value, 10) : 0;

  if (Date.now() - lastVacuum < VACUUM_INTERVAL_MS) {
    return { skipped: true, reason: 'vacuumed recently' };
  }

  p.sd.db.pragma('incremental_vacuum');
  const walResult = p.sd.db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number; log: number; checkpointed: number }>;
  const checkpointed = walResult?.[0]?.busy === 0;

  if (checkpointed) {
    p.sd.setMetadataValue.run('last_incremental_vacuum', String(Date.now()));
    serverLog('watcher', 'Incremental vacuum + WAL checkpoint completed');
  } else {
    serverLog('watcher', 'Incremental vacuum done, WAL checkpoint skipped (busy readers)');
  }
  return { vacuumed: true, wal_checkpointed: checkpointed };
}
