/**
 * Periodic Sweep — background graph hygiene scans
 *
 * Runs discovery scans on a timer and caches results for health_check to surface.
 * This keeps graph hygiene metrics fresh without requiring manual tool calls.
 *
 * Scans:
 * - Dead link targets ranked by frequency
 * - Unlinked mention counts for top entities
 * - Stub candidates (dead links worth creating notes for)
 *
 * Results are cached in module-level state and exposed via getSweepResults().
 * health_check reads these on every poll (every 3s from crank).
 */

import type { VaultIndex } from './types.js';
import { resolveTarget } from './graph.js';
import { countFTS5Mentions } from './fts5.js';

/** Default sweep interval: 5 minutes */
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Minimum interval between sweeps (prevent thrashing) */
const MIN_SWEEP_INTERVAL_MS = 30 * 1000;

export interface SweepResults {
  /** When the last sweep completed */
  last_sweep_at: number;
  /** How long the sweep took */
  sweep_duration_ms: number;
  /** Total dead wikilinks across the vault */
  dead_link_count: number;
  /** Top dead link targets ranked by reference frequency */
  top_dead_targets: Array<{
    target: string;
    wikilink_references: number;
    content_mentions: number;
  }>;
  /** Entities with the most unlinked plain-text mentions */
  top_unlinked_entities: Array<{
    entity: string;
    path: string;
    unlinked_mentions: number;
  }>;
}

let cachedResults: SweepResults | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let sweepRunning = false;

/**
 * Run a single sweep scan against the current vault index.
 */
export function runSweep(index: VaultIndex): SweepResults {
  const start = Date.now();

  // 1. Dead link scan — aggregate by target
  let deadLinkCount = 0;
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

  const topDeadTargets = Array.from(deadTargetCounts.entries())
    .filter(([, count]) => count >= 2)
    .map(([target, wikilink_references]) => ({
      target,
      wikilink_references,
      content_mentions: countFTS5Mentions(target),
    }))
    .sort((a, b) => b.wikilink_references - a.wikilink_references)
    .slice(0, 10);

  // 2. Unlinked mention scan — check top entities against FTS5
  const linkedCounts = new Map<string, number>();
  for (const note of index.notes.values()) {
    for (const link of note.outlinks) {
      const key = link.target.toLowerCase();
      linkedCounts.set(key, (linkedCounts.get(key) || 0) + 1);
    }
  }

  const seen = new Set<string>();
  const unlinkedEntities: Array<{ entity: string; path: string; unlinked_mentions: number }> = [];

  for (const [name, entityPath] of index.entities) {
    if (seen.has(entityPath)) continue;
    seen.add(entityPath);

    const totalMentions = countFTS5Mentions(name);
    if (totalMentions === 0) continue;

    const pathKey = entityPath.toLowerCase().replace(/\.md$/, '');
    const linked = Math.max(linkedCounts.get(name) || 0, linkedCounts.get(pathKey) || 0);
    const unlinked = Math.max(0, totalMentions - linked - 1);
    if (unlinked <= 0) continue;

    const note = index.notes.get(entityPath);
    const displayName = note?.title || name;

    unlinkedEntities.push({ entity: displayName, path: entityPath, unlinked_mentions: unlinked });
  }

  unlinkedEntities.sort((a, b) => b.unlinked_mentions - a.unlinked_mentions);

  const results: SweepResults = {
    last_sweep_at: Date.now(),
    sweep_duration_ms: Date.now() - start,
    dead_link_count: deadLinkCount,
    top_dead_targets: topDeadTargets,
    top_unlinked_entities: unlinkedEntities.slice(0, 10),
  };

  cachedResults = results;
  return results;
}

/**
 * Start the periodic sweep timer.
 * Runs an initial sweep immediately, then repeats on interval.
 */
export function startSweepTimer(
  getIndex: () => VaultIndex,
  intervalMs?: number,
): void {
  const interval = Math.max(intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS, MIN_SWEEP_INTERVAL_MS);

  // Run initial sweep after a short delay (let startup finish)
  setTimeout(() => {
    doSweep(getIndex);
  }, 5000);

  sweepTimer = setInterval(() => {
    doSweep(getIndex);
  }, interval);

  // Don't prevent process exit
  if (sweepTimer && typeof sweepTimer === 'object' && 'unref' in sweepTimer) {
    sweepTimer.unref();
  }
}

function doSweep(getIndex: () => VaultIndex): void {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const index = getIndex();
    if (index && index.notes && index.notes.size > 0) {
      runSweep(index);
    }
  } catch (err) {
    console.error('[Flywheel] Sweep error:', err);
  } finally {
    sweepRunning = false;
  }
}

/**
 * Stop the periodic sweep timer.
 */
export function stopSweepTimer(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/**
 * Get the most recent sweep results, or null if no sweep has run yet.
 */
export function getSweepResults(): SweepResults | null {
  return cachedResults;
}
