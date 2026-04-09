/**
 * Tests for find_notes tool — structural enumeration by folder, tags, frontmatter.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { connectTestClient, type TestClient, createTestServer, type TestServerContext } from '../helpers/createTestServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

describe('find_notes', () => {
  let context: TestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    context = await createTestServer(FIXTURES_PATH);
    client = connectTestClient(context.server);
  });

  describe('Folder Filtering', () => {
    test('folder filter restricts to direct and nested contents', async () => {
      const result = await client.callTool('find_notes', { folder: 'Nested', limit: 50 });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes).toBeDefined();
      for (const note of data.notes) {
        expect(note.path).toMatch(/^Nested\//);
      }
    });

    test('no folder filter returns notes from all folders', async () => {
      const allResult = await client.callTool('find_notes', { limit: 100 });
      const nestedResult = await client.callTool('find_notes', { folder: 'Nested', limit: 100 });
      const allData = JSON.parse(allResult.content[0].text);
      const nestedData = JSON.parse(nestedResult.content[0].text);
      expect(allData.total_matches).toBeGreaterThan(nestedData.total_matches);
    });

    test('nonexistent folder returns empty results', async () => {
      const result = await client.callTool('find_notes', { folder: 'does-not-exist', limit: 10 });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes).toHaveLength(0);
      expect(data.total_matches).toBe(0);
    });
  });

  describe('Frontmatter Matching (where)', () => {
    test('exact match on status field', async () => {
      const result = await client.callTool('find_notes', {
        where: { status: 'active' },
        limit: 20,
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes.length).toBeGreaterThan(0);
      for (const note of data.notes) {
        expect(note.frontmatter?.status).toBe('active');
      }
    });

    test('exact match on draft status', async () => {
      const result = await client.callTool('find_notes', {
        where: { status: 'draft' },
        limit: 20,
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes.length).toBeGreaterThan(0);
      for (const note of data.notes) {
        expect(note.frontmatter?.status).toBe('draft');
      }
    });

    test('AND semantics: multiple where fields', async () => {
      const result = await client.callTool('find_notes', {
        where: { status: 'draft', priority: 'high' },
        limit: 20,
      });
      const data = JSON.parse(result.content[0].text);
      for (const note of data.notes) {
        expect(note.frontmatter?.status).toBe('draft');
        expect(note.frontmatter?.priority).toBe('high');
      }
    });

    test('empty where object returns all notes', async () => {
      const allResult = await client.callTool('find_notes', { limit: 100 });
      const whereResult = await client.callTool('find_notes', { where: {}, limit: 100 });
      const allData = JSON.parse(allResult.content[0].text);
      const whereData = JSON.parse(whereResult.content[0].text);
      expect(whereData.total_matches).toBe(allData.total_matches);
    });

    test('nonexistent field returns empty results', async () => {
      const result = await client.callTool('find_notes', {
        where: { nonexistent_field: 'some_value' },
        limit: 10,
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes).toHaveLength(0);
    });
  });

  describe('Tag Filtering', () => {
    test('has_tag returns notes with that tag', async () => {
      const result = await client.callTool('find_notes', { has_tag: 'test', limit: 20 });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes.length).toBeGreaterThan(0);
      for (const note of data.notes) {
        const tags: string[] = note.tags ?? [];
        expect(tags.some(t => t === 'test' || t === '#test')).toBe(true);
      }
    });

    test('has_any_tag matches notes with at least one listed tag', async () => {
      const result = await client.callTool('find_notes', {
        has_any_tag: ['test', 'fixture'],
        limit: 20,
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes.length).toBeGreaterThan(0);
    });

    test('has_all_tags requires all specified tags', async () => {
      const both = await client.callTool('find_notes', {
        has_all_tags: ['test', 'fixture'],
        limit: 20,
      });
      const one = await client.callTool('find_notes', { has_tag: 'test', limit: 20 });
      const bothData = JSON.parse(both.content[0].text);
      const oneData = JSON.parse(one.content[0].text);
      expect(bothData.total_matches).toBeLessThanOrEqual(oneData.total_matches);
    });

    test('nonexistent tag returns empty results', async () => {
      const result = await client.callTool('find_notes', {
        has_tag: 'nonexistent-tag-xyz',
        limit: 10,
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes).toHaveLength(0);
    });
  });

  describe('Title Filtering', () => {
    test('title_contains filters by substring', async () => {
      const result = await client.callTool('find_notes', {
        title_contains: 'Normal',
        limit: 10,
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes.length).toBeGreaterThan(0);
      for (const note of data.notes) {
        expect(note.title.toLowerCase()).toContain('normal');
      }
    });

    test('title_contains is case-insensitive', async () => {
      const lower = await client.callTool('find_notes', { title_contains: 'normal', limit: 10 });
      const upper = await client.callTool('find_notes', { title_contains: 'NORMAL', limit: 10 });
      const lowerData = JSON.parse(lower.content[0].text);
      const upperData = JSON.parse(upper.content[0].text);
      expect(lowerData.total_matches).toBe(upperData.total_matches);
    });

    test('nonexistent title returns empty results', async () => {
      const result = await client.callTool('find_notes', {
        title_contains: 'xyzzy_does_not_exist',
        limit: 10,
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes).toHaveLength(0);
    });
  });

  describe('Date Filtering', () => {
    test('modified_after filters notes modified after date', async () => {
      const result = await client.callTool('find_notes', {
        modified_after: '2000-01-01',
        limit: 50,
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes.length).toBeGreaterThan(0);
    });

    test('modified_before filters notes modified before date', async () => {
      const result = await client.callTool('find_notes', {
        modified_before: '2100-01-01',
        limit: 50,
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes.length).toBeGreaterThan(0);
    });

    test('future modified_after returns no notes', async () => {
      const result = await client.callTool('find_notes', {
        modified_after: '2099-01-01',
        limit: 10,
      });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes).toHaveLength(0);
    });
  });

  describe('Sorting', () => {
    test('default sort returns results', async () => {
      const result = await client.callTool('find_notes', { limit: 10 });
      const data = JSON.parse(result.content[0].text);
      expect(data.notes).toBeDefined();
    });

    test('sort_by title asc returns alphabetical order', async () => {
      const result = await client.callTool('find_notes', {
        sort_by: 'title',
        order: 'asc',
        limit: 20,
      });
      const data = JSON.parse(result.content[0].text);
      if (data.notes.length > 1) {
        for (let i = 1; i < data.notes.length; i++) {
          expect(data.notes[i - 1].title.localeCompare(data.notes[i].title)).toBeLessThanOrEqual(0);
        }
      }
    });

    test('sort_by title desc returns reverse alphabetical order', async () => {
      const result = await client.callTool('find_notes', {
        sort_by: 'title',
        order: 'desc',
        limit: 20,
      });
      const data = JSON.parse(result.content[0].text);
      if (data.notes.length > 1) {
        for (let i = 1; i < data.notes.length; i++) {
          expect(data.notes[i - 1].title.localeCompare(data.notes[i].title)).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test('sort_by modified desc returns newest first', async () => {
      const result = await client.callTool('find_notes', {
        sort_by: 'modified',
        order: 'desc',
        limit: 20,
      });
      const data = JSON.parse(result.content[0].text);
      if (data.notes.length > 1) {
        for (let i = 1; i < data.notes.length; i++) {
          const prev = new Date(data.notes[i - 1].modified).getTime();
          const curr = new Date(data.notes[i].modified).getTime();
          expect(prev).toBeGreaterThanOrEqual(curr);
        }
      }
    });
  });

  describe('Limit and Response Shape', () => {
    test('respects limit parameter', async () => {
      const result = await client.callTool('find_notes', { limit: 2 });
      const data = JSON.parse(result.content[0].text);
      expect(data.returned).toBeLessThanOrEqual(2);
      expect(data.notes.length).toBeLessThanOrEqual(2);
    });

    test('returns total_matches and returned', async () => {
      const result = await client.callTool('find_notes', { limit: 5 });
      const data = JSON.parse(result.content[0].text);
      expect(data.total_matches).toBeDefined();
      expect(data.returned).toBeDefined();
    });

    test('returned equals notes array length', async () => {
      const result = await client.callTool('find_notes', { limit: 10 });
      const data = JSON.parse(result.content[0].text);
      expect(data.returned).toBe(data.notes.length);
    });

    test('notes contain expected fields', async () => {
      const result = await client.callTool('find_notes', { limit: 1 });
      const data = JSON.parse(result.content[0].text);
      if (data.notes.length > 0) {
        const note = data.notes[0];
        expect(note.path).toBeDefined();
        expect(note.title).toBeDefined();
        expect(note.modified).toBeDefined();
      }
    });
  });
});
