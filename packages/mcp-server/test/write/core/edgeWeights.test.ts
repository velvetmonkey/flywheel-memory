/**
 * Tests for edge weight computation
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
  recomputeEdgeWeights,
  buildPathToTargetsMap,
  setEdgeWeightStateDb,
} from '../../../src/core/write/edgeWeights.js';

describe('edgeWeights', () => {
  let vaultPath: string;
  let stateDb: StateDb;

  beforeEach(async () => {
    vaultPath = await createTempVault();
    stateDb = openStateDb(vaultPath);
    setEdgeWeightStateDb(stateDb);
  });

  afterEach(async () => {
    stateDb.db.close();
    deleteStateDb(vaultPath);
    await cleanupTempVault(vaultPath);
  });

  describe('recomputeEdgeWeights', () => {
    it('handles empty note_links gracefully', () => {
      const result = recomputeEdgeWeights(stateDb);
      expect(result.edges_updated).toBe(0);
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('assigns base weight of 1.0 when no signals exist', () => {
      stateDb.db.prepare(
        "INSERT INTO note_links (note_path, target) VALUES (?, ?)"
      ).run('daily/2026-02-24.md', 'typescript');

      const result = recomputeEdgeWeights(stateDb);
      expect(result.edges_updated).toBe(1);

      const row = stateDb.db.prepare(
        'SELECT weight, weight_updated_at FROM note_links WHERE note_path = ? AND target = ?'
      ).get('daily/2026-02-24.md', 'typescript') as { weight: number; weight_updated_at: number };
      expect(row.weight).toBe(1.0);
      expect(row.weight_updated_at).toBeGreaterThan(0);
    });

    it('weights increase with edits_survived', () => {
      // Insert two edges
      stateDb.db.prepare(
        "INSERT INTO note_links (note_path, target) VALUES (?, ?)"
      ).run('note.md', 'target-a');
      stateDb.db.prepare(
        "INSERT INTO note_links (note_path, target) VALUES (?, ?)"
      ).run('note.md', 'target-b');

      // target-a has survived 6 edits, target-b has 0
      stateDb.db.prepare(
        "INSERT INTO note_link_history (note_path, target, edits_survived) VALUES (?, ?, ?)"
      ).run('note.md', 'target-a', 6);

      recomputeEdgeWeights(stateDb);

      const rows = stateDb.db.prepare(
        'SELECT target, weight FROM note_links WHERE note_path = ? ORDER BY target'
      ).all('note.md') as Array<{ target: string; weight: number }>;

      const a = rows.find(r => r.target === 'target-a')!;
      const b = rows.find(r => r.target === 'target-b')!;

      // a: 1.0 + (6 * 0.5) = 4.0, b: 1.0
      expect(a.weight).toBe(4.0);
      expect(b.weight).toBe(1.0);
      expect(a.weight).toBeGreaterThan(b.weight);
    });

    it('weights increase with co-session access', () => {
      // Create entity for target resolution
      stateDb.insertEntity.run('TypeScript', 'typescript', 'tech/TypeScript.md', 'technologies', '[]', 5, null);

      // Insert edge: note.md -> typescript
      stateDb.db.prepare(
        "INSERT INTO note_links (note_path, target) VALUES (?, ?)"
      ).run('note.md', 'typescript');

      // Insert tool invocations with shared session (note.md + tech/TypeScript.md)
      const sessionId = 'sess-123';
      stateDb.db.prepare(
        `INSERT INTO tool_invocations (tool_name, session_id, note_paths, timestamp)
         VALUES (?, ?, ?, ?)`
      ).run('read_note', sessionId, JSON.stringify(['note.md', 'tech/TypeScript.md']), Date.now());

      recomputeEdgeWeights(stateDb);

      const row = stateDb.db.prepare(
        'SELECT weight FROM note_links WHERE note_path = ? AND target = ?'
      ).get('note.md', 'typescript') as { weight: number };

      // 1.0 (base) + 0.5 (1 co-session * 0.5) + 0.2 (1 source access * 0.2) = 1.7
      expect(row.weight).toBe(1.7);
    });

    it('caps co-session and source activity contributions', () => {
      // Create entity
      stateDb.insertEntity.run('TypeScript', 'typescript', 'tech/TypeScript.md', 'technologies', '[]', 5, null);

      // Insert edge
      stateDb.db.prepare(
        "INSERT INTO note_links (note_path, target) VALUES (?, ?)"
      ).run('note.md', 'typescript');

      // Insert many sessions to exceed caps
      for (let i = 0; i < 20; i++) {
        stateDb.db.prepare(
          `INSERT INTO tool_invocations (tool_name, session_id, note_paths, timestamp)
           VALUES (?, ?, ?, ?)`
        ).run('read_note', `sess-${i}`, JSON.stringify(['note.md', 'tech/TypeScript.md']), Date.now() + i);
      }

      recomputeEdgeWeights(stateDb);

      const row = stateDb.db.prepare(
        'SELECT weight FROM note_links WHERE note_path = ? AND target = ?'
      ).get('note.md', 'typescript') as { weight: number };

      // 1.0 (base) + 3.0 (co-session capped) + 2.0 (source access capped) = 6.0
      expect(row.weight).toBe(6.0);
    });

    it('returns correct edge count and duration', () => {
      for (let i = 0; i < 5; i++) {
        stateDb.db.prepare(
          "INSERT INTO note_links (note_path, target) VALUES (?, ?)"
        ).run('note.md', `target-${i}`);
      }

      const result = recomputeEdgeWeights(stateDb);
      expect(result.edges_updated).toBe(5);
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('buildPathToTargetsMap', () => {
    it('maps entity path to name_lower', () => {
      stateDb.insertEntity.run('TypeScript', 'typescript', 'tech/TypeScript.md', 'technologies', '[]', 5, null);

      const map = buildPathToTargetsMap(stateDb);
      expect(map.get('tech/TypeScript.md')).toBeDefined();
      expect(map.get('tech/TypeScript.md')!.has('typescript')).toBe(true);
    });

    it('includes aliases', () => {
      stateDb.insertEntity.run('TypeScript', 'typescript', 'tech/TypeScript.md', 'technologies', '["TS", "ts-lang"]', 5, null);

      const map = buildPathToTargetsMap(stateDb);
      const targets = map.get('tech/TypeScript.md')!;
      expect(targets.has('typescript')).toBe(true);
      expect(targets.has('ts')).toBe(true);
      expect(targets.has('ts-lang')).toBe(true);
    });

    it('returns empty map when no entities exist', () => {
      const map = buildPathToTargetsMap(stateDb);
      expect(map.size).toBe(0);
    });
  });
});
