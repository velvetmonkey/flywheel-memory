/**
 * Integrity orchestration (arch-review S10 — extracted verbatim from
 * index.ts).
 *
 * Orchestrates the StateDb integrity check state machine over the worker
 * runner in core/read/integrity.ts (which stays as-is): hydrate/persist
 * metadata, in-flight dedup per vault, backup policy, and VaultContext
 * integrity-state bookkeeping.
 */

import {
  INTEGRITY_BACKUP_INTERVAL_MS,
  INTEGRITY_CHECK_INTERVAL_MS,
  INTEGRITY_METADATA_KEYS,
  runIntegrityWorker,
  type IntegrityWorkerResult,
} from './../core/read/integrity.js';
import { serverLog } from './../core/shared/serverLog.js';
import type { IntegrityState, VaultContext } from './../vault-registry.js';
import { setFallbackScope } from './../vault-scope.js';
import { buildVaultScope } from './registryContext.js';

/** In-flight integrity checks keyed by vault name */
const integrityRuns = new Map<string, Promise<IntegrityWorkerResult>>();

export function hydrateIntegrityMetadata(ctx: VaultContext): void {
  if (!ctx.stateDb) return;
  const checkedAtRow = ctx.stateDb.getMetadataValue.get(INTEGRITY_METADATA_KEYS.checkedAt) as { value: string } | undefined;
  const statusRow = ctx.stateDb.getMetadataValue.get(INTEGRITY_METADATA_KEYS.status) as { value: string } | undefined;
  const durationRow = ctx.stateDb.getMetadataValue.get(INTEGRITY_METADATA_KEYS.durationMs) as { value: string } | undefined;
  const detailRow = ctx.stateDb.getMetadataValue.get(INTEGRITY_METADATA_KEYS.detail) as { value: string } | undefined;

  ctx.lastIntegrityCheckedAt = checkedAtRow ? parseInt(checkedAtRow.value, 10) || null : null;
  ctx.lastIntegrityDurationMs = durationRow ? parseInt(durationRow.value, 10) || null : null;
  ctx.lastIntegrityDetail = detailRow?.value ? detailRow.value : null;

  const status = statusRow?.value;
  if (status === 'healthy' || status === 'failed' || status === 'error') {
    ctx.integrityState = status;
  }
}

export function setIntegrityState(
  ctx: VaultContext,
  state: IntegrityState,
  detail: string | null = ctx.lastIntegrityDetail,
  durationMs: number | null = ctx.lastIntegrityDurationMs,
): void {
  ctx.integrityState = state;
  ctx.lastIntegrityDetail = detail;
  ctx.lastIntegrityDurationMs = durationMs;
  if (state === 'failed') {
    ctx.bootState = 'degraded';
  }
  if ((globalThis as any).__flywheel_active_vault === ctx.name) {
    setFallbackScope(buildVaultScope(ctx));
  }
}

export function persistIntegrityMetadata(ctx: VaultContext): void {
  if (!ctx.stateDb || ctx.lastIntegrityCheckedAt == null) return;
  ctx.stateDb.setMetadataValue.run(INTEGRITY_METADATA_KEYS.checkedAt, String(ctx.lastIntegrityCheckedAt));
  ctx.stateDb.setMetadataValue.run(INTEGRITY_METADATA_KEYS.status, ctx.integrityState);
  if (ctx.lastIntegrityDurationMs != null) {
    ctx.stateDb.setMetadataValue.run(INTEGRITY_METADATA_KEYS.durationMs, String(ctx.lastIntegrityDurationMs));
  }
  if (ctx.lastIntegrityDetail) {
    ctx.stateDb.setMetadataValue.run(INTEGRITY_METADATA_KEYS.detail, ctx.lastIntegrityDetail);
  } else {
    ctx.stateDb.setMetadataValue.run(INTEGRITY_METADATA_KEYS.detail, '');
  }
}

export function shouldRunBackup(ctx: VaultContext): boolean {
  if (ctx.lastBackupAt == null) return true;
  return Date.now() - ctx.lastBackupAt >= INTEGRITY_BACKUP_INTERVAL_MS;
}

export async function runIntegrityCheck(
  ctx: VaultContext,
  source: string,
  options: { force?: boolean } = {},
): Promise<IntegrityWorkerResult> {
  if (!ctx.stateDb) {
    return { status: 'error', detail: 'StateDb not available', durationMs: 0, backupCreated: false };
  }

  if (!options.force && ctx.integrityState === 'healthy' && ctx.lastIntegrityCheckedAt != null) {
    if (Date.now() - ctx.lastIntegrityCheckedAt < INTEGRITY_CHECK_INTERVAL_MS) {
      return {
        status: 'healthy',
        detail: ctx.lastIntegrityDetail,
        durationMs: ctx.lastIntegrityDurationMs ?? 0,
        backupCreated: false,
      };
    }
  }

  const existing = integrityRuns.get(ctx.name);
  if (existing) return existing;

  ctx.integrityCheckInProgress = true;
  ctx.integrityStartedAt = Date.now();
  ctx.integritySource = source;
  setIntegrityState(ctx, 'checking', ctx.lastIntegrityDetail, ctx.lastIntegrityDurationMs);
  serverLog('statedb', `[${ctx.name}] Integrity check started (${source})`);

  const promise = runIntegrityWorker({
    dbPath: ctx.stateDb.dbPath,
    runBackup: shouldRunBackup(ctx),
    busyTimeoutMs: 5_000,
  }).then((result) => {
    ctx.integrityCheckInProgress = false;
    ctx.integrityStartedAt = null;
    ctx.integritySource = source;
    ctx.lastIntegrityCheckedAt = Date.now();
    ctx.lastIntegrityDurationMs = result.durationMs;
    ctx.lastIntegrityDetail = result.detail;
    if (result.backupCreated) {
      ctx.lastBackupAt = Date.now();
    }

    if (result.status === 'healthy') {
      setIntegrityState(ctx, 'healthy', result.detail, result.durationMs);
      serverLog('statedb', `[${ctx.name}] Integrity check passed in ${result.durationMs}ms`);
    } else if (result.status === 'failed') {
      setIntegrityState(ctx, 'failed', result.detail, result.durationMs);
      serverLog('statedb', `[${ctx.name}] Integrity check failed: ${result.detail}`, 'error');
    } else {
      setIntegrityState(ctx, 'error', result.detail, result.durationMs);
      serverLog('statedb', `[${ctx.name}] Integrity check error: ${result.detail}`, 'warn');
    }

    persistIntegrityMetadata(ctx);
    return result;
  }).finally(() => {
    integrityRuns.delete(ctx.name);
    if ((globalThis as any).__flywheel_active_vault === ctx.name) {
      setFallbackScope(buildVaultScope(ctx));
    }
  });

  integrityRuns.set(ctx.name, promise);
  return promise;
}
