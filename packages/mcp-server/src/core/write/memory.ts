/**
 * Agentic Memory — Core CRUD + Graph Integration
 *
 * Lightweight key-value working memory stored in StateDb.
 * Memories are full participants in the knowledge graph: storing a memory
 * updates recency, co-occurrence, and edge weights for detected entities.
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import { recordEntityMention, escapeFts5Query } from '@velvetmonkey/vault-core';
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
  owner_scope: string;
  thread_id: string | null;
  supersede_reason: string | null;
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
  thread_id?: string;
}

export interface SupersedeMemoryOptions {
  /** Supersede every current memory carrying this thread correlation id. */
  thread_id?: string;
  /** Supersede the single current memory under this key (caller's scope). */
  key?: string;
  /** Audit reason recorded on each superseded row (e.g. "thread-resolved"). */
  reason?: string;
  agent_id?: string;
}

export interface SupersedeMemoryResult {
  superseded: Array<{ id: number; key: string; owner_scope: string }>;
  /** Rows matched but already superseded — idempotent no-op count. */
  already_superseded: number;
}

export interface UnsupersedeMemoryOptions {
  /** Reverse the thread-resolution tombstone on every row carrying this id. */
  thread_id: string;
  agent_id?: string;
}

export interface UnsupersedeMemoryResult {
  restored: Array<{ id: number; key: string; owner_scope: string }>;
  /**
   * Rows matched on the thread but left untouched: either already live
   * (superseded_by IS NULL) or superseded by a *successor* (replaced, not
   * thread-tombstoned). The undo only reverses self-tombstones.
   */
  skipped: number;
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

const GLOBAL_OWNER_SCOPE = 'global';

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

// Per-vault cache for entity list (keyed by dbPath, refreshed when stale)
type EntityCacheEntry = { cache: Array<{ name: string; name_lower: string; aliases_json: string | null }>; time: number };
const entityCacheMap = new Map<string, EntityCacheEntry>();
const ENTITY_CACHE_TTL_MS = 60_000; // 1 minute

function getEntityList(stateDb: StateDb): Array<{ name: string; name_lower: string; aliases_json: string | null }> {
  const now = Date.now();
  const key = stateDb.dbPath;
  const entry = entityCacheMap.get(key);
  if (entry && (now - entry.time) < ENTITY_CACHE_TTL_MS) {
    return entry.cache;
  }
  const cache = stateDb.getAllEntities.all() as Array<{ name: string; name_lower: string; aliases_json: string | null }>;
  entityCacheMap.set(key, { cache, time: now });
  return cache;
}

/**
 * Clear the entity cache. Exported for testing.
 */
export function clearEntityCache(): void {
  entityCacheMap.clear();
}

/**
 * Detect entities mentioned in memory text using the entity index in StateDb.
 * Returns entity names found as matches (case-insensitive).
 */
function detectEntities(stateDb: StateDb, text: string): string[] {
  // Get all entities from the index (cached)
  const allEntities = getEntityList(stateDb);

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

function resolveOwnerScope(
  agentId: string | undefined,
  visibility: 'shared' | 'private',
): string {
  if (visibility === 'private') {
    if (!agentId) {
      throw new Error('Private memories require agent_id');
    }
    return agentId;
  }
  return GLOBAL_OWNER_SCOPE;
}

function applyVisibilityFilter(conditions: string[], params: unknown[], agentId?: string): void {
  if (agentId) {
    conditions.push('(owner_scope = ? OR owner_scope = ?)');
    params.push(GLOBAL_OWNER_SCOPE, agentId);
    return;
  }
  conditions.push('owner_scope = ?');
  params.push(GLOBAL_OWNER_SCOPE);
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
    thread_id,
  } = options;
  const ownerScope = resolveOwnerScope(agent_id, visibility);

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
    'SELECT id, superseded_by FROM memories WHERE key = ? AND owner_scope = ?'
  ).get(key, ownerScope) as { id: number; superseded_by: number | null } | undefined;

  if (existing) {
    // Upsert: update existing memory.
    //
    // Supersession is PRESERVED, never reset (thread-identity slice 1).
    // The previous shape set `superseded_by = NULL` here, which meant any
    // routine same-key re-store (cron jobs idempotently re-storing facts)
    // silently resurrected a tombstoned memory — the upsert-resurrection
    // bug. A superseded fact stays superseded; explicit revival is
    // forget-then-store. thread_id is updated only when the caller provides
    // one, so re-stores without thread context don't strip the correlation id.
    stateDb.db.prepare(`
      UPDATE memories SET
        value = ?, memory_type = ?, entity = ?, entities_json = ?,
        source_agent_id = ?, source_session_id = ?,
        confidence = ?, updated_at = ?, accessed_at = ?,
        ttl_days = ?, visibility = ?, owner_scope = ?,
        thread_id = COALESCE(?, thread_id)
      WHERE key = ? AND owner_scope = ?
    `).run(
      value, type, entity ?? null, entitiesJson,
      agent_id ?? null, session_id ?? null,
      confidence, now, now,
      ttl_days ?? null, visibility, ownerScope,
      thread_id ?? null,
      key, ownerScope,
    );
  } else {
    // Insert new memory
    stateDb.db.prepare(`
      INSERT INTO memories (key, value, memory_type, entity, entities_json,
        source_agent_id, source_session_id, confidence,
        created_at, updated_at, accessed_at, ttl_days, visibility, owner_scope, thread_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      key, value, type, entity ?? null, entitiesJson,
      agent_id ?? null, session_id ?? null, confidence,
      now, now, now, ttl_days ?? null, visibility, ownerScope, thread_id ?? null,
    );
  }

  // Private memories must not leak into shared graph-derived signals.
  // A superseded row stays out of the graph: its edges were removed at
  // supersede time and a re-store must not resurrect them either.
  if (visibility === 'shared' && !(existing && existing.superseded_by !== null)) {
    updateGraphSignals(stateDb, key, detectedEntities);
  }

  // Return the stored memory
  return stateDb.db.prepare(
    'SELECT * FROM memories WHERE key = ? AND owner_scope = ?'
  ).get(key, ownerScope) as Memory;
}

/**
 * Get a memory by key. Updates accessed_at.
 */
export function getMemory(
  stateDb: StateDb,
  key: string,
  agent_id?: string,
): Memory | null {
  let memory: Memory | undefined;
  if (agent_id) {
    memory = stateDb.db.prepare(`
      SELECT * FROM memories
      WHERE key = ?
        AND superseded_by IS NULL
        AND (owner_scope = ? OR owner_scope = ?)
      ORDER BY CASE owner_scope WHEN ? THEN 0 ELSE 1 END, updated_at DESC, id DESC
      LIMIT 1
    `).get(key, GLOBAL_OWNER_SCOPE, agent_id, agent_id) as Memory | undefined;
  } else {
    memory = stateDb.db.prepare(
      'SELECT * FROM memories WHERE key = ? AND superseded_by IS NULL AND owner_scope = ? ORDER BY updated_at DESC, id DESC LIMIT 1'
    ).get(key, GLOBAL_OWNER_SCOPE) as Memory | undefined;
  }

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
  applyVisibilityFilter(conditions, params, agent_id);

  const where = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  const escaped = escapeFts5Query(query);
  if (!escaped) return [];

  try {
    const results = stateDb.db.prepare(`
      SELECT m.* FROM memories_fts
      JOIN memories m ON m.id = memories_fts.rowid
      WHERE memories_fts MATCH ?
      ${where}
      ORDER BY bm25(memories_fts)
      LIMIT ?
    `).all(escaped, ...params, limit) as Memory[];

    return results;
  } catch (err) {
    if (err instanceof Error && (err.message.includes('fts5: syntax error') || err.message.includes('no such column'))) {
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
  applyVisibilityFilter(conditions, params, agent_id);

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
  agent_id?: string,
): boolean {
  let memory: Memory | undefined;
  if (agent_id) {
    memory = stateDb.db.prepare(
      'SELECT * FROM memories WHERE key = ? AND superseded_by IS NULL AND owner_scope = ? ORDER BY updated_at DESC, id DESC LIMIT 1'
    ).get(key, agent_id) as Memory | undefined;
  } else {
    memory = stateDb.db.prepare(
      'SELECT * FROM memories WHERE key = ? AND superseded_by IS NULL AND owner_scope = ? ORDER BY updated_at DESC, id DESC LIMIT 1'
    ).get(key, GLOBAL_OWNER_SCOPE) as Memory | undefined;
  }

  if (!memory) return false;

  if (memory.visibility === 'shared' && memory.owner_scope === GLOBAL_OWNER_SCOPE) {
    removeGraphSignals(stateDb, key);
  }

  stateDb.db.prepare('DELETE FROM memories WHERE id = ?').run(memory.id);

  return true;
}

/**
 * Supersede memories — the resolution-as-fan-out consumer (slice 1).
 *
 * Marks current memories as superseded (tombstoned, retained for audit)
 * without deleting them. Targets either every current row carrying a
 * thread correlation id, or the single current row under a key in the
 * caller's scope. Idempotent: already-superseded rows are counted, not
 * an error, and a repeat call is a no-op.
 *
 * superseded_by is set to the row's own id — the self-pointer is the
 * tombstone-without-successor marker (every read path already filters
 * `superseded_by IS NULL`, so the fact disappears from get/search/list/
 * brief the moment this commits). supersede_reason carries the audit why.
 *
 * Graph edges for shared/global rows are removed (mirrors forgetMemory) so
 * stale memory:{key} edges don't outlive the fact.
 */
export function supersedeMemories(
  stateDb: StateDb,
  options: SupersedeMemoryOptions,
): SupersedeMemoryResult {
  const { thread_id, key, reason, agent_id } = options;

  if (!thread_id && !key) {
    throw new Error('supersede requires thread_id or key');
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (thread_id) {
    conditions.push('thread_id = ?');
    params.push(thread_id);
  }
  if (key) {
    conditions.push('key = ?');
    params.push(key);
  }
  // Scope rule (council round 1): a caller may only close facts it can see —
  // global rows plus its own agent scope. Never another agent's private facts.
  applyVisibilityFilter(conditions, params, agent_id);

  const matched = stateDb.db.prepare(
    `SELECT id, key, owner_scope, visibility, superseded_by FROM memories WHERE ${conditions.join(' AND ')}`
  ).all(...params) as Array<Pick<Memory, 'id' | 'key' | 'owner_scope' | 'visibility' | 'superseded_by'>>;

  const current = matched.filter((m) => m.superseded_by === null);
  const alreadySuperseded = matched.length - current.length;

  const now = Date.now();
  const stamp = stateDb.db.prepare(
    'UPDATE memories SET superseded_by = id, supersede_reason = ?, updated_at = ? WHERE id = ? AND superseded_by IS NULL'
  );

  for (const m of current) {
    stamp.run(reason ?? null, now, m.id);
    if (m.visibility === 'shared' && m.owner_scope === GLOBAL_OWNER_SCOPE) {
      removeGraphSignals(stateDb, m.key);
    }
  }

  return {
    superseded: current.map((m) => ({ id: m.id, key: m.key, owner_scope: m.owner_scope })),
    already_superseded: alreadySuperseded,
  };
}

/**
 * Unsupersede memories — the undo consumer for a reversed thread resolution
 * (thread-identity slice 4).
 *
 * Reverses supersedeMemories for one thread: clears superseded_by +
 * supersede_reason so the facts reappear in get/search/list/brief, and
 * restores the graph edges that supersede removed.
 *
 * Only SELF-TOMBSTONED rows are reversible — those with `superseded_by = id`,
 * the exact marker supersede writes. A row superseded by a *successor*
 * (`superseded_by != id`) was replaced by a newer fact, not tombstoned by a
 * thread resolution; reviving it would resurrect a stale value, so it is left
 * untouched and counted in `skipped`. Already-live rows skip the same way.
 *
 * Idempotent: the SQL guard `superseded_by = id` means a second call (or a
 * call on rows already cleared) is a no-op.
 */
export function unsupersedeMemories(
  stateDb: StateDb,
  options: UnsupersedeMemoryOptions,
): UnsupersedeMemoryResult {
  const { thread_id, agent_id } = options;

  if (!thread_id) {
    throw new Error('unsupersede requires thread_id');
  }

  const conditions: string[] = ['thread_id = ?'];
  const params: unknown[] = [thread_id];
  // Same visibility scope as supersede: a caller may only reverse facts it can
  // see — global rows plus its own agent scope.
  applyVisibilityFilter(conditions, params, agent_id);

  const matched = stateDb.db.prepare(
    `SELECT id, key, owner_scope, visibility, entities_json, superseded_by FROM memories WHERE ${conditions.join(' AND ')}`
  ).all(...params) as Array<Pick<Memory, 'id' | 'key' | 'owner_scope' | 'visibility' | 'entities_json' | 'superseded_by'>>;

  const reversible = matched.filter((m) => m.superseded_by !== null && m.superseded_by === m.id);
  const skipped = matched.length - reversible.length;

  const now = Date.now();
  const clear = stateDb.db.prepare(
    'UPDATE memories SET superseded_by = NULL, supersede_reason = NULL, updated_at = ? WHERE id = ? AND superseded_by = id'
  );

  for (const m of reversible) {
    clear.run(now, m.id);
    // Restore graph edges removed at supersede time, from the stored entity
    // list (mirrors storeMemory's shared/global rule — private/agent rows never
    // entered the shared graph).
    if (m.visibility === 'shared' && m.owner_scope === GLOBAL_OWNER_SCOPE && m.entities_json) {
      try {
        const entities = JSON.parse(m.entities_json) as string[];
        if (Array.isArray(entities) && entities.length > 0) {
          updateGraphSignals(stateDb, m.key, entities);
        }
      } catch { /* malformed entities_json — skip graph restore, fact is still revived */ }
    }
  }

  return {
    restored: reversible.map((m) => ({ id: m.id, key: m.key, owner_scope: m.owner_scope })),
    skipped,
  };
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
