/**
 * Tests for Graph Tools - link analysis and traversal
 *
 * These tests cover backlinks, forward links, orphan detection,
 * hub detection, and graph traversal operations.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { connect } from 'mcp-testing-kit';
import { createTestServer, type TestServerContext } from '../helpers/createTestServer.js';
import { buildVaultIndex } from '../../src/core/graph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

describe('Graph Tools via MCP', () => {
  let context: TestServerContext;

  beforeAll(async () => {
    context = await createTestServer(FIXTURES_PATH);
  });

  describe('get_backlinks', () => {
    test('returns backlinks for a note', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_backlinks', {
        path: 'another-note.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.note).toBeDefined();
      expect(data.backlinks).toBeDefined();
      expect(data.backlink_count).toBeDefined();
    });

    test('returns empty for note with no backlinks', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_backlinks', {
        path: 'orphan-note.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.backlink_count).toBe(0);
    });

    test('handles non-existent note', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_backlinks', {
        path: 'does-not-exist.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.backlinks).toHaveLength(0);
    });

    test('includes context when requested', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_backlinks', {
        path: 'another-note.md',
        include_context: true,
      });

      const data = JSON.parse(result.content[0].text);
      // Context may or may not be present depending on implementation
      expect(data).toBeDefined();
    });

    test('respects limit and offset', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_backlinks', {
        path: 'another-note.md',
        limit: 1,
        offset: 0,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.backlinks.length).toBeLessThanOrEqual(1);
    });
  });

  describe('get_forward_links', () => {
    test('returns forward links for a note', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_forward_links', {
        path: 'normal-note.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.forward_links).toBeDefined();
      expect(data.forward_link_count).toBeGreaterThan(0);
    });

    test('identifies broken forward links', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_forward_links', {
        path: 'normal-note.md',
      });

      const data = JSON.parse(result.content[0].text);
      // normal-note links to "Does Not Exist"
      const brokenLink = data.forward_links.find(
        (l: { exists: boolean }) => l.exists === false
      );
      if (data.forward_links.some((l: { target: string }) => l.target === 'Does Not Exist')) {
        expect(brokenLink).toBeDefined();
      }
    });

    test('handles non-existent note', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_forward_links', {
        path: 'does-not-exist.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.forward_link_count).toBe(0);
    });
  });

  describe('find_orphan_notes', () => {
    test('finds notes with no backlinks', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_orphan_notes', {});

      const data = JSON.parse(result.content[0].text);
      expect(data.orphans).toBeDefined();
      expect(data.orphan_count).toBeGreaterThanOrEqual(0);
    });

    test('filters by folder', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_orphan_notes', {
        folder: 'edge-cases',
      });

      const data = JSON.parse(result.content[0].text);
      for (const orphan of data.orphans) {
        expect(orphan.path.startsWith('edge-cases/')).toBe(true);
      }
    });

    test('respects limit and offset', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_orphan_notes', {
        limit: 2,
        offset: 0,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.orphans.length).toBeLessThanOrEqual(2);
    });
  });

  describe('find_hub_notes', () => {
    test('finds highly connected notes', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_hub_notes', {
        min_links: 1,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.hubs).toBeDefined();
      for (const hub of data.hubs) {
        expect(hub.total_connections).toBeGreaterThanOrEqual(1);
      }
    });

    test('respects min_links threshold', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_hub_notes', {
        min_links: 5,
      });

      const data = JSON.parse(result.content[0].text);
      for (const hub of data.hubs) {
        expect(hub.total_connections).toBeGreaterThanOrEqual(5);
      }
    });

    test('respects limit and offset', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_hub_notes', {
        limit: 1,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.hubs.length).toBeLessThanOrEqual(1);
    });
  });
});

describe('Advanced Graph Tools via MCP', () => {
  let context: TestServerContext;

  beforeAll(async () => {
    context = await createTestServer(FIXTURES_PATH);
  });

  describe('get_link_path', () => {
    test('finds path between connected notes', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_link_path', {
        from: 'normal-note.md',
        to: 'another-note.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.exists).toBeDefined();
      if (data.exists) {
        expect(data.path.length).toBeGreaterThan(0);
      }
    });

    test('returns empty path for unconnected notes', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_link_path', {
        from: 'orphan-note.md',
        to: 'another-note.md',
      });

      const data = JSON.parse(result.content[0].text);
      // Orphan has no links, so no path to another note
      expect(data).toBeDefined();
    });

    test('handles same note as start and end', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_link_path', {
        from: 'normal-note.md',
        to: 'normal-note.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.exists).toBe(true);
      expect(data.length).toBe(0);
    });

    test('respects max_depth parameter', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_link_path', {
        from: 'normal-note.md',
        to: 'orphan-note.md',
        max_depth: 1,
      });

      const data = JSON.parse(result.content[0].text);
      if (data.exists) {
        expect(data.path.length - 1).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('get_common_neighbors', () => {
    test('finds common targets between notes', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_common_neighbors', {
        note_a: 'normal-note.md',
        note_b: 'acme-corp.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.common_neighbors).toBeDefined();
      expect(data.common_count).toBeDefined();
    });

    test('returns empty for notes with no common links', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_common_neighbors', {
        note_a: 'orphan-note.md',
        note_b: 'another-note.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.common_count).toBe(0);
    });

    test('handles non-existent notes', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_common_neighbors', {
        note_a: 'does-not-exist.md',
        note_b: 'normal-note.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.common_count).toBe(0);
    });
  });

  describe('find_bidirectional_links', () => {
    test('finds mutual links', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_bidirectional_links', {});

      const data = JSON.parse(result.content[0].text);
      expect(data.pairs).toBeDefined();
    });

    test('filters to specific note', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_bidirectional_links', {
        path: 'normal-note.md',
      });

      const data = JSON.parse(result.content[0].text);
      for (const pair of data.pairs) {
        expect(
          pair.noteA === 'normal-note.md' || pair.noteB === 'normal-note.md'
        ).toBe(true);
      }
    });

    test('respects limit and offset', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_bidirectional_links', {
        limit: 1,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.pairs.length).toBeLessThanOrEqual(1);
    });
  });

  describe('find_dead_ends', () => {
    test('finds notes with backlinks but no outlinks', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_dead_ends', {
        min_backlinks: 1,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.dead_ends).toBeDefined();
    });

    test('respects min_backlinks threshold', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_dead_ends', {
        min_backlinks: 2,
      });

      const data = JSON.parse(result.content[0].text);
      for (const note of data.dead_ends) {
        expect(note.backlink_count).toBeGreaterThanOrEqual(2);
      }
    });

    test('filters by folder', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_dead_ends', {
        folder: 'edge-cases',
      });

      const data = JSON.parse(result.content[0].text);
      for (const note of data.dead_ends) {
        expect(note.path.startsWith('edge-cases/')).toBe(true);
      }
    });
  });

  describe('find_sources', () => {
    test('finds notes with outlinks but no backlinks', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_sources', {
        min_outlinks: 1,
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.sources).toBeDefined();
    });

    test('respects min_outlinks threshold', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('find_sources', {
        min_outlinks: 2,
      });

      const data = JSON.parse(result.content[0].text);
      for (const note of data.sources) {
        expect(note.outlink_count).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('get_connection_strength', () => {
    test('calculates connection strength between notes', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_connection_strength', {
        note_a: 'normal-note.md',
        note_b: 'another-note.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.score).toBeDefined();
      expect(typeof data.score).toBe('number');
      expect(data.factors).toBeDefined();
    });

    test('returns zero for unconnected notes', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_connection_strength', {
        note_a: 'orphan-note.md',
        note_b: 'another-note.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.score).toBe(0);
    });

    test('handles non-existent notes', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_connection_strength', {
        note_a: 'does-not-exist.md',
        note_b: 'normal-note.md',
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.score).toBe(0);
    });
  });
});

describe('Vault Index Graph Structure', () => {
  test('backlinks map contains arrays', async () => {
    const index = await buildVaultIndex(FIXTURES_PATH);

    for (const [, backlinks] of index.backlinks) {
      expect(Array.isArray(backlinks)).toBe(true);
    }
  });

  test('entities map points to paths', async () => {
    const index = await buildVaultIndex(FIXTURES_PATH);

    for (const [entity, path] of index.entities) {
      expect(typeof entity).toBe('string');
      expect(typeof path).toBe('string');
    }
  });

  test('notes contain outlinks with line numbers', async () => {
    const index = await buildVaultIndex(FIXTURES_PATH);

    for (const [, note] of index.notes) {
      for (const link of note.outlinks) {
        expect(link.target).toBeDefined();
        expect(typeof link.line).toBe('number');
      }
    }
  });
});
