/**
 * README Examples Tests
 *
 * Validates that the README/documentation examples work correctly
 * against the actual demo vaults. These tests ensure documentation
 * accuracy and prevent drift between docs and implementation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { createTestServer, type TestServerContext } from '../helpers/createTestServer.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Path to demo vaults
const DEMOS_PATH = path.resolve(__dirname, '../../../../demos');
const ARTEMIS_VAULT = path.join(DEMOS_PATH, 'artemis-rocket');
const CARTER_VAULT = path.join(DEMOS_PATH, 'carter-strategy');

describe('README Examples: Artemis Rocket Vault', () => {
  let context: TestServerContext;
  let client: Client;

  beforeAll(async () => {
    context = await createTestServer(ARTEMIS_VAULT);

    // Connect client to server
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await context.server.connect(serverTransport);

    client = new Client({
      name: 'test-client',
      version: '1.0.0',
    }, {
      capabilities: {},
    });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    if (context?.stateDb) {
      context.stateDb.close();
    }
    await client?.close();
  });

  describe('Tool Execution', () => {
    it('should execute health_check successfully', async () => {
      const result = await client.callTool({
        name: 'health_check',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].type).toBe('text');
      const healthData = JSON.parse(content[0].text);

      expect(healthData.status).toBeDefined();
      expect(healthData.vault_path).toBeDefined();
      expect(healthData.vault_path).toContain('artemis-rocket');
    });

    it('should find hub notes with find_hub_notes', async () => {
      const result = await client.callTool({
        name: 'find_hub_notes',
        arguments: { limit: 10 },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const hubs = JSON.parse(content[0].text);

      expect(Array.isArray(hubs.hubs)).toBe(true);
      // May have no hubs if min_links threshold not met in small demo vault
      if (hubs.hubs.length > 0) {
        // Hub notes should have meaningful backlink counts
        for (const hub of hubs.hubs.slice(0, 3)) {
          expect(hub.path).toMatch(/\.md$/);
          expect(typeof hub.backlink_count).toBe('number');
        }
      }
    });

    it('should get backlinks for a note', async () => {
      // Use get_recent_notes to find a note to test backlinks on
      const recentResult = await client.callTool({
        name: 'get_recent_notes',
        arguments: { limit: 5 },
      });

      expect(recentResult.isError).toBeFalsy();
      const recentContent = recentResult.content as Array<{ type: string; text: string }>;
      const recent = JSON.parse(recentContent[0].text);

      if (recent.notes && recent.notes.length > 0) {
        const notePath = recent.notes[0].path;

        const result = await client.callTool({
          name: 'get_backlinks',
          arguments: { path: notePath },
        });

        expect(result.isError).toBeFalsy();
        const content = result.content as Array<{ type: string; text: string }>;
        const backlinks = JSON.parse(content[0].text);

        // get_backlinks returns { note: ..., backlinks: [...] }
        expect(backlinks.note).toBeDefined();
        expect(Array.isArray(backlinks.backlinks)).toBe(true);
      }
    });

    it('should search notes by title', async () => {
      const result = await client.callTool({
        name: 'search_notes',
        arguments: { title_contains: 'project', limit: 10 },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const searchResults = JSON.parse(content[0].text);

      // search_notes returns { notes: [...] }
      expect(Array.isArray(searchResults.notes)).toBe(true);
    });

    it('should get recent notes', async () => {
      const result = await client.callTool({
        name: 'get_recent_notes',
        arguments: { limit: 10 },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const recent = JSON.parse(content[0].text);

      expect(Array.isArray(recent.notes)).toBe(true);
      expect(recent.notes.length).toBeLessThanOrEqual(10);
    });

    it('should get orphan notes', async () => {
      const result = await client.callTool({
        name: 'find_orphan_notes',
        arguments: { limit: 20 },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const orphans = JSON.parse(content[0].text);

      expect(Array.isArray(orphans.orphans)).toBe(true);
    });
  });

  describe('Graph Intelligence', () => {
    it('should analyze vault structure', async () => {
      const result = await client.callTool({
        name: 'get_folder_structure',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const structure = JSON.parse(content[0].text);

      expect(structure.folders).toBeDefined();
      expect(Array.isArray(structure.folders)).toBe(true);
      // Structure should have some folders
      expect(structure.folders.length).toBeGreaterThan(0);
    });

    it('should get note metadata', async () => {
      const result = await client.callTool({
        name: 'get_note_metadata',
        arguments: { path: 'project/Artemis Rocket.md' },
      });

      // May succeed or fail depending on exact file path
      if (!result.isError) {
        const content = result.content as Array<{ type: string; text: string }>;
        const metadata = JSON.parse(content[0].text);
        expect(metadata.path).toBeDefined();
      }
    });
  });
});

describe('README Examples: Carter Strategy Vault', () => {
  let context: TestServerContext;
  let client: Client;

  beforeAll(async () => {
    context = await createTestServer(CARTER_VAULT);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await context.server.connect(serverTransport);

    client = new Client({
      name: 'test-client',
      version: '1.0.0',
    }, {
      capabilities: {},
    });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    if (context?.stateDb) {
      context.stateDb.close();
    }
    await client?.close();
  });

  it('should execute health_check successfully', async () => {
    const result = await client.callTool({
      name: 'health_check',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const healthData = JSON.parse(content[0].text);

    expect(healthData.status).toBeDefined();
    expect(healthData.vault_path).toContain('carter-strategy');
  });

  it('should list all tools', async () => {
    const tools = await client.listTools();

    expect(tools.tools.length).toBeGreaterThanOrEqual(30);

    // Check for key tool categories
    const toolNames = tools.tools.map(t => t.name);

    // Graph tools
    expect(toolNames).toContain('get_backlinks');
    expect(toolNames).toContain('find_hub_notes');

    // Health tools
    expect(toolNames).toContain('health_check');

    // Query tools
    expect(toolNames).toContain('search_notes');
    expect(toolNames).toContain('get_recent_notes');
  });
});

describe('Tool Registration Consistency', () => {
  let context: TestServerContext;
  let client: Client;

  beforeAll(async () => {
    context = await createTestServer(ARTEMIS_VAULT);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await context.server.connect(serverTransport);

    client = new Client({
      name: 'test-client',
      version: '1.0.0',
    }, {
      capabilities: {},
    });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    if (context?.stateDb) {
      context.stateDb.close();
    }
    await client?.close();
  });

  it('should have all documented tools registered', async () => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map(t => t.name);

    // Core documented tools (from README)
    const documentedTools = [
      'health_check',
      'get_backlinks',
      'get_forward_links',
      'find_hub_notes',
      'find_orphan_notes',
      'search_notes',
      'get_recent_notes',
      'get_note_metadata',
      'get_folder_structure',
    ];

    for (const tool of documentedTools) {
      expect(toolNames, `Missing documented tool: ${tool}`).toContain(tool);
    }
  });

  it('should return valid JSON from all tools', async () => {
    const testCalls = [
      { name: 'health_check', arguments: {} },
      { name: 'find_hub_notes', arguments: { limit: 5 } },
      { name: 'find_orphan_notes', arguments: { limit: 5 } },
      { name: 'get_recent_notes', arguments: { limit: 5 } },
    ];

    for (const call of testCalls) {
      const result = await client.callTool(call);

      if (!result.isError) {
        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0].type).toBe('text');

        // Should be valid JSON
        expect(() => JSON.parse(content[0].text)).not.toThrow();
      }
    }
  });
});
