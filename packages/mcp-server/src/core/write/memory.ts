/**
 * Agentic Memory — Core CRUD + Graph Integration
 *
 * Lightweight key-value working memory stored in StateDb.
 * Memories are full participants in the knowledge graph: storing a memory
 * updates recency, co-occurrence, and edge weights for detected entities.
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import { recordEntityMention } from '@velvetmonkey/vault-core';
import { updateStoredNoteLinks } from './wikilinkFeedback.js';

// =============================================================================
// TYPES
// =============================================================================

export type MemoryType = 'fact' | 'preference' | 'observation' | 'summary';

export interface Memory {
  id: number;
  key: string;
  value: string;
  memory_type: MemoryType;
  entity: string | null;
  entities_json: string | null;
  source_agent_id: string | null;
  source_session_id: string | null;
  confidence: number;
  created_at: number;
  updated_at: number;
  accessed_at: number;
  ttl_days: number | null;
  superseded_by: number | null;
  visibility: string;
}

export interface StoreMemoryOptions {
  key: string;
  value: string;
  type: MemoryType;
  entity?: string;
  confidence?: number;
  ttl_days?: number;
  agent_id?: string;
  session_id?: string;
  visibility?: 'shared' | 'private';
}

export interface SearchMemoryOptions {
  query: string;
  type?: MemoryType;
  entity?: string;
  limit?: number;
  agent_id?: string;
}

export interface ListMemoryOptions {
  type?: MemoryType;
  entity?: string;
  limit?: number;
  agent_id?: string;
  include_expired?: boolean;
}

export interface SessionSummary {
  id: number;
  session_id: string;
  summary: string;
  topics_json: string | null;
  notes_modified_json: string | null;
  agent_id: string | null;
  started_at: number | null;
  ended_at: number;
  tool_count: number | null;
}

// =============================================================================
// ENTITY DETECTION
// =============================================================================

/**
 * Detect entities mentioned in memory text using the entity index in StateDb.
 * Returns entity names found as matches (case-insensitive).
 */
function detectEntities(stateDb: StateDb, text: string): string[] {
  // Get all entities from the index
  const allEntities = stateDb.getAllEntities.all() as Array<{
    name: string;
    name_lower: string;
    aliases_json: string | null;
  }>;

  const detected = new Set<string>();
  const textLower = text.toLowerCase();

  for (const entity of allEntities) {
    // Check entity name
    if (textLower.includes(entity.name_lower)) {
      detected.add(entity.name);
    }

    // Check aliases
    if (entity.aliases_json) {
      try {
        const aliases = JSON.parse(entity.aliases_json) as string[];
        for (const alias of aliases) {
          if (alias.length >= 3 && textLower.includes(alias.toLowerCase())) {
            detected.add(entity.name);
            break;
          }
        }
      } catch { /* skip malformed aliases */ }
    }
  }

  return [...detected];
}

// =============================================================================
// GRAPH INTEGRATION
// =============================================================================

/**
 * Update graph signals when a memory is stored/updated.
 * - Recency: update lastMentioned for all detected entities
 * - Note links: create memory→entity edges in note_links
 * - Co-occurrence: handled naturally by note_links edges
 */
function updateGraphSignals(
  stateDb: StateDb,
  memoryKey: string,
  entities: string[],
): void {
  if (entities.length === 0) return;

  const now = new Date();

  // Update recency for each detected entity
  for (const entity of entities) {
    recordEntityMention(stateDb, entity, now);
  }

  // Store memory→entity edges in note_links using memory:{key} as source path
  const sourcePath = `memory:${memoryKey}`;
  const targets = new Set(entities.map(e => e.toLowerCase()));
  updateStoredNoteLinks(stateDb, sourcePath, targets);
}

/**
 * Remove graph edges for a memory.
 */
function removeGraphSignals(stateDb: StateDb, memoryKey: string): void {
  const sourcePath = `memory:${memoryKey}`;
  updateStoredNoteLinks(stateDb, sourcePath, new Set());
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Store or update a memory. Upserts by key.
 * On store: detects entities, updates recency, creates graph edges.
 */
export function storeMemory(
  stateDb: StateDb,
  options: StoreMemoryOptions,
): Memory {
  const {
    key,
    value,
    type,
    entity,
    confidence = 1.0,
    ttl_days,
    agent_id,
    session_id,
    visibility = 'shared',
  } = options;

  const now = Date.now();

  // Detect entities in the value text
  const detectedEntities = detectEntities(stateDb, value);
  // Include the explicit entity if provided
  if (entity && !detectedEntities.includes(entity)) {
    detectedEntities.push(entity);
  }
  const entitiesJson = detectedEntities.length > 0 ? JSON.stringify(detectedEntities) : null;

  // Check if memory with this key already exists
  const existing = stateDb.db.prepare(
    'SELECT id FROM memories WHERE key = ?'
  ).get(key) as { id: number } | undefined;

  if (existing) {
    // Upsert: update existing memory
    stateDb.db.prepare(`
      UPDATE memories SET
        value = ?, memory_type = ?, entity = ?, entities_json = ?,
        source_agent_id = ?, source_session_id = ?,
        confidence = ?, updated_at = ?, accessed_at = ?,
        ttl_days = ?, visibility = ?, superseded_by = NULL
      WHERE key = ?
    `).run(
      value, type, entity ?? null, entitiesJson,
      agent_id ?? null, session_id ?? null,
      confidence, now, now,
      ttl_days ?? null, visibility, key,
    );
  } else {
    // Insert new memory
    stateDb.db.prepare(`
      INSERT INTO memories (key, value, memory_type, entity, entities_json,
        source_agent_id, source_session_id, confidence,
        created_at, updated_at, accessed_at, ttl_days, visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      key, value, type, entity ?? null, entitiesJson,
      agent_id ?? null, session_id ?? null, confidence,
      now, now, now, ttl_days ?? null, visibility,
    );
  }

  // Update graph signals
  updateGraphSignals(stateDb, key, detectedEntities);

  // Return the stored memory
  return stateDb.db.prepare(
    'SELECT * FROM memories WHERE key = ?'
  ).get(key) as Memory;
}

/**
 * Get a memory by key. Updates accessed_at.
 */
export function getMemory(
  stateDb: StateDb,
  key: string,
): Memory | null {
  const memory = stateDb.db.prepare(
    'SELECT * FROM memories WHERE key = ? AND superseded_by IS NULL'
  ).get(key) as Memory | undefined;

  if (!memory) return null;

  // Update accessed_at
  stateDb.db.prepare(
    'UPDATE memories SET accessed_at = ? WHERE id = ?'
  ).run(Date.now(), memory.id);

  return memory;
}

/**
 * Search memories using FTS5.
 */
export function searchMemories(
  stateDb: StateDb,
  options: SearchMemoryOptions,
): Memory[] {
  const { query, type, entity, limit = 20, agent_id } = options;

  const conditions: string[] = ['m.superseded_by IS NULL'];
  const params: unknown[] = [];

  if (type) {
    conditions.push('m.memory_type = ?');
    params.push(type);
  }
  if (entity) {
    conditions.push('(m.entity = ? COLLATE NOCASE OR m.entities_json LIKE ?)');
    params.push(entity, `%"${entity}"%`);
  }
  if (agent_id) {
    conditions.push("(m.visibility = 'shared' OR m.source_agent_id = ?)");
    params.push(agent_id);
  }

  const where = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  try {
    const results = stateDb.db.prepare(`
      SELECT m.* FROM memories_fts
      JOIN memories m ON m.id = memories_fts.rowid
      WHERE memories_fts MATCH ?
      ${where}
      ORDER BY bm25(memories_fts)
      LIMIT ?
    `).all(query, ...params, limit) as Memory[];

    return results;
  } catch (err) {
    if (err instanceof Error && err.message.includes('fts5: syntax error')) {
      throw new Error(`Invalid search query: ${query}. Check FTS5 syntax.`);
    }
    throw err;
  }
}

/**
 * List memories with optional filtering.
 */
export function listMemories(
  stateDb: StateDb,
  options: ListMemoryOptions = {},
): Memory[] {
  const { type, entity, limit = 50, agent_id, include_expired = false } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (!include_expired) {
    conditions.push('superseded_by IS NULL');
  }
  if (type) {
    conditions.push('memory_type = ?');
    params.push(type);
  }
  if (entity) {
    conditions.push('(entity = ? COLLATE NOCASE OR entities_json LIKE ?)');
    params.push(entity, `%"${entity}"%`);
  }
  if (agent_id) {
    conditions.push("(visibility = 'shared' OR source_agent_id = ?)");
    params.push(agent_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  return stateDb.db.prepare(
    `SELECT * FROM memories ${where} ORDER BY updated_at DESC LIMIT ?`
  ).all(...params) as Memory[];
}

/**
 * Forget a memory: remove graph edges, mark as expired.
 */
export function forgetMemory(
  stateDb: StateDb,
  key: string,
): boolean {
  const memory = stateDb.db.prepare(
    'SELECT id FROM memories WHERE key = ?'
  ).get(key) as { id: number } | undefined;

  if (!memory) return false;

  // Remove graph edges
  removeGraphSignals(stateDb, key);

  // Delete the memory
  stateDb.db.prepare('DELETE FROM memories WHERE key = ?').run(key);

  return true;
}

// =============================================================================
// SESSION SUMMARIES
// =============================================================================

/**
 * Store a session summary.
 */
export function storeSessionSummary(
  stateDb: StateDb,
  sessionId: string,
  summary: string,
  options: {
    topics?: string[];
    notes_modified?: string[];
    agent_id?: string;
    started_at?: number;
    tool_count?: number;
  } = {},
): SessionSummary {
  const now = Date.now();
  const { topics, notes_modified, agent_id, started_at, tool_count } = options;

  stateDb.db.prepare(`
    INSERT OR REPLACE INTO session_summaries
      (session_id, summary, topics_json, notes_modified_json,
       agent_id, started_at, ended_at, tool_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    summary,
    topics ? JSON.stringify(topics) : null,
    notes_modified ? JSON.stringify(notes_modified) : null,
    agent_id ?? null,
    started_at ?? null,
    now,
    tool_count ?? null,
  );

  return stateDb.db.prepare(
    'SELECT * FROM session_summaries WHERE session_id = ?'
  ).get(sessionId) as SessionSummary;
}

/**
 * Get recent session summaries.
 */
export function getRecentSessionSummaries(
  stateDb: StateDb,
  limit: number = 5,
  agent_id?: string,
): SessionSummary[] {
  if (agent_id) {
    return stateDb.db.prepare(
      'SELECT * FROM session_summaries WHERE agent_id = ? ORDER BY ended_at DESC LIMIT ?'
    ).all(agent_id, limit) as SessionSummary[];
  }
  return stateDb.db.prepare(
    'SELECT * FROM session_summaries ORDER BY ended_at DESC LIMIT ?'
  ).all(limit) as SessionSummary[];
}

// =============================================================================
// MEMORY LIFECYCLE
// =============================================================================

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

/**
 * Find potentially contradictory memories for an entity.
 * Returns pairs of memories about the same entity that might conflict.
 */
export function findContradictions(
  stateDb: StateDb,
  entity?: string,
): Array<{ memory_a: Memory; memory_b: Memory }> {
  const conditions = ["superseded_by IS NULL"];
  const params: unknown[] = [];

  if (entity) {
    conditions.push('(entity = ? COLLATE NOCASE OR entities_json LIKE ?)');
    params.push(entity, `%"${entity}"%`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  // Get memories grouped by entity, looking for same-key conflicts
  const memories = stateDb.db.prepare(
    `SELECT * FROM memories ${where} ORDER BY entity, key, updated_at DESC`
  ).all(...params) as Memory[];

  const contradictions: Array<{ memory_a: Memory; memory_b: Memory }> = [];

  // Group by entity+key prefix (e.g., "project.x.lead" and "project.x.lead")
  const byKey = new Map<string, Memory[]>();
  for (const m of memories) {
    const group = m.key;
    const list = byKey.get(group) || [];
    list.push(m);
    byKey.set(group, list);
  }

  // Find keys with multiple active memories (shouldn't normally happen due to upsert,
  // but can happen with different agent_ids)
  for (const [, mems] of byKey) {
    if (mems.length > 1) {
      for (let i = 0; i < mems.length - 1; i++) {
        contradictions.push({ memory_a: mems[i], memory_b: mems[i + 1] });
      }
    }
  }

  return contradictions;
}
