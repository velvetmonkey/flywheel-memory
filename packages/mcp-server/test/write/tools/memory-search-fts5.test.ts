/**
 * Regression: FTS5 column-injection in memory search.
 *
 * 2026-05-10 — scheduled jobs (zen-coach, morning-briefing, launch-monitor) failed
 * with `no such column: 41252` / `no such column: memory` because raw user queries
 * containing hyphenated alphanumeric tokens like `OC-41252` reached the
 * `memories_fts MATCH ?` clause unescaped — SQLite FTS5 then parsed `OC-41252` as a
 * column-qualified term and threw.
 *
 * The May 8 fix (#353) added `escapeFts5Query` but never reached the memory search
 * call site at `core/write/memory.ts:349`. These tests pin the call site to the
 * shared escape helper.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '@velvetmonkey/vault-core';
import { searchMemories, storeMemory } from '../../../src/core/write/memory.js';
import { createTempVault, cleanupTempVault } from '../helpers/testUtils.js';

describe('searchMemories FTS5 regressions', () => {
  let tempVault: string;
  let stateDb: StateDb | null = null;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);

    storeMemory(stateDb, {
      key: 'oc-41252-deploy',
      value: 'OC-41252 still not deployed to stage. Tesla dent photos overdue.',
      type: 'observation',
    });
    storeMemory(stateDb, {
      key: 'fwg-prep',
      value: 'FWG experiment Phase 0 prep not yet started. Witness theory expanding.',
      type: 'observation',
    });
    storeMemory(stateDb, {
      key: 'morning-briefing',
      value: 'Morning briefing: research findings overnight on flywheel concept.',
      type: 'summary',
    });
  });

  afterEach(async () => {
    if (stateDb) {
      stateDb.close();
      stateDb = null;
    }
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  // Today's failing queries — all observed in flywheel-engine logs 2026-05-10.
  it('handles hyphenated alphanumeric tokens (OC-41252)', () => {
    if (!stateDb) throw new Error('StateDb not initialized');
    expect(() => searchMemories(stateDb!, { query: 'OC-41252' })).not.toThrow();
  });

  it('handles the zen-coach query verbatim', () => {
    if (!stateDb) throw new Error('StateDb not initialized');
    const query = 'FWG experiment flywheel concept OC-41252 Tesla';
    expect(() => searchMemories(stateDb!, { query })).not.toThrow();
  });

  it('handles the morning-briefing query verbatim', () => {
    if (!stateDb) throw new Error('StateDb not initialized');
    const query = 'morning briefing research findings overnight FWG OC-41252 Tesla';
    expect(() => searchMemories(stateDb!, { query })).not.toThrow();
  });

  // `memory` is a column-name lookalike in some FTS5 contexts; left unquoted it
  // produced `no such column: memory` in today's logs.
  it('handles a bare `memory` token without column-reference injection', () => {
    if (!stateDb) throw new Error('StateDb not initialized');
    expect(() => searchMemories(stateDb!, { query: 'memory' })).not.toThrow();
  });

  it('handles ISO dates like 2026-05-08 (May 8 regression class)', () => {
    if (!stateDb) throw new Error('StateDb not initialized');
    expect(() => searchMemories(stateDb!, { query: '2026-05-08 briefing' })).not.toThrow();
  });

  it('returns matching memories for a normal alphanumeric query', () => {
    if (!stateDb) throw new Error('StateDb not initialized');
    const results = searchMemories(stateDb!, { query: 'flywheel' });
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty array (not throw) on an all-stripped query', () => {
    if (!stateDb) throw new Error('StateDb not initialized');
    const results = searchMemories(stateDb!, { query: '---' });
    expect(results).toEqual([]);
  });
});
