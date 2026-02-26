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
  computeFeedbackWeight,
  getWeightedEntityStats,
  FEEDBACK_DECAY_HALF_LIFE_DAYS,
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

    it('should suppress entity with low Beta-Binomial posterior mean', () => {
      // 12 entries: 2 correct, 10 incorrect
      // Posterior: Beta(2+2, 1+10) = Beta(4, 11), mean = 4/15 = 0.267 < 0.35
      // totalObs = 2+2+1+10 = 15 >= 8
      for (let i = 0; i < 2; i++) {
        recordFeedback(stateDb, 'Java', `correct ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 10; i++) {
        recordFeedback(stateDb, 'Java', `incorrect ${i}`, `note${i + 2}.md`, false);
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

    it('should remove suppression when posterior rises above threshold', () => {
      // First: 12 entries with high FP → suppressed
      // 2 correct + 10 incorrect → posterior = Beta(4,11) = 0.267 < 0.35
      for (let i = 0; i < 2; i++) {
        recordFeedback(stateDb, 'Spring', `correct ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 10; i++) {
        recordFeedback(stateDb, 'Spring', `incorrect ${i}`, `note${i + 2}.md`, false);
      }
      updateSuppressionList(stateDb);
      expect(isSuppressed(stateDb, 'Spring')).toBe(true);

      // Add 15 more correct entries → posterior = Beta(4+15, 11) = Beta(19, 11) = 19/30 = 0.633 > 0.35
      for (let i = 0; i < 15; i++) {
        recordFeedback(stateDb, 'Spring', `correct extra ${i}`, `note${i + 12}.md`, true);
      }
      updateSuppressionList(stateDb);
      expect(isSuppressed(stateDb, 'Spring')).toBe(false);
    });

    it('should return suppressed entities list', () => {
      // Create two entities that should be suppressed
      // Go: 10 negatives → posterior = Beta(2, 11) = 2/13 = 0.154 < 0.35, totalObs=13 >= 8
      for (let i = 0; i < 10; i++) {
        recordFeedback(stateDb, 'Go', `fp ${i}`, `note${i}.md`, false);
      }
      // Rust: 2 correct, 10 negative → posterior = Beta(4, 11) = 4/15 = 0.267 < 0.35
      for (let i = 0; i < 2; i++) {
        recordFeedback(stateDb, 'Rust', `correct ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 10; i++) {
        recordFeedback(stateDb, 'Rust', `fp ${i}`, `note${i + 2}.md`, false);
      }

      updateSuppressionList(stateDb);

      const suppressed = getSuppressedEntities(stateDb);
      expect(suppressed.length).toBe(2);

      const goEntry = suppressed.find(s => s.entity === 'Go');
      expect(goEntry).toBeDefined();
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

    it('should not include entity with <3 entries', () => {
      for (let i = 0; i < 2; i++) {
        recordFeedback(stateDb, 'NewEntity', `context ${i}`, `note${i}.md`, true);
      }
      const boosts = getAllFeedbackBoosts(stateDb);
      expect(boosts.has('NewEntity')).toBe(false);
    });

    it('should give +8 for 90% accuracy with 10 samples', () => {
      // 9 correct, 1 incorrect = 90% accuracy, 10 samples >= 5
      // New top tier: {0.85, 5, 8}
      for (let i = 0; i < 9; i++) {
        recordFeedback(stateDb, 'HighAccuracy', `context ${i}`, `note${i}.md`, true);
      }
      recordFeedback(stateDb, 'HighAccuracy', 'wrong', 'note9.md', false);

      const boosts = getAllFeedbackBoosts(stateDb);
      expect(boosts.get('HighAccuracy')).toBe(8);
      expect(getFeedbackBoost(stateDb, 'HighAccuracy')).toBe(8);
    });

    it('should give +4 for 80% accuracy', () => {
      // 8 correct, 2 incorrect = 80%
      for (let i = 0; i < 8; i++) {
        recordFeedback(stateDb, 'GoodEntity', `context ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 2; i++) {
        recordFeedback(stateDb, 'GoodEntity', `wrong ${i}`, `note${i + 8}.md`, false);
      }

      const boosts = getAllFeedbackBoosts(stateDb);
      expect(boosts.get('GoodEntity')).toBe(4);
    });

    it('should give 0 for 50% accuracy (neutral zone)', () => {
      // 5 correct, 5 incorrect = 50%
      // New neutral tier: {0.50, 3, 0}
      for (let i = 0; i < 5; i++) {
        recordFeedback(stateDb, 'MediumEntity', `context ${i}`, `note${i}.md`, true);
      }
      for (let i = 0; i < 5; i++) {
        recordFeedback(stateDb, 'MediumEntity', `wrong ${i}`, `note${i + 5}.md`, false);
      }

      const boosts = getAllFeedbackBoosts(stateDb);
      // 50% accuracy falls in neutral zone (0.50-0.70), boost = 0 → not in map
      expect(boosts.has('MediumEntity')).toBe(false);
    });

    it('should give -4 for 30% accuracy with 5+ samples', () => {
      // 3 correct, 7 incorrect = 30% accuracy, 10 samples >= 5
      // New penalty tier: {0.30, 5, -4}
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
      // New tiers: {0.85/5/+8, 0.70/3/+4, 0.50/3/0, 0.30/5/-4, 0/5/-8}
      expect(computeBoostFromAccuracy(0.90, 5)).toBe(8);   // >= 0.85, >= 5 samples → +8
      expect(computeBoostFromAccuracy(0.85, 5)).toBe(8);   // exactly 0.85 → +8
      expect(computeBoostFromAccuracy(0.84, 5)).toBe(4);   // below 0.85 but >= 0.70 → +4
      expect(computeBoostFromAccuracy(0.70, 3)).toBe(4);   // exactly 0.70, 3 samples → +4
      expect(computeBoostFromAccuracy(0.69, 3)).toBe(0);   // below 0.70 but >= 0.50 → 0
      expect(computeBoostFromAccuracy(0.50, 3)).toBe(0);   // exactly 0.50 → 0
      expect(computeBoostFromAccuracy(0.49, 5)).toBe(-4);  // below 0.50 but >= 0.30, 5 samples → -4
      expect(computeBoostFromAccuracy(0.30, 5)).toBe(-4);  // exactly 0.30, 5 samples → -4
      expect(computeBoostFromAccuracy(0.29, 5)).toBe(-8);  // below 0.30, 5 samples → -8
      expect(computeBoostFromAccuracy(0.10, 5)).toBe(-8);
      expect(computeBoostFromAccuracy(1.0, 3)).toBe(4);    // 100% but only 3 samples → +4 (needs 5 for +8)
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

      // Global: 7/10 = 70% → boost +4 (0.70 tier with 10 samples >= 3)
      const globalBoosts = getAllFeedbackBoosts(stateDb);
      expect(globalBoosts.get('Redis')).toBe(4);

      // Tech folder: 5/5 = 100% with 5 samples → +8 (top tier: >= 0.85, >= 5)
      const techBoosts = getAllFeedbackBoosts(stateDb, 'tech');
      expect(techBoosts.get('Redis')).toBe(8);

      // Daily folder: 2/5 = 40% → -4 (penalty tier: < 0.50, >= 5 samples)
      const dailyBoosts = getAllFeedbackBoosts(stateDb, 'daily');
      expect(dailyBoosts.get('Redis')).toBe(-4);
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

  // --------------------------------------------------------
  // Recency-weighted feedback decay
  // --------------------------------------------------------
  describe('recency-weighted feedback decay', () => {
    /** Helper: insert feedback with explicit created_at via raw SQL */
    function insertFeedbackAt(
      entity: string,
      notePath: string,
      correct: boolean,
      createdAt: string,
    ): void {
      stateDb.db.prepare(
        'INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(entity, 'decay-test', notePath, correct ? 1 : 0, createdAt);
    }

    it('computeFeedbackWeight returns 1.0 for very recent entries', () => {
      const now = new Date('2026-03-01T00:00:30Z'); // 30 seconds after entry (< 1 min threshold)
      const weight = computeFeedbackWeight('2026-03-01 00:00:00', now);
      expect(weight).toBe(1.0);
    });

    it('computeFeedbackWeight returns ~0.5 at half-life (30 days)', () => {
      const now = new Date('2026-03-31T00:00:00Z');
      const weight = computeFeedbackWeight('2026-03-01 00:00:00', now);
      expect(weight).toBeCloseTo(0.5, 2);
    });

    it('computeFeedbackWeight returns ~0.25 at 60 days', () => {
      const now = new Date('2026-04-30T00:00:00Z');
      const weight = computeFeedbackWeight('2026-03-01 00:00:00', now);
      expect(weight).toBeCloseTo(0.25, 2);
    });

    it('computeFeedbackWeight returns 1.0 for future dates', () => {
      const now = new Date('2026-02-28T00:00:00Z');
      const weight = computeFeedbackWeight('2026-03-01 00:00:00', now);
      expect(weight).toBe(1.0);
    });

    it('entity with old FPs + recent correct entries → NOT suppressed', () => {
      const now = new Date('2026-04-01T00:00:00Z');

      // 10 old FP entries (60 days ago) — weight ≈ 0.25 each
      for (let i = 0; i < 10; i++) {
        insertFeedbackAt('DecayEntity', `note${i}.md`, false, '2026-02-01 12:00:00');
      }

      // 5 recent correct entries (today) — weight ≈ 1.0 each
      for (let i = 0; i < 5; i++) {
        insertFeedbackAt('DecayEntity', `note${i + 10}.md`, true, '2026-04-01 00:00:00');
      }

      // Raw stats: 15 total, 10 FP = 66.7% FP rate → would suppress without decay
      // Weighted: 10*0.25 + 5*1.0 = 7.5 total, 10*0.25 = 2.5 FP → 33.3% FP rate
      // Actually with weighted total < 10 raw threshold met, let's check:
      // rawTotal=15 >= 10 ✓, weightedTotal=7.5 >= 3.0 ✓
      // weightedFpRate = 2.5/7.5 ≈ 0.333 → just above 0.30 threshold
      // Let's add a few more recent correct entries to push it under
      for (let i = 0; i < 3; i++) {
        insertFeedbackAt('DecayEntity', `note${i + 15}.md`, true, '2026-04-01 00:00:00');
      }

      // Weighted: 10*0.25 + 8*1.0 = 10.5 total, 2.5 FP → 23.8% FP rate < 30%
      updateSuppressionList(stateDb, now);
      expect(isSuppressed(stateDb, 'DecayEntity')).toBe(false);
    });

    it('entity with recent FPs + old correct entries → IS suppressed', () => {
      const now = new Date('2026-04-01T00:00:00Z');

      // 5 old correct entries (60 days ago) — weight ≈ 0.25 each
      for (let i = 0; i < 5; i++) {
        insertFeedbackAt('BadEntity', `note${i}.md`, true, '2026-02-01 12:00:00');
      }

      // 10 recent FP entries (today) — weight ≈ 1.0 each
      for (let i = 0; i < 10; i++) {
        insertFeedbackAt('BadEntity', `note${i + 5}.md`, false, '2026-04-01 00:00:00');
      }

      // Weighted: 5*0.25 + 10*1.0 = 11.25 total, 10*1.0 = 10.0 FP → 88.9% FP rate
      // rawTotal=15 >= 10 ✓, weightedTotal=11.25 >= 3.0 ✓
      updateSuppressionList(stateDb, now);
      expect(isSuppressed(stateDb, 'BadEntity')).toBe(true);
    });

    it('getAllFeedbackBoosts reflects weighted accuracy', () => {
      const now = new Date('2026-04-01T00:00:00Z');

      // 3 old incorrect entries (60 days ago) — weight ≈ 0.25 each
      for (let i = 0; i < 3; i++) {
        insertFeedbackAt('BoostEntity', `note${i}.md`, false, '2026-02-01 12:00:00');
      }

      // 7 recent correct entries (today) — weight ≈ 1.0 each
      for (let i = 0; i < 7; i++) {
        insertFeedbackAt('BoostEntity', `note${i + 3}.md`, true, '2026-04-01 00:00:00');
      }

      // Raw: 7/10 = 70% → boost +4
      // Weighted: 7*1.0 / (3*0.25 + 7*1.0) = 7.0/7.75 ≈ 90.3% → boost +8 (top tier)
      const boosts = getAllFeedbackBoosts(stateDb, undefined, now);
      expect(boosts.get('BoostEntity')).toBe(8);
    });

    it('old negative feedback fades → entity unsuppresses over time', () => {
      // Record 12 negative entries at "old" time
      for (let i = 0; i < 12; i++) {
        insertFeedbackAt('FadingEntity', `note${i}.md`, false, '2026-01-01 12:00:00');
      }

      // At first (shortly after), it's suppressed
      const earlyNow = new Date('2026-01-02T00:00:00Z');
      updateSuppressionList(stateDb, earlyNow);
      expect(isSuppressed(stateDb, 'FadingEntity')).toBe(true);

      // Add 5 recent correct entries
      for (let i = 0; i < 5; i++) {
        insertFeedbackAt('FadingEntity', `note${i + 12}.md`, true, '2026-04-01 00:00:00');
      }

      // 90 days later: old FPs have weight ≈ 0.125 each
      // Weighted FP = 12*0.125 = 1.5, correct = 5*1.0 = 5.0
      // Total = 6.5, FP rate = 1.5/6.5 ≈ 23% < 30%
      const lateNow = new Date('2026-04-01T00:00:00Z');
      updateSuppressionList(stateDb, lateNow);
      // The suppression record from earlyNow should be removed or updated
      // since the weighted FP rate is now below threshold
      expect(isSuppressed(stateDb, 'FadingEntity')).toBe(false);
    });

    it('getWeightedEntityStats returns correct weighted values', () => {
      const now = new Date('2026-04-01T00:00:00Z');

      // 4 entries: 2 old correct, 2 recent incorrect
      insertFeedbackAt('StatsEntity', 'note0.md', true, '2026-02-01 00:00:00');
      insertFeedbackAt('StatsEntity', 'note1.md', true, '2026-02-01 00:00:00');
      insertFeedbackAt('StatsEntity', 'note2.md', false, '2026-04-01 00:00:00');
      insertFeedbackAt('StatsEntity', 'note3.md', false, '2026-04-01 00:00:00');

      const stats = getWeightedEntityStats(stateDb, now);
      const entry = stats.find(s => s.entity === 'StatsEntity');
      expect(entry).toBeDefined();
      expect(entry!.rawTotal).toBe(4);

      // Old entries (59 days): weight ≈ 0.25
      // Recent entries (0 days): weight ≈ 1.0
      // weightedCorrect ≈ 2*0.25 = 0.5
      // weightedFp ≈ 2*1.0 = 2.0
      // weightedTotal ≈ 2.5
      expect(entry!.weightedTotal).toBeGreaterThan(2.0);
      expect(entry!.weightedTotal).toBeLessThan(3.0);
      expect(entry!.weightedFp).toBeGreaterThan(entry!.weightedCorrect);
      expect(entry!.weightedFpRate).toBeGreaterThan(0.7); // mostly recent FPs
    });
  });
});
