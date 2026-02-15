/**
 * MCP Server Integration Tests
 *
 * Tests the full MCP server startup, tool registration, and protocol compliance
 * using mcp-testing-kit for direct server testing.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createTestServer, connectTestClient, type TestServerContext, type TestClient } from '../helpers/createTestServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

describe('MCP Server Integration', () => {
  let context: TestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    context = await createTestServer(FIXTURES_PATH);
    client = connectTestClient(context.server);
  });

  describe('Tool Registration', () => {
    test('registers all expected tools', async () => {
      const result = await client.listTools();

      // Should have 24+ tools registered (read tools only in test server)
      expect(result.tools.length).toBeGreaterThanOrEqual(24);

      // Check for key tool categories
      const toolNames = result.tools.map((t: { name: string }) => t.name);

      // Graph tools
      expect(toolNames).toContain('get_backlinks');
      expect(toolNames).toContain('get_forward_links');
      expect(toolNames).toContain('graph_analysis');

      // Wikilink tools
      expect(toolNames).toContain('suggest_wikilinks');
      expect(toolNames).toContain('validate_links');

      // Health tools
      expect(toolNames).toContain('health_check');
      expect(toolNames).toContain('get_vault_stats');

      // Query tools (unified search)
      expect(toolNames).toContain('search');

      // Schema tools (unified)
      expect(toolNames).toContain('vault_schema');
      expect(toolNames).toContain('note_intelligence');
    });

    test('all tools have valid input schemas', async () => {
      const result = await client.listTools();

      for (const tool of result.tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });

    test('all tools have descriptions', async () => {
      const result = await client.listTools();

      for (const tool of result.tools) {
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(10);
      }
    });
  });

  describe('Tool Invocation', () => {
    test('health_check returns valid response', async () => {
      const result = await client.callTool('health_check', {});

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe('text');
    });

    test('get_vault_stats returns statistics', async () => {
      const result = await client.callTool('get_vault_stats', {});

      expect(result.content).toBeDefined();
      const stats = JSON.parse(result.content[0].text);
      expect(stats.total_notes).toBeGreaterThan(0);
    });

    test('search with metadata scope returns notes', async () => {
      const result = await client.callTool('search', { scope: 'metadata', limit: 10 });

      expect(result.content).toBeDefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.notes).toBeDefined();
      expect(data.notes.length).toBeGreaterThan(0);
    });

    test('get_backlinks handles missing note gracefully', async () => {
      const result = await client.callTool('get_backlinks', {
        path: 'does-not-exist.md',
      });

      expect(result.content).toBeDefined();
      // Should return empty results or error, not crash
    });

    test('suggest_wikilinks processes text', async () => {
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
      // get_backlinks requires 'path' parameter
      try {
        await client.callTool('get_backlinks', {});
        // If we get here, the tool should return an error in content
      } catch {
        // Expected - invalid parameters
      }
    });

    test('handles invalid path gracefully', async () => {
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
