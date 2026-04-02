/**
 * Trace test: cascading flywheel
 *
 * Verifies multi-step workflows where one tool's output feeds into another:
 * create → mutate (add wikilink) → backlinks connect, and
 * create → search → mutate → search.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('cascading flywheel traces', () => {
  describe('create → enrich → backlinks connect', () => {
    let ctx: WriteTestServerContext;
    let client: TestClient;

    beforeAll(async () => {
      ctx = await createWriteTestServer();
      client = connectTestClient(ctx.server);

      // Create entity note
      await createTestNote(ctx.vaultPath, 'people/Dana.md', [
        '---',
        'type: person',
        '---',
        '',
        '# Dana',
        '',
        'Dana is a product manager.',
      ].join('\n'));

      // Create daily note with plain-text mention (no wikilinks yet)
      await createTestNote(ctx.vaultPath, 'daily/2026-03-01.md', [
        '---',
        'type: daily',
        '---',
        '',
        '# 2026-03-01',
        '',
        'Met with Dana to discuss the roadmap.',
      ].join('\n'));

      // Build initial index
      await snap(client, 'refresh_index');
    }, 30_000);

    afterAll(async () => {
      await ctx?.cleanup();
    });

    it('adding wikilink via mutation creates backlink on target', async () => {
      // Simulate enrichment: replace plain "Dana" with [[Dana]] wikilink
      await snap(client, 'vault_replace_in_section', {
        path: 'daily/2026-03-01.md',
        section: '2026-03-01',
        search: 'Met with Dana to discuss the roadmap.',
        replacement: 'Met with [[Dana]] to discuss the roadmap.',
      });
      await snap(client, 'refresh_index');

      // Assert: Dana gains a backlink from the daily note
      const result = await snap(client, 'search', { query: 'Dana' });
      const note = (result.results ?? []).find((n: any) => n.path === 'people/Dana.md');
      expect(note).toBeDefined();
      expect(note.backlink_count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('create → search → mutate → search', () => {
    let ctx: WriteTestServerContext;
    let client: TestClient;

    beforeAll(async () => {
      ctx = await createWriteTestServer();
      client = connectTestClient(ctx.server);

      await createTestNote(ctx.vaultPath, 'notes/framework.md', [
        '---',
        'type: note',
        '---',
        '',
        '# Framework Analysis',
        '',
        '## Details',
        '',
        'reactxyztoken framework analysis for the project.',
      ].join('\n'));

      await snap(client, 'refresh_index');
    }, 30_000);

    afterAll(async () => {
      await ctx?.cleanup();
    });

    it('mutated content replaces old search results', async () => {
      // Verify original content is searchable
      const before = await snap(client, 'search', { query: 'reactxyztoken' });
      expect(before.total_results).toBeGreaterThanOrEqual(1);

      // Replace content
      await snap(client, 'vault_replace_in_section', {
        path: 'notes/framework.md',
        section: 'Details',
        search: 'reactxyztoken',
        replacement: 'vuexyztoken',
      });
      await snap(client, 'refresh_index');

      // Old content gone
      const afterOld = await snap(client, 'search', { query: 'reactxyztoken' });
      expect(afterOld.total_results).toBe(0);

      // New content found
      const afterNew = await snap(client, 'search', { query: 'vuexyztoken' });
      expect(afterNew.total_results).toBeGreaterThanOrEqual(1);
    });
  });
});
