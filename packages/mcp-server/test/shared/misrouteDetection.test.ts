/**
 * Heuristic Misroute Detection Tests (T15b)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';
import { detectMisroute, recordHeuristicMisroute } from '../../src/core/shared/misrouteDetection.js';
import { recordToolInvocation } from '../../src/core/shared/toolTracking.js';
import { getHeuristicMisroutes, getToolSelectionStats } from '../../src/core/shared/toolSelectionFeedback.js';

describe('Heuristic Misroute Detection', () => {
  describe('detectMisroute', () => {
    it('should flag temporal query routed to non-temporal tool', () => {
      const result = detectMisroute('note_read', 'show me the timeline of Alice');
      expect(result).not.toBeNull();
      expect(result!.expectedCategory).toBe('temporal');
      expect(result!.ruleId).toBe('temporal-via-wrong-cat');
      expect(result!.ruleVersion).toBe(1);
    });

    it('should flag graph query routed to non-graph tool', () => {
      const result = detectMisroute('edit_section', 'backlinks to project Alpha');
      expect(result).not.toBeNull();
      expect(result!.expectedCategory).toBe('graph');
    });

    it('should flag schema query routed to non-schema tool', () => {
      const result = detectMisroute('note_read', 'show me the schema conventions');
      expect(result).not.toBeNull();
      expect(result!.expectedCategory).toBe('schema');
    });

    it('should flag wikilinks query routed to non-wikilink tool', () => {
      const result = detectMisroute('note_read', 'suggest wikilinks for this note');
      expect(result).not.toBeNull();
      expect(result!.expectedCategory).toBe('wikilinks');
    });

    it('should NOT flag search (catch-all)', () => {
      const result = detectMisroute('search', 'show me the timeline of Alice');
      expect(result).toBeNull();
    });

    it('should NOT flag brief (catch-all)', () => {
      const result = detectMisroute('brief', 'backlinks to project');
      expect(result).toBeNull();
    });

    it('should NOT flag when tool category matches expected', () => {
      const result = detectMisroute('track_concept_evolution', 'show me the timeline of Alice');
      expect(result).toBeNull();
    });

    it('should NOT flag non-matching write query', () => {
      const result = detectMisroute('edit_section', 'add this content to the log');
      expect(result).toBeNull();
    });

    it('should return null for empty query context', () => {
      expect(detectMisroute('note_read', '')).toBeNull();
      expect(detectMisroute('note_read', '  ')).toBeNull();
    });
  });

  describe('recordHeuristicMisroute', () => {
    let tempDir: string;
    let stateDb: StateDb;

    beforeAll(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'misroute-test-'));
      stateDb = openStateDb(tempDir);
    });

    afterAll(async () => {
      try { stateDb.db.close(); } catch { /* ignore */ }
      try { deleteStateDb(tempDir); } catch { /* ignore */ }
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should store heuristic advisory row with correct=NULL', () => {
      const invId = recordToolInvocation(stateDb, {
        tool_name: 'note_read',
        query_context: 'evolution of the project',
        session_id: 'test-sess',
      });

      const detection = detectMisroute('note_read', 'evolution of the project')!;
      recordHeuristicMisroute(stateDb, invId, detection);

      const misroutes = getHeuristicMisroutes(stateDb, 10);
      expect(misroutes.length).toBe(1);
      expect(misroutes[0].tool_name).toBe('note_read');
      expect(misroutes[0].query_context).toBe('evolution of the project');
      expect(misroutes[0].correct).toBeNull();
      expect(misroutes[0].source).toBe('heuristic');
      expect(misroutes[0].rule_id).toBe('temporal-via-wrong-cat');
      expect(misroutes[0].rule_version).toBe(1);
      expect(misroutes[0].expected_category).toBe('temporal');
      expect(misroutes[0].session_id).toBe('test-sess');
      expect(misroutes[0].tool_invocation_id).toBe(invId);
    });

    it('should not affect explicit feedback stats', () => {
      // Heuristic rows have correct=NULL, so they should be excluded from stats
      const stats = getToolSelectionStats(stateDb, 30);
      const noteStructStats = stats.find(s => s.tool_name === 'note_read');
      // No explicit feedback was recorded, so this tool shouldn't appear in stats
      expect(noteStructStats).toBeUndefined();
    });
  });
});
