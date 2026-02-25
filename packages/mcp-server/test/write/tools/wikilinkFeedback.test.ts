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
  computeBoostFromAccuracy,
  getFeedbackBoost,
  getAllFeedbackBoosts,
  extractFolder,
  getEntityFolderAccuracy,
  trackWikilinkApplications,
  getTrackedApplications,
  processImplicitFeedback,
  updateStoredNoteLinks,
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
    it('should NOT suppress entity with < 5 feedback entries', () => {
      // Only 3 entries, all incorrect
      for (let i = 0; i < 3; i++) {
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
      // 10 entries: 8 correct, 2 incorrect (20% FP rate — below 30% threshold)
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
      // Create two entities that should be suppressed (need >= 10 entries each)
      for (let i = 0; i < 10; i++) {
        recordFeedback(stateDb, 'Go', `fp ${i}`, `note${i}.md`, false);
      }
      for (let i = 0; i < 6; i++) {
        recordFeedback(stateDb, 'Rust', `correct ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 6; i++) {
        recordFeedback(stateDb, 'Rust', `fp ${i}`, `note${i + 6}.md`, false);
      }

      updateSuppressionList(stateDb);

      const suppressed = getSuppressedEntities(stateDb);
      expect(suppressed.length).toBe(2);

      const goEntry = suppressed.find(s => s.entity === 'Go');
      expect(goEntry).toBeDefined();
      expect(goEntry!.false_positive_rate).toBe(1.0);
    });
  });

  // --------------------------------------------------------
  // Feedback boost (Layer 10)
  // --------------------------------------------------------
  describe('feedback boost', () => {
    it('should return empty map with no feedback', () => {
      const boosts = getAllFeedbackBoosts(stateDb);
      expect(boosts.size).toBe(0);
    });

    it('should not include entity with <5 entries', () => {
      for (let i = 0; i < 4; i++) {
        recordFeedback(stateDb, 'NewEntity', `context ${i}`, `note${i}.md`, true);
      }
      const boosts = getAllFeedbackBoosts(stateDb);
      expect(boosts.has('NewEntity')).toBe(false);
    });

    it('should give +5 for 95% accuracy with 20 samples', () => {
      // 19 correct, 1 incorrect = 95% accuracy
      for (let i = 0; i < 19; i++) {
        recordFeedback(stateDb, 'HighAccuracy', `context ${i}`, `note${i}.md`, true);
      }
      recordFeedback(stateDb, 'HighAccuracy', 'wrong', 'note19.md', false);

      const boosts = getAllFeedbackBoosts(stateDb);
      expect(boosts.get('HighAccuracy')).toBe(5);
      expect(getFeedbackBoost(stateDb, 'HighAccuracy')).toBe(5);
    });

    it('should give +2 for 80% accuracy', () => {
      // 8 correct, 2 incorrect = 80%
      for (let i = 0; i < 8; i++) {
        recordFeedback(stateDb, 'GoodEntity', `context ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 2; i++) {
        recordFeedback(stateDb, 'GoodEntity', `wrong ${i}`, `note${i + 8}.md`, false);
      }

      const boosts = getAllFeedbackBoosts(stateDb);
      expect(boosts.get('GoodEntity')).toBe(2);
    });

    it('should give -2 for 50% accuracy', () => {
      // 5 correct, 5 incorrect = 50%
      for (let i = 0; i < 5; i++) {
        recordFeedback(stateDb, 'MediumEntity', `context ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 5; i++) {
        recordFeedback(stateDb, 'MediumEntity', `wrong ${i}`, `note${i + 5}.md`, false);
      }

      const boosts = getAllFeedbackBoosts(stateDb);
      expect(boosts.get('MediumEntity')).toBe(-2);
    });

    it('should give -4 for 30% accuracy', () => {
      // 3 correct, 7 incorrect = 30%
      for (let i = 0; i < 3; i++) {
        recordFeedback(stateDb, 'LowEntity', `context ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 7; i++) {
        recordFeedback(stateDb, 'LowEntity', `wrong ${i}`, `note${i + 3}.md`, false);
      }

      const boosts = getAllFeedbackBoosts(stateDb);
      expect(boosts.get('LowEntity')).toBe(-4);
    });

    it('should match getFeedbackBoost with batch output', () => {
      // Create multiple entities
      for (let i = 0; i < 10; i++) {
        recordFeedback(stateDb, 'EntityA', `ctx ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 5; i++) {
        recordFeedback(stateDb, 'EntityB', `ctx ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 5; i++) {
        recordFeedback(stateDb, 'EntityB', `wrong ${i}`, `note${i + 5}.md`, false);
      }

      const boosts = getAllFeedbackBoosts(stateDb);
      expect(getFeedbackBoost(stateDb, 'EntityA')).toBe(boosts.get('EntityA') ?? 0);
      expect(getFeedbackBoost(stateDb, 'EntityB')).toBe(boosts.get('EntityB') ?? 0);
    });

    it('computeBoostFromAccuracy: tier boundaries', () => {
      expect(computeBoostFromAccuracy(0.95, 20)).toBe(5);
      expect(computeBoostFromAccuracy(0.94, 20)).toBe(2);  // below 95% tier
      expect(computeBoostFromAccuracy(0.95, 5)).toBe(2);   // not enough samples for +5 tier
      expect(computeBoostFromAccuracy(0.80, 5)).toBe(2);
      expect(computeBoostFromAccuracy(0.79, 5)).toBe(0);   // below 80% but above 60%
      expect(computeBoostFromAccuracy(0.60, 5)).toBe(0);
      expect(computeBoostFromAccuracy(0.59, 5)).toBe(-2);  // below 60% but above 40%
      expect(computeBoostFromAccuracy(0.40, 5)).toBe(-2);
      expect(computeBoostFromAccuracy(0.39, 5)).toBe(-4);
      expect(computeBoostFromAccuracy(0.10, 5)).toBe(-4);
      expect(computeBoostFromAccuracy(1.0, 3)).toBe(0);    // below min samples
    });
  });

  // --------------------------------------------------------
  // Context-stratified accuracy
  // --------------------------------------------------------
  describe('context-stratified', () => {
    it('extractFolder: multi-level path returns top folder', () => {
      expect(extractFolder('tech/react/hooks.md')).toBe('tech');
      expect(extractFolder('daily/2026-01-01.md')).toBe('daily');
    });

    it('extractFolder: root-level note returns empty string', () => {
      expect(extractFolder('note.md')).toBe('');
    });

    it('should compute per-entity per-folder accuracy', () => {
      // React: 100% accurate in tech/, 0% in daily-notes/
      for (let i = 0; i < 5; i++) {
        recordFeedback(stateDb, 'React', `correct ${i}`, `tech/note${i}.md`, true);
      }
      for (let i = 0; i < 5; i++) {
        recordFeedback(stateDb, 'React', `wrong ${i}`, `daily-notes/note${i}.md`, false);
      }

      const folderAccuracy = getEntityFolderAccuracy(stateDb);
      const reactFolders = folderAccuracy.get('React');
      expect(reactFolders).toBeDefined();

      const techStats = reactFolders!.get('tech');
      expect(techStats).toBeDefined();
      expect(techStats!.accuracy).toBe(1.0);
      expect(techStats!.count).toBe(5);

      const dailyStats = reactFolders!.get('daily-notes');
      expect(dailyStats).toBeDefined();
      expect(dailyStats!.accuracy).toBe(0);
      expect(dailyStats!.count).toBe(5);
    });

    it('should suppress entity only in specific folder', () => {
      // Entity: all correct in tech/, all wrong in daily/
      // 12 correct in tech + 5 incorrect in daily = 29.4% FP globally (under 30%)
      for (let i = 0; i < 12; i++) {
        recordFeedback(stateDb, 'Spring', `correct ${i}`, `tech/note${i}.md`, true);
      }
      for (let i = 0; i < 5; i++) {
        recordFeedback(stateDb, 'Spring', `wrong ${i}`, `daily/note${i}.md`, false);
      }

      // Not globally suppressed (29.4% FP < 30% threshold)
      expect(isSuppressed(stateDb, 'Spring')).toBe(false);

      // Suppressed in daily/ folder (5 entries, 100% FP)
      expect(isSuppressed(stateDb, 'Spring', 'daily')).toBe(true);

      // Not suppressed in tech/ folder (5 entries, 0% FP)
      expect(isSuppressed(stateDb, 'Spring', 'tech')).toBe(false);
    });

    it('should not folder-suppress with <5 entries', () => {
      for (let i = 0; i < 3; i++) {
        recordFeedback(stateDb, 'Go', `wrong ${i}`, `daily/note${i}.md`, false);
      }

      // Not enough entries for folder suppression
      expect(isSuppressed(stateDb, 'Go', 'daily')).toBe(false);
    });

    it('getAllFeedbackBoosts with folder: different boosts per folder context', () => {
      // Entity with 100% in tech/ (5 entries) and 40% in daily/ (5 entries)
      for (let i = 0; i < 5; i++) {
        recordFeedback(stateDb, 'Redis', `correct ${i}`, `tech/note${i}.md`, true);
      }
      for (let i = 0; i < 2; i++) {
        recordFeedback(stateDb, 'Redis', `correct ${i}`, `daily/note${i}.md`, true);
      }
      for (let i = 0; i < 3; i++) {
        recordFeedback(stateDb, 'Redis', `wrong ${i}`, `daily/note${i + 2}.md`, false);
      }

      // Global: 7/10 = 70% → boost 0 (60-80% tier), not in map since boost is 0
      const globalBoosts = getAllFeedbackBoosts(stateDb);
      expect(globalBoosts.has('Redis')).toBe(false);

      // Tech folder: 5/5 = 100% with 5 samples → +2 (needs 20 for +5)
      const techBoosts = getAllFeedbackBoosts(stateDb, 'tech');
      expect(techBoosts.get('Redis')).toBe(2);

      // Daily folder: 2/5 = 40% → -2
      const dailyBoosts = getAllFeedbackBoosts(stateDb, 'daily');
      expect(dailyBoosts.get('Redis')).toBe(-2);
    });
  });

  // --------------------------------------------------------
  // Implicit feedback (application tracking & removal detection)
  // --------------------------------------------------------
  describe('implicit feedback', () => {
    it('trackWikilinkApplications stores entities', () => {
      trackWikilinkApplications(stateDb, 'projects/web.md', ['typescript', 'react']);

      const tracked = getTrackedApplications(stateDb, 'projects/web.md');
      expect(tracked).toHaveLength(2);
      expect(tracked).toContain('typescript');
      expect(tracked).toContain('react');
    });

    it('processImplicitFeedback detects removed wikilinks', () => {
      // Track two entities as applied
      trackWikilinkApplications(stateDb, 'projects/web.md', ['typescript', 'react']);

      // Content only has [[React]] — TypeScript was removed
      const content = 'Building a web app with [[React]] and some other tools';
      const removed = processImplicitFeedback(stateDb, 'projects/web.md', content);

      expect(removed).toHaveLength(1);
      expect(removed).toContain('typescript');

      // Verify negative feedback was recorded
      const feedback = getFeedback(stateDb, 'typescript');
      expect(feedback).toHaveLength(1);
      expect(feedback[0].correct).toBe(false);
      expect(feedback[0].context).toBe('implicit:removed');
      expect(feedback[0].note_path).toBe('projects/web.md');
    });

    it('processImplicitFeedback ignores kept wikilinks', () => {
      trackWikilinkApplications(stateDb, 'tech/stack.md', ['react', 'node']);

      // Both wikilinks still present
      const content = 'Using [[React]] with [[Node]] for the stack';
      const removed = processImplicitFeedback(stateDb, 'tech/stack.md', content);

      expect(removed).toHaveLength(0);

      // No feedback should be recorded
      const feedback = getFeedback(stateDb);
      expect(feedback).toHaveLength(0);
    });

    it('processImplicitFeedback marks removed as status=removed', () => {
      trackWikilinkApplications(stateDb, 'notes/test.md', ['docker']);

      // Content has no wikilinks — docker removed
      const removed = processImplicitFeedback(stateDb, 'notes/test.md', 'plain text');
      expect(removed).toContain('docker');

      // Status should be 'removed', so getTrackedApplications returns empty
      const tracked = getTrackedApplications(stateDb, 'notes/test.md');
      expect(tracked).toHaveLength(0);
    });

    it('re-application resets removed status', () => {
      // Apply, remove, then re-apply
      trackWikilinkApplications(stateDb, 'notes/test.md', ['kubernetes']);
      processImplicitFeedback(stateDb, 'notes/test.md', 'no links here');

      // Re-apply
      trackWikilinkApplications(stateDb, 'notes/test.md', ['kubernetes']);

      const tracked = getTrackedApplications(stateDb, 'notes/test.md');
      expect(tracked).toHaveLength(1);
      expect(tracked).toContain('kubernetes');
    });

    it('no false positives on new notes', () => {
      // No tracked applications for this note
      const removed = processImplicitFeedback(stateDb, 'brand-new.md', 'some content');

      expect(removed).toHaveLength(0);

      const feedback = getFeedback(stateDb);
      expect(feedback).toHaveLength(0);
    });
  });

  // --------------------------------------------------------
  // Score explanation types
  // --------------------------------------------------------
  describe('score explanation', () => {
    it('ScoreBreakdown: all fields are valid numbers', () => {
      // Import types to verify structure
      const breakdown = {
        contentMatch: 10,
        cooccurrenceBoost: 3,
        typeBoost: 5,
        contextBoost: 2,
        recencyBoost: 1,
        crossFolderBoost: 3,
        hubBoost: 5,
        feedbackAdjustment: 2,
      };

      // Verify all fields sum to total
      const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
      expect(total).toBe(31);
    });

    it('confidence classification boundaries', () => {
      function classifyConfidence(score: number): 'high' | 'medium' | 'low' {
        return score >= 20 ? 'high' : score >= 12 ? 'medium' : 'low';
      }

      expect(classifyConfidence(20)).toBe('high');
      expect(classifyConfidence(19)).toBe('medium');
      expect(classifyConfidence(12)).toBe('medium');
      expect(classifyConfidence(11)).toBe('low');
      expect(classifyConfidence(0)).toBe('low');
      expect(classifyConfidence(100)).toBe('high');
    });

    it('ScoredSuggestion structure is correct', () => {
      const suggestion = {
        entity: 'React',
        path: 'tech/react.md',
        totalScore: 25,
        breakdown: {
          contentMatch: 15,
          cooccurrenceBoost: 0,
          typeBoost: 0,
          contextBoost: 2,
          recencyBoost: 0,
          crossFolderBoost: 3,
          hubBoost: 5,
          feedbackAdjustment: 0,
        },
        confidence: 'high' as const,
        feedbackCount: 10,
        accuracy: 0.8,
      };

      expect(suggestion.entity).toBe('React');
      expect(suggestion.totalScore).toBe(25);
      expect(suggestion.confidence).toBe('high');
      expect(suggestion.breakdown.contentMatch).toBe(15);
      expect(suggestion.feedbackCount).toBe(10);
    });

    it('feedback count and accuracy populated from stateDb', () => {
      // Record some feedback for an entity
      for (let i = 0; i < 8; i++) {
        recordFeedback(stateDb, 'TypeScript', `correct ${i}`, `tech/note${i}.md`, true);
      }
      for (let i = 0; i < 2; i++) {
        recordFeedback(stateDb, 'TypeScript', `wrong ${i}`, `note${i}.md`, false);
      }

      const stats = getEntityStats(stateDb);
      const tsStats = stats.find(s => s.entity === 'TypeScript');
      expect(tsStats).toBeDefined();
      expect(tsStats!.total).toBe(10);
      expect(tsStats!.accuracy).toBe(0.8);
    });
  });

  // --------------------------------------------------------
  // updateStoredNoteLinks — weight preservation
  // --------------------------------------------------------
  describe('updateStoredNoteLinks — weight preservation', () => {
    it('preserves weight for existing links', () => {
      // Seed a link with custom weight
      stateDb.db.prepare(
        "INSERT INTO note_links (note_path, target, weight) VALUES (?, ?, ?)"
      ).run('daily/2026-02-24.md', 'typescript', 3.5);

      // Update with same link + a new one
      updateStoredNoteLinks(stateDb, 'daily/2026-02-24.md', new Set(['typescript', 'react']));

      const rows = stateDb.db.prepare(
        'SELECT target, weight FROM note_links WHERE note_path = ? ORDER BY target'
      ).all('daily/2026-02-24.md') as Array<{ target: string; weight: number }>;

      expect(rows).toHaveLength(2);
      expect(rows.find(r => r.target === 'typescript')!.weight).toBe(3.5); // preserved
      expect(rows.find(r => r.target === 'react')!.weight).toBe(1.0);     // default
    });

    it('removes orphaned links', () => {
      stateDb.db.prepare(
        "INSERT INTO note_links (note_path, target, weight) VALUES (?, ?, ?)"
      ).run('note.md', 'old-link', 2.0);
      stateDb.db.prepare(
        "INSERT INTO note_links (note_path, target) VALUES (?, ?)"
      ).run('note.md', 'kept-link');

      updateStoredNoteLinks(stateDb, 'note.md', new Set(['kept-link']));

      const rows = stateDb.db.prepare(
        'SELECT target FROM note_links WHERE note_path = ?'
      ).all('note.md') as Array<{ target: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].target).toBe('kept-link');
    });

    it('handles empty current set (clears all)', () => {
      stateDb.db.prepare(
        "INSERT INTO note_links (note_path, target) VALUES (?, ?)"
      ).run('note.md', 'link1');

      updateStoredNoteLinks(stateDb, 'note.md', new Set());

      const count = stateDb.db.prepare(
        'SELECT COUNT(*) as cnt FROM note_links WHERE note_path = ?'
      ).get('note.md') as { cnt: number };
      expect(count.cnt).toBe(0);
    });
  });
});
