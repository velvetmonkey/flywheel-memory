/**
 * Tests for mutation hints (SQLite StateDb)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  computeHash,
  readHints,
  writeHints,
  addMutationHint,
  getHintsForPath,
  getHintsSince,
  clearHints,
  setHintsStateDb,
} from '../../../src/core/write/hints.js';
import { createTempVault, cleanupTempVault } from '../helpers/testUtils.js';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';

describe('computeHash', () => {
  it('should produce consistent hashes', () => {
    const content = 'Hello, World!';
    const hash1 = computeHash(content);
    const hash2 = computeHash(content);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(12);
  });

  it('should produce different hashes for different content', () => {
    const hash1 = computeHash('Hello');
    const hash2 = computeHash('World');

    expect(hash1).not.toBe(hash2);
  });
});

describe('Hints operations', () => {
  let tempVault: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    tempVault = await createTempVault();
    stateDb = openStateDb(tempVault);
    setHintsStateDb(stateDb);
  });

  afterEach(async () => {
    setHintsStateDb(null);
    stateDb.db.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  describe('readHints/writeHints', () => {
    it('should return empty hints when no hints exist', () => {
      const hints = readHints();

      expect(hints.version).toBe(1);
      expect(hints.mutations).toHaveLength(0);
    });

    it('should write and read hints', () => {
      const hints = {
        version: 1,
        mutations: [
          {
            timestamp: '2026-01-29T12:00:00Z',
            path: 'note.md',
            operation: 'add_to_section',
            beforeHash: 'abc123',
            afterHash: 'def456',
          },
        ],
      };

      writeHints(hints);
      const read = readHints();

      expect(read).toEqual(hints);
    });
  });

  describe('addMutationHint', () => {
    it('should add a mutation hint', () => {
      const result = addMutationHint(
        'daily-notes/2026-01-29.md',
        'add_to_section',
        '# Before',
        '# After\n- New item'
      );

      expect(result).toBe(true);

      const hints = readHints();
      expect(hints.mutations).toHaveLength(1);
      expect(hints.mutations[0].path).toBe('daily-notes/2026-01-29.md');
      expect(hints.mutations[0].operation).toBe('add_to_section');
    });

    it('should add new hints at the front', () => {
      addMutationHint('first.md', 'op1', 'a', 'b');
      addMutationHint('second.md', 'op2', 'c', 'd');

      const hints = readHints();

      expect(hints.mutations[0].path).toBe('second.md');
      expect(hints.mutations[1].path).toBe('first.md');
    });

    it('should trim old hints at max limit', () => {
      // Add 105 hints (max is 100)
      for (let i = 0; i < 105; i++) {
        addMutationHint(`note${i}.md`, 'op', `${i}`, `${i + 1}`);
      }

      const hints = readHints();
      expect(hints.mutations).toHaveLength(100);

      // Most recent should be at the front
      expect(hints.mutations[0].path).toBe('note104.md');
    });
  });

  describe('getHintsForPath', () => {
    it('should filter hints by path', () => {
      addMutationHint('note1.md', 'op1', 'a', 'b');
      addMutationHint('note2.md', 'op2', 'c', 'd');
      addMutationHint('note1.md', 'op3', 'e', 'f');

      const hints = getHintsForPath('note1.md');

      expect(hints).toHaveLength(2);
      expect(hints.every(h => h.path === 'note1.md')).toBe(true);
    });

    it('should return empty array for unknown path', () => {
      addMutationHint('known.md', 'op', 'a', 'b');

      const hints = getHintsForPath('unknown.md');

      expect(hints).toHaveLength(0);
    });
  });

  describe('getHintsSince', () => {
    it('should filter hints by timestamp', () => {
      // Add hints with known timestamps
      const hints = {
        version: 1,
        mutations: [
          {
            timestamp: '2026-01-29T12:00:00Z',
            path: 'recent.md',
            operation: 'op1',
            beforeHash: 'a',
            afterHash: 'b',
          },
          {
            timestamp: '2026-01-28T12:00:00Z',
            path: 'older.md',
            operation: 'op2',
            beforeHash: 'c',
            afterHash: 'd',
          },
        ],
      };
      writeHints(hints);

      const since = new Date('2026-01-29T00:00:00Z');
      const filtered = getHintsSince(since);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].path).toBe('recent.md');
    });
  });

  describe('clearHints', () => {
    it('should remove all hints', () => {
      addMutationHint('note.md', 'op', 'a', 'b');
      clearHints();

      const hints = readHints();

      expect(hints.mutations).toHaveLength(0);
    });
  });
});
