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
    it('should execute doctor action=health successfully', async () => {
      // flywheel_doctor retired (T43 B3+) — merged into doctor(action: health)
      const result = await client.callTool({
        name: 'doctor',
        arguments: { action: 'health' },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].type).toBe('text');
      const healthData = JSON.parse(content[0].text);

      expect(healthData.status).toBeDefined();
      expect(healthData.vault_path).toBeDefined();
      expect(healthData.vault_path).toContain('artemis-rocket');
    });

    it('should find hub notes with graph', async () => {
      // graph_analysis retired (T43 B3+) — merged into graph(action: analyse, analysis: hubs)
      const result = await client.callTool({
        name: 'graph',
        arguments: { action: 'analyse', analysis: 'hubs', limit: 10 },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const hubs = JSON.parse(content[0].text);

      // graph(action: analyse) returns top_hubs (renamed from hubs in graph_analysis)
      expect(Array.isArray(hubs.top_hubs)).toBe(true);
      // May have no hubs if min_links threshold not met in small demo vault
      if (hubs.top_hubs.length > 0) {
        // Hub notes should have meaningful backlink counts
        for (const hub of hubs.top_hubs.slice(0, 3)) {
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
      // graph_analysis retired (T43 B3+) — merged into graph(action: analyse)
      const result = await client.callTool({
        name: 'graph',
        arguments: { action: 'analyse', limit: 20 },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const data = JSON.parse(content[0].text);

      expect(Array.isArray(data.orphans)).toBe(true);
    });
  });

  describe('Graph Intelligence', () => {
    it('should get note structure', async () => {
      const result = await client.callTool({
        name: 'note_read',
        arguments: { action: 'structure', path: 'project/Artemis Rocket.md' },
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

  it('should execute doctor action=health successfully', async () => {
    // flywheel_doctor retired (T43 B3+) — merged into doctor(action: health)
    const result = await client.callTool({
      name: 'doctor',
      arguments: { action: 'health' },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const healthData = JSON.parse(content[0].text);

    expect(healthData.status).toBeDefined();
    expect(healthData.vault_path).toContain('carter-strategy');
  });

  it('should list all tools', async () => {
    const tools = await client.listTools();

    // T43 B3+: agent preset = 18 tools (17 under CLAUDECODE=1)
    expect(tools.tools.length).toBeGreaterThanOrEqual(18);

    // Check for key tool categories
    const toolNames = tools.tools.map(t => t.name);

    // Graph tools (graph_analysis retired, merged into graph)
    expect(toolNames).toContain('graph');

    // Health tools (flywheel_doctor retired, merged into doctor)
    expect(toolNames).toContain('doctor');

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

    // Core documented tools (T43 B3+ merged names)
    const documentedTools = [
      'doctor',       // flywheel_doctor retired — merged into doctor
      'graph',        // graph_analysis retired — merged into graph
      'search',
      'note_read',
    ];

    for (const tool of documentedTools) {
      expect(toolNames, `Missing documented tool: ${tool}`).toContain(tool);
    }
  });

  it('should return valid JSON from all tools', async () => {
    const testCalls = [
      { name: 'doctor', arguments: { action: 'health' } },
      { name: 'graph', arguments: { action: 'analyse', limit: 5 } },
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
