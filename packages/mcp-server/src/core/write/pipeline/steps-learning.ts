/**
 * Watcher pipeline steps — learning, prospects & proactive linking
 * (arch-review S9, moved verbatim from PipelineRunner methods in
 * core/read/watch/pipeline.ts; split out of the linking group to keep
 * each file under 500 LOC).
 *
 * Steps: drain_proactive_queue, prospect_scan, suggestion_scoring,
 * proactive_enqueue, tag_scan, retrieval_cooccurrence.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  findEntityMatches,
  getProtectedZones,
  rangeOverlapsProtectedZone,
  detectImplicitEntities,
  setWriteState,
} from '@velvetmonkey/vault-core';

import { serverLog } from '../../shared/serverLog.js';
import { suggestRelatedLinks, applyProactiveSuggestions } from '../wikilinks.js';
import { enqueueProactiveSuggestions, drainProactiveQueue, excludedFolderSet, isInExcludedFolder, type QueueEntry } from '../proactiveQueue.js';
import { mineRetrievalCooccurrence } from '../../shared/retrievalCooccurrence.js';
import { countFTS5Mentions } from '../../read/fts5.js';
import { recordProspectSightings, refreshProspectSummaries, cleanStaleProspects, type ProspectSighting } from '../../shared/prospects.js';
import { getStoredNoteTags, updateStoredNoteTags } from '../wikilinkFeedback.js';
import type { PipelineState } from './context.js';

// ── Step 0.5: Drain proactive queue ──────────────────────────────

export async function drainQueue(s: PipelineState): Promise<Record<string, unknown>> {
  const { p } = s;
  if (!p.sd || p.flywheelConfig?.proactive_linking === false) {
    return { skipped: true };
  }

  const result = await drainProactiveQueue(
    p.sd,
    p.vp,
    {
      minScore: p.flywheelConfig?.proactive_min_score ?? 20,
      maxPerFile: p.flywheelConfig?.proactive_max_per_file ?? 5,
      maxPerDay: p.flywheelConfig?.proactive_max_per_day ?? 10,
      excludeFolders: excludedFolderSet(p.flywheelConfig),
    },
    applyProactiveSuggestions,
  );

  const totalApplied = result.applied.reduce((s, r) => s + r.entities.length, 0);
  if (totalApplied > 0) {
    serverLog('watcher', `Proactive drain: applied ${totalApplied} links in ${result.applied.length} files`);
  }
  const byReason: Record<string, number> = {};
  for (const r of result.rejections) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  if (result.rejections.length > 0) {
    const summary = Object.entries(byReason).map(([k, v]) => `${k}=${v}`).join(' ');
    serverLog('watcher', `Proactive drain rejections: ${result.rejections.length} (${summary})`);
  }

  // Persist last-drain snapshot for doctor diagnostics. Cap rejection sample
  // to avoid bloat — diagnostic surface, not durable audit log.
  try {
    setWriteState(p.sd, 'last_proactive_drain', {
      at: Date.now(),
      total_applied: totalApplied,
      applied_files: result.applied.length,
      expired: result.expired,
      skipped_active: result.skippedActiveEdit,
      skipped_mtime: result.skippedMtimeGuard,
      skipped_daily_cap: result.skippedDailyCap,
      purged_missing: result.purgedMissing,
      skipped_stat_failed: result.skippedStatFailed,
      rejection_count: result.rejections.length,
      rejection_sample: result.rejections.slice(0, 25),
      rejection_breakdown: byReason,
    });
  } catch { /* non-critical */ }

  return {
    applied: result.applied,
    total_applied: totalApplied,
    expired: result.expired,
    skipped_active: result.skippedActiveEdit,
    skipped_mtime: result.skippedMtimeGuard,
    skipped_daily_cap: result.skippedDailyCap,
    purged_missing: result.purgedMissing,
    skipped_stat_failed: result.skippedStatFailed,
    rejections: result.rejections.length,
  };
}

// ── Step 11: Prospect scan ────────────────────────────────────────

export async function prospectScan(s: PipelineState): Promise<Record<string, unknown>> {
  const { p } = s;
  const vaultIndex = p.getVaultIndex();
  const events = s.normalEvents();
  if (events.length === 0 && s.lightIndexPaths.size > 0) {
    return { skipped: true, reason: 'light-index files only', skipped_light_index: s.lightIndexPaths.size };
  }
  const prospectResults: Array<{
    file: string;
    implicit: string[];
    deadLinkMatches: string[];
  }> = [];

  for (const event of events) {
    if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
    try {
      const content = await fs.readFile(path.join(p.vp, event.path), 'utf-8');
      const zones = getProtectedZones(content);
      const linkedSet = new Set(
        (s.forwardLinkResults.find(r => r.file === event.path)?.resolved ?? [])
          .concat(s.forwardLinkResults.find(r => r.file === event.path)?.dead ?? [])
          .map(n => n.toLowerCase())
      );
      const knownEntitySet = new Set(s.entitiesAfter.map(e => e.nameLower));

      const implicitMatches = detectImplicitEntities(content);
      const implicitNames = implicitMatches
        .filter(imp => !linkedSet.has(imp.text.toLowerCase()) && !knownEntitySet.has(imp.text.toLowerCase()))
        .map(imp => imp.text);

      const deadLinkMatches: string[] = [];
      for (const [key, links] of vaultIndex.backlinks) {
        if (links.length < 2 || vaultIndex.entities.has(key) || linkedSet.has(key)) continue;
        const matches = findEntityMatches(content, key, true);
        if (matches.some(m => !rangeOverlapsProtectedZone(m.start, m.end, zones))) {
          deadLinkMatches.push(key);
        }
      }

      if (implicitNames.length > 0 || deadLinkMatches.length > 0) {
        prospectResults.push({ file: event.path, implicit: implicitNames, deadLinkMatches });
      }
    } catch { /* ignore */ }
  }

  if (prospectResults.length > 0) {
    const implicitCount = prospectResults.reduce((s, p) => s + p.implicit.length, 0);
    const deadCount = prospectResults.reduce((s, p) => s + p.deadLinkMatches.length, 0);
    serverLog('watcher', `Prospect scan: ${implicitCount} implicit entities, ${deadCount} dead link matches across ${prospectResults.length} files`);

    // Persist prospect sightings to ledger
    const sightings: ProspectSighting[] = [];
    for (const result of prospectResults) {
      for (const name of result.implicit) {
        sightings.push({
          term: name.toLowerCase(),
          displayName: name,
          notePath: result.file,
          source: 'implicit',
          confidence: 'low',
        });
      }
      for (const target of result.deadLinkMatches) {
        const backlinkCount = vaultIndex.backlinks.get(target)?.length ?? 0;
        const ftsCount = countFTS5Mentions(target);
        const isHighScore = backlinkCount >= 3 && ftsCount >= 3;
        sightings.push({
          term: target.toLowerCase(),
          displayName: target,
          notePath: result.file,
          source: isHighScore ? 'high_score' : 'dead_link',
          confidence: backlinkCount >= 3 ? 'high' : 'medium',
          backlinkCount,
          score: isHighScore ? ftsCount : 0,
        });
      }
    }
    if (sightings.length > 0) {
      recordProspectSightings(sightings);
      const affectedTerms = [...new Set(sightings.map(s => s.term))];
      refreshProspectSummaries(affectedTerms);
    }
    cleanStaleProspects();
  }
  return { prospects: prospectResults };
}

// ── Step 12: Suggestion scoring ───────────────────────────────────

export async function suggestionScoring(s: PipelineState): Promise<void> {
  const { p, tracker } = s;
  tracker.start('suggestion_scoring', { files: p.events.length });
  const events = s.normalEvents();
  if (events.length === 0 && s.lightIndexPaths.size > 0) {
    tracker.skipCurrent('light-index files only', { skipped_light_index: s.lightIndexPaths.size });
    return;
  }

  for (const event of events) {
    if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
    try {
      const rawContent = await fs.readFile(path.join(p.vp, event.path), 'utf-8');
      const content = rawContent.replace(/ → \[\[.*$/gm, '');
      const result = await suggestRelatedLinks(content, {
        maxSuggestions: 5,
        notePath: event.path,
        detail: true,
      });
      if (result.detailed && result.detailed.length > 0) {
        s.suggestionResults.push({
          file: event.path,
          top: result.detailed.slice(0, 5).map(s => ({
            entity: s.entity,
            score: s.totalScore,
            confidence: s.confidence,
          })),
        });
      }
    } catch { /* ignore */ }
  }

  tracker.end({ scored_files: s.suggestionResults.length, suggestions: s.suggestionResults });
  if (s.suggestionResults.length > 0) {
    serverLog('watcher', `Suggestion scoring: ${s.suggestionResults.length} files scored`);
  }
}

// ── Step 12.5: Proactive enqueue ───────────────────────────────────

export async function proactiveLinking(s: PipelineState): Promise<void> {
  const { p, tracker } = s;
  if (p.flywheelConfig?.proactive_linking === false || s.suggestionResults.length === 0) return;
  if (!p.sd) return;

  tracker.start('proactive_enqueue', { files: s.suggestionResults.length });
  try {
    const minScore = p.flywheelConfig?.proactive_min_score ?? 20;
    const maxPerFile = p.flywheelConfig?.proactive_max_per_file ?? 5;
    const proactiveExcluded = excludedFolderSet(p.flywheelConfig);
    const entries: QueueEntry[] = [];

    for (const { file, top } of s.suggestionResults) {
      // Engine-owned folders get links at write time; the watcher must
      // never write into them (re-render⇄proactive churn loop).
      if (isInExcludedFolder(file, proactiveExcluded)) continue;
      const candidates = top
        .filter(s => s.score >= minScore && s.confidence === 'high')
        .slice(0, maxPerFile);

      for (const c of candidates) {
        entries.push({ notePath: file, entity: c.entity, score: c.score, confidence: c.confidence });
      }
    }

    const enqueued = enqueueProactiveSuggestions(p.sd, entries);
    tracker.end({ enqueued, total_candidates: entries.length });
    if (enqueued > 0) {
      serverLog('watcher', `Proactive enqueue: ${enqueued} suggestions queued for deferred application`);
    }
  } catch (e) {
    tracker.end({ error: String(e) });
    serverLog('watcher', `Proactive enqueue failed: ${e}`, 'error');
  }
}

// ── Step 13: Tag scan ─────────────────────────────────────────────

export async function tagScan(s: PipelineState): Promise<Record<string, unknown>> {
  const { p } = s;
  const vaultIndex = p.getVaultIndex();
  const tagDiffs: Array<{ file: string; added: string[]; removed: string[] }> = [];

  if (p.sd) {
    const noteTagsForward = new Map<string, Set<string>>();
    for (const [tag, paths] of vaultIndex.tags) {
      for (const notePath of paths) {
        if (!noteTagsForward.has(notePath)) noteTagsForward.set(notePath, new Set());
        noteTagsForward.get(notePath)!.add(tag);
      }
    }

    for (const event of p.events) {
      if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
      const currentSet = noteTagsForward.get(event.path) ?? new Set<string>();
      const previousSet = getStoredNoteTags(p.sd, event.path);
      if (previousSet.size === 0 && currentSet.size > 0) {
        updateStoredNoteTags(p.sd, event.path, currentSet);
        continue;
      }
      const added = [...currentSet].filter(t => !previousSet.has(t));
      const removed = [...previousSet].filter(t => !currentSet.has(t));
      if (added.length > 0 || removed.length > 0) {
        tagDiffs.push({ file: event.path, added, removed });
      }
      updateStoredNoteTags(p.sd, event.path, currentSet);
    }

    for (const event of p.events) {
      if (event.type === 'delete') {
        const previousSet = getStoredNoteTags(p.sd, event.path);
        if (previousSet.size > 0) {
          tagDiffs.push({ file: event.path, added: [], removed: [...previousSet] });
          updateStoredNoteTags(p.sd, event.path, new Set());
        }
      }
    }
  }

  const totalTagsAdded = tagDiffs.reduce((s, d) => s + d.added.length, 0);
  const totalTagsRemoved = tagDiffs.reduce((s, d) => s + d.removed.length, 0);
  if (tagDiffs.length > 0) {
    serverLog('watcher', `Tag scan: ${totalTagsAdded} added, ${totalTagsRemoved} removed across ${tagDiffs.length} files`);
  }
  return { total_added: totalTagsAdded, total_removed: totalTagsRemoved, tag_diffs: tagDiffs };
}

// ── Step 19: Retrieval co-occurrence ──────────────────────────────

export async function retrievalCooccurrence(s: PipelineState): Promise<Record<string, unknown>> {
  const { p } = s;
  if (!p.sd) return { skipped: 'no sd' };
  const inserted = mineRetrievalCooccurrence(p.sd);
  if (inserted > 0) {
    serverLog('watcher', `Retrieval co-occurrence: ${inserted} new pairs`);
  }
  return { pairs_inserted: inserted };
}
