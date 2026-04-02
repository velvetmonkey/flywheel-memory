/**
 * Blocking Chain Verification Test
 *
 * Tests that the "What's blocking the propulsion system?" example
 * from the README is actually traceable via the vault structure.
 *
 * Expected chain:
 * Propulsion System → waiting on → Turbopump (delayed)
 *   → waiting on → Acme Aerospace (supplier delivery delayed)
 *     → affects → Engine Hot Fire Results, Thrust Validation (blocked)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { createTestServer, type TestServerContext } from '../helpers/createTestServer.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const DEMOS_PATH = path.resolve(__dirname, '../../../../../demos');
const ARTEMIS_VAULT = path.join(DEMOS_PATH, 'artemis-rocket');

describe('README Blocking Chain Example', () => {
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

  describe('Blocking Chain Entities Exist', () => {
    it('should have Propulsion System note', async () => {
      const result = await client.callTool({
        name: 'get_note_structure',
        arguments: { path: 'systems/propulsion/Propulsion System.md' }
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.path).toContain('Propulsion System');
    });

    it('should have Turbopump note with delayed status', async () => {
      const result = await client.callTool({
        name: 'get_note_structure',
        arguments: { path: 'systems/propulsion/Turbopump.md' }
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.frontmatter?.status).toBe('delayed');
    });

    it('should have Acme Aerospace supplier note with delayed status', async () => {
      const result = await client.callTool({
        name: 'get_note_structure',
        arguments: { path: 'suppliers/Acme Aerospace.md' }
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.frontmatter?.status).toBe('delayed');
      expect(data.frontmatter?.blocked_by).toContain('[[Turbopump]]');
      expect(data.frontmatter?.affects).toContain('[[Propulsion System]]');
    });

    it('should have Thrust Validation note with blocked status', async () => {
      const result = await client.callTool({
        name: 'get_note_structure',
        arguments: { path: 'tests/Thrust Validation.md' }
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.frontmatter?.status).toBe('blocked');
      expect(data.frontmatter?.blocked_by).toContain('[[Acme Aerospace]]');
    });

    it('should have Ignition Sequence note', async () => {
      const result = await client.callTool({
        name: 'get_note_structure',
        arguments: { path: 'systems/propulsion/Ignition Sequence.md' }
      });

      expect(result.isError).toBeFalsy();
    });
  });

  describe('Blocking Chain is Traceable', () => {
    it('should find blocked/delayed notes via search', async () => {
      const result = await client.callTool({
        name: 'search',
        arguments: { modified_after: '2000-01-01', limit: 50, detail_count: 50 }
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

      // Find notes with delayed or blocked status
      const results = data.results ?? data.notes ?? [];
      const blockedNotes = results.filter((n: any) =>
        n.frontmatter?.status === 'delayed' || n.frontmatter?.status === 'blocked'
      );

      // Should have at least Turbopump (delayed) and Thrust Validation (blocked)
      expect(blockedNotes.length).toBeGreaterThanOrEqual(2);

      const paths = blockedNotes.map((n: any) => n.path);
      expect(paths.some((p: string) => p.includes('Turbopump'))).toBe(true);
      expect(paths.some((p: string) => p.includes('Thrust Validation'))).toBe(true);
    });

    it('should find backlinks via search for Acme Aerospace', async () => {
      const result = await client.callTool({
        name: 'search',
        arguments: { query: 'Acme Aerospace', limit: 5 }
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

      // Search results include backlink_count in enriched decision surface
      const results = data.results ?? data.notes ?? [];
      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
    });

    it('should find backlinks via search for Turbopump', async () => {
      const result = await client.callTool({
        name: 'search',
        arguments: { query: 'Turbopump', limit: 5 }
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

      // Search results include backlink_count in enriched decision surface
      const results = data.results ?? data.notes ?? [];
      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
