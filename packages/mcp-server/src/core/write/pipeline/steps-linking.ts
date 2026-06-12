/**
 * Watcher pipeline steps — linking & implicit feedback (arch-review S9,
 * moved verbatim from PipelineRunner methods in core/read/watch/pipeline.ts).
 *
 * Steps: forward_links, wikilink_check, implicit_feedback,
 * incremental_recency, corrections.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  findEntityMatches,
  getProtectedZones,
  rangeOverlapsProtectedZone,
  recordEntityMention,
} from '@velvetmonkey/vault-core';

import { serverLog } from '../../shared/serverLog.js';
import { getForwardLinksForNote } from '../../read/graph.js';
import {
  updateSuppressionList,
  getTrackedApplications,
  processImplicitFeedback,
  getStoredNoteLinks,
  updateStoredNoteLinks,
  diffNoteLinks,
  recordFeedback,
  recordImplicitRemoved,
  isSuppressed,
  getAllSuppressionPenalties,
  trackWikilinkApplications,
} from '../wikilinkFeedback.js';
import { processPendingCorrections } from '../corrections.js';
import { excludedFolderSet, isInExcludedFolder } from '../proactiveQueue.js';
import type { PipelineState } from './context.js';

// ── Step 8: Forward links ─────────────────────────────────────────

export async function forwardLinks(s: PipelineState): Promise<Record<string, unknown>> {
  const { p } = s;
  const vaultIndex = p.getVaultIndex();
  let totalResolved = 0;
  let totalDead = 0;

  for (const event of p.events) {
    if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
    try {
      const links = getForwardLinksForNote(vaultIndex, event.path);
      const resolved: string[] = [];
      const dead: string[] = [];
      const seen = new Set<string>();
      for (const link of links) {
        const name = link.target;
        if (seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        if (link.exists) resolved.push(name);
        else dead.push(name);
      }
      if (resolved.length > 0 || dead.length > 0) {
        s.forwardLinkResults.push({ file: event.path, resolved, dead });
      }
      totalResolved += resolved.length;
      totalDead += dead.length;
    } catch { /* ignore */ }
  }

  // Diff against stored links to detect additions/removals
  if (p.sd) {
    const upsertHistory = p.sd.db.prepare(`
      INSERT INTO note_link_history (note_path, target) VALUES (?, ?)
      ON CONFLICT(note_path, target) DO UPDATE SET edits_survived = edits_survived + 1
    `);
    const checkThreshold = p.sd.db.prepare(`
      SELECT target FROM note_link_history
      WHERE note_path = ? AND target = ? AND edits_survived >= 3 AND last_positive_at IS NULL
    `);
    const markPositive = p.sd.db.prepare(`
      UPDATE note_link_history SET last_positive_at = datetime('now') WHERE note_path = ? AND target = ?
    `);
    const getEdgeCount = p.sd.db.prepare(
      'SELECT edits_survived FROM note_link_history WHERE note_path=? AND target=?'
    );

    for (const entry of s.forwardLinkResults) {
      const currentSet = new Set([
        ...entry.resolved.map(n => n.toLowerCase()),
        ...entry.dead.map(n => n.toLowerCase()),
      ]);
      const previousSet = getStoredNoteLinks(p.sd, entry.file);
      if (previousSet.size === 0) {
        updateStoredNoteLinks(p.sd, entry.file, currentSet);
        continue;
      }
      const diff = diffNoteLinks(previousSet, currentSet);
      if (diff.added.length > 0 || diff.removed.length > 0) {
        s.linkDiffs.push({ file: entry.file, ...diff });
      }
      updateStoredNoteLinks(p.sd, entry.file, currentSet);

      if (diff.removed.length === 0) continue;
      for (const link of currentSet) {
        if (!previousSet.has(link)) continue;
        upsertHistory.run(entry.file, link);
        const countRow = getEdgeCount.get(entry.file, link) as { edits_survived: number } | undefined;
        if (countRow) {
          s.survivedLinks.push({ entity: link, file: entry.file, count: countRow.edits_survived });
        }
        const hit = checkThreshold.get(entry.file, link) as { target: string } | undefined;
        if (hit) {
          const entity = s.entitiesAfter.find(
            e => e.nameLower === link ||
                 (e.aliases ?? []).some((a: string) => a.toLowerCase() === link)
          );
          if (entity) {
            recordFeedback(p.sd, entity.name, 'implicit:kept', entry.file, true, 0.8);
            markPositive.run(entry.file, link);
          }
        }
      }
    }

    // Handle deleted files
    for (const event of p.events) {
      if (event.type === 'delete') {
        const previousSet = getStoredNoteLinks(p.sd, event.path);
        if (previousSet.size > 0) {
          s.linkDiffs.push({ file: event.path, added: [], removed: [...previousSet] });
          updateStoredNoteLinks(p.sd, event.path, new Set());
        }
      }
    }

    // Handle upserts where all wikilinks were removed
    const processedFiles = new Set(s.forwardLinkResults.map(r => r.file));
    for (const event of p.events) {
      if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
      if (processedFiles.has(event.path)) continue;
      const previousSet = getStoredNoteLinks(p.sd, event.path);
      if (previousSet.size > 0) {
        s.linkDiffs.push({ file: event.path, added: [], removed: [...previousSet] });
        updateStoredNoteLinks(p.sd, event.path, new Set());
      }
    }
  }

  // Highlight new dead links
  const newDeadLinks: Array<{ file: string; targets: string[] }> = [];
  const vaultIdx = p.getVaultIndex();
  for (const diff of s.linkDiffs) {
    const newDead = diff.added.filter(target => !vaultIdx.entities.has(target.toLowerCase()));
    if (newDead.length > 0) {
      newDeadLinks.push({ file: diff.file, targets: newDead });
    }
  }

  serverLog('watcher', `Forward links: ${totalResolved} resolved, ${totalDead} dead${newDeadLinks.length > 0 ? `, ${newDeadLinks.reduce((s, d) => s + d.targets.length, 0)} new dead` : ''}`);
  return {
    total_resolved: totalResolved,
    total_dead: totalDead,
    links: s.forwardLinkResults,
    link_diffs: s.linkDiffs,
    survived: s.survivedLinks,
    new_dead_links: newDeadLinks,
  };
}

// ── Step 9: Wikilink check ────────────────────────────────────────

export async function wikilinkCheck(s: PipelineState): Promise<void> {
  const { p, tracker } = s;
  const vaultIndex = p.getVaultIndex();
  tracker.start('wikilink_check', { files: p.events.length });
  const trackedLinks: Array<{ file: string; entities: string[] }> = [];
  const events = s.normalEvents();
  if (events.length === 0 && s.lightIndexPaths.size > 0) {
    tracker.skipCurrent('light-index files only', { skipped_light_index: s.lightIndexPaths.size });
    return;
  }

  if (p.sd) {
    for (const event of events) {
      if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
      try {
        const apps = getTrackedApplications(p.sd, event.path);
        if (apps.length > 0) trackedLinks.push({ file: event.path, entities: apps });
      } catch { /* ignore */ }
    }
  }

  // Include manual wikilink additions from forward_links diff
  for (const diff of s.linkDiffs) {
    if (diff.added.length === 0) continue;
    const existing = trackedLinks.find(t => t.file === diff.file);
    if (existing) {
      const set = new Set(existing.entities.map(e => e.toLowerCase()));
      for (const a of diff.added) {
        if (!set.has(a)) {
          existing.entities.push(a);
          set.add(a);
        }
      }
    } else {
      trackedLinks.push({ file: diff.file, entities: diff.added });
    }
  }

  // Detect unwikified entity mentions in changed files
  const mentionResults: Array<{ file: string; entities: string[] }> = [];
  for (const event of events) {
    if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
    try {
      const content = await fs.readFile(path.join(p.vp, event.path), 'utf-8');
      const zones = getProtectedZones(content);
      const linked = new Set(
        (s.forwardLinkResults.find(r => r.file === event.path)?.resolved ?? [])
          .map(n => n.toLowerCase())
      );
      const mentions: string[] = [];
      for (const entity of s.entitiesAfter) {
        if (linked.has(entity.nameLower)) continue;
        if (p.sd && isSuppressed(p.sd, entity.name)) continue;
        const matches = findEntityMatches(content, entity.name, true);
        const valid = matches.some(m => !rangeOverlapsProtectedZone(m.start, m.end, zones));
        if (valid) {
          mentions.push(entity.name);
          continue;
        }
        for (const alias of (entity.aliases ?? [])) {
          const aliasMatches = findEntityMatches(content, alias, true);
          if (aliasMatches.some(m => !rangeOverlapsProtectedZone(m.start, m.end, zones))) {
            mentions.push(entity.name);
            break;
          }
        }
      }
      if (mentions.length > 0) {
        mentionResults.push({ file: event.path, entities: mentions });
      }
    } catch { /* ignore */ }
  }

  tracker.end({ tracked: trackedLinks, mentions: mentionResults });
  serverLog('watcher', `Wikilink check: ${trackedLinks.reduce((s, t) => s + t.entities.length, 0)} tracked links in ${trackedLinks.length} files, ${mentionResults.reduce((s, m) => s + m.entities.length, 0)} unwikified mentions`);
}

// ── Step 10: Implicit feedback ────────────────────────────────────

export async function implicitFeedback(s: PipelineState): Promise<void> {
  const { p, tracker } = s;
  tracker.start('implicit_feedback', { files: p.events.length });
  const events = s.normalEvents();
  if (events.length === 0 && s.lightIndexPaths.size > 0) {
    tracker.skipCurrent('light-index files only', { skipped_light_index: s.lightIndexPaths.size });
    return;
  }

  const deletedFiles = new Set(
    p.events.filter(e => e.type === 'delete').map(e => e.path)
  );
  const preSuppressed = p.sd ? new Set(getAllSuppressionPenalties(p.sd).keys()) : new Set<string>();
  const feedbackResults: Array<{ entity: string; file: string }> = [];

  const feedbackExcluded = excludedFolderSet(p.flywheelConfig);
  if (p.sd) {
    for (const event of events) {
      if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
      // Engine-rendered folders: full re-renders legitimately drop links;
      // counting those as implicit-removed would churn-suppress entities.
      if (isInExcludedFolder(event.path, feedbackExcluded)) continue;
      try {
        const content = await fs.readFile(path.join(p.vp, event.path), 'utf-8');
        const removed = processImplicitFeedback(p.sd, event.path, content);
        for (const entity of removed) feedbackResults.push({ entity, file: event.path });
      } catch { /* ignore */ }
    }
  }

  // Manual wikilink removals via forward_links diff
  if (p.sd && s.linkDiffs.length > 0) {
    for (const diff of s.linkDiffs) {
      if (deletedFiles.has(diff.file)) continue;
      if (isInExcludedFolder(diff.file, feedbackExcluded)) continue;
      for (const target of diff.removed) {
        if (feedbackResults.some(r => r.entity === target && r.file === diff.file)) continue;
        const entity = s.entitiesAfter.find(
          e => e.nameLower === target ||
            (e.aliases ?? []).some((a: string) => a.toLowerCase() === target)
        );
        if (entity) {
          // Cooldown-guarded (24h per entity+note) so single-note link churn
          // doesn't cast repeated false-positive votes. Keeps confidence 1.0.
          recordImplicitRemoved(p.sd, entity.name, diff.file, 1.0);
          feedbackResults.push({ entity: entity.name, file: diff.file });
        }
      }
    }
  }

  // Manual wikilink additions via forward_links diff
  const additionResults: Array<{ entity: string; file: string }> = [];
  if (p.sd && s.linkDiffs.length > 0) {
    const checkApplication = p.sd.db.prepare(
      `SELECT 1 FROM wikilink_applications WHERE LOWER(entity) = LOWER(?) AND note_path = ? AND status = 'applied'`
    );
    for (const diff of s.linkDiffs) {
      if (deletedFiles.has(diff.file)) continue;
      const newlyTracked: Array<{ entity: string; matchedTerm?: string }> = [];
      for (const target of diff.added) {
        if (checkApplication.get(target, diff.file)) continue;
        const entity = s.entitiesAfter.find(
          e => e.nameLower === target ||
            (e.aliases ?? []).some((a: string) => a.toLowerCase() === target)
        );
        if (entity) {
          recordFeedback(p.sd, entity.name, 'implicit:manual_added', diff.file, true);
          additionResults.push({ entity: entity.name, file: diff.file });
          newlyTracked.push({
            entity: entity.name,
            matchedTerm: entity.nameLower === target ? undefined : target,
          });
        }
      }
      // Track applications so removal detection works on subsequent edits
      if (newlyTracked.length > 0) {
        trackWikilinkApplications(p.sd, diff.file, newlyTracked, 'manual_detected');
      }
    }
  }

  // Detect newly suppressed entities
  const newlySuppressed: string[] = [];
  if (p.sd) {
    const postSuppressed = getAllSuppressionPenalties(p.sd);
    for (const entity of postSuppressed.keys()) {
      if (!preSuppressed.has(entity)) {
        newlySuppressed.push(entity);
      }
    }
  }

  tracker.end({ removals: feedbackResults, additions: additionResults, newly_suppressed: newlySuppressed });
  if (feedbackResults.length > 0 || additionResults.length > 0) {
    serverLog('watcher', `Implicit feedback: ${feedbackResults.length} removals, ${additionResults.length} manual additions detected`);
  }
  if (newlySuppressed.length > 0) {
    serverLog('watcher', `Suppression: ${newlySuppressed.length} entities newly suppressed: ${newlySuppressed.join(', ')}`);
  }
}

// ── Step 10.1: Incremental recency ──────────────────────────────

export async function incrementalRecency(s: PipelineState): Promise<Record<string, unknown>> {
  const { p } = s;
  if (!p.sd) return { skipped: true };

  let updated = 0;
  const now = new Date();
  for (const entry of s.forwardLinkResults) {
    for (const target of entry.resolved) {
      recordEntityMention(p.sd, target, now);
      updated++;
    }
  }
  return { entities_updated: updated };
}

// ── Step 10.5: Corrections ────────────────────────────────────────

export async function corrections(s: PipelineState): Promise<Record<string, unknown>> {
  const { p } = s;
  if (!p.sd) return { skipped: true };
  const corrProcessed = processPendingCorrections(p.sd);
  if (corrProcessed > 0) {
    updateSuppressionList(p.sd);
    serverLog('watcher', `Corrections: ${corrProcessed} processed`);
  }
  return { processed: corrProcessed };
}
