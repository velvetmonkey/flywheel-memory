/**
 * MCP Server Integration Tests
 *
 * Tests the full MCP server startup, tool registration, and protocol compliance
 * using mcp-testing-kit for direct server testing.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { connect, close } from 'mcp-testing-kit';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createTestServer, type TestServerContext } from '../helpers/createTestServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

describe('MCP Server Integration', () => {
  let context: TestServerContext;

  beforeAll(async () => {
    context = await createTestServer(FIXTURES_PATH);
  });

  afterAll(async () => {
    await close(context.server);
  });

  describe('Tool Registration', () => {
    test('registers all expected tools', async () => {
      const client = await connect(context.server);
      const result = await client.listTools();

      // Should have 30+ tools registered
      expect(result.tools.length).toBeGreaterThanOrEqual(30);

      // Check for key tool categories
      const toolNames = result.tools.map((t: { name: string }) => t.name);

      // Graph tools
      expect(toolNames).toContain('get_backlinks');
      expect(toolNames).toContain('get_forward_links');
      expect(toolNames).toContain('find_orphan_notes');
      expect(toolNames).toContain('find_hub_notes');

      // Wikilink tools
      expect(toolNames).toContain('suggest_wikilinks');
      expect(toolNames).toContain('validate_links');
      expect(toolNames).toContain('find_broken_links');

      // Health tools
      expect(toolNames).toContain('health_check');
      expect(toolNames).toContain('get_vault_stats');

      // Query tools
      expect(toolNames).toContain('search_notes');
      expect(toolNames).toContain('get_recent_notes');

      // Periodic tools
      expect(toolNames).toContain('detect_periodic_notes');

      // Schema tools
      expect(toolNames).toContain('infer_folder_conventions');
      expect(toolNames).toContain('get_frontmatter_schema');
    });

    test('all tools have valid input schemas', async () => {
      const client = await connect(context.server);
      const result = await client.listTools();

      for (const tool of result.tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });

    test('all tools have descriptions', async () => {
      const client = await connect(context.server);
      const result = await client.listTools();

      for (const tool of result.tools) {
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(10);
      }
    });
  });

  describe('Tool Invocation', () => {
    test('health_check returns valid response', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('health_check', {});

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe('text');
    });

    test('get_vault_stats returns statistics', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_vault_stats', {});

      expect(result.content).toBeDefined();
      const stats = JSON.parse(result.content[0].text);
      expect(stats.total_notes).toBeGreaterThan(0);
    });

    test('search_notes with no filters returns notes', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('search_notes', { limit: 10 });

      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.notes).toBeDefined();
      expect(data.notes.length).toBeGreaterThan(0);
    });

    test('get_backlinks handles missing note gracefully', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_backlinks', {
        path: 'does-not-exist.md',
      });

      expect(result.content).toBeDefined();
      // Should return empty results or error, not crash
    });

    test('suggest_wikilinks processes text', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('suggest_wikilinks', {
        text: 'This mentions Alex Johnson and Acme Corp.',
      });

      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.suggestions).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('handles missing required parameters', async () => {
      const client = await connect(context.server);

      // get_backlinks requires 'path' parameter
      try {
        await client.callTool('get_backlinks', {});
        // If we get here, the tool should return an error in content
      } catch {
        // Expected - invalid parameters
      }
    });

    test('handles invalid path gracefully', async () => {
      const client = await connect(context.server);
      const result = await client.callTool('get_note_metadata', {
        path: '../../../etc/passwd',
      });

      expect(result.content).toBeDefined();
      // Should not crash or expose system files
    });
  });
});

describe('Vault Index', () => {
  let context: TestServerContext;

  beforeAll(async () => {
    context = await createTestServer(FIXTURES_PATH);
  });

  test('indexes fixture notes correctly', () => {
    expect(context.vaultIndex.notes.size).toBeGreaterThanOrEqual(7);
  });

  test('builds backlinks from outlinks', () => {
    // normal-note links to Another Note, so Another Note should have a backlink
    // Backlinks are stored as Backlink[] arrays
    const backlinks = context.vaultIndex.backlinks.get('another note');
    expect(backlinks).toBeDefined();
    expect(backlinks?.length).toBeGreaterThan(0);
  });

  test('builds entity map with titles and aliases', () => {
    // Should resolve both titles and aliases
    expect(context.vaultIndex.entities.has('normal-note')).toBe(true);
    expect(context.vaultIndex.entities.has('test note')).toBe(true); // alias
  });

  test('builds tag index', () => {
    expect(context.vaultIndex.tags.has('test')).toBe(true);
  });
});
