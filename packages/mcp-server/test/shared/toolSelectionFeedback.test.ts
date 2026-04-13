/**
 * Tool Selection Feedback Tests (T15a)
 *
 * Tests for query context extraction, feedback recording, hydration,
 * Beta-Binomial posterior accuracy, and learning report integration.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';
import { recordToolInvocation } from '../../src/core/shared/toolTracking.js';
import {
  recordToolSelectionFeedback,
  getToolSelectionList,
  getToolSelectionStats,
  getToolEffectivenessScores,
  getToolSelectionReport,
} from '../../src/core/shared/toolSelectionFeedback.js';

describe('Tool Selection Feedback', () => {
  let tempDir: string;
  let stateDb: StateDb;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tsf-test-'));
    stateDb = openStateDb(tempDir);
  });

  afterAll(async () => {
    try { stateDb.db.close(); } catch { /* ignore */ }
    try { deleteStateDb(tempDir); } catch { /* ignore */ }
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('recordToolInvocation returns id', () => {
    it('should return a positive integer id', () => {
      const id = recordToolInvocation(stateDb, {
        tool_name: 'search',
        query_context: 'quarterly review',
      });
      expect(id).toBeGreaterThan(0);
      expect(typeof id).toBe('number');
    });

    it('should persist query_context', () => {
      const id = recordToolInvocation(stateDb, {
        tool_name: 'read',
        query_context: 'Log',
        session_id: 'test-session-1',
      });

      const row = stateDb.db.prepare(
        'SELECT query_context, session_id FROM tool_invocations WHERE id = ?'
      ).get(id) as { query_context: string; session_id: string };

      expect(row.query_context).toBe('Log');
      expect(row.session_id).toBe('test-session-1');
    });

    it('should store null query_context when not provided', () => {
      const id = recordToolInvocation(stateDb, {
        tool_name: 'vault_add_to_section',
      });

      const row = stateDb.db.prepare(
        'SELECT query_context FROM tool_invocations WHERE id = ?'
      ).get(id) as { query_context: string | null };

      expect(row.query_context).toBeNull();
    });
  });

  describe('recordToolSelectionFeedback', () => {
    it('should record explicit feedback with tool_name', () => {
      const id = recordToolSelectionFeedback(stateDb, {
        tool_name: 'search',
        correct: false,
        expected_tool: 'track_concept_evolution',
        expected_category: 'temporal',
      });
      expect(id).toBeGreaterThan(0);

      const entries = getToolSelectionList(stateDb, 1);
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].tool_name).toBe('search');
      expect(entries[0].correct).toBe(false);
      expect(entries[0].expected_tool).toBe('track_concept_evolution');
      expect(entries[0].source).toBe('explicit');
    });

    it('should hydrate from tool_invocation_id', () => {
      // First create an invocation
      const invId = recordToolInvocation(stateDb, {
        tool_name: 'graph_analysis',
        query_context: 'connections to Alice',
        session_id: 'hydrate-test',
      });

      // Record feedback pointing at that invocation
      const feedbackId = recordToolSelectionFeedback(stateDb, {
        tool_invocation_id: invId,
        correct: true,
      });

      const entries = getToolSelectionList(stateDb, 10);
      const entry = entries.find(e => e.id === feedbackId);
      expect(entry).toBeDefined();
      expect(entry!.tool_name).toBe('graph_analysis');
      expect(entry!.query_context).toBe('connections to Alice');
      expect(entry!.session_id).toBe('hydrate-test');
      expect(entry!.correct).toBe(true);
    });

    it('should throw when neither tool_invocation_id nor tool_name provided', () => {
      expect(() => recordToolSelectionFeedback(stateDb, {
        correct: false,
      })).toThrow('tool_name is required');
    });
  });

  describe('getToolSelectionStats (Beta-Binomial)', () => {
    let statsDb: StateDb;
    let statsDir: string;

    beforeAll(async () => {
      statsDir = await mkdtemp(join(tmpdir(), 'tsf-stats-'));
      statsDb = openStateDb(statsDir);

      // 8 correct, 2 wrong for 'search'
      for (let i = 0; i < 8; i++) {
        recordToolSelectionFeedback(statsDb, { tool_name: 'search', correct: true });
      }
      for (let i = 0; i < 2; i++) {
        recordToolSelectionFeedback(statsDb, { tool_name: 'search', correct: false });
      }

      // 3 correct, 7 wrong for 'vault_add_to_section'
      for (let i = 0; i < 3; i++) {
        recordToolSelectionFeedback(statsDb, { tool_name: 'vault_add_to_section', correct: true });
      }
      for (let i = 0; i < 7; i++) {
        recordToolSelectionFeedback(statsDb, { tool_name: 'vault_add_to_section', correct: false });
      }
    });

    afterAll(async () => {
      try { statsDb.db.close(); } catch { /* ignore */ }
      try { deleteStateDb(statsDir); } catch { /* ignore */ }
      await rm(statsDir, { recursive: true, force: true });
    });

    it('should compute correct posterior for high-accuracy tool', () => {
      const stats = getToolSelectionStats(statsDb, 30);
      const searchStat = stats.find(s => s.tool_name === 'search');
      expect(searchStat).toBeDefined();
      // posterior = (4 + 8) / (4 + 8 + 1 + 2) = 12/15 = 0.8
      expect(searchStat!.posterior_accuracy).toBe(0.8);
      expect(searchStat!.correct_count).toBe(8);
      expect(searchStat!.wrong_count).toBe(2);
    });

    it('should compute correct posterior for low-accuracy tool', () => {
      const stats = getToolSelectionStats(statsDb, 30);
      const addStat = stats.find(s => s.tool_name === 'vault_add_to_section');
      expect(addStat).toBeDefined();
      // posterior = (4 + 3) / (4 + 3 + 1 + 7) = 7/15 ≈ 0.467
      expect(addStat!.posterior_accuracy).toBe(0.467);
    });
  });

  describe('getToolEffectivenessScores', () => {
    let effDb: StateDb;
    let effDir: string;

    beforeAll(async () => {
      effDir = await mkdtemp(join(tmpdir(), 'tsf-eff-'));
      effDb = openStateDb(effDir);

      // 20 data points for 'search' (above threshold)
      for (let i = 0; i < 15; i++) {
        recordToolSelectionFeedback(effDb, { tool_name: 'search', correct: true });
      }
      for (let i = 0; i < 5; i++) {
        recordToolSelectionFeedback(effDb, { tool_name: 'search', correct: false });
      }

      // 5 data points for 'brief' (below threshold)
      for (let i = 0; i < 5; i++) {
        recordToolSelectionFeedback(effDb, { tool_name: 'brief', correct: true });
      }
    });

    afterAll(async () => {
      try { effDb.db.close(); } catch { /* ignore */ }
      try { deleteStateDb(effDir); } catch { /* ignore */ }
      await rm(effDir, { recursive: true, force: true });
    });

    it('should include tools with sufficient observations', () => {
      const scores = getToolEffectivenessScores(effDb, 15);
      expect(scores.has('search')).toBe(true);
      expect(scores.get('search')).toBeGreaterThan(0);
    });

    it('should exclude tools below observation threshold', () => {
      const scores = getToolEffectivenessScores(effDb, 15);
      expect(scores.has('brief')).toBe(false);
    });
  });

  describe('getToolSelectionReport', () => {
    it('should return null when no feedback exists', async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), 'tsf-empty-'));
      const emptyDb = openStateDb(emptyDir);
      try {
        const report = getToolSelectionReport(emptyDb, 7);
        expect(report).toBeNull();
      } finally {
        try { emptyDb.db.close(); } catch { /* ignore */ }
        try { deleteStateDb(emptyDir); } catch { /* ignore */ }
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it('should return report with data when feedback exists', async () => {
      const reportDir = await mkdtemp(join(tmpdir(), 'tsf-report-'));
      const reportDb = openStateDb(reportDir);
      try {
        recordToolSelectionFeedback(reportDb, { tool_name: 'search', correct: true });
        recordToolSelectionFeedback(reportDb, { tool_name: 'search', correct: false });
        recordToolSelectionFeedback(reportDb, { tool_name: 'graph_analysis', correct: false });

        const report = getToolSelectionReport(reportDb, 7);
        expect(report).not.toBeNull();
        expect(report!.total_feedback).toBe(3);
        expect(report!.confirmed_correct).toBe(1);
        expect(report!.confirmed_wrong).toBe(2);
        expect(report!.accuracy_rate).toBe(0.333);
        expect(report!.top_reported_wrong_tools.length).toBeGreaterThan(0);
      } finally {
        try { reportDb.db.close(); } catch { /* ignore */ }
        try { deleteStateDb(reportDir); } catch { /* ignore */ }
        await rm(reportDir, { recursive: true, force: true });
      }
    });
  });
});
