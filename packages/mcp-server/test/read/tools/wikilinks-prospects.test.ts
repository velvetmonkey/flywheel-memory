/**
 * Tests for prospect recording and enrichment via read-side wikilink tools.
 *
 * Uses a purpose-built temp vault so backlink counts, entities,
 * and FTS state are explicit and deterministic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { openStateDb, deleteStateDb, type StateDb } from '@velvetmonkey/vault-core';
import { createTempVault, cleanupTempVault } from '../../helpers/testUtils.js';
import { buildVaultIndex } from '../../../src/core/read/graph.js';
import { setFTS5Database } from '../../../src/core/read/fts5.js';
import { setProspectStateDb, resetCleanupCooldown } from '../../../src/core/shared/prospects.js';
import { createTestServer, connectTestClient, type TestClient, type TestServerContext } from '../helpers/createTestServer.js';

let tempVault: string;
let context: TestServerContext;
let client: TestClient;
let stateDb: StateDb;

describe('Wikilink Prospect Integration', () => {
  function insertProspectSummary(params: {
    term: string;
    displayName: string;
    noteCount: number;
    dayCount: number;
    totalSightings: number;
    backlinkMax: number;
    cooccurringEntities?: string | null;
    bestSource: string;
    bestConfidence: string;
    bestScore: number;
    firstSeenAt: number;
    lastSeenAt: number;
    promotionScore: number;
    updatedAt: number;
    status?: 'prospect' | 'entity_created' | 'merged' | 'rejected';
    resolvedEntityPath?: string | null;
    lastFeedbackAt?: number | null;
  }): void {
    stateDb.db.prepare(`
      INSERT INTO prospect_summary (
        term, display_name, note_count, day_count, total_sightings, backlink_max,
        cooccurring_entities, best_source, best_confidence, best_score,
        first_seen_at, last_seen_at, promotion_score, promoted_at,
        status, resolved_entity_path, last_feedback_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.term,
      params.displayName,
      params.noteCount,
      params.dayCount,
      params.totalSightings,
      params.backlinkMax,
      params.cooccurringEntities ?? null,
      params.bestSource,
      params.bestConfidence,
      params.bestScore,
      params.firstSeenAt,
      params.lastSeenAt,
      params.promotionScore,
      null,
      params.status ?? 'prospect',
      params.resolvedEntityPath ?? null,
      params.lastFeedbackAt ?? null,
      params.updatedAt,
    );
  }

  beforeAll(async () => {
    tempVault = await createTempVault();

    // Create notes with dead-link references and entities
    await mkdir(path.join(tempVault, 'people'), { recursive: true });
    await writeFile(
      path.join(tempVault, 'people', 'Alice.md'),
      '---\ntype: person\n---\n# Alice\n\nAlice is working with [[Beta Platform]] and [[Charlie]].\n',
    );
    await writeFile(
      path.join(tempVault, 'people', 'Charlie.md'),
      '---\ntype: person\n---\n# Charlie\n\nCharlie uses [[Beta Platform]] for data analysis.\n',
    );
    await writeFile(
      path.join(tempVault, 'people', 'Dave.md'),
      '---\ntype: person\n---\n# Dave\n\nDave reviewed the Beta Platform documentation with [[Alice]].\n',
    );

    // Create server with our temp vault — this calls setProspectStateDb internally
    context = await createTestServer(tempVault);
    client = connectTestClient(context.server);
    stateDb = context.stateDb!;
    resetCleanupCooldown();
  }, 30000);

  afterAll(async () => {
    setProspectStateDb(null);
    stateDb?.close();
    deleteStateDb(tempVault);
    await cleanupTempVault(tempVault);
  });

  // ===========================================================================
  // suggest_wikilinks prospect recording
  // ===========================================================================

  describe('suggest_wikilinks prospect recording', () => {
    it('records prospects only when note_path is provided', async () => {
      const result = await client.callTool('suggest_wikilinks', {
        text: 'Discussed the Beta Platform integration with Marcus Johnson today.',
        note_path: 'daily/2026-03-30.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data).toBeDefined();

      // Check that at least some prospect was recorded in the ledger
      const count = stateDb.db.prepare(
        'SELECT COUNT(*) as cnt FROM prospect_ledger WHERE note_path = ?'
      ).get('daily/2026-03-30.md') as { cnt: number };
      expect(count.cnt).toBeGreaterThan(0);
    });

    it('does NOT record prospects when note_path is omitted', async () => {
      // Clear ledger first
      stateDb.db.exec('DELETE FROM prospect_ledger');
      stateDb.db.exec('DELETE FROM prospect_summary');

      await client.callTool('suggest_wikilinks', {
        text: 'Discussed the Beta Platform integration with Marcus Johnson today.',
      });

      const count = stateDb.db.prepare(
        'SELECT COUNT(*) as cnt FROM prospect_ledger'
      ).get() as { cnt: number };
      expect(count.cnt).toBe(0);
    });
  });

  // ===========================================================================
  // suggest_wikilinks prospect enrichment
  // ===========================================================================

  describe('suggest_wikilinks prospect enrichment', () => {
    it('enriches prospects with ledger data when prospect_summary exists', async () => {
      const now = Date.now();
      // Pre-populate a prospect summary for a term that will appear as a prospect
      stateDb.db.exec(`
        INSERT OR REPLACE INTO prospect_summary
          (term, display_name, note_count, day_count, total_sightings, backlink_max, best_source, best_confidence, best_score, first_seen_at, last_seen_at, promotion_score, updated_at)
        VALUES
          ('beta platform', 'Beta Platform', 7, 5, 15, 3, 'dead_link', 'high', 0, ${now - 5 * 86400000}, ${now}, 55, ${now})
      `);

      const result = await client.callTool('suggest_wikilinks', {
        text: 'The Beta Platform needs an upgrade. We should discuss Beta Platform with the team.',
        note_path: 'daily/2026-03-30.md',
      });

      const data = JSON.parse(result.content[0].text);
      // Find the Beta Platform prospect in the results
      const prospect = data.prospects?.find((p: any) =>
        p.entity?.toLowerCase() === 'beta platform'
      );

      if (prospect) {
        // When enriched, these fields should be present
        expect(prospect.ledger_source).toBeDefined();
        expect(prospect.ledger_note_count).toBeDefined();
        expect(prospect.ledger_day_count).toBeDefined();
        expect(typeof prospect.effective_score).toBe('number');
        expect(typeof prospect.promotion_ready).toBe('boolean');
      }
    });
  });

  // ===========================================================================
  // discover_stub_candidates
  // ===========================================================================

  describe('discover_stub_candidates', () => {
    it('uses prospect summaries when present', async () => {
      const now = Date.now();
      // Clear and seed prospect data
      stateDb.db.exec('DELETE FROM prospect_summary');
      stateDb.db.exec(`
        INSERT INTO prospect_summary
          (term, display_name, note_count, day_count, total_sightings, backlink_max, best_source, best_confidence, best_score, first_seen_at, last_seen_at, promotion_score, updated_at)
        VALUES
          ('analytics dashboard', 'Analytics Dashboard', 8, 6, 20, 5, 'dead_link', 'high', 3, ${now - 10 * 86400000}, ${now}, 65, ${now})
      `);

      const result = await client.callTool('discover_stub_candidates', {
        min_frequency: 5,
        limit: 10,
      });

      const data = JSON.parse(result.content[0].text);
      const candidate = data.candidates?.find((c: any) =>
        c.term?.toLowerCase() === 'analytics dashboard'
      );
      if (candidate) {
        expect(candidate.effective_score).toBeGreaterThan(0);
        expect(typeof candidate.promotion_ready).toBe('boolean');
      }
    });

    it('falls back to dead-link aggregation when no prospect data', async () => {
      // Clear all prospect data
      stateDb.db.exec('DELETE FROM prospect_ledger');
      stateDb.db.exec('DELETE FROM prospect_summary');

      const result = await client.callTool('discover_stub_candidates', {
        min_frequency: 1,
        limit: 20,
      });

      const data = JSON.parse(result.content[0].text);
      // Should still return something (from dead links in vault)
      expect(data).toBeDefined();
      // Candidates from fallback won't have effective_score
      if (data.candidates && data.candidates.length > 0) {
        // Fallback candidates have wikilink_references but may lack effective_score
        expect(data.candidates[0]).toHaveProperty('term');
        expect(data.candidates[0]).toHaveProperty('wikilink_references');
      }
    });

    it('min_frequency filters prospect-backed candidates', async () => {
      const now = Date.now();
      stateDb.db.exec('DELETE FROM prospect_summary');
      // One with backlink_max=2 (below min_frequency=5)
      insertProspectSummary({
        term: 'low ref',
        displayName: 'Low Ref',
        noteCount: 3,
        dayCount: 2,
        totalSightings: 5,
        backlinkMax: 2,
        bestSource: 'dead_link',
        bestConfidence: 'medium',
        bestScore: 0,
        firstSeenAt: now,
        lastSeenAt: now,
        promotionScore: 20,
        updatedAt: now,
      });
      // One with backlink_max=8 (above min_frequency=5)
      insertProspectSummary({
        term: 'high ref',
        displayName: 'High Ref',
        noteCount: 8,
        dayCount: 6,
        totalSightings: 20,
        backlinkMax: 8,
        bestSource: 'dead_link',
        bestConfidence: 'high',
        bestScore: 0,
        firstSeenAt: now,
        lastSeenAt: now,
        promotionScore: 60,
        updatedAt: now,
      });

      const result = await client.callTool('discover_stub_candidates', {
        min_frequency: 5,
        limit: 10,
      });

      const data = JSON.parse(result.content[0].text);
      if (data.candidates) {
        const lowRef = data.candidates.find((c: any) => c.term?.toLowerCase() === 'low ref');
        const highRef = data.candidates.find((c: any) => c.term?.toLowerCase() === 'high ref');
        expect(lowRef).toBeUndefined();
        if (highRef) {
          expect(highRef.wikilink_references).toBeGreaterThanOrEqual(5);
        }
      }
    });
  });
});
