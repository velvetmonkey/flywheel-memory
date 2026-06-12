/**
 * Agentic Memory — TTL / Maintenance Lifecycle
 *
 * Periodic memory hygiene, run from the sweep timer (boot/postIndex):
 * TTL-based expiry, access-based confidence decay, and pruning of old
 * superseded rows. CRUD + graph integration live in memory.ts.
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import { removeGraphSignals } from './memory.js';

/**
 * Sweep expired memories (TTL-based).
 * Returns the number of memories cleaned up.
 */
export function sweepExpiredMemories(stateDb: StateDb): number {
  const now = Date.now();
  const msPerDay = 86400000;

  // Find memories past their TTL
  const expired = stateDb.db.prepare(`
    SELECT key FROM memories
    WHERE ttl_days IS NOT NULL
    AND superseded_by IS NULL
    AND (created_at + (ttl_days * ?)) < ?
  `).all(msPerDay, now) as Array<{ key: string }>;

  for (const { key } of expired) {
    removeGraphSignals(stateDb, key);
  }

  const result = stateDb.db.prepare(`
    DELETE FROM memories
    WHERE ttl_days IS NOT NULL
    AND superseded_by IS NULL
    AND (created_at + (ttl_days * ?)) < ?
  `).run(msPerDay, now);

  return result.changes;
}

/**
 * Apply access-based confidence decay.
 * Memories not accessed within the decay window lose confidence.
 */
export function decayMemoryConfidence(stateDb: StateDb): number {
  const now = Date.now();
  const msPerDay = 86400000;
  const halfLifeDays = 30;
  const lambda = Math.LN2 / (halfLifeDays * msPerDay);

  // Find memories that haven't been accessed in over 7 days
  const staleThreshold = now - (7 * msPerDay);

  const staleMemories = stateDb.db.prepare(`
    SELECT id, accessed_at, confidence FROM memories
    WHERE accessed_at < ? AND superseded_by IS NULL AND confidence > 0.1
  `).all(staleThreshold) as Array<{ id: number; accessed_at: number; confidence: number }>;

  let updated = 0;
  const updateStmt = stateDb.db.prepare(
    'UPDATE memories SET confidence = ? WHERE id = ?'
  );

  for (const mem of staleMemories) {
    const ageDays = (now - mem.accessed_at) / msPerDay;
    const decayFactor = Math.exp(-lambda * ageDays * msPerDay);
    const newConfidence = Math.max(0.1, mem.confidence * decayFactor);
    if (Math.abs(newConfidence - mem.confidence) > 0.01) {
      updateStmt.run(newConfidence, mem.id);
      updated++;
    }
  }

  return updated;
}

/**
 * Prune old superseded memories (older than retentionDays).
 */
export function pruneSupersededMemories(
  stateDb: StateDb,
  retentionDays: number = 90,
): number {
  const cutoff = Date.now() - (retentionDays * 86400000);

  const result = stateDb.db.prepare(`
    DELETE FROM memories
    WHERE superseded_by IS NOT NULL
    AND updated_at < ?
  `).run(cutoff);

  return result.changes;
}
