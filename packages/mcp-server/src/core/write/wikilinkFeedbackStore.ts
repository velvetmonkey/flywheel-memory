/**
 * Wikilink Feedback Store (repository)
 *
 * All SQLite access for the wikilink feedback & suppression engine
 * (wikilinkFeedback.ts) and its report assembly (wikilinkFeedbackReports.ts).
 *
 * Contains SQL statements and row mapping ONLY — zero scoring, posterior,
 * or threshold logic. Tables touched: wikilink_feedback,
 * wikilink_suppressions, wikilink_suppression_overrides,
 * wikilink_applications, note_links, note_tags, entities, suggestion_events.
 */

import type { StateDb } from '@velvetmonkey/vault-core';

// =============================================================================
// SHARED ROW SHAPES
// =============================================================================

/** Who most recently applied a wikilink to a note */
export type WikilinkApplicationSource = 'tool' | 'proactive' | 'enrichment' | 'manual_detected';

/** A feedback entry mapped for external consumption (correct as boolean). */
export interface FeedbackEntry {
  id: number;
  entity: string;
  context: string;
  note_path: string;
  correct: boolean;
  created_at: string;
}

/**
 * Derived per-entity accuracy stats (assembled by
 * wikilinkFeedback.getEntityStats — the suppressed flag is domain logic).
 */
export interface EntityStats {
  entity: string;
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  suppressed: boolean;
}

// =============================================================================
// wikilink_feedback
// =============================================================================

/** Raw wikilink_feedback row as stored (correct as 0/1). */
interface RawFeedbackEntryRow {
  id: number;
  entity: string;
  context: string;
  note_path: string;
  correct: number;
  created_at: string;
}

/** Insert a feedback row. Returns the inserted row id. */
export function insertFeedback(
  stateDb: StateDb,
  entity: string,
  context: string,
  notePath: string,
  correct: boolean,
  confidence: number,
  matchedTerm: string | null,
): number | bigint {
  const result = stateDb.db.prepare(
    'INSERT INTO wikilink_feedback (entity, context, note_path, correct, confidence, matched_term) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(entity, context, notePath, correct ? 1 : 0, confidence, matchedTerm);
  return result.lastInsertRowid;
}

/**
 * Get feedback entries, optionally filtered by entity
 */
export function getFeedback(
  stateDb: StateDb,
  entity?: string,
  limit: number = 20,
): FeedbackEntry[] {
  let rows: RawFeedbackEntryRow[];

  if (entity) {
    rows = stateDb.db.prepare(
      'SELECT id, entity, context, note_path, correct, created_at FROM wikilink_feedback WHERE entity = ? ORDER BY created_at DESC LIMIT ?'
    ).all(entity, limit) as RawFeedbackEntryRow[];
  } else {
    rows = stateDb.db.prepare(
      'SELECT id, entity, context, note_path, correct, created_at FROM wikilink_feedback ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as RawFeedbackEntryRow[];
  }

  return rows.map(r => ({
    id: r.id,
    entity: r.entity,
    context: r.context,
    note_path: r.note_path,
    correct: r.correct === 1,
    created_at: r.created_at,
  }));
}

/** Per-entity raw feedback counts grouped case-insensitively. */
export interface EntityFeedbackCountRow {
  entity: string;
  total: number;
  correct_count: number;
  incorrect_count: number;
}

/** Per-entity total/correct/incorrect counts over all feedback. */
export function getEntityFeedbackCounts(stateDb: StateDb): EntityFeedbackCountRow[] {
  return stateDb.db.prepare(`
    SELECT
      entity,
      COUNT(*) as total,
      SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count,
      SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) as incorrect_count
    FROM wikilink_feedback
    GROUP BY entity COLLATE NOCASE
    ORDER BY total DESC
  `).all() as EntityFeedbackCountRow[];
}

/** Feedback row used for recency-weighted (decay) computations. */
export interface FeedbackDecayRow {
  entity: string;
  correct: number;
  confidence: number;
  created_at: string;
}

/** All feedback rows ordered by entity (case-insensitive), for decay weighting. */
export function getAllFeedbackRows(stateDb: StateDb): FeedbackDecayRow[] {
  return stateDb.db.prepare(`
    SELECT entity, correct, confidence, created_at
    FROM wikilink_feedback
    ORDER BY entity COLLATE NOCASE
  `).all() as FeedbackDecayRow[];
}

/** Feedback row for a single entity scoped to a folder. */
export interface FolderFeedbackRow {
  correct: number;
  confidence: number;
  created_at: string;
}

/** Feedback rows for one entity restricted to a top-level folder ('' = vault root). */
export function getFolderFeedbackRows(
  stateDb: StateDb,
  entity: string,
  folder: string,
): FolderFeedbackRow[] {
  return stateDb.db.prepare(`
    SELECT correct, confidence, created_at
    FROM wikilink_feedback
    WHERE entity = ? COLLATE NOCASE AND (
      CASE WHEN ? = '' THEN note_path NOT LIKE '%/%'
      ELSE note_path LIKE ? || '/%'
      END
    )
  `).all(entity, folder, folder) as FolderFeedbackRow[];
}

/** Feedback row carrying just entity, note path, and outcome. */
export interface FeedbackPathRow {
  entity: string;
  note_path: string;
  correct: number;
}

/** All (entity, note_path, correct) triples — for folder accuracy aggregation. */
export function getFeedbackEntityPathRows(stateDb: StateDb): FeedbackPathRow[] {
  return stateDb.db.prepare(`
    SELECT
      entity,
      note_path,
      correct
    FROM wikilink_feedback
  `).all() as FeedbackPathRow[];
}

/** Outcome + timestamp row for a single entity. */
export interface EntityOutcomeRow {
  correct: number;
  created_at: string;
}

/** All (correct, created_at) rows for one entity — for boost computation. */
export function getEntityFeedbackOutcomes(stateDb: StateDb, entity: string): EntityOutcomeRow[] {
  return stateDb.db.prepare(`
    SELECT correct, created_at
    FROM wikilink_feedback
    WHERE entity = ?
  `).all(entity) as EntityOutcomeRow[];
}

/** Feedback row with the alias term that matched. */
export interface AliasFeedbackRow {
  entity: string;
  matched_term: string;
  correct: number;
  confidence: number;
  created_at: string;
}

/** Alias-attributed feedback rows ordered by entity + term (case-insensitive). */
export function getAliasFeedbackRowsOrdered(stateDb: StateDb): AliasFeedbackRow[] {
  return stateDb.db.prepare(`
    SELECT entity, matched_term, correct, confidence, created_at
    FROM wikilink_feedback
    WHERE matched_term IS NOT NULL
    ORDER BY entity COLLATE NOCASE, matched_term COLLATE NOCASE
  `).all() as AliasFeedbackRow[];
}

/** Alias-attributed feedback rows (unordered). */
export function getAliasFeedbackRows(stateDb: StateDb): AliasFeedbackRow[] {
  return stateDb.db.prepare(`
    SELECT entity, matched_term, correct, confidence, created_at
    FROM wikilink_feedback
    WHERE matched_term IS NOT NULL
  `).all() as AliasFeedbackRow[];
}

/** Most recent 'implicit:removed' feedback timestamp for an (entity, note) pair. */
export function getLastImplicitRemovedAt(
  stateDb: StateDb,
  entity: string,
  notePath: string,
): string | null {
  const last = stateDb.db.prepare(
    `SELECT MAX(created_at) as last FROM wikilink_feedback
     WHERE entity = ? COLLATE NOCASE AND context = 'implicit:removed' AND note_path = ?`
  ).get(entity, notePath) as { last: string | null } | undefined;
  return last?.last ?? null;
}

/** Most recent 'implicit:survived' feedback timestamp for an (entity, note) pair. */
export function getLastImplicitSurvivedAt(
  stateDb: StateDb,
  entity: string,
  notePath: string,
): string | null {
  const last = stateDb.db.prepare(
    `SELECT MAX(created_at) as last FROM wikilink_feedback
     WHERE entity = ? COLLATE NOCASE AND context = 'implicit:survived' AND note_path = ?`
  ).get(entity, notePath) as { last: string | null } | undefined;
  return last?.last ?? null;
}

/** Feedback counts grouped into implicit vs explicit sources. */
export interface FeedbackSourceRow {
  source: string;
  count: number;
  correct_count: number;
}

/** Implicit vs explicit feedback counts (dashboard). */
export function getFeedbackSourceCounts(stateDb: StateDb): FeedbackSourceRow[] {
  return stateDb.db.prepare(`
    SELECT
      CASE WHEN context LIKE 'implicit:%' THEN 'implicit' ELSE 'explicit' END as source,
      COUNT(*) as count,
      SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count
    FROM wikilink_feedback
    GROUP BY source
  `).all() as FeedbackSourceRow[];
}

/** Per-day feedback counts for the 30-day dashboard timeline. */
export interface FeedbackTimelineRow {
  day: string;
  count: number;
  correct_count: number;
  incorrect_count: number;
}

/** 30-day per-day feedback timeline (dashboard). */
export function getFeedbackDailyTimeline(stateDb: StateDb): FeedbackTimelineRow[] {
  return stateDb.db.prepare(`
    SELECT
      date(created_at) as day,
      COUNT(*) as count,
      SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count,
      SUM(CASE WHEN correct = 0 THEN 1 ELSE 0 END) as incorrect_count
    FROM wikilink_feedback
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY day
    ORDER BY day
  `).all() as FeedbackTimelineRow[];
}

/** Recent feedback row for one entity (journey view). */
export interface RecentEntityFeedbackRow {
  note_path: string;
  correct: number;
  context: string;
  created_at: string;
}

/** Latest 20 feedback rows for one entity (journey view). */
export function getRecentEntityFeedback(stateDb: StateDb, entity: string): RecentEntityFeedbackRow[] {
  return stateDb.db.prepare(`
    SELECT note_path, correct, context, created_at
    FROM wikilink_feedback
    WHERE entity = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(entity) as RecentEntityFeedbackRow[];
}

/** Total + correct feedback counts for one entity. */
export interface EntityFeedbackTotalsRow {
  total: number;
  correct_count: number;
}

/** Total/correct feedback counts for one entity (journey view). */
export function getEntityFeedbackTotals(stateDb: StateDb, entity: string): EntityFeedbackTotalsRow {
  return stateDb.db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct_count
    FROM wikilink_feedback WHERE entity = ?
  `).get(entity) as EntityFeedbackTotalsRow;
}

/** Per-day feedback count for trend charts. */
export interface FeedbackTrendRow {
  day: string;
  count: number;
}

/** Per-day feedback counts over the last 30 days (extended dashboard). */
export function getFeedbackTrendDaily(stateDb: StateDb): FeedbackTrendRow[] {
  return stateDb.db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count
    FROM wikilink_feedback
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY day
    ORDER BY day
  `).all() as FeedbackTrendRow[];
}

// =============================================================================
// wikilink_suppressions
// =============================================================================

/** Upsert a suppression row with the given false positive rate. */
export function upsertSuppression(stateDb: StateDb, entity: string, falsePositiveRate: number): void {
  stateDb.db.prepare(`
    INSERT INTO wikilink_suppressions (entity, false_positive_rate, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(entity) DO UPDATE SET
      false_positive_rate = excluded.false_positive_rate,
      updated_at = datetime('now')
  `).run(entity, falsePositiveRate);
}

/** Delete a suppression row by exact entity match. */
export function deleteSuppression(stateDb: StateDb, entity: string): void {
  stateDb.db.prepare(
    'DELETE FROM wikilink_suppressions WHERE entity = ?'
  ).run(entity);
}

/** Delete suppression rows older than the TTL (re-evaluation window). */
export function deleteExpiredSuppressions(stateDb: StateDb, ttlDays: number): void {
  stateDb.db.prepare(
    `DELETE FROM wikilink_suppressions
     WHERE datetime(updated_at, '+' || ? || ' days') <= datetime('now')`
  ).run(ttlDays);
}

/** Force-suppress an entity with false_positive_rate = 1.0 (explicit suppress). */
export function forceSuppression(stateDb: StateDb, entity: string): void {
  stateDb.db.prepare(`
    INSERT INTO wikilink_suppressions (entity, false_positive_rate, updated_at)
    VALUES (?, 1.0, datetime('now'))
    ON CONFLICT(entity) DO UPDATE SET false_positive_rate = 1.0, updated_at = datetime('now')
  `).run(entity);
}

/** Delete a suppression row case-insensitively. Returns affected row count. */
export function deleteSuppressionNocase(stateDb: StateDb, entity: string): number {
  const result = stateDb.db.prepare(
    'DELETE FROM wikilink_suppressions WHERE entity = ? COLLATE NOCASE'
  ).run(entity);
  return result.changes;
}

/** Suppression row with its last-updated timestamp. */
export interface ActiveSuppressionRow {
  entity: string;
  updated_at: string;
}

/** Non-expired suppression row for one entity (case-insensitive), if any. */
export function getActiveSuppression(
  stateDb: StateDb,
  entity: string,
  ttlDays: number,
): ActiveSuppressionRow | undefined {
  return stateDb.db.prepare(
    `SELECT entity, updated_at FROM wikilink_suppressions
     WHERE entity = ? COLLATE NOCASE
     AND datetime(updated_at, '+' || ? || ' days') > datetime('now')`
  ).get(entity, ttlDays) as ActiveSuppressionRow | undefined;
}

/**
 * Get count of suppressed entities
 */
export function getSuppressedCount(stateDb: StateDb): number {
  const row = stateDb.db.prepare(
    'SELECT COUNT(*) as count FROM wikilink_suppressions'
  ).get() as { count: number };
  return row.count;
}

/**
 * Get all suppressed entities
 */
export function getSuppressedEntities(stateDb: StateDb): Array<{ entity: string; false_positive_rate: number; total: number }> {
  return stateDb.db.prepare(`
    SELECT s.entity, s.false_positive_rate,
      COALESCE((SELECT COUNT(*) FROM wikilink_feedback WHERE entity = s.entity COLLATE NOCASE), 0) as total
    FROM wikilink_suppressions s
    ORDER BY s.false_positive_rate DESC
  `).all() as Array<{ entity: string; false_positive_rate: number; total: number }>;
}

/** All non-expired suppression rows. */
export function getActiveSuppressions(stateDb: StateDb, ttlDays: number): ActiveSuppressionRow[] {
  return stateDb.db.prepare(
    `SELECT entity, updated_at FROM wikilink_suppressions
     WHERE datetime(updated_at, '+' || ? || ' days') > datetime('now')`
  ).all(ttlDays) as ActiveSuppressionRow[];
}

/** Stored false positive rate for one entity (case-insensitive), if suppressed. */
export function getSuppressionFalsePositiveRate(stateDb: StateDb, entity: string): number | undefined {
  const row = stateDb.db.prepare(
    'SELECT false_positive_rate FROM wikilink_suppressions WHERE entity = ? COLLATE NOCASE'
  ).get(entity) as { false_positive_rate: number } | undefined;
  return row?.false_positive_rate;
}

/** Suppression row including rate and timestamp (extended dashboard). */
export interface SuppressionChangeRow {
  entity: string;
  false_positive_rate: number;
  updated_at: string;
}

/** All suppression rows ordered by most recently updated. */
export function getSuppressionRowsByUpdatedAt(stateDb: StateDb): SuppressionChangeRow[] {
  return stateDb.db.prepare(`
    SELECT entity, false_positive_rate, updated_at
    FROM wikilink_suppressions
    ORDER BY updated_at DESC
  `).all() as SuppressionChangeRow[];
}

// =============================================================================
// wikilink_suppression_overrides
// =============================================================================

/** Remove the manual unsuppress override for an entity (case-insensitive). */
export function deleteSuppressionOverride(stateDb: StateDb, entity: string): void {
  stateDb.db.prepare(
    'DELETE FROM wikilink_suppression_overrides WHERE entity = ? COLLATE NOCASE'
  ).run(entity);
}

/** Record a durable manual unsuppress override for an entity. */
export function insertSuppressionOverride(stateDb: StateDb, entity: string): void {
  stateDb.db.prepare(
    'INSERT OR IGNORE INTO wikilink_suppression_overrides (entity) VALUES (?)'
  ).run(entity);
}

/**
 * Entities the user manually unsuppressed — a durable override that
 * auto-suppression must not undo. Lowercased for case-insensitive checks
 * (mirrors the suppressedSet pattern in entity.ts).
 */
export function getSuppressionOverrides(stateDb: StateDb): Set<string> {
  const rows = stateDb.db.prepare(
    'SELECT entity FROM wikilink_suppression_overrides'
  ).all() as Array<{ entity: string }>;
  return new Set(rows.map(r => r.entity.toLowerCase()));
}

/** Whether a manual unsuppress override exists for an entity (case-insensitive). */
export function hasSuppressionOverride(stateDb: StateDb, entity: string): boolean {
  const overridden = stateDb.db.prepare(
    'SELECT 1 FROM wikilink_suppression_overrides WHERE entity = ? COLLATE NOCASE'
  ).get(entity);
  return overridden !== undefined;
}

// =============================================================================
// wikilink_applications
// =============================================================================

/** Upsert an application row with status='applied' for later removal detection. */
export function upsertApplication(
  stateDb: StateDb,
  entity: string,
  notePath: string,
  matchedTerm: string | null,
  source: WikilinkApplicationSource,
): void {
  stateDb.db.prepare(`
    INSERT INTO wikilink_applications (entity, note_path, matched_term, applied_at, status, source)
    VALUES (?, ?, ?, datetime('now'), 'applied', ?)
    ON CONFLICT(entity, note_path) DO UPDATE SET
      matched_term = COALESCE(?, matched_term),
      applied_at = datetime('now'),
      status = 'applied',
      source = ?
  `).run(entity, notePath, matchedTerm, source, matchedTerm, source);
}

/**
 * Get tracked applications for a note (status='applied')
 */
export function getTrackedApplications(
  stateDb: StateDb,
  notePath: string,
): string[] {
  const rows = stateDb.db.prepare(
    `SELECT entity FROM wikilink_applications WHERE note_path = ? AND status = 'applied'`
  ).all(notePath) as Array<{ entity: string }>;

  return rows.map(r => r.entity);
}

/** Application row with applied_at timestamp for confidence computation. */
export interface AppliedApplicationRow {
  entity: string;
  applied_at: string;
  matched_term: string | null;
}

/**
 * Get tracked applications with applied_at timestamp for confidence computation.
 */
export function getTrackedApplicationsWithTime(
  stateDb: StateDb,
  notePath: string,
): AppliedApplicationRow[] {
  return stateDb.db.prepare(
    `SELECT entity, applied_at, matched_term FROM wikilink_applications WHERE note_path = ? AND status = 'applied'`
  ).all(notePath) as AppliedApplicationRow[];
}

/** Mark a tracked application as removed. */
export function markApplicationRemoved(stateDb: StateDb, entity: string, notePath: string): void {
  stateDb.db.prepare(
    `UPDATE wikilink_applications SET status = 'removed' WHERE entity = ? AND note_path = ?`
  ).run(entity, notePath);
}

/** Application counts grouped by status. */
export interface ApplicationStatusRow {
  status: string;
  count: number;
}

/** Application counts per status (dashboard). */
export function getApplicationStatusCounts(stateDb: StateDb): ApplicationStatusRow[] {
  return stateDb.db.prepare(
    `SELECT status, COUNT(*) as count FROM wikilink_applications GROUP BY status`
  ).all() as ApplicationStatusRow[];
}

/** Application row for one entity (journey view). */
export interface EntityApplicationRow {
  note_path: string;
  applied_at: string;
  status: string;
}

/** All application rows for one entity (journey view). */
export function getApplicationsForEntity(stateDb: StateDb, entity: string): EntityApplicationRow[] {
  return stateDb.db.prepare(`
    SELECT note_path, applied_at, status
    FROM wikilink_applications
    WHERE entity = ?
  `).all(entity) as EntityApplicationRow[];
}

// =============================================================================
// entities
// =============================================================================

/** Resolve the canonical entity name for a case-insensitive match, if known. */
export function lookupCanonicalEntity(stateDb: StateDb, name: string): string | undefined {
  const row = stateDb.db.prepare(
    `SELECT name FROM entities WHERE LOWER(name) = LOWER(?) LIMIT 1`
  ).get(name) as { name: string } | undefined;
  return row?.name;
}

/** Entity metadata row (journey discover stage). */
export interface EntityRecordRow {
  name: string;
  path: string;
  category: string;
  aliases_json: string | null;
  hub_score: number;
}

/** Entity metadata by lowercased name, if present. */
export function getEntityRecord(stateDb: StateDb, nameLower: string): EntityRecordRow | undefined {
  return stateDb.db.prepare(`
    SELECT name, path, category, aliases_json, hub_score
    FROM entities WHERE name_lower = ?
  `).get(nameLower) as EntityRecordRow | undefined;
}

// =============================================================================
// note_links
// =============================================================================

/** Get previously stored forward links for a note */
export function getStoredNoteLinks(stateDb: StateDb, notePath: string): Set<string> {
  const rows = stateDb.db.prepare(
    'SELECT target FROM note_links WHERE note_path = ?'
  ).all(notePath) as Array<{ target: string }>;
  return new Set(rows.map(r => r.target));
}

/** Replace stored links for a note, preserving weights on existing rows */
export function replaceNoteLinks(
  stateDb: StateDb,
  notePath: string,
  currentLinks: Set<string>,
): void {
  const ins = stateDb.db.prepare(
    'INSERT OR IGNORE INTO note_links (note_path, target) VALUES (?, ?)'
  );
  const del = stateDb.db.prepare(
    'DELETE FROM note_links WHERE note_path = ? AND target = ?'
  );
  const existing = stateDb.db.prepare(
    'SELECT target FROM note_links WHERE note_path = ?'
  );
  const tx = stateDb.db.transaction(() => {
    // Insert new links (existing rows untouched due to OR IGNORE)
    for (const target of currentLinks) {
      ins.run(notePath, target);
    }
    // Remove orphaned links no longer in current set
    const rows = existing.all(notePath) as Array<{ target: string }>;
    for (const row of rows) {
      if (!currentLinks.has(row.target)) {
        del.run(notePath, row.target);
      }
    }
  });
  tx();
}

// =============================================================================
// note_tags
// =============================================================================

/** Get previously stored tags for a note */
export function getStoredNoteTags(stateDb: StateDb, notePath: string): Set<string> {
  const rows = stateDb.db.prepare(
    'SELECT tag FROM note_tags WHERE note_path = ?'
  ).all(notePath) as Array<{ tag: string }>;
  return new Set(rows.map(r => r.tag));
}

/** Replace stored tags for a note with current set */
export function replaceNoteTags(
  stateDb: StateDb,
  notePath: string,
  currentTags: Set<string>,
): void {
  const del = stateDb.db.prepare('DELETE FROM note_tags WHERE note_path = ?');
  const ins = stateDb.db.prepare('INSERT INTO note_tags (note_path, tag) VALUES (?, ?)');
  const tx = stateDb.db.transaction(() => {
    del.run(notePath);
    for (const tag of currentTags) {
      ins.run(notePath, tag);
    }
  });
  tx();
}

// =============================================================================
// suggestion_events
// =============================================================================

/** One suggestion event to persist (breakdown pre-serialized by the caller). */
export interface SuggestionEventInsert {
  entity: string;
  totalScore: number;
  breakdownJson: string;
  /** 1 = passed the suggestion threshold, 0 = scored but did not pass. */
  passed: 0 | 1;
}

/**
 * Insert suggestion events for one note in a single transaction
 * (pipeline observability, Pillar 6). Rows start unapplied.
 */
export function insertSuggestionEvents(
  stateDb: StateDb,
  timestamp: number,
  notePath: string,
  threshold: number,
  strictness: string,
  events: SuggestionEventInsert[],
): void {
  const insertStmt = stateDb.db.prepare(`
    INSERT OR IGNORE INTO suggestion_events
      (timestamp, note_path, entity, total_score, breakdown_json, threshold, passed, strictness, applied, pipeline_event_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
  `);
  const persistTransaction = stateDb.db.transaction(() => {
    for (const e of events) {
      insertStmt.run(
        timestamp,
        notePath,
        e.entity,
        e.totalScore,
        e.breakdownJson,
        threshold,
        e.passed,
        strictness
      );
    }
  });
  persistTransaction();
}

/** Mark pending suggestion events as applied for the given entities on a note. */
export function markSuggestionEventsApplied(
  stateDb: StateDb,
  notePath: string,
  entities: string[],
): void {
  const markApplied = stateDb.db.prepare(
    `UPDATE suggestion_events SET applied = 1
     WHERE note_path = ? AND entity = ? AND applied = 0`,
  );
  for (const entity of entities) {
    markApplied.run(notePath, entity);
  }
}

/** Raw suggestion event row (breakdown still JSON-encoded). */
export interface SuggestionEventRow {
  note_path: string;
  timestamp: number;
  total_score: number;
  breakdown_json: string;
  threshold: number;
  passed: number;
}

/** Latest 20 suggestion events for one entity since a cutoff (journey view). */
export function getRecentSuggestionEvents(
  stateDb: StateDb,
  entity: string,
  cutoff: number,
): SuggestionEventRow[] {
  return stateDb.db.prepare(`
    SELECT note_path, timestamp, total_score, breakdown_json, threshold, passed
    FROM suggestion_events
    WHERE entity = ? AND timestamp >= ?
    ORDER BY timestamp DESC
    LIMIT 20
  `).all(entity, cutoff) as SuggestionEventRow[];
}

/** Total suggestion event count for one entity. */
export function countSuggestionEvents(stateDb: StateDb, entity: string): number {
  const row = stateDb.db.prepare(`
    SELECT COUNT(*) as cnt FROM suggestion_events WHERE entity = ?
  `).get(entity) as { cnt: number };
  return row.cnt;
}

/** Score timeline row — max-scoring event per day for one entity. */
export interface ScoreTimelineRow {
  timestamp: number;
  total_score: number;
  breakdown_json: string;
  note_path: string;
  passed: number;
  threshold: number;
}

/** Max-scoring suggestion event per day for one entity since a cutoff. */
export function getEntityScoreTimelineRows(
  stateDb: StateDb,
  entity: string,
  cutoff: number,
  limit: number,
): ScoreTimelineRow[] {
  return stateDb.db.prepare(`
    SELECT s.timestamp, s.total_score, s.breakdown_json, s.note_path, s.passed, s.threshold
    FROM suggestion_events s
    INNER JOIN (
      SELECT date(timestamp/1000, 'unixepoch') as day, MAX(total_score) as max_score
      FROM suggestion_events
      WHERE entity = ? AND timestamp >= ?
      GROUP BY day
    ) agg ON date(s.timestamp/1000, 'unixepoch') = agg.day AND s.total_score = agg.max_score
    WHERE s.entity = ? AND s.timestamp >= ?
    GROUP BY agg.day
    ORDER BY s.timestamp ASC
    LIMIT ?
  `).all(entity, cutoff, entity, cutoff, limit) as ScoreTimelineRow[];
}

/** Timestamped breakdown JSON row. */
export interface SuggestionBreakdownRow {
  timestamp: number;
  breakdown_json: string;
}

/** All (timestamp, breakdown_json) rows since a cutoff, oldest first. */
export function getSuggestionBreakdownsSince(stateDb: StateDb, cutoff: number): SuggestionBreakdownRow[] {
  return stateDb.db.prepare(`
    SELECT timestamp, breakdown_json
    FROM suggestion_events
    WHERE timestamp >= ?
    ORDER BY timestamp ASC
  `).all(cutoff) as SuggestionBreakdownRow[];
}

/** All breakdown_json payloads since a cutoff (layer health). */
export function getBreakdownJsonSince(stateDb: StateDb, cutoff: number): Array<{ breakdown_json: string }> {
  return stateDb.db.prepare(`
    SELECT breakdown_json FROM suggestion_events WHERE timestamp >= ?
  `).all(cutoff) as Array<{ breakdown_json: string }>;
}

/** Aggregate row for the most-suggested entities. */
export interface TopSuggestedEntityRow {
  entity: string;
  cnt: number;
  avg_score: number;
  pass_rate: number;
}

/** Top 10 entities by suggestion frequency with avg score and pass rate. */
export function getTopSuggestedEntities(stateDb: StateDb): TopSuggestedEntityRow[] {
  return stateDb.db.prepare(`
    SELECT entity, COUNT(*) as cnt, AVG(total_score) as avg_score,
           SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as pass_rate
    FROM suggestion_events
    GROUP BY entity
    ORDER BY cnt DESC
    LIMIT 10
  `).all() as TopSuggestedEntityRow[];
}
