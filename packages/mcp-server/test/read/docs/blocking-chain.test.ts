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
        name: 'get_note_metadata',
        arguments: { path: 'systems/propulsion/Propulsion System.md' }
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.path).toContain('Propulsion System');
    });

    it('should have Turbopump note with delayed status', async () => {
      const result = await client.callTool({
        name: 'get_note_metadata',
        arguments: { path: 'systems/propulsion/Turbopump.md' }
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.frontmatter?.status).toBe('delayed');
    });

    it('should have Acme Aerospace supplier note with delayed status', async () => {
      const result = await client.callTool({
        name: 'get_note_metadata',
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
        name: 'get_note_metadata',
        arguments: { path: 'tests/Thrust Validation.md' }
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(data.frontmatter?.status).toBe('blocked');
      expect(data.frontmatter?.blocked_by).toContain('[[Acme Aerospace]]');
    });

    it('should have Ignition Sequence note', async () => {
      const result = await client.callTool({
        name: 'get_note_metadata',
        arguments: { path: 'systems/propulsion/Ignition Sequence.md' }
      });

      expect(result.isError).toBeFalsy();
    });
  });

  describe('Blocking Chain is Traceable', () => {
    it('should find blocked/delayed notes via search', async () => {
      const result = await client.callTool({
        name: 'search_notes',
        arguments: { frontmatter_has: 'status', limit: 50 }
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

      // Find notes with delayed or blocked status
      const blockedNotes = data.notes.filter((n: any) =>
        n.frontmatter?.status === 'delayed' || n.frontmatter?.status === 'blocked'
      );

      // Should have at least Turbopump (delayed), Acme Aerospace (delayed), Thrust Validation (blocked)
      expect(blockedNotes.length).toBeGreaterThanOrEqual(3);

      const paths = blockedNotes.map((n: any) => n.path);
      expect(paths.some((p: string) => p.includes('Turbopump'))).toBe(true);
      expect(paths.some((p: string) => p.includes('Acme Aerospace'))).toBe(true);
      expect(paths.some((p: string) => p.includes('Thrust Validation'))).toBe(true);
    });

    it('should trace backlinks from Acme Aerospace to Turbopump', async () => {
      const result = await client.callTool({
        name: 'get_backlinks',
        arguments: { path: 'suppliers/Acme Aerospace.md' }
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

      // Debug: log actual backlinks structure
      console.log('Acme Aerospace backlinks:', JSON.stringify(data.backlinks?.slice(0, 5), null, 2));

      // Acme Aerospace should be referenced by Turbopump (in supplier field)
      // Backlinks structure depends on tool implementation
      const hasBacklinks = data.backlinks && data.backlinks.length > 0;
      expect(hasBacklinks).toBe(true);

      // If has backlinks, at least one should be from propulsion system files
      if (hasBacklinks) {
        const backlinkStrings = data.backlinks.map((b: any) => JSON.stringify(b));
        const foundTurbopump = backlinkStrings.some((s: string) => s.includes('Turbopump'));
        expect(foundTurbopump).toBe(true);
      }
    });

    it('should trace backlinks from Turbopump to Propulsion System', async () => {
      const result = await client.callTool({
        name: 'get_backlinks',
        arguments: { path: 'systems/propulsion/Turbopump.md' }
      });

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content as Array<{ text: string }>)[0].text);

      // Debug: log actual backlinks structure
      console.log('Turbopump backlinks count:', data.backlinks?.length || 0);
      console.log('Turbopump sample backlinks:', JSON.stringify(data.backlinks?.slice(0, 5), null, 2));

      // Turbopump should be referenced by Propulsion System
      // Turbopump is mentioned throughout the vault
      const hasBacklinks = data.backlinks && data.backlinks.length > 0;
      expect(hasBacklinks).toBe(true);

      // Log all paths to see what we have
      if (hasBacklinks) {
        const backlinkStrings = data.backlinks.map((b: any) => JSON.stringify(b));
        console.log('Looking for Propulsion System in:', backlinkStrings.slice(0, 10));
        const foundPropulsion = backlinkStrings.some((s: string) => s.includes('Propulsion'));
        expect(foundPropulsion).toBe(true);
      }
    });
  });
});
