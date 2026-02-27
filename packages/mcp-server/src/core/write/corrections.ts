/**
 * Persistent Corrections
 *
 * Records, lists, and resolves corrections from user/engine feedback.
 * Corrections survive sessions and can be consumed by the watcher pipeline.
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import { recordFeedback } from './wikilinkFeedback.js';

// =============================================================================
// TYPES
// =============================================================================

export interface Correction {
  id: number;
  entity: string | null;
  note_path: string | null;
  correction_type: string;
  description: string;
  source: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Record a new correction.
 */
export function recordCorrection(
  stateDb: StateDb,
  type: string,
  description: string,
  source: string = 'user',
  entity?: string,
  notePath?: string,
): Correction {
  const result = stateDb.db.prepare(`
    INSERT INTO corrections (entity, note_path, correction_type, description, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(entity ?? null, notePath ?? null, type, description, source);

  return stateDb.db.prepare(
    'SELECT * FROM corrections WHERE id = ?'
  ).get(result.lastInsertRowid) as Correction;
}

/**
 * List corrections, optionally filtered by status and/or entity.
 */
export function listCorrections(
  stateDb: StateDb,
  status?: string,
  entity?: string,
  limit: number = 50,
): Correction[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (entity) {
    conditions.push('entity = ? COLLATE NOCASE');
    params.push(entity);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  return stateDb.db.prepare(
    `SELECT * FROM corrections ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as Correction[];
}

/**
 * Resolve a correction (mark as applied or dismissed).
 */
export function resolveCorrection(
  stateDb: StateDb,
  id: number,
  newStatus: string,
): boolean {
  const result = stateDb.db.prepare(`
    UPDATE corrections
    SET status = ?, resolved_at = datetime('now')
    WHERE id = ?
  `).run(newStatus, id);

  return result.changes > 0;
}

/**
 * Get pending corrections for a specific entity.
 */
export function getPendingCorrectionsForEntity(
  stateDb: StateDb,
  entity: string,
): Correction[] {
  return stateDb.db.prepare(
    `SELECT * FROM corrections WHERE entity = ? COLLATE NOCASE AND status = 'pending' ORDER BY created_at DESC`
  ).all(entity) as Correction[];
}

/**
 * Process all pending corrections, recording feedback and resolving each.
 * Called by the watcher pipeline after implicit_feedback.
 *
 * @returns Number of corrections processed
 */
export function processPendingCorrections(stateDb: StateDb): number {
  const pending = listCorrections(stateDb, 'pending');
  let processed = 0;

  for (const correction of pending) {
    if (!correction.entity) {
      resolveCorrection(stateDb, correction.id, 'dismissed');
      continue;
    }

    if (correction.correction_type === 'wrong_link') {
      recordFeedback(stateDb, correction.entity, 'correction:wrong_link', correction.note_path || '', false, 1.0);
    } else if (correction.correction_type === 'wrong_category') {
      recordFeedback(stateDb, correction.entity, 'correction:wrong_category', '', false, 0.5);
    }

    resolveCorrection(stateDb, correction.id, 'applied');
    processed++;
  }

  return processed;
}
