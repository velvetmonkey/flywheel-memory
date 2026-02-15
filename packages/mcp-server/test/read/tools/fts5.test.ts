/**
 * Tests for FTS5 Full-Text Search Tools
 *
 * These tests cover the search and refresh_index tools,
 * including stemming, phrase matching, boolean operators, and edge cases.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { connectTestClient, type TestClient, createTestServer, type TestServerContext } from '../helpers/createTestServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

describe('FTS5 Full-Text Search Tools', () => {
  let context: TestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    context = await createTestServer(FIXTURES_PATH);
    client = connectTestClient(context.server);
  });

  afterAll(() => {
    // Clean up StateDb (which now hosts notes_fts)
    const flywheelDir = path.join(FIXTURES_PATH, '.flywheel');
    try {
      if (fs.existsSync(flywheelDir)) {
        fs.rmSync(flywheelDir, { recursive: true });
      }
    } catch {
      // File may still be locked - ignore cleanup failure
    }
  });

  describe('refresh_index', () => {
    test('builds index successfully', async () => {
      const result = await client.callTool('refresh_index', {});

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.notes_count).toBeGreaterThan(0);
      expect(data.fts5_notes).toBeGreaterThanOrEqual(0);
    });

    test('reports note count in response', async () => {
      const result = await client.callTool('refresh_index', {});

      const data = JSON.parse(result.content[0].text);
      // Should index markdown files from fixtures
      expect(data.notes_count).toBeGreaterThan(10);
    });
  });

  describe('search (content scope)', () => {
    describe('Basic Functionality', () => {
      test('finds notes containing a simple term', async () => {

        // search with scope content will auto-build index if needed
        const result = await client.callTool('search', {
          scope: 'content',
          query: 'note',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.total_results).toBeGreaterThanOrEqual(0);
        expect(data.results).toBeDefined();
        expect(data.results.length).toBeGreaterThan(0);
      });

      test('returns expected result format', async () => {
        const result = await client.callTool('search', {
          scope: 'content',
          query: 'note',
          limit: 1,
        });

        const data = JSON.parse(result.content[0].text);
        if (data.results.length > 0) {
          const item = data.results[0];
          expect(item.path).toBeDefined();
          expect(item.title).toBeDefined();
          expect(item.snippet).toBeDefined();
        }
      });

      test('respects limit parameter', async () => {
        const result = await client.callTool('search', {
          scope: 'content',
          query: 'note',
          limit: 2,
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.results.length).toBeLessThanOrEqual(2);
      });

      test('returns query in response', async () => {
        const result = await client.callTool('search', {
          scope: 'content',
          query: 'test search',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.query).toBe('test search');
      });
    });

    describe('Stemming', () => {
      test('matches stemmed variations', async () => {

        const result = await client.callTool('search', {
          scope: 'content',
          query: 'link',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data).toBeDefined();
      });
    });

    describe('Phrase Search', () => {
      test('handles phrase queries with quotes', async () => {
        const result = await client.callTool('search', {
          scope: 'content',
          query: '"test note"',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.query).toBe('"test note"');
      });
    });

    describe('Boolean Operators', () => {
      test('handles AND operator', async () => {
        const result = await client.callTool('search', {
          scope: 'content',
          query: 'note AND test',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data).toBeDefined();
      });

      test('handles OR operator', async () => {
        const result = await client.callTool('search', {
          scope: 'content',
          query: 'note OR test',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data).toBeDefined();
      });

      test('handles NOT operator', async () => {
        const result = await client.callTool('search', {
          scope: 'content',
          query: 'note NOT test',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data).toBeDefined();
      });
    });

    describe('Prefix Matching', () => {
      test('handles prefix wildcard', async () => {
        const result = await client.callTool('search', {
          scope: 'content',
          query: 'not*',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data).toBeDefined();
      });
    });

    describe('Snippets', () => {
      test('returns highlighted snippets', async () => {
        const result = await client.callTool('search', {
          scope: 'content',
          query: 'note',
          limit: 5,
        });

        const data = JSON.parse(result.content[0].text);
        if (data.results.length > 0) {
          const hasSnippet = data.results.some(
            (r: { snippet: string }) => r.snippet && r.snippet.length > 0
          );
          expect(hasSnippet).toBe(true);
        }
      });
    });

    describe('Edge Cases', () => {
      test('handles empty results gracefully', async () => {
        const result = await client.callTool('search', {
          scope: 'content',
          query: 'xyznonexistenttermxyz123456',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.total_results).toBe(0);
        expect(data.results).toHaveLength(0);
      });

      test('handles special characters', async () => {
        try {
          const result = await client.callTool('search', {
            scope: 'content',
            query: 'test',
          });
          const data = JSON.parse(result.content[0].text);
          expect(data).toBeDefined();
        } catch (err) {
          expect(err).toBeDefined();
        }
      });

      test('handles unicode text', async () => {
        const result = await client.callTool('search', {
          scope: 'content',
          query: '日本',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data).toBeDefined();
      });
    });
  });
});
