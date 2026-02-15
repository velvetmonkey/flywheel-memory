/**
 * Tests for wikilink_feedback tool
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
  recordFeedback,
  getFeedback,
  getEntityStats,
  updateSuppressionList,
  isSuppressed,
  getSuppressedCount,
  getSuppressedEntities,
} from '../../../src/core/write/wikilinkFeedback.js';

describe('wikilink_feedback', () => {
  let vaultPath: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    vaultPath = await createTempVault();
    stateDb = openStateDb(vaultPath);
  });

  afterEach(async () => {
    stateDb.db.close();
    deleteStateDb(vaultPath);
    await cleanupTempVault(vaultPath);
  });

  // --------------------------------------------------------
  // Record feedback
  // --------------------------------------------------------
  describe('recordFeedback', () => {
    it('should record positive feedback', () => {
      recordFeedback(stateDb, 'TypeScript', 'using TypeScript for development', 'projects/web.md', true);

      const entries = getFeedback(stateDb);
      expect(entries).toHaveLength(1);
      expect(entries[0].entity).toBe('TypeScript');
      expect(entries[0].correct).toBe(true);
      expect(entries[0].note_path).toBe('projects/web.md');
    });

    it('should record negative feedback', () => {
      recordFeedback(stateDb, 'Java', 'drinking java coffee', 'daily/2026-01-01.md', false);

      const entries = getFeedback(stateDb);
      expect(entries).toHaveLength(1);
      expect(entries[0].correct).toBe(false);
    });

    it('should record multiple feedback entries', () => {
      recordFeedback(stateDb, 'React', 'built with React', 'tech/react.md', true);
      recordFeedback(stateDb, 'React', 'react to the news', 'daily/2026-01-02.md', false);
      recordFeedback(stateDb, 'Node', 'Node.js server', 'tech/node.md', true);

      const entries = getFeedback(stateDb);
      expect(entries).toHaveLength(3);
    });
  });

  // --------------------------------------------------------
  // Get feedback with filters
  // --------------------------------------------------------
  describe('getFeedback', () => {
    it('should filter by entity', () => {
      recordFeedback(stateDb, 'React', 'built with React', 'tech/react.md', true);
      recordFeedback(stateDb, 'Vue', 'using Vue', 'tech/vue.md', true);

      const entries = getFeedback(stateDb, 'React');
      expect(entries).toHaveLength(1);
      expect(entries[0].entity).toBe('React');
    });

    it('should respect limit', () => {
      for (let i = 0; i < 30; i++) {
        recordFeedback(stateDb, 'Entity', `context ${i}`, `note${i}.md`, true);
      }

      const entries = getFeedback(stateDb, undefined, 10);
      expect(entries).toHaveLength(10);
    });
  });

  // --------------------------------------------------------
  // Entity accuracy stats
  // --------------------------------------------------------
  describe('getEntityStats', () => {
    it('should compute accuracy stats per entity', () => {
      // 8 correct, 2 incorrect for "React"
      for (let i = 0; i < 8; i++) {
        recordFeedback(stateDb, 'React', `correct ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 2; i++) {
        recordFeedback(stateDb, 'React', `incorrect ${i}`, `note${i + 8}.md`, false);
      }

      const stats = getEntityStats(stateDb);
      expect(stats).toHaveLength(1);

      const react = stats[0];
      expect(react.entity).toBe('React');
      expect(react.total).toBe(10);
      expect(react.correct).toBe(8);
      expect(react.incorrect).toBe(2);
      expect(react.accuracy).toBe(0.8);
    });
  });

  // --------------------------------------------------------
  // Suppression threshold
  // --------------------------------------------------------
  describe('suppression', () => {
    it('should NOT suppress entity with < 10 feedback entries', () => {
      // Only 5 entries, all incorrect
      for (let i = 0; i < 5; i++) {
        recordFeedback(stateDb, 'Java', `false positive ${i}`, `note${i}.md`, false);
      }

      updateSuppressionList(stateDb);
      expect(isSuppressed(stateDb, 'Java')).toBe(false);
    });

    it('should suppress entity with >= 10 entries and >= 30% false positive rate', () => {
      // 10 entries: 6 correct, 4 incorrect (40% FP rate)
      for (let i = 0; i < 6; i++) {
        recordFeedback(stateDb, 'Java', `correct ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 4; i++) {
        recordFeedback(stateDb, 'Java', `incorrect ${i}`, `note${i + 6}.md`, false);
      }

      updateSuppressionList(stateDb);
      expect(isSuppressed(stateDb, 'Java')).toBe(true);
      expect(getSuppressedCount(stateDb)).toBe(1);
    });

    it('should NOT suppress entity with < 30% false positive rate', () => {
      // 10 entries: 8 correct, 2 incorrect (20% FP rate)
      for (let i = 0; i < 8; i++) {
        recordFeedback(stateDb, 'TypeScript', `correct ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 2; i++) {
        recordFeedback(stateDb, 'TypeScript', `incorrect ${i}`, `note${i + 8}.md`, false);
      }

      updateSuppressionList(stateDb);
      expect(isSuppressed(stateDb, 'TypeScript')).toBe(false);
    });

    it('should remove suppression when rate drops below threshold', () => {
      // First: 10 entries with 40% FP rate → suppressed
      for (let i = 0; i < 6; i++) {
        recordFeedback(stateDb, 'Spring', `correct ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 4; i++) {
        recordFeedback(stateDb, 'Spring', `incorrect ${i}`, `note${i + 6}.md`, false);
      }
      updateSuppressionList(stateDb);
      expect(isSuppressed(stateDb, 'Spring')).toBe(true);

      // Add 10 more correct entries → FP rate drops to 4/20 = 20%
      for (let i = 0; i < 10; i++) {
        recordFeedback(stateDb, 'Spring', `correct extra ${i}`, `note${i + 10}.md`, true);
      }
      updateSuppressionList(stateDb);
      expect(isSuppressed(stateDb, 'Spring')).toBe(false);
    });

    it('should return suppressed entities list', () => {
      // Create two entities that should be suppressed
      for (let i = 0; i < 10; i++) {
        recordFeedback(stateDb, 'Go', `fp ${i}`, `note${i}.md`, false);
      }
      for (let i = 0; i < 5; i++) {
        recordFeedback(stateDb, 'Rust', `correct ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 5; i++) {
        recordFeedback(stateDb, 'Rust', `fp ${i}`, `note${i + 5}.md`, false);
      }

      updateSuppressionList(stateDb);

      const suppressed = getSuppressedEntities(stateDb);
      expect(suppressed.length).toBe(2);

      const goEntry = suppressed.find(s => s.entity === 'Go');
      expect(goEntry).toBeDefined();
      expect(goEntry!.false_positive_rate).toBe(1.0);
    });
  });
});
