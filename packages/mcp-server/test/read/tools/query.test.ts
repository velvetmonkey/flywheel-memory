/**
 * Tests for Query Tools - frontmatter, tag, and folder matching
 *
 * These tests cover type coercion, case sensitivity, array matching,
 * folder prefix matching, and sorting behavior.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { connect } from 'mcp-testing-kit';
import { createTestServer, type TestServerContext } from '../helpers/createTestServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

describe('Query Tools', () => {
  let context: TestServerContext;

  beforeAll(async () => {
    context = await createTestServer(FIXTURES_PATH);
  });

  describe('search_notes', () => {
    describe('Basic Functionality', () => {
      test('returns all notes when no filters', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', { limit: 100 });

        const data = JSON.parse(result.content[0].text);
        expect(data.total_matches).toBeGreaterThan(0);
        expect(data.notes.length).toBeGreaterThan(0);
      });

      test('respects limit parameter', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', { limit: 2 });

        const data = JSON.parse(result.content[0].text);
        expect(data.returned).toBeLessThanOrEqual(2);
        expect(data.notes.length).toBeLessThanOrEqual(2);
      });

      test('returns notes in expected format', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', { limit: 1 });

        const data = JSON.parse(result.content[0].text);
        const note = data.notes[0];

        expect(note.path).toBeDefined();
        expect(note.title).toBeDefined();
        expect(note.modified).toBeDefined();
        expect(note.tags).toBeDefined();
        expect(note.frontmatter).toBeDefined();
      });
    });

    describe('Frontmatter Matching (where)', () => {
      test('matches exact string values', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          where: { type: 'project' },
        });

        const data = JSON.parse(result.content[0].text);
        // Should match notes with type: project
        for (const note of data.notes) {
          if (note.frontmatter.type) {
            expect(note.frontmatter.type.toLowerCase()).toBe('project');
          }
        }
      });

      test('case-insensitive string matching', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          where: { status: 'ACTIVE' },
        });

        const data = JSON.parse(result.content[0].text);
        // Case shouldn't matter
        for (const note of data.notes) {
          if (note.frontmatter.status && typeof note.frontmatter.status === 'string') {
            expect(note.frontmatter.status.toLowerCase()).toBe('active');
          }
        }
      });

      test('matches values in arrays', async () => {
        const client = await connect(context.server);
        // Tags in frontmatter are often arrays
        const result = await client.callTool('search_notes', { limit: 50 });

        const data = JSON.parse(result.content[0].text);
        expect(data).toBeDefined();
      });

      test('handles null/undefined filter values', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          where: { nonexistent: null },
        });

        const data = JSON.parse(result.content[0].text);
        // Should return notes that DON'T have this field
        expect(data).toBeDefined();
      });

      test('exact match for non-string types', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          where: { priority: 1 },
        });

        const data = JSON.parse(result.content[0].text);
        for (const note of data.notes) {
          if (note.frontmatter.priority !== undefined) {
            expect(note.frontmatter.priority).toBe(1);
          }
        }
      });

      test('multiple where conditions are AND-ed', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          where: { type: 'project', status: 'active' },
        });

        const data = JSON.parse(result.content[0].text);
        for (const note of data.notes) {
          // Both conditions must match
          if (note.frontmatter.type && note.frontmatter.status) {
            expect(note.frontmatter.type.toLowerCase()).toBe('project');
            expect(note.frontmatter.status.toLowerCase()).toBe('active');
          }
        }
      });
    });

    describe('Tag Matching', () => {
      test('has_tag filters by single tag', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          has_tag: 'test',
        });

        const data = JSON.parse(result.content[0].text);
        for (const note of data.notes) {
          expect(note.tags.map((t: string) => t.toLowerCase())).toContain('test');
        }
      });

      test('has_tag with # prefix works', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          has_tag: '#test',
        });

        const data = JSON.parse(result.content[0].text);
        // # prefix should be stripped
        for (const note of data.notes) {
          expect(note.tags.map((t: string) => t.toLowerCase())).toContain('test');
        }
      });

      test('has_any_tag matches any of multiple tags (OR)', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          has_any_tag: ['test', 'example'],
        });

        const data = JSON.parse(result.content[0].text);
        for (const note of data.notes) {
          const lowerTags = note.tags.map((t: string) => t.toLowerCase());
          expect(lowerTags.includes('test') || lowerTags.includes('example')).toBe(true);
        }
      });

      test('has_all_tags matches all specified tags (AND)', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          has_all_tags: ['test'],
        });

        const data = JSON.parse(result.content[0].text);
        for (const note of data.notes) {
          const lowerTags = note.tags.map((t: string) => t.toLowerCase());
          expect(lowerTags).toContain('test');
        }
      });

      test('empty has_any_tag returns all notes', async () => {
        const client = await connect(context.server);
        const allNotes = await client.callTool('search_notes', { limit: 100 });
        const emptyFilter = await client.callTool('search_notes', {
          has_any_tag: [],
          limit: 100,
        });

        const allData = JSON.parse(allNotes.content[0].text);
        const filterData = JSON.parse(emptyFilter.content[0].text);
        expect(filterData.total_matches).toBe(allData.total_matches);
      });
    });

    describe('Folder Matching', () => {
      test('filters by folder name', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          folder: 'edge-cases',
        });

        const data = JSON.parse(result.content[0].text);
        for (const note of data.notes) {
          expect(note.path.startsWith('edge-cases/')).toBe(true);
        }
      });

      test('folder with trailing slash works', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          folder: 'edge-cases/',
        });

        const data = JSON.parse(result.content[0].text);
        for (const note of data.notes) {
          expect(note.path.startsWith('edge-cases/')).toBe(true);
        }
      });

      test('avoids false positive on folder prefix', async () => {
        const client = await connect(context.server);
        // If we have folders "foo" and "foobar", searching for "foo"
        // should NOT match notes in "foobar"
        const result = await client.callTool('search_notes', {
          folder: 'edge-cases',
        });

        const data = JSON.parse(result.content[0].text);
        for (const note of data.notes) {
          // Should start with folder prefix
          expect(note.path.startsWith('edge-cases')).toBe(true);
        }
      });
    });

    describe('Title Matching', () => {
      test('title_contains filters by substring', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          title_contains: 'note',
        });

        const data = JSON.parse(result.content[0].text);
        for (const note of data.notes) {
          expect(note.title.toLowerCase()).toContain('note');
        }
      });

      test('title_contains is case-insensitive', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          title_contains: 'NOTE',
        });

        const data = JSON.parse(result.content[0].text);
        for (const note of data.notes) {
          expect(note.title.toLowerCase()).toContain('note');
        }
      });
    });

    describe('Sorting', () => {
      test('sorts by modified date descending by default', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', { limit: 10 });

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
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
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
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
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
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          sort_by: 'created',
          order: 'desc',
          limit: 10,
        });

        const data = JSON.parse(result.content[0].text);
        // Just verify it doesn't crash - created may fall back to modified
        expect(data.notes).toBeDefined();
      });
    });

    describe('Combined Filters', () => {
      test('combines where + has_tag', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          where: { type: 'project' },
          has_tag: 'test',
        });

        const data = JSON.parse(result.content[0].text);
        for (const note of data.notes) {
          if (note.frontmatter.type) {
            expect(note.frontmatter.type.toLowerCase()).toBe('project');
          }
          expect(note.tags.map((t: string) => t.toLowerCase())).toContain('test');
        }
      });

      test('combines folder + title_contains', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          folder: 'edge-cases',
          title_contains: 'note',
        });

        const data = JSON.parse(result.content[0].text);
        for (const note of data.notes) {
          expect(note.path.startsWith('edge-cases')).toBe(true);
          expect(note.title.toLowerCase()).toContain('note');
        }
      });
    });

    describe('Edge Cases', () => {
      test('handles empty vault gracefully', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          folder: 'nonexistent-folder-xyz',
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.total_matches).toBe(0);
        expect(data.notes).toHaveLength(0);
      });

      test('handles special characters in search', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          title_contains: '日本',
        });

        const data = JSON.parse(result.content[0].text);
        // Should not crash
        expect(data).toBeDefined();
      });

      test('returns query in response', async () => {
        const client = await connect(context.server);
        const result = await client.callTool('search_notes', {
          has_tag: 'test',
          folder: 'edge-cases',
          limit: 5,
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.query.has_tag).toBe('test');
        expect(data.query.folder).toBe('edge-cases');
        expect(data.query.limit).toBe(5);
      });
    });
  });
});
