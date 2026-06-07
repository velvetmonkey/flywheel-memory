/**
 * Tests for thread-identity slice 1: supersedeMemories + the upsert
 * resurrection fix.
 *
 * The release gate (plan v5): a superseded fact must never resurface in
 * get/search/list after supersede — INCLUDING after a routine same-key
 * cron re-store, which previously reset superseded_by = NULL.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTempVault,
  cleanupTempVault,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../../helpers/testUtils.js';
import {
  storeMemory,
  getMemory,
  searchMemories,
  listMemories,
  supersedeMemories,
  type Memory,
} from '../../../src/core/write/memory.js';

describe('supersedeMemories + upsert resurrection fix', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
  });

  afterEach(async () => {
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  function rawRow(key: string): Memory | undefined {
    return stateDb.db.prepare('SELECT * FROM memories WHERE key = ?').get(key) as Memory | undefined;
  }

  it('v44 migration shape: thread_id + supersede_reason columns and index exist', () => {
    const columns = new Set(
      (stateDb.db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>).map((r) => r.name)
    );
    expect(columns.has('thread_id')).toBe(true);
    expect(columns.has('supersede_reason')).toBe(true);

    const indexes = (stateDb.db.prepare('PRAGMA index_list(memories)').all() as Array<{ name: string }>).map((r) => r.name);
    expect(indexes).toContain('idx_memories_thread_id');
  });

  it('store stamps thread_id; supersede by thread_id tombstones all current rows', () => {
    storeMemory(stateDb, { key: 'fact.a', value: 'alpha fact', type: 'fact', thread_id: 'thr-abc123' });
    storeMemory(stateDb, { key: 'fact.b', value: 'beta fact', type: 'fact', thread_id: 'thr-abc123' });
    storeMemory(stateDb, { key: 'fact.c', value: 'gamma fact', type: 'fact', thread_id: 'thr-other' });

    const result = supersedeMemories(stateDb, { thread_id: 'thr-abc123', reason: 'thread-resolved' });

    expect(result.superseded.map((m) => m.key).sort()).toEqual(['fact.a', 'fact.b']);
    expect(result.already_superseded).toBe(0);

    // Tombstoned rows vanish from every read path but are retained in the table
    expect(getMemory(stateDb, 'fact.a')).toBeNull();
    expect(getMemory(stateDb, 'fact.b')).toBeNull();
    expect(getMemory(stateDb, 'fact.c')).not.toBeNull();
    expect(listMemories(stateDb).map((m) => m.key)).toEqual(['fact.c']);
    expect(searchMemories(stateDb, { query: 'alpha' })).toHaveLength(0);

    const row = rawRow('fact.a');
    expect(row).toBeDefined();
    expect(row!.superseded_by).toBe(row!.id); // self-pointer tombstone
    expect(row!.supersede_reason).toBe('thread-resolved');
  });

  it('supersede is idempotent: repeat call is a counted no-op', () => {
    storeMemory(stateDb, { key: 'fact.a', value: 'alpha', type: 'fact', thread_id: 'thr-x' });

    const first = supersedeMemories(stateDb, { thread_id: 'thr-x' });
    expect(first.superseded).toHaveLength(1);
    expect(first.already_superseded).toBe(0);

    const second = supersedeMemories(stateDb, { thread_id: 'thr-x' });
    expect(second.superseded).toHaveLength(0);
    expect(second.already_superseded).toBe(1);
  });

  it('supersede by key tombstones the single current row in scope', () => {
    storeMemory(stateDb, { key: 'fact.solo', value: 'solo', type: 'fact' });

    const result = supersedeMemories(stateDb, { key: 'fact.solo', reason: 'closed' });
    expect(result.superseded).toHaveLength(1);
    expect(getMemory(stateDb, 'fact.solo')).toBeNull();
  });

  it('supersede requires thread_id or key', () => {
    expect(() => supersedeMemories(stateDb, {})).toThrow(/thread_id or key/);
  });

  it('RELEASE GATE: same-key re-store does NOT resurrect a superseded fact', () => {
    storeMemory(stateDb, { key: 'fact.cron', value: 'original', type: 'fact', thread_id: 'thr-y' });
    supersedeMemories(stateDb, { thread_id: 'thr-y', reason: 'thread-resolved' });
    expect(getMemory(stateDb, 'fact.cron')).toBeNull();

    // The cron job idempotently re-stores the same fact — the old upsert
    // reset superseded_by = NULL here and silently un-superseded it.
    const restored = storeMemory(stateDb, { key: 'fact.cron', value: 'original', type: 'fact' });

    expect(restored.superseded_by).not.toBeNull(); // store result reflects tombstone
    expect(getMemory(stateDb, 'fact.cron')).toBeNull();
    expect(listMemories(stateDb).map((m) => m.key)).not.toContain('fact.cron');
    expect(searchMemories(stateDb, { query: 'original' })).toHaveLength(0);

    const row = rawRow('fact.cron');
    expect(row!.supersede_reason).toBe('thread-resolved'); // audit trail preserved
    expect(row!.thread_id).toBe('thr-y'); // correlation id not stripped by re-store
  });

  it('re-store without thread_id keeps the existing thread_id; with one, updates it', () => {
    storeMemory(stateDb, { key: 'fact.t', value: 'v1', type: 'fact', thread_id: 'thr-keep' });
    storeMemory(stateDb, { key: 'fact.t', value: 'v2', type: 'fact' });
    expect(rawRow('fact.t')!.thread_id).toBe('thr-keep');

    storeMemory(stateDb, { key: 'fact.t', value: 'v3', type: 'fact', thread_id: 'thr-new' });
    expect(rawRow('fact.t')!.thread_id).toBe('thr-new');
  });

  it('scope rule: caller without agent_id cannot supersede private facts on the thread', () => {
    storeMemory(stateDb, { key: 'fact.private', value: 'secret', type: 'fact', thread_id: 'thr-z', agent_id: 'agent-1', visibility: 'private' });
    storeMemory(stateDb, { key: 'fact.global', value: 'public', type: 'fact', thread_id: 'thr-z' });

    const result = supersedeMemories(stateDb, { thread_id: 'thr-z' });
    expect(result.superseded.map((m) => m.key)).toEqual(['fact.global']);

    // private fact untouched, still visible to its owner
    expect(getMemory(stateDb, 'fact.private', 'agent-1')).not.toBeNull();

    // owner's call closes it
    const owned = supersedeMemories(stateDb, { thread_id: 'thr-z', agent_id: 'agent-1' });
    expect(owned.superseded.map((m) => m.key)).toEqual(['fact.private']);
    expect(getMemory(stateDb, 'fact.private', 'agent-1')).toBeNull();
  });

  it('supersede removes graph edges for shared/global facts (no stale memory:{key} edges)', () => {
    // Seed an entity so detection creates a memory→entity edge
    stateDb.db.prepare(`
      INSERT INTO entities (name, name_lower, path, category) VALUES ('Kuramoto', 'kuramoto', 'notes/Kuramoto.md', 'concepts')
    `).run();

    storeMemory(stateDb, { key: 'fact.edge', value: 'Kuramoto sync threshold proven', type: 'fact', thread_id: 'thr-e' });
    const edgesBefore = stateDb.db.prepare(
      "SELECT COUNT(*) as c FROM note_links WHERE note_path = 'memory:fact.edge'"
    ).get() as { c: number };
    expect(edgesBefore.c).toBeGreaterThan(0);

    supersedeMemories(stateDb, { thread_id: 'thr-e' });
    const edgesAfter = stateDb.db.prepare(
      "SELECT COUNT(*) as c FROM note_links WHERE note_path = 'memory:fact.edge'"
    ).get() as { c: number };
    expect(edgesAfter.c).toBe(0);
  });

  it('re-store on a superseded shared fact does not resurrect graph edges', () => {
    stateDb.db.prepare(`
      INSERT INTO entities (name, name_lower, path, category) VALUES ('Kuramoto', 'kuramoto', 'notes/Kuramoto.md', 'concepts')
    `).run();
    storeMemory(stateDb, { key: 'fact.ghost', value: 'Kuramoto fact', type: 'fact', thread_id: 'thr-g' });
    supersedeMemories(stateDb, { thread_id: 'thr-g' });

    storeMemory(stateDb, { key: 'fact.ghost', value: 'Kuramoto fact', type: 'fact' });
    const edges = stateDb.db.prepare(
      "SELECT COUNT(*) as c FROM note_links WHERE note_path = 'memory:fact.ghost'"
    ).get() as { c: number };
    expect(edges.c).toBe(0);
  });
});
