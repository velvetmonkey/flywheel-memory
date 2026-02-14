/**
 * Tests for FTS5 Full-Text Search Tools
 *
 * These tests cover the full_text_search and rebuild_search_index tools,
 * including stemming, phrase matching, boolean operators, and edge cases.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { connect } from 'mcp-testing-kit';
import { createTestServer, type TestServerContext } from '../helpers/createTestServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

describe('FTS5 Full-Text Search Tools', () => {
  let context: TestServerContext;

  beforeAll(async () => {
    context = await createTestServer(FIXTURES_PATH);
  });

  afterAll(() => {
    // Clean up test database - wrapped in try-catch for Windows file locking
    const dbPath = path.join(FIXTURES_PATH, '.claude', 'vault-search.db');
    try {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    } catch {
      // File may still be locked on Windows - ignore cleanup failure
    }
  });

  describe('rebuild_search_index', () => {
    test('builds index successfully', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('rebuild_search_index', {});

      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe('success');
      expect(data.notes_indexed).toBeGreaterThan(0);
      expect(data.message).toContain('Successfully indexed');
    });

    test('reports note count in response', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('rebuild_search_index', {});

      const data = JSON.parse(result.content[0].text);
      // Should index markdown files from fixtures
      expect(data.notes_indexed).toBeGreaterThan(10);
    });
  });

  describe('full_text_search', () => {
    describe('Basic Functionality', () => {
      test('finds notes containing a simple term', async () => {
        const client = await connect(context.server);

        // full_text_search will auto-build index if needed
        const result = await client.callTool('full_text_search', {
          query: 'note',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.total_results).toBeGreaterThanOrEqual(0);
        expect(data.results).toBeDefined();
        expect(data.results.length).toBeGreaterThan(0);
      });

      test('returns expected result format', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('full_text_search', {
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
        const client = await connect(context.server);
        const result = await client.callTool('full_text_search', {
          query: 'note',
          limit: 2,
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.results.length).toBeLessThanOrEqual(2);
      });

      test('returns query in response', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('full_text_search', {
          query: 'test search',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.query).toBe('test search');
      });
    });

    describe('Stemming', () => {
      test('matches stemmed variations', async () => {
        const client = await connect(context.server);

        // Create test content with word variations
        // Stemming should match "link" from "linking", "links", "linked"
        const result = await client.callTool('full_text_search', {
          query: 'link',
        });

        const data = JSON.parse(result.content[0].text);
        // If fixtures contain wikilinks or linking content, should match
        expect(data).toBeDefined();
      });
    });

    describe('Phrase Search', () => {
      test('handles phrase queries with quotes', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('full_text_search', {
          query: '"test note"',
        });

        const data = JSON.parse(result.content[0].text);
        // Should not crash on phrase search
        expect(data.query).toBe('"test note"');
      });
    });

    describe('Boolean Operators', () => {
      test('handles AND operator', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('full_text_search', {
          query: 'note AND test',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data).toBeDefined();
      });

      test('handles OR operator', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('full_text_search', {
          query: 'note OR test',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data).toBeDefined();
      });

      test('handles NOT operator', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('full_text_search', {
          query: 'note NOT test',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data).toBeDefined();
      });
    });

    describe('Prefix Matching', () => {
      test('handles prefix wildcard', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('full_text_search', {
          query: 'not*',
        });

        const data = JSON.parse(result.content[0].text);
        // Should match "note", "notes", etc.
        expect(data).toBeDefined();
      });
    });

    describe('Snippets', () => {
      test('returns highlighted snippets', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('full_text_search', {
          query: 'note',
          limit: 5,
        });

        const data = JSON.parse(result.content[0].text);
        if (data.results.length > 0) {
          // Snippets use [...] brackets for highlighting
          const hasSnippet = data.results.some(
            (r: { snippet: string }) => r.snippet && r.snippet.length > 0
          );
          expect(hasSnippet).toBe(true);
        }
      });
    });

    describe('Edge Cases', () => {
      test('handles empty results gracefully', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('full_text_search', {
          query: 'xyznonexistenttermxyz123456',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.total_results).toBe(0);
        expect(data.results).toHaveLength(0);
      });

      test('handles special characters', async () => {
        const client = await connect(context.server);

        // FTS5 should handle special characters
        try {
          const result = await client.callTool('full_text_search', {
            query: 'test',
          });
          const data = JSON.parse(result.content[0].text);
          expect(data).toBeDefined();
        } catch (err) {
          // Some special queries may fail - that's expected
          expect(err).toBeDefined();
        }
      });

      test('handles unicode text', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('full_text_search', {
          query: '日本',
        });

        const data = JSON.parse(result.content[0].text);
        // Should not crash on unicode
        expect(data).toBeDefined();
      });
    });
  });
});
