/**
 * Vault health report (arch-review S7).
 *
 * buildHealthReport() is the doctor(action: health) engine, moved verbatim
 * from tools/read/health.ts — index freshness, composite health score,
 * pipeline/embedding/integrity status, proactive-linking observability,
 * and recommendations. Diagnostics is a cross-cutting consumer (it reads
 * write-side learning state), hence the neutral core/diagnostics home.
 *
 * Output shape pinned by test/read/tools/health.test.ts and
 * doctor-shape.test.ts before the move.
 */

import * as fs from 'fs';
import type { VaultIndex, FlywheelConfig, IndexState } from '../read/types.js';
import { resolveTarget, getIndexState, getIndexProgress, getIndexError, normalizeTarget } from '../read/graph.js';
import { detectPeriodicNotes } from '../read/periodic.js';
import { SCHEMA_VERSION, getWriteState, type StateDb } from '@velvetmonkey/vault-core';
import { getRecentIndexEvents, getRecentPipelineEvent, getLastSuccessfulEvent, getLastEventByTrigger, compactPipelineRun, type CompactStep, type CompactPipelineRun } from '../shared/indexActivity.js';
import type { PipelineActivity, WatcherStatus } from '../read/watch/types.js';
import { getFTS5State } from '../read/fts5.js';
import { hasEmbeddingsIndex, isEmbeddingsBuilding, getEmbeddingsCount, getActiveModelId, diagnoseEmbeddings } from '../read/embeddings.js';
import { isTaskCacheReady, isTaskCacheBuilding } from '../read/taskCache.js';
import { getSweepResults, type SweepResults } from '../read/sweep.js';
import { getProactiveLinkingSummary, getProactiveLinkingOneLiner } from '../shared/proactiveLinkingStats.js';
import { countPendingProactiveSuggestions, listPendingProactiveSuggestions } from './healthQueries.js';
import type { HealthCheckOutput, PeriodicNoteInfo } from './types.js';
export type { HealthCheckOutput, PeriodicNoteInfo } from './types.js';

/** Staleness threshold in seconds */
// 30 min — a quiet period of half an hour is a more honest threshold for
// "the watcher might have stopped" than 5 min (which trips on every coffee
// break on an actively-watched vault). Pair this with the previous fix
// that makes freshness count watcher batches, not just full rebuilds.
export const STALE_THRESHOLD_SECONDS = 1800;

export interface VaultRuntimeStateView {
  bootState: string;
  integrityState: string;
  integrityCheckInProgress: boolean;
  integrityStartedAt: number | null;
  integritySource: string | null;
  lastIntegrityCheckedAt: number | null;
  lastIntegrityDurationMs: number | null;
  lastIntegrityDetail: string | null;
  lastBackupAt: number | null;
}

export interface HealthReportDeps {
  getIndex: () => VaultIndex;
  getVaultPath: () => string;
  getConfig: () => FlywheelConfig;
  getStateDb: () => StateDb | null;
  getWatcherStatus: () => WatcherStatus | null;
  getPipelineActivityState: () => Readonly<PipelineActivity> | null;
  getVaultRuntimeState: () => VaultRuntimeStateView;
}



export async function buildHealthReport(
  deps: HealthReportDeps,
  detail: 'summary' | 'full' = 'summary',
): Promise<HealthCheckOutput> {
  const { getIndex, getVaultPath, getConfig, getStateDb, getWatcherStatus, getPipelineActivityState, getVaultRuntimeState } = deps;
  const isFull = detail === 'full';
  const index = getIndex();
  const vaultPath = getVaultPath();
  const recommendations: string[] = [];

  // Get index state info
  const indexState = getIndexState();
  const indexProgress = getIndexProgress();
  const indexErrorObj = getIndexError();

  // Check vault accessibility
  let vaultAccessible = false;
  try {
    fs.accessSync(vaultPath, fs.constants.R_OK);
    vaultAccessible = true;
  } catch {
    vaultAccessible = false;
    recommendations.push('Vault path is not accessible. Check PROJECT_PATH environment variable.');
  }

  // Check database integrity
  let dbIntegrityFailed = false;
  const stateDb = getStateDb();
  const runtimeState = getVaultRuntimeState();
  if (runtimeState.integrityState === 'failed') {
    dbIntegrityFailed = true;
    recommendations.push(`Database integrity check failed: ${runtimeState.lastIntegrityDetail ?? 'unknown integrity failure'}`);
  } else if (runtimeState.integrityState === 'error') {
    recommendations.push(`Database integrity check error: ${runtimeState.lastIntegrityDetail ?? 'integrity runner error'}`);
  } else if (runtimeState.integrityCheckInProgress) {
    recommendations.push('Database integrity check is still running.');
  }

  // Check index status
  const indexBuilt = indexState === 'ready' && index !== undefined && index.notes !== undefined;

  // Canonical timestamps from index_events
  let lastIndexActivityAt: number | undefined;
  let lastFullRebuildAt: number | undefined;
  let lastWatcherBatchAt: number | undefined;
  let lastBuild: ReturnType<typeof getLastEventByTrigger> | undefined;
  let lastManual: ReturnType<typeof getLastEventByTrigger> | undefined;
  if (stateDb) {
    try {
      const lastAny = getLastSuccessfulEvent(stateDb);
      if (lastAny) lastIndexActivityAt = lastAny.timestamp;
      lastBuild = getLastEventByTrigger(stateDb, 'startup_build') ?? undefined;
      lastManual = getLastEventByTrigger(stateDb, 'manual_refresh') ?? undefined;
      lastFullRebuildAt = Math.max(lastBuild?.timestamp ?? 0, lastManual?.timestamp ?? 0) || undefined;
      const lastWatcher = getLastEventByTrigger(stateDb, 'watcher');
      if (lastWatcher) lastWatcherBatchAt = lastWatcher.timestamp;
    } catch { /* ignore */ }
  }

  // Freshness = newest of {last full rebuild, last successful watcher
  // batch}. The watcher's 25-step incremental pipeline (fts5, embeddings,
  // hub scores, etc.) keeps the index current between full rebuilds —
  // treating it otherwise produces a false-positive "stale" flag 5 min
  // after every manual refresh on actively-watched vaults.
  //
  // index.builtAt is the in-memory load timestamp — it always equals
  // "right now" for a freshly-loaded server. Only use it as a last-resort
  // fallback when no index_events rows exist at all (e.g. brand-new DB
  // before the first watcher batch lands).
  const freshnessTimestamp = (() => {
    const events = [lastFullRebuildAt, lastWatcherBatchAt].filter(
      (t): t is number => typeof t === 'number' && t > 0,
    );
    if (events.length) return Math.max(...events);
    return indexBuilt && index.builtAt ? index.builtAt.getTime() : undefined;
  })();
  const indexAge = freshnessTimestamp
    ? Math.floor((Date.now() - freshnessTimestamp) / 1000)
    : -1;
  const indexStale = indexBuilt && indexAge > STALE_THRESHOLD_SECONDS;

  // Add state-specific recommendations
  if (indexState === 'building') {
    const { parsed, total } = indexProgress;
    const progress = total > 0 ? ` (${parsed}/${total} files)` : '';
    recommendations.push(`Index is building${progress}. Some tools may not be available yet.`);
  } else if (indexState === 'error') {
    recommendations.push(`Index failed to build: ${indexErrorObj?.message || 'unknown error'}`);
  } else if (indexStale) {
    recommendations.push(`Index is ${Math.floor(indexAge / 60)} minutes old. Consider running refresh_index.`);
  }

  // Count metrics (only if index is ready)
  const noteCount = indexBuilt ? index.notes.size : 0;
  const entityCount = indexBuilt ? index.entities.size : 0;
  const tagCount = indexBuilt ? index.tags.size : 0;
  let linkCount = 0;
  if (indexBuilt) {
    for (const note of index.notes.values()) linkCount += note.outlinks.length;
  }

  if (indexBuilt && noteCount === 0 && vaultAccessible) {
    recommendations.push('No notes found in vault. Is PROJECT_PATH pointing to a markdown vault?');
  }

  // Determine overall status
  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (!vaultAccessible || indexState === 'error' || dbIntegrityFailed) {
    status = 'unhealthy';
  } else if (indexState === 'building' || indexStale || recommendations.length > 0) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  // Detect periodic note conventions (only when index is ready, full mode only)
  let periodicNotes: PeriodicNoteInfo[] | undefined;
  if (isFull && indexBuilt) {
    const types = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
    periodicNotes = types.map(type => {
      const result = detectPeriodicNotes(index, type);
      return {
        type: result.type,
        detected: result.detected,
        folder: result.folder,
        pattern: result.pattern,
        today_path: result.today_path,
        today_exists: result.today_exists,
      };
    }).filter(p => p.detected);
  }

  // Include config info (full mode only)
  let configInfo: Record<string, unknown> | undefined;
  if (isFull) {
    const config = getConfig();
    configInfo = Object.keys(config).length > 0
      ? config as unknown as Record<string, unknown>
      : undefined;
  }

  // Get last rebuild event from StateDb
  let lastRebuild: HealthCheckOutput['last_rebuild'];
  if (stateDb) {
    try {
      const rebuildEvent = (lastBuild && lastManual)
        ? (lastBuild.timestamp >= lastManual.timestamp ? lastBuild : lastManual)
        : (lastBuild ?? lastManual);
      if (rebuildEvent) {
        lastRebuild = {
          trigger: rebuildEvent.trigger,
          timestamp: rebuildEvent.timestamp,
          duration_ms: rebuildEvent.duration_ms,
          ago_seconds: Math.floor((Date.now() - rebuildEvent.timestamp) / 1000),
        };
      }
    } catch {
      // Ignore errors reading index events
    }
  }

  // Get last pipeline run (most recent event with steps data — survives restarts)
  let lastPipeline: HealthCheckOutput['last_pipeline'];
  let recentPipelines: HealthCheckOutput['recent_pipelines'];
  if (stateDb) {
    try {
      const evt = getRecentPipelineEvent(stateDb);
      if (evt && evt.steps && evt.steps.length > 0) {
        const compact = compactPipelineRun(evt);
        if (isFull) {
          // Full mode: include compact step summaries
          lastPipeline = compact;
        } else {
          // Summary mode: metadata only, no steps array
          const { steps: _steps, ...metadataOnly } = compact;
          lastPipeline = metadataOnly;
        }
      }
    } catch {
      // Ignore errors reading pipeline data
    }

    // Recent pipeline events (last 5 with compact steps) — full mode only
    if (isFull) {
      try {
        const events = getRecentIndexEvents(stateDb, 10)
          .filter(e => e.steps && e.steps.length > 0)
          .slice(0, 5);
        if (events.length > 0) {
          recentPipelines = events.map(e => compactPipelineRun(e));
        }
      } catch {
        // Ignore errors reading recent pipeline data
      }
    }
  }

  const ftsState = getFTS5State();

  // Dead link scan — full mode only (iterates all outlinks)
  let deadLinkCount = 0;
  let topDeadLinkTargets: Array<{ target: string; mention_count: number }> = [];
  if (isFull && indexBuilt) {
    const deadTargetCounts = new Map<string, number>();
    for (const note of index.notes.values()) {
      for (const link of note.outlinks) {
        if (!resolveTarget(index, link.target)) {
          deadLinkCount++;
          const key = link.target.toLowerCase();
          deadTargetCounts.set(key, (deadTargetCounts.get(key) || 0) + 1);
        }
      }
    }
    topDeadLinkTargets = Array.from(deadTargetCounts.entries())
      .map(([target, mention_count]) => ({ target, mention_count }))
      .sort((a, b) => b.mention_count - a.mention_count)
      .slice(0, 5);
  }

  // Compute vault health score (0-100)
  let vault_health_score = 0;
  if (indexBuilt && noteCount > 0) {
    // Link density: avg outlinks per note, target 3+
    const avgOutlinks = linkCount / noteCount;
    const linkDensity = Math.min(1, avgOutlinks / 3);

    // Orphan ratio: notes with 0 backlinks (excluding periodic notes)
    let orphanCount = 0;
    for (const note of index.notes.values()) {
      const bl = index.backlinks.get(normalizeTarget(note.path));
      if (!bl || bl.length === 0) orphanCount++;
    }
    const orphanRatio = 1 - (orphanCount / noteCount);

    // Dead link ratio
    const totalLinks = linkCount > 0 ? linkCount : 1;
    const deadLinkRatio = 1 - (deadLinkCount / totalLinks);

    // Frontmatter coverage
    let notesWithFm = 0;
    for (const note of index.notes.values()) {
      if (Object.keys(note.frontmatter).length > 0) notesWithFm++;
    }
    const fmCoverage = notesWithFm / noteCount;

    // Freshness: notes modified in last 90 days
    const freshCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    let freshCount = 0;
    for (const note of index.notes.values()) {
      if (note.modified && note.modified.getTime() > freshCutoff) freshCount++;
    }
    const freshness = freshCount / noteCount;

    // Entity coverage: target 1 entity per 2 notes
    const entityCoverage = Math.min(1, entityCount / (noteCount * 0.5));

    // Weighted composite
    vault_health_score = Math.round(
      (linkDensity * 25 +
       orphanRatio * 20 +
       deadLinkRatio * 15 +
       fmCoverage * 15 +
       freshness * 15 +
       entityCoverage * 10)
    );
  }

  // Pipeline activity (always included — lightweight process-local read)
  const activity = getPipelineActivityState();
  const pipelineActivity = {
    busy: activity?.busy ?? false,
    current_step: activity?.current_step ?? null,
    started_at: activity?.started_at ?? null,
    progress: activity && activity.busy && activity.total_steps > 0
      ? `${activity.completed_steps}/${activity.total_steps} steps`
      : null,
    last_completed_ago_seconds: activity?.last_completed_at
      ? Math.floor((Date.now() - activity.last_completed_at) / 1000)
      : null,
  };

  const output: HealthCheckOutput = {
    status,
    vault_health_score,
    schema_version: SCHEMA_VERSION,
    vault_accessible: vaultAccessible,
    vault_path: vaultPath,
    index_state: indexState,
    index_progress: indexState === 'building' ? indexProgress : undefined,
    index_error: indexState === 'error' && indexErrorObj ? indexErrorObj.message : undefined,
    index_built: indexBuilt,
    index_age_seconds: indexAge,
    index_stale: indexStale,
    note_count: noteCount,
    entity_count: entityCount,
    tag_count: tagCount,
    link_count: linkCount,
    periodic_notes: periodicNotes && periodicNotes.length > 0 ? periodicNotes : undefined,
    config: configInfo,
    last_rebuild: lastRebuild,
    last_pipeline: lastPipeline,
    recent_pipelines: recentPipelines,
    fts5_ready: ftsState.ready,
    fts5_building: ftsState.building,
    embeddings_building: isEmbeddingsBuilding(),
    embeddings_ready: hasEmbeddingsIndex(),
    embeddings_count: getEmbeddingsCount(),
    // Persisted build telemetry (init_semantic background builds) — survives
    // a server restart so a crashed/failed build stays observable here.
    last_embedding_build: stateDb ? (getWriteState<Record<string, unknown>>(stateDb, 'last_embedding_build') ?? undefined) : undefined,
    embedding_model: hasEmbeddingsIndex() ? getActiveModelId() : undefined,
    embedding_diagnosis: isFull && hasEmbeddingsIndex() ? diagnoseEmbeddings(vaultPath) : undefined,
    tasks_ready: isTaskCacheReady(),
    tasks_building: isTaskCacheBuilding(),
    watcher_state: getWatcherStatus()?.state,
    boot_state: runtimeState.bootState,
    integrity_state: runtimeState.integrityState,
    integrity_check_in_progress: runtimeState.integrityCheckInProgress,
    integrity_started_at: runtimeState.integrityStartedAt,
    integrity_source: runtimeState.integritySource,
    integrity_last_checked_at: runtimeState.lastIntegrityCheckedAt,
    integrity_duration_ms: runtimeState.lastIntegrityDurationMs,
    integrity_detail: runtimeState.lastIntegrityDetail,
    watcher_pending: getWatcherStatus()?.pendingEvents,
    last_index_activity_at: lastIndexActivityAt,
    last_index_activity_ago_seconds: lastIndexActivityAt
      ? Math.floor((Date.now() - lastIndexActivityAt) / 1000) : undefined,
    last_full_rebuild_at: lastFullRebuildAt,
    last_watcher_batch_at: lastWatcherBatchAt,
    pipeline_activity: pipelineActivity,
    dead_link_count: isFull ? deadLinkCount : undefined,
    top_dead_link_targets: isFull ? topDeadLinkTargets : undefined,
    sweep: isFull ? (getSweepResults() ?? undefined) : undefined,
    proactive_linking: isFull && stateDb ? (() => {
      const config = getConfig();
      const enabled = config.proactive_linking !== false;
      const minScore = config.proactive_min_score ?? 20;
      const maxPerDay = config.proactive_max_per_day ?? 10;
      const queuePending = { cnt: countPendingProactiveSuggestions(stateDb) };
      const summary = getProactiveLinkingSummary(stateDb, 1);
      const oneLiner = getProactiveLinkingOneLiner(stateDb, 1);

      // Per-row pending breakdown: why each queued item hasn't applied yet.
      const pendingRows = listPendingProactiveSuggestions(stateDb, 25);

      const now = Date.now();
      const pendingBreakdown = pendingRows.map(r => {
        const reasons: string[] = [];
        if (r.score < minScore) reasons.push(`score ${r.score} < min ${minScore}`);
        if (r.confidence !== 'high') reasons.push(`confidence=${r.confidence} (need high)`);
        if (r.expires_at <= now) reasons.push('expired');
        return {
          note_path: r.note_path,
          entity: r.entity,
          score: r.score,
          confidence: r.confidence,
          age_hours: Math.round((now - r.queued_at) / 3_600_000 * 10) / 10,
          likely_reasons: reasons.length > 0 ? reasons : ['passes filters — likely active_edit, daily_cap, or apply_empty (see last_drain)'],
        };
      });

      const lastDrain = getWriteState<{
        at: number;
        total_applied: number;
        applied_files: number;
        expired: number;
        skipped_active: number;
        skipped_mtime: number;
        skipped_daily_cap: number;
        purged_missing?: number;
        skipped_stat_failed?: number;
        rejection_count: number;
        rejection_sample: Array<Record<string, unknown>>;
        rejection_breakdown?: Record<string, number>;
      }>(stateDb, 'last_proactive_drain');

      return {
        enabled,
        queue_pending: queuePending.cnt,
        min_score: minScore,
        max_per_day: maxPerDay,
        summary: oneLiner,
        total_applied_24h: summary.total_applied,
        survived_24h: summary.survived,
        removed_24h: summary.removed,
        files_24h: summary.files_touched,
        pending_breakdown: pendingBreakdown,
        last_drain: lastDrain ? {
          at: lastDrain.at,
          age_minutes: Math.round((now - lastDrain.at) / 60_000),
          total_applied: lastDrain.total_applied,
          applied_files: lastDrain.applied_files,
          expired: lastDrain.expired,
          skipped_active: lastDrain.skipped_active,
          skipped_mtime: lastDrain.skipped_mtime,
          skipped_daily_cap: lastDrain.skipped_daily_cap,
          purged_missing: lastDrain.purged_missing ?? 0,
          skipped_stat_failed: lastDrain.skipped_stat_failed ?? 0,
          rejection_count: lastDrain.rejection_count,
          rejection_breakdown: lastDrain.rejection_breakdown ?? {},
          rejection_sample: lastDrain.rejection_sample,
        } : null,
      };
    })() : undefined,
    recommendations,
  };

  return output;
}
