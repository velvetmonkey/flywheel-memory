/**
 * Tests for thread-identity slice 4: unsupersedeMemories — the undo consumer
 * for a reversed thread resolution.
 *
 * Contract: unsupersede reverses supersedeMemories for one thread, but ONLY
 * for self-tombstoned rows (superseded_by = id). Rows replaced by a successor
 * stay closed. Idempotent. Graph edges restored for shared/global rows.
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
  unsupersedeMemories,
  type Memory,
} from '../../../src/core/write/memory.js';

describe('unsupersedeMemories (thread-resolution undo)', () => {
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

  it('round-trip: supersede then unsupersede restores all current facts on the thread', () => {
    storeMemory(stateDb, { key: 'fact.a', value: 'alpha fact', type: 'fact', thread_id: 'thr-abc123' });
    storeMemory(stateDb, { key: 'fact.b', value: 'beta fact', type: 'fact', thread_id: 'thr-abc123' });
    storeMemory(stateDb, { key: 'fact.c', value: 'gamma fact', type: 'fact', thread_id: 'thr-other' });

    supersedeMemories(stateDb, { thread_id: 'thr-abc123', reason: 'thread-resolved' });
    expect(getMemory(stateDb, 'fact.a')).toBeNull();
    expect(getMemory(stateDb, 'fact.b')).toBeNull();

    const result = unsupersedeMemories(stateDb, { thread_id: 'thr-abc123' });
    expect(result.restored.map((m) => m.key).sort()).toEqual(['fact.a', 'fact.b']);
    expect(result.skipped).toBe(0);

    // Facts reappear in every read path; reason cleared; other thread untouched
    expect(getMemory(stateDb, 'fact.a')).not.toBeNull();
    expect(getMemory(stateDb, 'fact.b')).not.toBeNull();
    expect(listMemories(stateDb).map((m) => m.key).sort()).toEqual(['fact.a', 'fact.b', 'fact.c']);
    expect(searchMemories(stateDb, { query: 'alpha' })).toHaveLength(1);

    const row = rawRow('fact.a')!;
    expect(row.superseded_by).toBeNull();
    expect(row.supersede_reason).toBeNull();
  });

  it('is idempotent: a second unsupersede (or one on live rows) is a no-op', () => {
    storeMemory(stateDb, { key: 'fact.a', value: 'alpha', type: 'fact', thread_id: 'thr-x' });
    supersedeMemories(stateDb, { thread_id: 'thr-x' });

    const first = unsupersedeMemories(stateDb, { thread_id: 'thr-x' });
    expect(first.restored).toHaveLength(1);
    expect(first.skipped).toBe(0);

    // Second call: the row is already live → skipped, not restored again
    const second = unsupersedeMemories(stateDb, { thread_id: 'thr-x' });
    expect(second.restored).toHaveLength(0);
    expect(second.skipped).toBe(1);
  });

  it('does NOT revive a row superseded by a successor (only self-tombstones)', () => {
    // Simulate a real successor supersession: row replaced by a newer fact.
    storeMemory(stateDb, { key: 'fact.s', value: 'v1', type: 'fact', thread_id: 'thr-succ' });
    const original = rawRow('fact.s')!;
    // Insert a successor and point the original at it (superseded_by != id).
    storeMemory(stateDb, { key: 'fact.s2', value: 'v2 successor', type: 'fact', thread_id: 'thr-succ' });
    const successor = rawRow('fact.s2')!;
    stateDb.db.prepare('UPDATE memories SET superseded_by = ? WHERE id = ?').run(successor.id, original.id);

    const result = unsupersedeMemories(stateDb, { thread_id: 'thr-succ' });
    // fact.s was replaced, not thread-tombstoned → left closed
    expect(result.restored.map((m) => m.key)).not.toContain('fact.s');
    expect(rawRow('fact.s')!.superseded_by).toBe(successor.id);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it('requires thread_id', () => {
    expect(() => unsupersedeMemories(stateDb, { thread_id: '' })).toThrow(/thread_id/);
  });

  it('scope rule: caller without agent_id cannot unsupersede private facts on the thread', () => {
    storeMemory(stateDb, { key: 'fact.private', value: 'secret', type: 'fact', thread_id: 'thr-z', agent_id: 'agent-1', visibility: 'private' });
    storeMemory(stateDb, { key: 'fact.global', value: 'public', type: 'fact', thread_id: 'thr-z' });
    supersedeMemories(stateDb, { thread_id: 'thr-z', agent_id: 'agent-1' }); // owner closes both (sees global + own)

    // Global caller can only restore the global row
    const result = unsupersedeMemories(stateDb, { thread_id: 'thr-z' });
    expect(result.restored.map((m) => m.key)).toEqual(['fact.global']);
    expect(getMemory(stateDb, 'fact.private', 'agent-1')).toBeNull();

    // Owner restores the private one
    const owned = unsupersedeMemories(stateDb, { thread_id: 'thr-z', agent_id: 'agent-1' });
    expect(owned.restored.map((m) => m.key)).toEqual(['fact.private']);
    expect(getMemory(stateDb, 'fact.private', 'agent-1')).not.toBeNull();
  });

  it('restores graph edges for shared/global facts on undo', () => {
    stateDb.db.prepare(`
      INSERT INTO entities (name, name_lower, path, category) VALUES ('Kuramoto', 'kuramoto', 'notes/Kuramoto.md', 'concepts')
    `).run();

    storeMemory(stateDb, { key: 'fact.edge', value: 'Kuramoto sync threshold proven', type: 'fact', thread_id: 'thr-e' });
    supersedeMemories(stateDb, { thread_id: 'thr-e' });
    const edgesAfterSupersede = stateDb.db.prepare(
      "SELECT COUNT(*) as c FROM note_links WHERE note_path = 'memory:fact.edge'"
    ).get() as { c: number };
    expect(edgesAfterSupersede.c).toBe(0);

    unsupersedeMemories(stateDb, { thread_id: 'thr-e' });
    const edgesAfterUndo = stateDb.db.prepare(
      "SELECT COUNT(*) as c FROM note_links WHERE note_path = 'memory:fact.edge'"
    ).get() as { c: number };
    expect(edgesAfterUndo.c).toBeGreaterThan(0);
  });
});
