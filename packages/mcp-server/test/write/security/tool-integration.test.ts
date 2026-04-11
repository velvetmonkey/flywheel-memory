/**
 * Tool-level security integration tests
 *
 * Tests path boundary enforcement at the MCP tool input boundary —
 * the same interface Claude sees. Complements the unit tests in
 * path-encoding.test.ts and permission-bypass.test.ts which test
 * validatePath/validatePathSecure directly.
 *
 * These tests verify that individual tool handlers correctly use
 * validatePathSecure() rather than the deprecated sync validatePath().
 *
 * Covered:
 *   vault_create_note  — note path traversal, template LFI
 *   vault_delete_note  — path traversal on delete
 *   vault_move_note    — traversal on source and destination
 *   vault_rename_note  — traversal on source path
 *   merge_entities     — traversal on source and target
 *   absorb_as_alias    — traversal on target
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createWriteTestServer,
  type WriteTestServerContext,
} from '../../helpers/createWriteTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import fs from 'fs/promises';
import path from 'path';

/** Parse the first text content block from a tool result */
function parseResult(result: { content: unknown }): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe('Tool-level path security (T32)', () => {
  let ctx: WriteTestServerContext;
  let client: Client;

  beforeAll(async () => {
    ctx = await createWriteTestServer();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await ctx.server.connect(serverTransport);

    client = new Client(
      { name: 'security-test', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client?.close();
    await ctx?.cleanup();
  });

  // ============================================================
  // vault_create_note — note path traversal
  // ============================================================

  describe('vault_create_note — note path', () => {
    it('rejects simple path traversal', async () => {
      const result = await client.callTool({
        name: 'vault_create_note',
        arguments: { path: '../outside.md', content: 'bad' },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid path|path traversal/i);
    });

    it('rejects absolute path', async () => {
      const result = await client.callTool({
        name: 'vault_create_note',
        arguments: { path: '/etc/passwd.md', content: 'bad' },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
    });

    it('rejects sensitive file target (.env)', async () => {
      const result = await client.callTool({
        name: 'vault_create_note',
        arguments: { path: '.env', content: 'TOKEN=stolen' },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid path|sensitive/i);
    });
  });

  // ============================================================
  // vault_create_note — template LFI (Local File Inclusion)
  // ============================================================

  describe('vault_create_note — template path', () => {
    it('rejects traversal in template path', async () => {
      // Create a legit target note path to get past note-path validation
      const result = await client.callTool({
        name: 'vault_create_note',
        arguments: {
          path: 'notes/safe.md',
          template: '../../etc/passwd',
          content: '',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid template path|path traversal/i);
    });

    it('rejects absolute path in template', async () => {
      const result = await client.callTool({
        name: 'vault_create_note',
        arguments: {
          path: 'notes/safe2.md',
          template: '/etc/passwd',
          content: '',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
    });

    it('rejects sensitive file as template (.env)', async () => {
      // Create a .env file inside vault so it "exists" — should still be blocked
      await fs.writeFile(path.join(ctx.vaultPath, '.env'), 'SECRET=test');
      const result = await client.callTool({
        name: 'vault_create_note',
        arguments: {
          path: 'notes/safe3.md',
          template: '.env',
          content: '',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid template path|sensitive/i);
    });
  });

  // ============================================================
  // vault_delete_note
  // ============================================================

  describe('vault_delete_note', () => {
    it('rejects path traversal', async () => {
      const result = await client.callTool({
        name: 'vault_delete_note',
        arguments: { path: '../outside.md', confirm: true },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid path|path traversal/i);
    });

    it('rejects sensitive file target', async () => {
      const result = await client.callTool({
        name: 'vault_delete_note',
        arguments: { path: '.env', confirm: true },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
    });
  });

  // ============================================================
  // vault_move_note
  // ============================================================

  describe('vault_move_note', () => {
    it('rejects path traversal on source', async () => {
      const result = await client.callTool({
        name: 'vault_move_note',
        arguments: {
          oldPath: '../outside.md',
          newPath: 'notes/dest.md',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid source path|path traversal/i);
    });

    it('rejects path traversal on destination', async () => {
      await createTestNote(ctx.vaultPath, 'notes/move-source.md', '# Source\n');
      const result = await client.callTool({
        name: 'vault_move_note',
        arguments: {
          oldPath: 'notes/move-source.md',
          newPath: '../../etc/escape.md',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid destination path|path traversal/i);
    });

    it('rejects sensitive destination', async () => {
      await createTestNote(ctx.vaultPath, 'notes/move-source2.md', '# Source\n');
      const result = await client.callTool({
        name: 'vault_move_note',
        arguments: {
          oldPath: 'notes/move-source2.md',
          newPath: '.env',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
    });
  });

  // ============================================================
  // vault_rename_note
  // ============================================================

  describe('vault_rename_note', () => {
    it('rejects path traversal on source', async () => {
      const result = await client.callTool({
        name: 'vault_rename_note',
        arguments: {
          path: '../outside.md',
          newTitle: 'new-name',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid path|path traversal/i);
    });
  });

  // ============================================================
  // merge_entities
  // ============================================================

  describe('merge_entities', () => {
    it('rejects path traversal on source', async () => {
      const result = await client.callTool({
        name: 'merge_entities',
        arguments: {
          source_path: '../outside.md',
          target_path: 'notes/target.md',
          dry_run: true,
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid source path|path traversal/i);
    });

    it('rejects path traversal on target', async () => {
      await createTestNote(ctx.vaultPath, 'notes/merge-source.md', '# Source\n');
      const result = await client.callTool({
        name: 'merge_entities',
        arguments: {
          source_path: 'notes/merge-source.md',
          target_path: '../../etc/escape.md',
          dry_run: true,
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid target path|path traversal/i);
    });
  });

  // ============================================================
  // absorb_as_alias
  // ============================================================

  describe('absorb_as_alias', () => {
    it('rejects path traversal on target', async () => {
      const result = await client.callTool({
        name: 'absorb_as_alias',
        arguments: {
          source_name: 'SomeName',
          target_path: '../../etc/escape.md',
          dry_run: true,
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid target path|path traversal/i);
    });

    it('rejects sensitive file as target', async () => {
      const result = await client.callTool({
        name: 'absorb_as_alias',
        arguments: {
          source_name: 'SomeName',
          target_path: '.env',
          dry_run: true,
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
    });
  });

  // ============================================================
  // Symlink escape (if OS supports symlink creation)
  // ============================================================

  describe('symlink escape (vault_delete_note)', () => {
    it('rejects symlink pointing outside vault', async () => {
      // Create a temp dir outside the vault
      const outsideDir = await fs.mkdtemp('/tmp/flywheel-outside-');
      const outsideFile = path.join(outsideDir, 'secret.md');
      await fs.writeFile(outsideFile, 'secret content');

      // Create a symlink inside the vault pointing to the outside file
      const symlinkPath = path.join(ctx.vaultPath, 'escape-link.md');
      try {
        await fs.symlink(outsideFile, symlinkPath);
      } catch {
        // Skip if symlink creation not supported (some WSL configs)
        await fs.rm(outsideDir, { recursive: true, force: true });
        return;
      }

      const result = await client.callTool({
        name: 'vault_delete_note',
        arguments: { path: 'escape-link.md', confirm: true },
      });

      // Clean up regardless of result
      await fs.rm(outsideDir, { recursive: true, force: true });
      try { await fs.unlink(symlinkPath); } catch { /* already gone */ }

      const data = parseResult(result);
      // Should be blocked: symlink target is outside vault
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid path|outside vault|symlink/i);
    });
  });
});
