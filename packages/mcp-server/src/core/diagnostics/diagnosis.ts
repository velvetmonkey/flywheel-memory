/**
 * Named-check diagnosis engine (arch-review S7) — doctor(action: diagnosis),
 * moved verbatim from tools/read/health.ts: 10 checks over schema, vault
 * access, index freshness, embeddings, FTS5, watcher, task cache,
 * suppression health, pipeline, and the proactive queue.
 */

import * as fs from 'fs';
import type { VaultIndex } from '../read/types.js';
import { getIndexState, getIndexProgress, getIndexError } from '../read/graph.js';
import { SCHEMA_VERSION, getWriteState, type StateDb } from '@velvetmonkey/vault-core';
import { getRecentPipelineEvent, getLastSuccessfulEvent, type PipelineStep } from '../shared/indexActivity.js';
import type { WatcherStatus } from '../read/watch/types.js';
import { getFTS5State } from '../read/fts5.js';
import { hasEmbeddingsIndex, isEmbeddingsBuilding, getEmbeddingsCount, getActiveModelId, getEntityEmbeddingsCount } from '../read/embeddings.js';
import { isTaskCacheReady, isTaskCacheBuilding } from '../read/taskCache.js';
import { getProactiveLinkingSummary } from '../shared/proactiveLinkingStats.js';
import { getSuppressedCount, getEntityStats } from '../write/wikilinkFeedback.js';
import { STALE_THRESHOLD_SECONDS } from './report.js';
import { countPendingProactiveSuggestions, countEntityRows } from './healthQueries.js';

export interface DiagnosisDeps {
  getIndex: () => VaultIndex;
  getVaultPath: () => string;
  getStateDb: () => StateDb | null;
  getWatcherStatus: () => WatcherStatus | null;
}

export interface DiagnosisOutput {
  status: 'healthy' | 'needs_attention' | 'unhealthy';
  summary: string;
  checks: Array<{ name: string; status: 'ok' | 'warning' | 'error'; detail: string; fix?: string }>;
  fixes: Array<{ check: string; fix?: string }>;
}

export function runDiagnosis(deps: DiagnosisDeps): DiagnosisOutput {
  const { getIndex, getVaultPath, getStateDb, getWatcherStatus } = deps;
  // Named checks array — port of old flywheel_doctor(report: diagnosis) default behaviour
  const checks: Array<{
    name: string;
    status: 'ok' | 'warning' | 'error';
    detail: string;
    fix?: string;
  }> = [];

  const diagIndex = getIndex();
  const diagVaultPath = getVaultPath();
  const diagStateDb = getStateDb();
  const diagWatcherStatus = getWatcherStatus();

  // 1. Schema version
  checks.push({ name: 'schema_version', status: 'ok', detail: `Schema version ${SCHEMA_VERSION}` });

  // 2. Vault accessibility
  try {
    fs.accessSync(diagVaultPath, fs.constants.R_OK | fs.constants.W_OK);
    checks.push({ name: 'vault_access', status: 'ok', detail: `Vault readable and writable at ${diagVaultPath}` });
  } catch {
    checks.push({ name: 'vault_access', status: 'error', detail: `Vault not accessible at ${diagVaultPath}`, fix: 'Check PROJECT_PATH environment variable and directory permissions' });
  }

  // 3. Index activity freshness
  const diagIndexState = getIndexState();
  const diagIndexBuilt = diagIndexState === 'ready' && diagIndex?.notes !== undefined;
  if (diagIndexState === 'ready' && diagIndexBuilt) {
    let activityAge: number | null = null;
    if (diagStateDb) {
      try {
        const lastEvt = getLastSuccessfulEvent(diagStateDb);
        if (lastEvt) activityAge = Math.floor((Date.now() - lastEvt.timestamp) / 1000);
      } catch { /* ignore */ }
    }
    const age = activityAge ?? Math.floor((Date.now() - diagIndex.builtAt.getTime()) / 1000);
    if (age > STALE_THRESHOLD_SECONDS) {
      checks.push({ name: 'index_activity', status: 'warning', detail: `Last index activity ${Math.floor(age / 60)} minutes ago`, fix: 'Run refresh_index to rebuild' });
    } else {
      checks.push({ name: 'index_activity', status: 'ok', detail: `Last activity ${age}s ago, ${diagIndex.notes.size} notes, ${diagIndex.entities.size} entities` });
    }
  } else if (diagIndexState === 'building') {
    const progress = getIndexProgress();
    checks.push({ name: 'index_activity', status: 'warning', detail: `Index building (${progress.parsed}/${progress.total} files)` });
  } else {
    const err = getIndexError();
    checks.push({ name: 'index_activity', status: 'error', detail: `Index in ${diagIndexState} state${err ? ': ' + err.message : ''}`, fix: 'Run refresh_index' });
  }

  // 4. Embedding coverage
  const embReady = hasEmbeddingsIndex();
  const embCount = getEmbeddingsCount();
  const diagNoteCount = diagIndexBuilt ? diagIndex.notes.size : 0;
  if (embReady && diagNoteCount > 0) {
    const coverage = Math.round((embCount / diagNoteCount) * 100);
    if (coverage < 50) {
      checks.push({ name: 'embedding_coverage', status: 'warning', detail: `${embCount}/${diagNoteCount} notes embedded (${coverage}%)`, fix: 'Run init_semantic with force=true to rebuild' });
    } else {
      checks.push({ name: 'embedding_coverage', status: 'ok', detail: `${embCount}/${diagNoteCount} notes embedded (${coverage}%), model: ${getActiveModelId() || 'default'}` });
    }
    // Entity embeddings
    const entityEmbCount = getEntityEmbeddingsCount();
    const diagEntityCount = diagStateDb ? countEntityRows(diagStateDb) : 0;
    if (diagEntityCount > 0) {
      const entityCoverage = Math.round((entityEmbCount / diagEntityCount) * 100);
      checks.push({ name: 'entity_embedding_coverage', status: entityCoverage < 50 ? 'warning' : 'ok', detail: `${entityEmbCount}/${diagEntityCount} canonical entities embedded (${entityCoverage}%)` });
    }
  } else if (!embReady) {
    checks.push({ name: 'embedding_coverage', status: 'warning', detail: 'Semantic embeddings not built', fix: 'Run init_semantic to enable hybrid search' });
  } else if (isEmbeddingsBuilding()) {
    checks.push({ name: 'embedding_coverage', status: 'warning', detail: 'Embedding build in progress' });
  }

  // 5. FTS5 state
  const fts = getFTS5State();
  if (fts.ready) {
    checks.push({ name: 'fts5', status: 'ok', detail: `FTS5 ready, ${fts.noteCount ?? 0} notes indexed` });
  } else if (fts.building) {
    checks.push({ name: 'fts5', status: 'warning', detail: 'FTS5 index building' });
  } else {
    checks.push({ name: 'fts5', status: 'error', detail: 'FTS5 not available', fix: 'Will build automatically on next index rebuild' });
  }

  // 6. Watcher state
  if (diagWatcherStatus) {
    if (diagWatcherStatus.state === 'ready') {
      checks.push({ name: 'watcher', status: 'ok', detail: `Watcher running, ${diagWatcherStatus.pendingEvents ?? 0} pending events` });
    } else if (diagWatcherStatus.state === 'error') {
      checks.push({ name: 'watcher', status: 'error', detail: 'Watcher in error state', fix: 'Restart the MCP server' });
    } else {
      checks.push({ name: 'watcher', status: 'warning', detail: `Watcher state: ${diagWatcherStatus.state}${diagWatcherStatus.pendingEvents ? `, ${diagWatcherStatus.pendingEvents} pending` : ''}` });
    }
  }

  // 7. Task cache
  if (isTaskCacheReady()) {
    checks.push({ name: 'task_cache', status: 'ok', detail: 'Task cache ready' });
  } else if (isTaskCacheBuilding()) {
    checks.push({ name: 'task_cache', status: 'warning', detail: 'Task cache building' });
  } else {
    checks.push({ name: 'task_cache', status: 'warning', detail: 'Task cache not ready' });
  }

  // 8. Suppression health
  if (diagStateDb) {
    try {
      const suppressedCount = getSuppressedCount(diagStateDb);
      const stats = getEntityStats(diagStateDb);
      const diagEntityCount2 = diagIndexBuilt ? diagIndex.entities.size : 0;
      if (diagEntityCount2 > 0 && suppressedCount > diagEntityCount2 * 0.2) {
        checks.push({ name: 'suppression_health', status: 'warning', detail: `${suppressedCount} entities suppressed (${Math.round(suppressedCount / diagEntityCount2 * 100)}% of total)`, fix: 'Review suppressed entities — high suppression rate may indicate overly aggressive feedback' });
      } else {
        checks.push({ name: 'suppression_health', status: 'ok', detail: `${suppressedCount} entities suppressed, ${stats.length} entities with feedback` });
      }
    } catch {
      checks.push({ name: 'suppression_health', status: 'ok', detail: 'No suppression data yet' });
    }
  }

  // 9. Pipeline health
  if (diagStateDb) {
    try {
      const evt = getRecentPipelineEvent(diagStateDb);
      if (evt) {
        const ageMin = Math.round((Date.now() - evt.timestamp) / 60000);
        const failedSteps = evt.steps?.filter((s: PipelineStep) => s.skipped && s.skip_reason?.includes('error')) || [];
        if (failedSteps.length > 0) {
          checks.push({ name: 'pipeline', status: 'warning', detail: `Last pipeline ${ageMin}min ago (${evt.duration_ms}ms), ${failedSteps.length} failed steps: ${failedSteps.map((s: PipelineStep) => s.name).join(', ')}` });
        } else {
          checks.push({ name: 'pipeline', status: 'ok', detail: `Last pipeline ${ageMin}min ago, ${evt.duration_ms}ms, ${evt.steps?.length ?? 0} steps` });
        }
      }
    } catch {
      checks.push({ name: 'pipeline', status: 'ok', detail: 'No pipeline data' });
    }
  }

  // 10. Proactive queue stall detection
  if (diagStateDb) {
    try {
      const queuePending = { cnt: countPendingProactiveSuggestions(diagStateDb) };
      const proactiveSummary = getProactiveLinkingSummary(diagStateDb, 1);
      const lastDrain = getWriteState<{
        rejection_count: number;
        rejection_breakdown?: Record<string, number>;
      }>(diagStateDb, 'last_proactive_drain');

      if (queuePending.cnt > 0 && proactiveSummary.total_applied === 0) {
        const top = Object.entries(lastDrain?.rejection_breakdown ?? {})
          .sort(([, a], [, b]) => b - a)
          .slice(0, 2)
          .map(([reason, count]) => `${reason} (${count})`)
          .join(', ');
        checks.push({
          name: 'proactive_queue',
          status: 'warning',
          detail: `${queuePending.cnt} pending, 0 applied in 24h. Top rejections: ${top || 'unknown'}`,
          fix: 'Lower proactive_min_score or inspect via doctor(action: pipeline)',
        });
      } else {
        checks.push({
          name: 'proactive_queue',
          status: 'ok',
          detail: `${queuePending.cnt} pending, ${proactiveSummary.total_applied} applied in 24h`,
        });
      }
    } catch { /* skip */ }
  }

  const errorCount = checks.filter(c => c.status === 'error').length;
  const warningCount = checks.filter(c => c.status === 'warning').length;
  const overallStatus = errorCount > 0 ? 'unhealthy' : warningCount > 0 ? 'needs_attention' : 'healthy';

  const diagOutput = {
    status: overallStatus,
    summary: `${checks.length} checks: ${checks.length - errorCount - warningCount} ok, ${warningCount} warnings, ${errorCount} errors`,
    checks,
    fixes: checks.filter(c => c.fix).map(c => ({ check: c.name, fix: c.fix })),
  };

  return diagOutput as DiagnosisOutput;
}
