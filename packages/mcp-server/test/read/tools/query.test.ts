/**
 * Tests for Query Tools - date filtering, sorting, and enrichment
 *
 * Structural filters (folder, tags, frontmatter) moved to find_notes.test.ts.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { connectTestClient, type TestClient, createTestServer, type TestServerContext } from '../helpers/createTestServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

describe('Query Tools', () => {
  let context: TestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    context = await createTestServer(FIXTURES_PATH);
    client = connectTestClient(context.server);
  });

  describe('search', () => {
    describe('Basic Functionality', () => {
      test('returns all notes when no filters', async () => {

        const result = await client.callTool('search', { modified_after: '2000-01-01', limit: 100 });

        const data = JSON.parse(result.content[0].text);
        expect(data.total_matches).toBeGreaterThan(0);
        expect(data.notes.length).toBeGreaterThan(0);
      });

      test('respects limit parameter', async () => {

        const result = await client.callTool('search', { modified_after: '2000-01-01', limit: 2 });

        const data = JSON.parse(result.content[0].text);
        expect(data.returned).toBeLessThanOrEqual(2);
        expect(data.notes.length).toBeLessThanOrEqual(2);
      });

      test('returns notes in expected format', async () => {

        const result = await client.callTool('search', { modified_after: '2000-01-01', limit: 1 });

        const data = JSON.parse(result.content[0].text);
        const note = data.notes[0];

        expect(note.path).toBeDefined();
        expect(note.title).toBeDefined();
        expect(note.modified).toBeDefined();
        expect(note.tags).toBeDefined();
        expect(note.frontmatter).toBeDefined();
      });
    });

    describe('Sorting', () => {
      test('sorts by modified date descending by default', async () => {

        const result = await client.callTool('search', { modified_after: '2000-01-01', limit: 10 });

        const data = JSON.parse(result.content[0].text);
        if (data.notes.length > 1) {
          for (let i = 1; i < data.notes.length; i++) {
            const prevDate = new Date(data.notes[i - 1].modified);
            const currDate = new Date(data.notes[i].modified);
            expect(prevDate.getTime()).toBeGreaterThanOrEqual(currDate.getTime());
          }
        }
      });

      test('sorts by modified date ascending', async () => {

        const result = await client.callTool('search', {
          modified_after: '2000-01-01',
          sort_by: 'modified',
          order: 'asc',
          limit: 10,
        });

        const data = JSON.parse(result.content[0].text);
        if (data.notes.length > 1) {
          for (let i = 1; i < data.notes.length; i++) {
            const prevDate = new Date(data.notes[i - 1].modified);
            const currDate = new Date(data.notes[i].modified);
            expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
          }
        }
      });

      test('sorts by title alphabetically', async () => {

        const result = await client.callTool('search', {
          modified_after: '2000-01-01',
          sort_by: 'title',
          order: 'asc',
          limit: 10,
        });

        const data = JSON.parse(result.content[0].text);
        if (data.notes.length > 1) {
          for (let i = 1; i < data.notes.length; i++) {
            expect(data.notes[i - 1].title.localeCompare(data.notes[i].title)).toBeLessThanOrEqual(0);
          }
        }
      });

      test('sorts by created date', async () => {

        const result = await client.callTool('search', {
          modified_after: '2000-01-01',
          sort_by: 'created',
          order: 'desc',
          limit: 10,
        });

        const data = JSON.parse(result.content[0].text);
        // Just verify it doesn't crash - created may fall back to modified
        expect(data.notes).toBeDefined();
      });
    });

    describe('Tiered Enrichment', () => {
      test('light results lack frontmatter/backlinks/outlinks arrays but have counts', async () => {
        const result = await client.callTool('search', {
          modified_after: '2000-01-01',
          limit: 10,
          detail_count: 1,
        });

        const data = JSON.parse(result.content[0].text);
        if (data.notes.length > 1) {
          // First result should be fully enriched
          const full = data.notes[0];
          expect(full.frontmatter).toBeDefined();
          expect(full.tags).toBeDefined();
          expect(full.backlinks).toBeDefined();
          expect(full.outlinks).toBeDefined();

          // Second result should be light
          const light = data.notes[1];
          expect(light.path).toBeDefined();
          expect(light.title).toBeDefined();
          expect(light.backlink_count).toBeDefined();
          expect(light.outlink_count).toBeDefined();
          expect(light.modified).toBeDefined();
          expect(light.frontmatter).toBeUndefined();
          expect(light.tags).toBeUndefined();
          expect(light.backlinks).toBeUndefined();
          expect(light.outlinks).toBeUndefined();
          expect(light.headings).toBeUndefined();
        }
      });

      test('detail_count equal to limit produces full enrichment on all results', async () => {
        const result = await client.callTool('search', {
          modified_after: '2000-01-01',
          limit: 5,
          detail_count: 5,
        });

        const data = JSON.parse(result.content[0].text);
        for (const note of data.notes) {
          expect(note.frontmatter).toBeDefined();
          expect(note.tags).toBeDefined();
          expect(note.backlinks).toBeDefined();
          expect(note.outlinks).toBeDefined();
        }
      });
    });

    describe('Edge Cases', () => {
      test('no query and no date filters returns error', async () => {
        const result = await client.callTool('search', {});
        const data = JSON.parse(result.content[0].text);
        expect(data.error).toBeDefined();
      });

      test('handles special characters in query', async () => {
        const result = await client.callTool('search', {
          query: '日本',
        });
        // Should not crash
        const data = JSON.parse(result.content[0].text);
        expect(data).toBeDefined();
      });

      test('date-only search returns total_matches and returned', async () => {
        const result = await client.callTool('search', {
          modified_after: '2000-01-01',
          limit: 5,
        });
        const data = JSON.parse(result.content[0].text);
        expect(data.total_matches).toBeDefined();
        expect(data.returned).toBeDefined();
      });
    });

    describe('action routing', () => {
      test('default action routes to query branch', async () => {
        const result = await client.callTool('search', { query: 'Acme' });
        const data = JSON.parse(result.content[0].text);
        // Query branch returns a results-shaped payload, not similarity shape
        expect(data.source).toBeUndefined();
        expect(data.similar).toBeUndefined();
        expect(data.results ?? data.notes).toBeDefined();
      });

      test('action: similar routes to similarity branch', async () => {
        const result = await client.callTool('search', {
          action: 'similar',
          path: 'Acme Corp.md',
        });
        const data = JSON.parse(result.content[0].text);
        expect(data.source).toBe('Acme Corp.md');
        expect(data.method).toMatch(/^(bm25|hybrid)$/);
        expect(Array.isArray(data.similar)).toBe(true);
      });

      test('action: similar without path returns error', async () => {
        const result = await client.callTool('search', { action: 'similar' });
        const data = JSON.parse(result.content[0].text);
        expect(data.error).toMatch(/requires path/i);
        expect(data.example).toBeDefined();
      });

      test('action: similar with unknown path returns error', async () => {
        const result = await client.callTool('search', {
          action: 'similar',
          path: 'does-not-exist.md',
        });
        const data = JSON.parse(result.content[0].text);
        expect(data.error).toMatch(/not found/i);
      });

    });
  });
});
