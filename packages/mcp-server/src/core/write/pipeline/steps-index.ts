/**
 * Watcher pipeline steps — indexing & caches (arch-review S9, moved verbatim
 * from PipelineRunner methods in core/read/watch/pipeline.ts).
 *
 * Steps: index_rebuild, fts5_incremental, note_moves, entity_scan, hub_scores,
 * recency, cooccurrence, edge_weights, note_embeddings, entity_embeddings,
 * index_cache, task_cache.
 *
 * Critical steps throw on failure; non-critical ones are wrapped by the
 * runStep() helper in runner.ts. Data flows between steps via PipelineState.
 */

import * as path from 'node:path';
import { getAllEntitiesFromDb } from '@velvetmonkey/vault-core';

import { processBatch } from '../../read/watch/batchProcessor.js';
import { serverLog } from '../../shared/serverLog.js';
import { computeEntityDiff, type StepRunResult } from '../../shared/indexActivity.js';
import { exportHubScores } from '../../shared/hubExport.js';
import { buildRecencyIndex, loadRecencyFromStateDb, saveRecencyToStateDb } from '../../shared/recency.js';
import { mineCooccurrences, saveCooccurrenceToStateDb } from '../../shared/cooccurrence.js';
import { setCooccurrenceIndex } from '../wikilinks.js';
import { purgeProactiveForDeleted } from '../proactiveQueue.js';
import { updateFTS5Incremental } from '../../read/fts5.js';
import {
  updateEmbedding,
  removeEmbedding,
  hasEmbeddingsIndex,
  updateEntityEmbedding,
  hasEntityEmbeddingsIndex,
  removeOrphanedNoteEmbeddings,
  removeOrphanedEntityEmbeddings,
} from '../../read/embeddings.js';
import { updateTaskCacheForFile, removeTaskCacheForFile } from '../../read/taskCache.js';
import { saveVaultIndexToCache } from '../../read/graph.js';
import { recomputeEdgeWeights } from '../edgeWeights.js';
import type { PipelineState } from './context.js';

// ── Step 1: Index rebuild (critical) ──────────────────────────────

export async function indexRebuild(s: PipelineState): Promise<void> {
  const { p, tracker } = s;
  const vaultIndex = p.getVaultIndex();

  tracker.start('index_rebuild', { files_changed: p.events.length, changed_paths: p.changedPaths });
  if (!vaultIndex) {
    const rebuilt = await p.buildVaultIndex(p.vp);
    p.updateVaultIndex(rebuilt);
    s.hasEntityRelevantChanges = true; // full rebuild — entity state unknown
    serverLog('watcher', `Index rebuilt (full): ${rebuilt.notes.size} notes, ${rebuilt.entities.size} entities`);
  } else {
    // Pass events with relative paths directly — batchProcessor handles joining with vaultPath
    const relativeBatch = {
      ...p.batch,
      events: p.events,
    };
    const batchResult = await processBatch(vaultIndex, p.vp, relativeBatch, {
      onError: (filePath, error) => {
        serverLog('watcher', `File processing error: ${filePath}: ${error.message}`, 'error');
      },
    });
    s.hasEntityRelevantChanges = batchResult.hasEntityRelevantChanges;
    // Update builtAt so freshness checks reflect the incremental update
    vaultIndex.builtAt = new Date();
    serverLog('watcher', `Incremental: ${batchResult.successful}/${batchResult.total} files in ${batchResult.durationMs}ms`);
  }
  p.updateIndexState('ready');
  const idx = p.getVaultIndex();
  tracker.end({ note_count: idx.notes.size, entity_count: idx.entities.size, tag_count: idx.tags.size });
}

// ── Step 1.1: FTS5 incremental update ──────────────────────────────

export function fts5Incremental(s: PipelineState): void {
  const { p, tracker } = s;
  const changed = p.events.filter(e => e.type === 'upsert').map(e => e.path);
  const deleted = [
    ...p.events.filter(e => e.type === 'delete').map(e => e.path),
    ...p.renames.map(r => r.oldPath),
  ];
  if (changed.length === 0 && deleted.length === 0) {
    tracker.start('fts5_incremental', {});
    tracker.skip('fts5_incremental', 'no changes');
    return;
  }
  tracker.start('fts5_incremental', { changed: changed.length, deleted: deleted.length });
  const result = updateFTS5Incremental(p.vp, changed, deleted);
  tracker.end(result);
  if (result.updated > 0 || result.removed > 0) {
    serverLog('watcher', `FTS5: ${result.updated} updated, ${result.removed} removed`);
  }
  // Purge pending proactive-link queue entries for deleted notes so they
  // never become ENOENT ghosts re-checked on every drain.
  if (deleted.length > 0 && p.sd) {
    try {
      const purged = purgeProactiveForDeleted(p.sd, deleted);
      if (purged > 0) {
        serverLog('watcher', `Proactive queue: purged ${purged} entries for ${deleted.length} deleted note(s)`);
      }
    } catch (e) {
      serverLog('watcher', `Proactive queue purge failed: ${e}`, 'error');
    }
  }
}

// ── Step 1.5: Note moves ──────────────────────────────────────────

export function noteMoves(s: PipelineState): void {
  const { p, tracker } = s;
  tracker.start('note_moves', { count: p.renames.length });
  tracker.end({
    renames: p.renames.map(r => ({ oldPath: r.oldPath, newPath: r.newPath })),
  });
  if (p.renames.length > 0) {
    serverLog('watcher', `Note moves: ${p.renames.length} rename(s) recorded`);
  }
}

// ── Step 2: Entity scan (critical) ────────────────────────────────

export async function entityScan(s: PipelineState): Promise<void> {
  const { p, tracker } = s;
  const vaultIndex = p.getVaultIndex();

  // Capture hub scores BEFORE entity scan resets them
  if (p.sd) {
    const rows = p.sd.db.prepare('SELECT name, hub_score FROM entities').all() as Array<{ name: string; hub_score: number }>;
    for (const r of rows) s.hubBefore.set(r.name, r.hub_score);
  }

  // Throttle: full entity scan is expensive (recursive directory walk).
  // Skip if scanned within 5 minutes; downstream steps still get entities from DB.
  const entityScanAgeMs = p.ctx.lastEntityScanAt > 0
    ? Date.now() - p.ctx.lastEntityScanAt : Infinity;
  if (entityScanAgeMs < 5 * 60 * 1000 && !s.hasEntityRelevantChanges) {
    tracker.start('entity_scan', {});
    tracker.skip('entity_scan', `cache valid (${Math.round(entityScanAgeMs / 1000)}s old)`);
    s.entitiesBefore = p.sd ? getAllEntitiesFromDb(p.sd) : [];
    s.entitiesAfter = s.entitiesBefore;
    p.deferredScheduler?.schedule('entity_scan', 5 * 60 * 1000 - entityScanAgeMs);
    serverLog('watcher', `Entity scan: throttled (${Math.round(entityScanAgeMs / 1000)}s old)`);
    return;
  }

  s.entitiesBefore = p.sd ? getAllEntitiesFromDb(p.sd) : [];
  tracker.start('entity_scan', { note_count: vaultIndex.notes.size });
  await p.updateEntitiesInStateDb(p.vp, p.sd);
  p.ctx.lastEntityScanAt = Date.now();
  s.entitiesAfter = p.sd ? getAllEntitiesFromDb(p.sd) : [];
  const entityDiff = computeEntityDiff(s.entitiesBefore, s.entitiesAfter);

  // Detect category/description changes and record in entity_changes audit log
  // Uses INSERT OR IGNORE + ms-precision timestamps to avoid UNIQUE constraint crashes
  const categoryChanges: Array<{ entity: string; from: string; to: string }> = [];
  const descriptionChanges: Array<{ entity: string; from: string | null; to: string | null }> = [];
  if (p.sd) {
    const beforeMap = new Map(s.entitiesBefore.map(e => [e.name, e]));
    const insertChange = p.sd.db.prepare(
      'INSERT OR IGNORE INTO entity_changes (entity, field, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?)'
    );
    try {
      const now = new Date().toISOString();
      for (const after of s.entitiesAfter) {
        const before = beforeMap.get(after.name);
        if (before && before.category !== after.category) {
          insertChange.run(after.name, 'category', before.category, after.category, now);
          categoryChanges.push({ entity: after.name, from: before.category, to: after.category });
        }
        if (before) {
          const oldDesc = before.description ?? null;
          const newDesc = after.description ?? null;
          if (oldDesc !== newDesc) {
            insertChange.run(after.name, 'description', oldDesc, newDesc, now);
            descriptionChanges.push({ entity: after.name, from: oldDesc, to: newDesc });
          }
        }
      }
    } catch (e) {
      serverLog('watcher', `entity_changes audit failed: ${e}`, 'error');
    }
  }

  tracker.end({ entity_count: s.entitiesAfter.length, ...entityDiff, category_changes: categoryChanges, description_changes: descriptionChanges });
  serverLog('watcher', `Entity scan: ${s.entitiesAfter.length} entities`);
}

// ── Step 3: Hub scores ────────────────────────────────────────────

export async function hubScores(s: PipelineState): Promise<Record<string, unknown>> {
  const { p } = s;

  // Throttle: hub score computation iterates all notes + power iteration.
  // Skip if computed within 5 minutes.
  const hubAgeMs = p.ctx.lastHubScoreRebuildAt > 0
    ? Date.now() - p.ctx.lastHubScoreRebuildAt : Infinity;
  if (hubAgeMs < 5 * 60 * 1000) {
    p.deferredScheduler?.schedule('hub_scores', 5 * 60 * 1000 - hubAgeMs);
    serverLog('watcher', `Hub scores: throttled (${Math.round(hubAgeMs / 1000)}s old)`);
    return { skipped: true, age_ms: hubAgeMs };
  }

  const vaultIndex = p.getVaultIndex();
  const hubUpdated = await exportHubScores(vaultIndex, p.sd);
  const hubDiffs: Array<{ entity: string; before: number; after: number }> = [];
  if (p.sd) {
    const rows = p.sd.db.prepare('SELECT name, hub_score FROM entities').all() as Array<{ name: string; hub_score: number }>;
    for (const r of rows) {
      const prev = s.hubBefore.get(r.name) ?? 0;
      if (prev !== r.hub_score) hubDiffs.push({ entity: r.name, before: prev, after: r.hub_score });
    }
  }
  p.ctx.lastHubScoreRebuildAt = Date.now();
  serverLog('watcher', `Hub scores: ${hubUpdated ?? 0} updated`);
  return { updated: hubUpdated ?? 0, diffs: hubDiffs.slice(0, 10) };
}

// ── Step 3.5: Recency ─────────────────────────────────────────────

export async function recency(s: PipelineState): Promise<Record<string, unknown>> {
  const { p } = s;
  const cachedRecency = loadRecencyFromStateDb(p.sd ?? undefined);
  const cacheAgeMs = cachedRecency ? Date.now() - (cachedRecency.lastUpdated ?? 0) : Infinity;
  if (cacheAgeMs >= 60 * 60 * 1000) {
    const entities = s.entitiesAfter.map(e => ({ name: e.name, path: e.path, aliases: e.aliases }));
    const recencyIndex = await buildRecencyIndex(p.vp, entities);
    saveRecencyToStateDb(recencyIndex, p.sd ?? undefined);
    serverLog('watcher', `Recency: rebuilt ${recencyIndex.lastMentioned.size} entities`);
    return { rebuilt: true, entities: recencyIndex.lastMentioned.size };
  }
  p.deferredScheduler?.schedule('recency', 60 * 60 * 1000 - cacheAgeMs);
  serverLog('watcher', `Recency: cache valid (${Math.round(cacheAgeMs / 1000)}s old)`);
  return { rebuilt: false, cached_age_ms: cacheAgeMs };
}

// ── Step 3.6: Co-occurrence ───────────────────────────────────────

export async function cooccurrence(s: PipelineState): Promise<Record<string, unknown>> {
  const { p } = s;
  const cooccurrenceAgeMs = p.ctx.lastCooccurrenceRebuildAt > 0
    ? Date.now() - p.ctx.lastCooccurrenceRebuildAt
    : Infinity;
  if (cooccurrenceAgeMs >= 60 * 60 * 1000) {
    const entityNames = s.entitiesAfter.map(e => e.name);
    const cooccurrenceIdx = await mineCooccurrences(p.vp, entityNames);
    setCooccurrenceIndex(cooccurrenceIdx);
    p.ctx.lastCooccurrenceRebuildAt = Date.now();
    p.ctx.cooccurrenceIndex = cooccurrenceIdx;
    if (p.sd) {
      saveCooccurrenceToStateDb(p.sd, cooccurrenceIdx);
    }
    serverLog('watcher', `Co-occurrence: rebuilt ${cooccurrenceIdx._metadata.total_associations} associations`);
    return { rebuilt: true, associations: cooccurrenceIdx._metadata.total_associations };
  }
  p.deferredScheduler?.schedule('cooccurrence', 60 * 60 * 1000 - cooccurrenceAgeMs);
  serverLog('watcher', `Co-occurrence: cache valid (${Math.round(cooccurrenceAgeMs / 1000)}s old)`);
  return { rebuilt: false, age_ms: cooccurrenceAgeMs };
}

// ── Step 3.7: Edge weights ────────────────────────────────────────

export async function edgeWeights(s: PipelineState): Promise<Record<string, unknown>> {
  const { p } = s;
  if (!p.sd) return { skipped: true };
  const edgeWeightAgeMs = p.ctx.lastEdgeWeightRebuildAt > 0
    ? Date.now() - p.ctx.lastEdgeWeightRebuildAt
    : Infinity;
  if (edgeWeightAgeMs >= 60 * 60 * 1000) {
    const result = recomputeEdgeWeights(p.sd);
    p.ctx.lastEdgeWeightRebuildAt = Date.now();
    serverLog('watcher', `Edge weights: ${result.edges_updated} edges in ${result.duration_ms}ms`);
    return {
      rebuilt: true,
      edges: result.edges_updated,
      duration_ms: result.duration_ms,
      total_weighted: result.total_weighted,
      avg_weight: result.avg_weight,
      strong_count: result.strong_count,
      top_changes: result.top_changes,
    };
  }
  p.deferredScheduler?.schedule('edge_weights', 60 * 60 * 1000 - edgeWeightAgeMs);
  serverLog('watcher', `Edge weights: cache valid (${Math.round(edgeWeightAgeMs / 1000)}s old)`);
  return { rebuilt: false, age_ms: edgeWeightAgeMs };
}

// ── Step 4: Note embeddings ───────────────────────────────────────

export async function noteEmbeddings(s: PipelineState): Promise<StepRunResult> {
  const { p } = s;
  const events = s.normalEvents();
  if (events.length === 0 && s.lightIndexPaths.size > 0) {
    return { kind: 'skipped', reason: 'light-index files only', output: { skipped_light_index: s.lightIndexPaths.size } };
  }
  if (!hasEmbeddingsIndex()) {
    return { kind: 'skipped', reason: 'not built' };
  }
  let embUpdated = 0;
  let embRemoved = 0;
  for (const event of events) {
    try {
      if (event.type === 'delete') {
        removeEmbedding(event.path);
        embRemoved++;
      } else if (event.path.endsWith('.md')) {
        const absPath = path.join(p.vp, event.path);
        await updateEmbedding(event.path, absPath);
        embUpdated++;
      }
    } catch {
      // Don't let per-event embedding errors affect watcher
    }
  }
  let orphansRemoved = 0;
  try {
    // Pass the live vault index paths as the authoritative truth source —
    // never trust notes_fts for the destructive delete (a failed FTS rebuild
    // once left it empty and orphan cleanup wiped every embedding).
    orphansRemoved = removeOrphanedNoteEmbeddings(new Set(p.getVaultIndex().notes.keys()));
  } catch (e) {
    serverLog('watcher', `Note embedding orphan cleanup failed: ${e}`, 'error');
  }
  serverLog('watcher', `Note embeddings: ${embUpdated} updated, ${embRemoved} removed, ${orphansRemoved} orphans cleaned`);
  return { kind: 'done', output: { updated: embUpdated, removed: embRemoved, orphans_removed: orphansRemoved, skipped_light_index: s.lightIndexPaths.size } };
}

// ── Step 5: Entity embeddings ─────────────────────────────────────

export async function entityEmbeddings(s: PipelineState): Promise<StepRunResult> {
  const { p } = s;
  let entEmbUpdated = 0;
  let entEmbOrphansRemoved = 0;
  const entEmbNames: string[] = [];
  const events = s.normalEvents();
  if (events.length === 0 && s.lightIndexPaths.size > 0) {
    return { kind: 'skipped', reason: 'light-index files only', output: { skipped_light_index: s.lightIndexPaths.size } };
  }
  if (!hasEntityEmbeddingsIndex() || !p.sd) {
    return { kind: 'skipped', reason: !p.sd ? 'no sd' : 'not built' };
  }
  try {
    const allEntities = getAllEntitiesFromDb(p.sd);
    for (const event of events) {
      if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
      const matching = allEntities.filter(e => e.path === event.path);
      for (const entity of matching) {
        await updateEntityEmbedding(entity.name, {
          name: entity.name,
          path: entity.path,
          category: entity.category,
          aliases: entity.aliases,
        }, p.vp);
        entEmbUpdated++;
        entEmbNames.push(entity.name);
      }
    }
    // Clean up embeddings for entities no longer in the database
    const currentNames = new Set(allEntities.map(e => e.name));
    entEmbOrphansRemoved = removeOrphanedEntityEmbeddings(currentNames);
  } catch (e) {
    serverLog('watcher', `Entity embedding update/orphan cleanup failed: ${e}`, 'error');
  }
  serverLog('watcher', `Entity embeddings: ${entEmbUpdated} updated, ${entEmbOrphansRemoved} orphans cleaned`);
  return { kind: 'done', output: { updated: entEmbUpdated, updated_entities: entEmbNames.slice(0, 10), orphans_removed: entEmbOrphansRemoved } };
}

// ── Step 6: Index cache ───────────────────────────────────────────

export async function indexCache(s: PipelineState): Promise<void> {
  const { p, tracker } = s;
  const vaultIndex = p.getVaultIndex();
  if (p.sd) {
    // Throttle: full index serialization to SQLite is expensive for large vaults.
    // Skip if saved within 30 seconds.
    const cacheAgeMs = p.ctx.lastIndexCacheSaveAt > 0
      ? Date.now() - p.ctx.lastIndexCacheSaveAt : Infinity;
    if (cacheAgeMs < 30 * 1000) {
      tracker.start('index_cache', {});
      tracker.skip('index_cache', `saved recently (${Math.round(cacheAgeMs / 1000)}s ago)`);
      return;
    }
    tracker.start('index_cache', { note_count: vaultIndex.notes.size });
    try {
      saveVaultIndexToCache(p.sd, vaultIndex);
      p.ctx.lastIndexCacheSaveAt = Date.now();
      tracker.end({ saved: true });
      serverLog('watcher', 'Index cache saved');
    } catch (err) {
      tracker.end({ saved: false, error: err instanceof Error ? err.message : String(err) });
      serverLog('index', `Failed to update index cache: ${err instanceof Error ? err.message : err}`, 'error');
    }
  } else {
    tracker.skip('index_cache', 'no sd');
  }
}

// ── Step 7: Task cache ────────────────────────────────────────────

export async function taskCache(s: PipelineState): Promise<void> {
  const { p, tracker } = s;
  tracker.start('task_cache', { files: p.events.length });
  let taskUpdated = 0;
  let taskRemoved = 0;
  for (const event of p.events) {
    try {
      if (event.type === 'delete') {
        removeTaskCacheForFile(event.path);
        taskRemoved++;
      } else if (event.path.endsWith('.md')) {
        await updateTaskCacheForFile(p.vp, event.path);
        taskUpdated++;
      }
    } catch {
      // Don't let task cache errors affect watcher
    }
  }
  tracker.end({ updated: taskUpdated, removed: taskRemoved });
  serverLog('watcher', `Task cache: ${taskUpdated} updated, ${taskRemoved} removed`);
}
