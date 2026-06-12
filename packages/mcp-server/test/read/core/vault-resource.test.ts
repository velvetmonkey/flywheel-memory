/**
 * MCP resource coverage for src/resources/vault.ts (arch-review S12).
 *
 * Registers the vault resources against a real McpServer and exercises the
 * resources/list + resources/read protocol surface over an in-memory
 * transport. Shape pins only — no value pins (fixture content may drift).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildVaultIndex } from '../../../src/core/read/graph.js';
import { registerVaultResources } from '../../../src/resources/vault.js';
import type { VaultIndex } from '../../../src/core/read/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');

describe('vault resources (src/resources/vault.ts)', () => {
  let index: VaultIndex | null = null;
  let client: Client;

  beforeAll(async () => {
    index = await buildVaultIndex(FIXTURES_PATH);

    const server = new McpServer({ name: 'vault-resource-test', version: '0.0.0' });
    registerVaultResources(server, () => index);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: 'vault-resource-test-client', version: '0.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client?.close();
  });

  it('lists the three vault:// resources', async () => {
    const result = await client.listResources();
    const uris = result.resources.map((r) => r.uri);

    expect(uris).toContain('vault://stats');
    expect(uris).toContain('vault://schema');
    expect(uris).toContain('vault://recent');

    for (const resource of result.resources) {
      expect(typeof resource.name).toBe('string');
      expect(resource.mimeType).toBe('application/json');
    }
  });

  it('reads vault://stats with the stats contract shape', async () => {
    const result = await client.readResource({ uri: 'vault://stats' });

    expect(result.contents.length).toBeGreaterThan(0);
    const content = result.contents[0];
    expect(content.uri).toBe('vault://stats');
    expect(content.mimeType).toBe('application/json');

    const stats = JSON.parse(content.text as string);
    for (const field of ['note_count', 'tag_count', 'total_links', 'orphan_count', 'index_built_at']) {
      expect(stats, `missing stats field ${field}`).toHaveProperty(field);
    }
    expect(typeof stats.note_count).toBe('number');
    expect(typeof stats.orphan_count).toBe('number');
    expect(typeof stats.index_built_at).toBe('string');
  });

  it('reads vault://recent with the recent-notes contract shape', async () => {
    const result = await client.readResource({ uri: 'vault://recent' });

    const data = JSON.parse(result.contents[0].text as string);
    expect(Array.isArray(data.recent_notes)).toBe(true);
    expect(data.recent_notes.length).toBeLessThanOrEqual(10);
    if (data.recent_notes.length > 0) {
      const note = data.recent_notes[0];
      for (const field of ['path', 'title', 'modified', 'tags']) {
        expect(note, `missing recent-note field ${field}`).toHaveProperty(field);
      }
    }
  });

  it('returns an error payload when the index is not ready', async () => {
    const previous = index;
    index = null;
    try {
      const result = await client.readResource({ uri: 'vault://stats' });
      const data = JSON.parse(result.contents[0].text as string);
      expect(data.error).toBe('Index not ready');
    } finally {
      index = previous;
    }
  });
});
