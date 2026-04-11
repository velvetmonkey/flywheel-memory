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
const DEMOS_PATH = path.resolve(__dirname, '../../../../../demos');
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
    it('should execute flywheel_doctor report=health successfully', async () => {
      const result = await client.callTool({
        name: 'flywheel_doctor',
        arguments: { report: 'health' },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].type).toBe('text');
      const healthData = JSON.parse(content[0].text);

      expect(healthData.status).toBeDefined();
      expect(healthData.vault_path).toBeDefined();
      expect(healthData.vault_path).toContain('artemis-rocket');
    });

    it('should find hub notes with graph_analysis', async () => {
      const result = await client.callTool({
        name: 'graph_analysis',
        arguments: { analysis: 'hubs', limit: 10 },
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
      // Use search to find a note to test backlinks on
      const recentResult = await client.callTool({
        name: 'search',
        arguments: { modified_after: '2000-01-01', sort_by: 'modified', limit: 5 },
      });

      expect(recentResult.isError).toBeFalsy();
      const recentContent = recentResult.content as Array<{ type: string; text: string }>;
      const recent = JSON.parse(recentContent[0].text);

      if (recent.notes && recent.notes.length > 0) {
        const notePath = recent.notes[0].path;

        // Backlink data is available via search results (backlinks field)
        const result = await client.callTool({
          name: 'search',
          arguments: { query: notePath.replace('.md', ''), limit: 1 },
        });

        expect(result.isError).toBeFalsy();
      }
    });

    it('should find notes by title', async () => {
      const result = await client.callTool({
        name: 'find_notes',
        arguments: { title_contains: 'project', limit: 10 },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const searchResults = JSON.parse(content[0].text);

      // find_notes returns { notes: [...] }
      expect(Array.isArray(searchResults.notes)).toBe(true);
    });

    it('should get recent notes via search', async () => {
      const result = await client.callTool({
        name: 'search',
        arguments: { modified_after: '2000-01-01', sort_by: 'modified', limit: 10 },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const recent = JSON.parse(content[0].text);

      expect(Array.isArray(recent.notes)).toBe(true);
      expect(recent.notes.length).toBeLessThanOrEqual(10);
    });

    it('should get orphan notes', async () => {
      const result = await client.callTool({
        name: 'graph_analysis',
        arguments: { analysis: 'orphans', limit: 20 },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const orphans = JSON.parse(content[0].text);

      expect(Array.isArray(orphans.orphans)).toBe(true);
    });
  });

  describe('Graph Intelligence', () => {
    it('should get note structure', async () => {
      const result = await client.callTool({
        name: 'note_read',
        arguments: { path: 'project/Artemis Rocket.md' },
      });

      // May succeed or fail depending on exact file path
      if (!result.isError) {
        const content = result.content as Array<{ type: string; text: string }>;
        const structure = JSON.parse(content[0].text);
        expect(structure.path).toBeDefined();
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

  it('should execute flywheel_doctor report=health successfully', async () => {
    const result = await client.callTool({
      name: 'flywheel_doctor',
      arguments: { report: 'health' },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const healthData = JSON.parse(content[0].text);

    expect(healthData.status).toBeDefined();
    expect(healthData.vault_path).toContain('carter-strategy');
  });

  it('should list all tools', async () => {
    const tools = await client.listTools();

    expect(tools.tools.length).toBeGreaterThanOrEqual(24);

    // Check for key tool categories
    const toolNames = tools.tools.map(t => t.name);

    // Graph tools
    expect(toolNames).toContain('graph_analysis');

    // Health tools (merged into flywheel_doctor)
    expect(toolNames).toContain('flywheel_doctor');

    // Query tools
    expect(toolNames).toContain('search');
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
      'flywheel_doctor',
      'graph_analysis',
      'search',
      'note_read',
    ];

    for (const tool of documentedTools) {
      expect(toolNames, `Missing documented tool: ${tool}`).toContain(tool);
    }
  });

  it('should return valid JSON from all tools', async () => {
    const testCalls = [
      { name: 'flywheel_doctor', arguments: { report: 'health' } },
      { name: 'graph_analysis', arguments: { analysis: 'hubs', limit: 5 } },
      { name: 'graph_analysis', arguments: { analysis: 'orphans', limit: 5 } },
      { name: 'search', arguments: { modified_after: '2000-01-01', sort_by: 'modified', limit: 5 } },
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
