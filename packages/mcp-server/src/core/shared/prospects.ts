/**
 * Prospect Ledger — Persistent Pre-Entity Memory
 *
 * Accumulates evidence about terms that aren't yet full entities
 * (no backing note) but keep appearing across sessions. Three
 * persisted source classes feed the ledger:
 *
 * - **implicit** — Pattern-detected terms (proper nouns, CamelCase, etc.). score = 0.
 * - **dead_link** — Unresolved backlink targets with backlink_count >= 2. score = 0.
 * - **high_score** — Dead-link prospect with backlink_count >= 3 AND FTS mentions >= 3.
 *                     score = countFTS5Mentions(term).
 *
 * The ledger stores day-grain sightings (one row per term + note_path + seen_day)
 * and materializes a summary per term for fast scoring. A 60-day half-life decay
 * ensures stale prospects fade naturally. Promotion scoring drives both wikilink
 * suggestion boosting (Layer 14) and stub-candidate surfacing.
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import { getActiveScopeOrNull } from '../../vault-scope.js';

// =============================================================================
// Constants
// =============================================================================

/** 60-day half-life for prospect decay */
export const PROSPECT_DECAY_HALF_LIFE_DAYS = 60;
const PROSPECT_DECAY_LAMBDA = Math.LN2 / PROSPECT_DECAY_HALF_LIFE_DAYS;

/** Age cutoff for stale cleanup (210 days — decay < 0.01) */
const STALE_AGE_MS = 210 * 24 * 60 * 60 * 1000;

/** Default promotion threshold (effective score after decay) */
export const PROMOTION_THRESHOLD = 50;

/** Source precedence: higher = stronger signal */
const SOURCE_PRECEDENCE: Record<string, number> = {
  implicit: 0,
  dead_link: 1,
  high_score: 2,
};

/** Source multipliers for promotion score */
const SOURCE_MULTIPLIER: Record<string, number> = {
  implicit: 1.0,
  dead_link: 1.2,
  high_score: 1.3,
};

/** Confidence precedence */
const CONFIDENCE_PRECEDENCE: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/** Cooldown for stale cleanup (1 hour) */
const CLEANUP_COOLDOWN_MS = 60 * 60 * 1000;
let lastCleanupAt = 0;

// =============================================================================
// Module-level StateDb (follows recency.ts pattern)
// =============================================================================

let moduleStateDb: StateDb | null = null;

function getStateDb(): StateDb | null {
  return getActiveScopeOrNull()?.stateDb ?? moduleStateDb;
}

/**
 * Set the StateDb instance for this module.
 * Called during MCP server initialization / activateVault().
 */
export function setProspectStateDb(stateDb: StateDb | null): void {
  moduleStateDb = stateDb;
}

// =============================================================================
// Types
// =============================================================================

export type ProspectSource = 'implicit' | 'dead_link' | 'high_score';

export interface ProspectSighting {
  term: string;           // lowercased
  displayName: string;    // original casing
  notePath: string;       // vault-relative
  source: ProspectSource;
  pattern?: string;       // implicit pattern type
  confidence: 'high' | 'medium' | 'low';
  backlinkCount?: number;
  score?: number;         // detector-specific: implicit=0, dead_link=0, high_score=FTS count
}

export interface ProspectCandidate {
  term: string;
  displayName: string;
  promotionScore: number;     // raw un-decayed
  effectiveScore: number;     // after decay
  promotionReady: boolean;    // effectiveScore >= PROMOTION_THRESHOLD
  noteCount: number;
  dayCount: number;
  backlinkMax: number;
  cooccurringEntities: string[];
  bestSource: string;
  bestConfidence: string;
  bestScore: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

interface ProspectSummaryRow {
  term: string;
  display_name: string;
  note_count: number;
  day_count: number;
  total_sightings: number;
  backlink_max: number;
  cooccurring_entities: string | null;
  best_source: string;
  best_confidence: string;
  best_score: number;
  first_seen_at: number;
  last_seen_at: number;
  promotion_score: number;
  promoted_at: number | null;
  updated_at: number;
}

// =============================================================================
// Decay
// =============================================================================

/**
 * Compute exponential decay weight for a prospect based on last seen time.
 * Returns 1.0 for just-seen, 0.5 at 60 days, ~0.01 at 7 months.
 */
export function computeProspectDecay(lastSeenAt: number, now?: number): number {
  const ref = now ?? Date.now();
  const ageDays = (ref - lastSeenAt) / (24 * 60 * 60 * 1000);
  if (ageDays < 0) return 1.0;
  return Math.exp(-PROSPECT_DECAY_LAMBDA * ageDays);
}

// =============================================================================
// Recording Sightings
// =============================================================================

/**
 * Get today's date as ISO string (YYYY-MM-DD).
 */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Batch-record prospect sightings in a transaction.
 * Same-day repeats for the same term+note_path upsert: keep earliest display_name,
 * advance last_seen_at, increment sighting_count, take MAX backlink_count,
 * upgrade source/confidence by precedence.
 */
export function recordProspectSightings(sightings: ProspectSighting[]): void {
  const stateDb = getStateDb();
  if (!stateDb || sightings.length === 0) return;

  const now = Date.now();
  const day = todayISO();

  const upsert = stateDb.db.prepare(`
    INSERT INTO prospect_ledger (term, display_name, note_path, seen_day, source, pattern, confidence, backlink_count, score, first_seen_at, last_seen_at, sighting_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(term, note_path, seen_day) DO UPDATE SET
      last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
      sighting_count = sighting_count + 1,
      backlink_count = MAX(backlink_count, excluded.backlink_count),
      score = MAX(score, excluded.score),
      source = CASE
        WHEN (CASE excluded.source WHEN 'high_score' THEN 2 WHEN 'dead_link' THEN 1 ELSE 0 END)
           > (CASE source WHEN 'high_score' THEN 2 WHEN 'dead_link' THEN 1 ELSE 0 END)
        THEN excluded.source
        ELSE source
      END,
      confidence = CASE
        WHEN (CASE excluded.confidence WHEN 'high' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END)
           > (CASE confidence WHEN 'high' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END)
        THEN excluded.confidence
        ELSE confidence
      END
  `);

  const runBatch = stateDb.db.transaction(() => {
    for (const s of sightings) {
      upsert.run(
        s.term.toLowerCase(),
        s.displayName,
        s.notePath,
        day,
        s.source,
        s.pattern ?? null,
        s.confidence,
        s.backlinkCount ?? 0,
        s.score ?? 0,
        now,
        now,
      );
    }
  });

  runBatch();
}

// =============================================================================
// Summary Refresh
// =============================================================================

/**
 * Refresh prospect summaries for the given terms.
 * Aggregates from prospect_ledger into prospect_summary.
 */
export function refreshProspectSummaries(terms: string[]): void {
  const stateDb = getStateDb();
  if (!stateDb || terms.length === 0) return;

  const now = Date.now();

  // Aggregate query for a single term
  const aggregate = stateDb.db.prepare(`
    SELECT
      term,
      MIN(display_name) AS display_name,
      COUNT(DISTINCT note_path) AS note_count,
      COUNT(*) AS day_count,
      SUM(sighting_count) AS total_sightings,
      MAX(backlink_count) AS backlink_max,
      MAX(score) AS best_score,
      MIN(first_seen_at) AS first_seen_at,
      MAX(last_seen_at) AS last_seen_at
    FROM prospect_ledger
    WHERE term = ?
    GROUP BY term
  `);

  // Best source (highest precedence)
  const bestSource = stateDb.db.prepare(`
    SELECT source FROM prospect_ledger
    WHERE term = ?
    ORDER BY
      CASE source WHEN 'high_score' THEN 2 WHEN 'dead_link' THEN 1 ELSE 0 END DESC
    LIMIT 1
  `);

  // Best confidence (highest precedence)
  const bestConfidence = stateDb.db.prepare(`
    SELECT confidence FROM prospect_ledger
    WHERE term = ?
    ORDER BY
      CASE confidence WHEN 'high' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END DESC
    LIMIT 1
  `);

  // Co-occurring entities from note_links
  const cooccurring = stateDb.db.prepare(`
    SELECT DISTINCT nl.target
    FROM prospect_ledger pl
    JOIN note_links nl ON pl.note_path = nl.note_path
    WHERE pl.term = ? AND LOWER(nl.target) != ?
    LIMIT 10
  `);

  // Check if entity exists (for promoted_at)
  const entityExists = stateDb.db.prepare(`
    SELECT 1 FROM entities
    WHERE name_lower = ?
    UNION
    SELECT 1 FROM entities
    WHERE EXISTS (
      SELECT 1 FROM json_each(aliases_json) WHERE LOWER(value) = ?
    )
    LIMIT 1
  `);

  // Upsert summary
  const upsertSummary = stateDb.db.prepare(`
    INSERT INTO prospect_summary (term, display_name, note_count, day_count, total_sightings, backlink_max, cooccurring_entities, best_source, best_confidence, best_score, first_seen_at, last_seen_at, promotion_score, promoted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(term) DO UPDATE SET
      display_name = excluded.display_name,
      note_count = excluded.note_count,
      day_count = excluded.day_count,
      total_sightings = excluded.total_sightings,
      backlink_max = excluded.backlink_max,
      cooccurring_entities = excluded.cooccurring_entities,
      best_source = excluded.best_source,
      best_confidence = excluded.best_confidence,
      best_score = excluded.best_score,
      first_seen_at = excluded.first_seen_at,
      last_seen_at = excluded.last_seen_at,
      promotion_score = excluded.promotion_score,
      promoted_at = excluded.promoted_at,
      updated_at = excluded.updated_at
  `);

  const runRefresh = stateDb.db.transaction(() => {
    for (const rawTerm of terms) {
      const term = rawTerm.toLowerCase();

      const agg = aggregate.get(term) as {
        term: string;
        display_name: string;
        note_count: number;
        day_count: number;
        total_sightings: number;
        backlink_max: number;
        best_score: number;
        first_seen_at: number;
        last_seen_at: number;
      } | undefined;

      if (!agg) continue;

      const srcRow = bestSource.get(term) as { source: string } | undefined;
      const confRow = bestConfidence.get(term) as { confidence: string } | undefined;
      const coocRows = cooccurring.all(term, term) as Array<{ target: string }>;
      const coocEntities = coocRows.map(r => r.target);

      // Check entity existence for promoted_at
      const exists = entityExists.get(term, term);
      const promotedAt = exists ? now : null;

      const promoScore = computePromotionScore({
        noteCount: agg.note_count,
        dayCount: agg.day_count,
        backlinkMax: agg.backlink_max,
        cooccurringCount: coocEntities.length,
        bestScore: agg.best_score,
        bestSource: srcRow?.source ?? 'implicit',
      });

      upsertSummary.run(
        term,
        agg.display_name,
        agg.note_count,
        agg.day_count,
        agg.total_sightings,
        agg.backlink_max,
        coocEntities.length > 0 ? JSON.stringify(coocEntities) : null,
        srcRow?.source ?? 'implicit',
        confRow?.confidence ?? 'low',
        agg.best_score,
        agg.first_seen_at,
        agg.last_seen_at,
        promoScore,
        promotedAt,
        now,
      );
    }
  });

  runRefresh();
}

// =============================================================================
// Promotion Score
// =============================================================================

interface PromotionInput {
  noteCount: number;
  dayCount: number;
  backlinkMax: number;
  cooccurringCount: number;
  bestScore: number;
  bestSource: string;
}

/**
 * Compute raw promotion score (un-decayed).
 *
 * Formula:
 *   raw = (noteSpread*3 + daySpread*2 + backlinkSig*2 + cooccurSig*1 + sourceScoreSig*0.5) * sourceMultiplier
 *
 * Each component normalized to [0, 10].
 */
export function computePromotionScore(input: PromotionInput): number {
  const noteSpread = Math.min(input.noteCount, 10);
  const daySpread = Math.min(input.dayCount, 10);
  const backlinkSig = Math.min(input.backlinkMax, 10);
  const cooccurSig = Math.min(input.cooccurringCount, 10);
  const sourceScoreSig = Math.min(input.bestScore, 10);

  const multiplier = SOURCE_MULTIPLIER[input.bestSource] ?? 1.0;

  const raw = (
    noteSpread * 3 +
    daySpread * 2 +
    backlinkSig * 2 +
    cooccurSig * 1 +
    sourceScoreSig * 0.5
  ) * multiplier;

  return Math.round(raw * 10) / 10;
}

// =============================================================================
// Prospect Boost Map (for scoring pipeline)
// =============================================================================

/**
 * Build a Map of prospect term -> boost value [0, 6] for the scoring pipeline.
 * Entity existence is checked via DB query to exclude promoted prospects from
 * candidate surfacing, but promoted terms still receive boost for decay-through.
 */
export function getProspectBoostMap(): Map<string, number> {
  const stateDb = getStateDb();
  if (!stateDb) return new Map();

  try {
    const rows = stateDb.db.prepare(`
      SELECT term, promotion_score, last_seen_at
      FROM prospect_summary
      WHERE promotion_score > 0
    `).all() as Array<Pick<ProspectSummaryRow, 'term' | 'promotion_score' | 'last_seen_at'>>;

    const now = Date.now();
    const map = new Map<string, number>();

    for (const row of rows) {
      const effective = row.promotion_score * computeProspectDecay(row.last_seen_at, now);
      if (effective > 5) {
        const boost = Math.min(6, effective / 10);
        map.set(row.term, Math.round(boost * 10) / 10);
      }
    }

    return map;
  } catch {
    return new Map();
  }
}

// =============================================================================
// Promotion Candidates (for discover_stub_candidates)
// =============================================================================

/**
 * Return all scored prospects sorted by effective score descending.
 * Excludes terms that currently exist as entities (checked via DB lookup
 * against entities.name_lower + json_each(aliases_json)).
 * Each candidate includes promotion_ready annotation.
 */
export function getPromotionCandidates(limit = 50): ProspectCandidate[] {
  const stateDb = getStateDb();
  if (!stateDb) return [];

  try {
    const rows = stateDb.db.prepare(`
      SELECT ps.*
      FROM prospect_summary ps
      WHERE ps.promotion_score > 0
        AND NOT EXISTS (
          SELECT 1 FROM entities WHERE name_lower = ps.term
        )
        AND NOT EXISTS (
          SELECT 1 FROM entities e, json_each(e.aliases_json) j
          WHERE LOWER(j.value) = ps.term
        )
      ORDER BY ps.promotion_score DESC
    `).all() as ProspectSummaryRow[];

    const now = Date.now();
    const candidates: ProspectCandidate[] = [];

    for (const row of rows) {
      const effective = row.promotion_score * computeProspectDecay(row.last_seen_at, now);
      if (effective < 1) continue; // filter near-zero

      candidates.push({
        term: row.term,
        displayName: row.display_name,
        promotionScore: row.promotion_score,
        effectiveScore: Math.round(effective * 10) / 10,
        promotionReady: effective >= PROMOTION_THRESHOLD,
        noteCount: row.note_count,
        dayCount: row.day_count,
        backlinkMax: row.backlink_max,
        cooccurringEntities: row.cooccurring_entities ? JSON.parse(row.cooccurring_entities) : [],
        bestSource: row.best_source,
        bestConfidence: row.best_confidence,
        bestScore: row.best_score,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
      });

      if (candidates.length >= limit) break;
    }

    return candidates;
  } catch {
    return [];
  }
}

/**
 * Get sample note paths for a prospect term (for discover_stub_candidates).
 */
export function getProspectSampleNotes(term: string, limit = 3): string[] {
  const stateDb = getStateDb();
  if (!stateDb) return [];

  try {
    const rows = stateDb.db.prepare(`
      SELECT DISTINCT note_path FROM prospect_ledger
      WHERE term = ?
      ORDER BY last_seen_at DESC
      LIMIT ?
    `).all(term.toLowerCase(), limit) as Array<{ note_path: string }>;

    return rows.map(r => r.note_path);
  } catch {
    return [];
  }
}

// =============================================================================
// Stale Cleanup
// =============================================================================

/**
 * Delete prospect ledger rows older than 210 days and prune orphaned summaries.
 * Gated behind a 1-hour in-process cooldown.
 * Returns the number of ledger rows deleted.
 */
export function cleanStaleProspects(): number {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_COOLDOWN_MS) return 0;
  lastCleanupAt = now;

  const stateDb = getStateDb();
  if (!stateDb) return 0;

  try {
    const cutoff = now - STALE_AGE_MS;

    const result = stateDb.db.prepare(
      'DELETE FROM prospect_ledger WHERE last_seen_at < ?'
    ).run(cutoff);

    // Prune orphaned summaries
    stateDb.db.prepare(`
      DELETE FROM prospect_summary
      WHERE term NOT IN (SELECT DISTINCT term FROM prospect_ledger)
    `).run();

    return result.changes;
  } catch {
    return 0;
  }
}

/**
 * Reset the cleanup cooldown (for testing).
 */
export function resetCleanupCooldown(): void {
  lastCleanupAt = 0;
}
