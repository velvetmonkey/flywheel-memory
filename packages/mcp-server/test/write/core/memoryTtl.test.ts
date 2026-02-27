/**
 * Tests for sweepExpiredMemories — TTL-based memory cleanup
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTempVault,
  cleanupTempVault,
  openStateDb,
  deleteStateDb,
  type StateDb,
} from '../../helpers/testUtils.js';
import { sweepExpiredMemories } from '../../../src/core/write/memory.js';

describe('sweepExpiredMemories', () => {
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

  function insertMemory(key: string, createdAt: number, ttlDays: number | null): void {
    stateDb.db.prepare(`
      INSERT INTO memories (key, value, memory_type, confidence, created_at, updated_at, accessed_at, ttl_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(key, 'test-value', 'fact', 1.0, createdAt, createdAt, createdAt, ttlDays);
  }

  function memoryCount(): number {
    const row = stateDb.db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
    return row.count;
  }

  it('expired memory is deleted', () => {
    const twoDaysAgo = Date.now() - 2 * 86400000;
    insertMemory('expired-key', twoDaysAgo, 1);

    sweepExpiredMemories(stateDb);

    expect(memoryCount()).toBe(0);
  });

  it('non-expired memory survives', () => {
    const now = Date.now();
    insertMemory('fresh-key', now, 30);

    sweepExpiredMemories(stateDb);

    expect(memoryCount()).toBe(1);
  });

  it('memory with no TTL survives', () => {
    const longAgo = Date.now() - 365 * 86400000;
    insertMemory('no-ttl-key', longAgo, null);

    sweepExpiredMemories(stateDb);

    expect(memoryCount()).toBe(1);
  });

  it('returns correct count of swept memories', () => {
    const twoDaysAgo = Date.now() - 2 * 86400000;
    const now = Date.now();

    insertMemory('expired-1', twoDaysAgo, 1);
    insertMemory('expired-2', twoDaysAgo, 1);
    insertMemory('fresh-1', now, 30);

    const swept = sweepExpiredMemories(stateDb);

    expect(swept).toBe(2);
    expect(memoryCount()).toBe(1);
  });
});
