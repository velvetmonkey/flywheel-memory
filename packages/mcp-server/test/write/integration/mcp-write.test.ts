/**
 * MCP Write Integration Tests
 *
 * Tests write tools at the MCP client level — the same interface
 * Claude sees. Covers mutations, config, security boundaries, and undo.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createWriteTestServer,
  type WriteTestServerContext,
} from '../../helpers/createWriteTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';

/** Parse the first text content block from a tool result */
function parseResult(result: { content: unknown }): unknown {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

describe('MCP Write Integration', () => {
  let ctx: WriteTestServerContext;
  let client: Client;

  beforeAll(async () => {
    ctx = await createWriteTestServer();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await ctx.server.connect(serverTransport);

    client = new Client(
      { name: 'write-test', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client?.close();
    await ctx?.cleanup();
  });

  // ==========================================================================
  // vault_add_to_section
  // ==========================================================================
  describe('vault_add_to_section', () => {
    it('adds content to an existing section', async () => {
      await createTestNote(ctx.vaultPath, 'test-add.md', [
        '# Test',
        '',
        '## Log',
        '',
        '- Existing entry',
        '',
      ].join('\n'));

      const result = await client.callTool({
        name: 'vault_add_to_section',
        arguments: {
          path: 'test-add.md',
          section: 'Log',
          content: '- New entry',
        },
      });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as Record<string, unknown>;
      expect(data.success).toBe(true);

      const fileContent = readFileSync(path.join(ctx.vaultPath, 'test-add.md'), 'utf-8');
      expect(fileContent).toContain('- New entry');
      expect(fileContent).toContain('- Existing entry');
    });

    it('creates a note when create_if_missing is true', async () => {
      // Daily notes use built-in fallback template with standard sections
      const result = await client.callTool({
        name: 'vault_add_to_section',
        arguments: {
          path: 'daily/2099-01-01.md',
          section: 'Log',
          content: '- Created via MCP',
          create_if_missing: true,
        },
      });

      expect(result.isError).toBeFalsy();

      const created = existsSync(path.join(ctx.vaultPath, 'daily/2099-01-01.md'));
      expect(created).toBe(true);

      const fileContent = readFileSync(path.join(ctx.vaultPath, 'daily/2099-01-01.md'), 'utf-8');
      expect(fileContent).toContain('Created via MCP');
      // Verify daily template structure was applied
      expect(fileContent).toContain('# Food');
      expect(fileContent).toContain('# Log');
    });

    it('dry_run + create_if_missing does not create a file', async () => {
      const result = await client.callTool({
        name: 'vault_add_to_section',
        arguments: {
          path: 'daily/2099-02-02.md',
          section: '2099-02-02',
          content: '- Should not exist',
          create_if_missing: true,
          dry_run: true,
        },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text.toLowerCase()).toContain('dry run');

      const created = existsSync(path.join(ctx.vaultPath, 'daily/2099-02-02.md'));
      expect(created).toBe(false);
    });

    it('blocks path traversal', async () => {
      const result = await client.callTool({
        name: 'vault_add_to_section',
        arguments: {
          path: '../../../etc/passwd',
          section: 'Log',
          content: 'exploit',
        },
      });

      const text = (result.content as Array<{ text: string }>)[0].text.toLowerCase();
      expect(text).toMatch(/path|blocked|invalid|outside|traversal|security/);
    });

    it('blocks sensitive file access', async () => {
      const result = await client.callTool({
        name: 'vault_add_to_section',
        arguments: {
          path: '.env',
          section: 'Secrets',
          content: 'exploit',
        },
      });

      const text = (result.content as Array<{ text: string }>)[0].text.toLowerCase();
      expect(text).toMatch(/sensitive|blocked|denied|protected|security|\.env/);
    });
  });

  // ==========================================================================
  // vault_create_note
  // ==========================================================================
  describe('vault_create_note', () => {
    it('creates a note with valid path and content', async () => {
      const result = await client.callTool({
        name: 'vault_create_note',
        arguments: {
          path: 'new-note.md',
          content: '# New Note\n\nHello world',
        },
      });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as Record<string, unknown>;
      expect(data.success).toBe(true);

      const fileContent = readFileSync(path.join(ctx.vaultPath, 'new-note.md'), 'utf-8');
      expect(fileContent).toContain('Hello world');
    });

    it('blocks path traversal on create', async () => {
      const result = await client.callTool({
        name: 'vault_create_note',
        arguments: {
          path: '../../outside.md',
          content: '# Exploit',
        },
      });

      const text = (result.content as Array<{ text: string }>)[0].text.toLowerCase();
      expect(text).toMatch(/path|blocked|invalid|outside|traversal|security/);
    });
  });

  // ==========================================================================
  // flywheel_config
  // ==========================================================================
  describe('flywheel_config', () => {
    it('returns valid config in get mode', async () => {
      const result = await client.callTool({
        name: 'flywheel_config',
        arguments: { mode: 'get' },
      });

      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as Record<string, unknown>;
      expect(data).toHaveProperty('wikilink_strictness');
    });

    it('persists a valid key with set mode', async () => {
      const setResult = await client.callTool({
        name: 'flywheel_config',
        arguments: {
          mode: 'set',
          key: 'wikilink_strictness',
          value: 'conservative',
        },
      });

      expect(setResult.isError).toBeFalsy();
      const setData = parseResult(setResult) as Record<string, unknown>;
      expect(setData.wikilink_strictness).toBe('conservative');

      // Verify via get
      const getResult = await client.callTool({
        name: 'flywheel_config',
        arguments: { mode: 'get' },
      });
      const getData = parseResult(getResult) as Record<string, unknown>;
      expect(getData.wikilink_strictness).toBe('conservative');
    });

    it('rejects an unknown config key', async () => {
      const result = await client.callTool({
        name: 'flywheel_config',
        arguments: {
          mode: 'set',
          key: 'nonexistent',
          value: 'anything',
        },
      });

      const data = parseResult(result) as Record<string, unknown>;
      expect(data.error).toBeDefined();
      expect(String(data.error)).toContain('Unknown config key');
    });

    it('rejects an invalid value type', async () => {
      const result = await client.callTool({
        name: 'flywheel_config',
        arguments: {
          mode: 'set',
          key: 'wikilink_strictness',
          value: 12345,
        },
      });

      const data = parseResult(result) as Record<string, unknown>;
      expect(data.error).toBeDefined();
      expect(String(data.error).toLowerCase()).toContain('invalid');
    });

    it('rejects read-only key (paths)', async () => {
      const result = await client.callTool({
        name: 'flywheel_config',
        arguments: {
          mode: 'set',
          key: 'paths',
          value: {},
        },
      });

      const data = parseResult(result) as Record<string, unknown>;
      expect(data.error).toBeDefined();
      expect(String(data.error)).toContain('Unknown config key');
    });
  });

  // ==========================================================================
  // vault_undo_last_mutation
  // ==========================================================================
  describe('vault_undo_last_mutation', () => {
    it('reports not-a-git-repo in a temp vault', async () => {
      const result = await client.callTool({
        name: 'vault_undo_last_mutation',
        arguments: { confirm: true },
      });

      const text = (result.content as Array<{ text: string }>)[0].text.toLowerCase();
      expect(text).toMatch(/git|not.*repo|undo|failed|error/);
    });
  });
});
