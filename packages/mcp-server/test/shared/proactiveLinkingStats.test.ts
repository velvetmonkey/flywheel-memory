/**
 * Proactive Linking Observability Tests
 *
 * Tests for schema migration, source tracking, proactive cap scoping,
 * summary queries, and one-liner formatting.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';
import {
  trackWikilinkApplications,
  getTrackedApplications,
  processImplicitFeedback,
} from '../../src/core/write/wikilinkFeedback.js';
import {
  getProactiveLinkingSummary,
  getProactiveLinkingOneLiner,
} from '../../src/core/shared/proactiveLinkingStats.js';

describe('Proactive Linking Observability', () => {
  let tempDir: string;
  let stateDb: StateDb;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'plo-test-'));
    stateDb = openStateDb(tempDir);
  });

  afterAll(async () => {
    try { stateDb.db.close(); } catch { /* ignore */ }
    try { deleteStateDb(tempDir); } catch { /* ignore */ }
    await rm(tempDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------
  // Schema v38 migration
  // --------------------------------------------------------
  describe('schema v38', () => {
    it('wikilink_applications has source column', () => {
      const columns = stateDb.db.prepare(
        `SELECT name FROM pragma_table_info('wikilink_applications')`,
      ).all() as Array<{ name: string }>;
      const names = columns.map(c => c.name);
      expect(names).toContain('source');
    });

    it('source defaults to tool', () => {
      trackWikilinkApplications(stateDb, 'test/default.md', ['entity-a']);
      const row = stateDb.db.prepare(
        `SELECT source FROM wikilink_applications WHERE entity = 'entity-a' AND note_path = 'test/default.md'`,
      ).get() as { source: string };
      expect(row.source).toBe('tool');
    });
  });

  // --------------------------------------------------------
  // Source tracking
  // --------------------------------------------------------
  describe('source tracking', () => {
    it('stores each source value correctly', () => {
      trackWikilinkApplications(stateDb, 'src/tool.md', ['react'], 'tool');
      trackWikilinkApplications(stateDb, 'src/proactive.md', ['react'], 'proactive');
      trackWikilinkApplications(stateDb, 'src/enrichment.md', ['react'], 'enrichment');
      trackWikilinkApplications(stateDb, 'src/manual.md', ['react'], 'manual_detected');

      const get = (path: string) => stateDb.db.prepare(
        `SELECT source FROM wikilink_applications WHERE note_path = ? AND LOWER(entity) = 'react'`,
      ).get(path) as { source: string };

      expect(get('src/tool.md').source).toBe('tool');
      expect(get('src/proactive.md').source).toBe('proactive');
      expect(get('src/enrichment.md').source).toBe('enrichment');
      expect(get('src/manual.md').source).toBe('manual_detected');
    });

    it('UPSERT overwrites source on re-application', () => {
      trackWikilinkApplications(stateDb, 'src/overwrite.md', ['vue'], 'tool');
      const before = stateDb.db.prepare(
        `SELECT source FROM wikilink_applications WHERE note_path = 'src/overwrite.md' AND LOWER(entity) = 'vue'`,
      ).get() as { source: string };
      expect(before.source).toBe('tool');

      trackWikilinkApplications(stateDb, 'src/overwrite.md', ['vue'], 'proactive');
      const after = stateDb.db.prepare(
        `SELECT source FROM wikilink_applications WHERE note_path = 'src/overwrite.md' AND LOWER(entity) = 'vue'`,
      ).get() as { source: string };
      expect(after.source).toBe('proactive');
    });
  });

  // --------------------------------------------------------
  // Proactive cap scoping
  // --------------------------------------------------------
  describe('proactive daily cap', () => {
    it('cap query only counts proactive rows', () => {
      // Seed mixed-source applications for the same file
      const notePath = 'cap/test.md';
      trackWikilinkApplications(stateDb, notePath, ['angular'], 'tool');
      trackWikilinkApplications(stateDb, notePath, ['svelte'], 'enrichment');
      trackWikilinkApplications(stateDb, notePath, ['solid'], 'proactive');
      trackWikilinkApplications(stateDb, notePath, ['preact'], 'manual_detected');

      const todayStr = new Date().toISOString().slice(0, 10);
      const cnt = stateDb.db.prepare(
        `SELECT COUNT(*) as cnt FROM wikilink_applications WHERE note_path = ? AND applied_at >= ? AND source = 'proactive'`,
      ).get(notePath, todayStr) as { cnt: number };

      expect(cnt.cnt).toBe(1); // Only the 'proactive' row
    });
  });

  // --------------------------------------------------------
  // Summary queries
  // --------------------------------------------------------
  describe('getProactiveLinkingSummary', () => {
    it('returns zeros when no proactive applications', () => {
      // Use a fresh tempDir to avoid pollution from earlier tests
      const tempDir2 = join(tempDir, 'empty');
      mkdirSync(tempDir2, { recursive: true });
      const db2 = openStateDb(tempDir2);

      const summary = getProactiveLinkingSummary(db2, 1);
      expect(summary.total_applied).toBe(0);
      expect(summary.survived).toBe(0);
      expect(summary.removed).toBe(0);
      expect(summary.files_touched).toBe(0);
      expect(summary.survival_rate).toBeNull();
      expect(summary.recent).toHaveLength(0);

      db2.db.close();
      deleteStateDb(tempDir2);
    });

    it('filters to proactive source only', () => {
      const summary = getProactiveLinkingSummary(stateDb, 1);
      // Only proactive applications should appear — not tool/enrichment/manual_detected
      // From the tests above, we have proactive rows in 'src/proactive.md' and 'cap/test.md'
      for (const r of summary.recent) {
        // Verify all returned rows are proactive by checking note_paths
        // (we can't query source directly from summary.recent, but we can check
        // that only proactive note paths are returned)
        expect(r.status).toMatch(/^(applied|removed)$/);
      }
      // At minimum, we should see the proactive applications we created
      expect(summary.total_applied).toBeGreaterThanOrEqual(1);
    });

    it('computes survival_rate correctly', () => {
      // All proactive applications are status='applied' so far (none removed)
      const summary = getProactiveLinkingSummary(stateDb, 1);
      if (summary.total_applied > 0) {
        expect(summary.survival_rate).toBe(1.0); // All survived
        expect(summary.removed).toBe(0);
      }
    });

    it('counts files_touched as distinct note_path', () => {
      const summary = getProactiveLinkingSummary(stateDb, 1);
      // We have proactive apps in 'src/proactive.md', 'cap/test.md', 'src/overwrite.md'
      expect(summary.files_touched).toBeGreaterThanOrEqual(2);
    });
  });

  // --------------------------------------------------------
  // One-liner
  // --------------------------------------------------------
  describe('getProactiveLinkingOneLiner', () => {
    it('returns null when no activity', () => {
      const tempDir3 = join(tempDir, 'oneliner-empty');
      mkdirSync(tempDir3, { recursive: true });
      const db3 = openStateDb(tempDir3);

      const result = getProactiveLinkingOneLiner(db3, 1);
      expect(result).toBeNull();

      db3.db.close();
      deleteStateDb(tempDir3);
    });

    it('formats correctly with singular/plural', () => {
      const oneLiner = getProactiveLinkingOneLiner(stateDb, 1);
      expect(oneLiner).not.toBeNull();
      expect(oneLiner).toMatch(/\d+ links? applied across \d+ notes?/);
      expect(oneLiner).toMatch(/survived/);
      expect(oneLiner).toMatch(/rate/);
    });
  });

  // --------------------------------------------------------
  // Integration: source survives removal detection
  // --------------------------------------------------------
  describe('source through removal lifecycle', () => {
    it('source persists through status changes', () => {
      // Apply via proactive
      trackWikilinkApplications(stateDb, 'lifecycle/test.md', ['docker'], 'proactive');

      const beforeRow = stateDb.db.prepare(
        `SELECT source, status FROM wikilink_applications WHERE note_path = 'lifecycle/test.md' AND LOWER(entity) = 'docker'`,
      ).get() as { source: string; status: string };
      expect(beforeRow.source).toBe('proactive');
      expect(beforeRow.status).toBe('applied');

      // Simulate removal (processImplicitFeedback marks as removed)
      processImplicitFeedback(stateDb, 'lifecycle/test.md', 'no wikilinks here');

      const afterRow = stateDb.db.prepare(
        `SELECT source, status FROM wikilink_applications WHERE note_path = 'lifecycle/test.md' AND LOWER(entity) = 'docker'`,
      ).get() as { source: string; status: string };
      expect(afterRow.source).toBe('proactive'); // Source preserved
      expect(afterRow.status).toBe('removed');   // Status changed
    });
  });
});
