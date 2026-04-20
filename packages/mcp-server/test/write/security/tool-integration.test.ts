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
 *   note(create)       — note path traversal, template LFI
 *   note(delete)       — path traversal on delete
 *   note(move)         — traversal on source and destination
 *   note(rename)       — traversal on source path
 *   entity(merge)      — traversal on source and target
 *   entity(alias)      — traversal on target
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createWriteTestServer,
  type WriteTestServerContext,
} from '../../helpers/createWriteTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { moveNote } from '../../../src/tools/write/move-notes.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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
  // note(create) — note path traversal
  // ============================================================

  describe('note(create) — note path', () => {
    it('rejects simple path traversal', async () => {
      const result = await client.callTool({
        name: 'note',
        arguments: { action: 'create', path: '../outside.md', content: 'bad' },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid path|path traversal/i);
    });

    it('rejects absolute path', async () => {
      const result = await client.callTool({
        name: 'note',
        arguments: { action: 'create', path: '/etc/passwd.md', content: 'bad' },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
    });

    it('rejects sensitive file target (.env)', async () => {
      const result = await client.callTool({
        name: 'note',
        arguments: { action: 'create', path: '.env', content: 'TOKEN=stolen' },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid path|sensitive/i);
    });

    it('rejects nested destination when deepest existing ancestor is a symlink outside the vault', async () => {
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flywheel-create-escape-'));
      const symlinkDir = path.join(ctx.vaultPath, 'escape-link');

      try {
        await fs.symlink(outsideDir, symlinkDir);
      } catch {
        await fs.rm(outsideDir, { recursive: true, force: true });
        return;
      }

      const result = await client.callTool({
        name: 'note',
        arguments: { action: 'create', path: 'escape-link/new/sub/file.md', content: 'bad' },
      });

      await fs.rm(outsideDir, { recursive: true, force: true });
      try { await fs.unlink(symlinkDir); } catch { /* already gone */ }

      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid path|outside vault|ancestor/i);
    });
  });

  // ============================================================
  // note(create) — template LFI (Local File Inclusion)
  // ============================================================

  describe('note(create) — template path', () => {
    it('rejects traversal in template path', async () => {
      // Create a legit target note path to get past note-path validation
      const result = await client.callTool({
        name: 'note',
        arguments: {
          action: 'create',
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
        name: 'note',
        arguments: {
          action: 'create',
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
        name: 'note',
        arguments: {
          action: 'create',
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
  // note(delete)
  // ============================================================

  describe('note(delete)', () => {
    it('rejects path traversal', async () => {
      const result = await client.callTool({
        name: 'note',
        arguments: { action: 'delete', path: '../outside.md', confirm: true },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid path|path traversal/i);
    });

    it('rejects sensitive file target', async () => {
      const result = await client.callTool({
        name: 'note',
        arguments: { action: 'delete', path: '.env', confirm: true },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
    });
  });

  // ============================================================
  // note(move)
  // ============================================================

  describe('note(move)', () => {
    it('rejects path traversal on source', async () => {
      const result = await client.callTool({
        name: 'note',
        arguments: {
          action: 'move',
          path: '../outside.md',
          destination: 'notes/dest.md',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid source path|path traversal/i);
    });

    it('rejects path traversal on destination', async () => {
      await createTestNote(ctx.vaultPath, 'notes/move-source.md', '# Source\n');
      const result = await client.callTool({
        name: 'note',
        arguments: {
          action: 'move',
          path: 'notes/move-source.md',
          destination: '../../etc/escape.md',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid destination path|path traversal/i);
    });

    it('rejects sensitive destination', async () => {
      await createTestNote(ctx.vaultPath, 'notes/move-source2.md', '# Source\n');
      const result = await client.callTool({
        name: 'note',
        arguments: {
          action: 'move',
          path: 'notes/move-source2.md',
          destination: '.env',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
    });

    it('rejects nested destination escapes for both merged and shared move implementations', async () => {
      await createTestNote(ctx.vaultPath, 'notes/move-source3.md', '# Source\n');

      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flywheel-move-escape-'));
      const symlinkDir = path.join(ctx.vaultPath, 'escape-link');

      try {
        await fs.symlink(outsideDir, symlinkDir);
      } catch {
        await fs.rm(outsideDir, { recursive: true, force: true });
        return;
      }

      const mergedResult = await client.callTool({
        name: 'note',
        arguments: {
          action: 'move',
          path: 'notes/move-source3.md',
          destination: 'escape-link/new/sub/file.md',
        },
      });
      const dedicatedData = await moveNote(ctx.vaultPath, {
        oldPath: 'notes/move-source3.md',
        newPath: 'escape-link/new/sub/file.md',
      });

      await fs.rm(outsideDir, { recursive: true, force: true });
      try { await fs.unlink(symlinkDir); } catch { /* already gone */ }

      const mergedData = parseResult(mergedResult);
      expect(mergedData.success).toBe(false);
      expect(dedicatedData.success).toBe(false);
      expect(String(mergedData.message)).toMatch(/invalid destination path|outside vault|ancestor/i);
      expect(String(dedicatedData.message)).toMatch(/invalid destination path|outside vault|ancestor/i);
    });
  });

  // ============================================================
  // note(rename)
  // ============================================================

  describe('note(rename)', () => {
    it('rejects path traversal on source', async () => {
      const result = await client.callTool({
        name: 'note',
        arguments: {
          action: 'rename',
          path: '../outside.md',
          new_name: 'new-name',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid path|path traversal/i);
    });
  });

  // ============================================================
  // entity(merge)
  // ============================================================

  describe('entity(merge)', () => {
    it('rejects path traversal on source', async () => {
      const result = await client.callTool({
        name: 'entity',
        arguments: {
          action: 'merge',
          primary: 'notes/target.md',
          secondary: '../outside.md',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid source path|path traversal/i);
    });

    it('rejects path traversal on target', async () => {
      await createTestNote(ctx.vaultPath, 'notes/merge-source.md', '# Source\n');
      const result = await client.callTool({
        name: 'entity',
        arguments: {
          action: 'merge',
          primary: '../../etc/escape.md',
          secondary: 'notes/merge-source.md',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid target path|path traversal/i);
    });
  });

  // ============================================================
  // entity(alias)
  // ============================================================

  describe('entity(alias)', () => {
    it('rejects path traversal on target', async () => {
      const result = await client.callTool({
        name: 'entity',
        arguments: {
          action: 'alias',
          entity: '../../etc/escape.md',
          alias: 'SomeName',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
      expect(data.message).toMatch(/invalid target path|path traversal/i);
    });

    it('rejects sensitive file as target', async () => {
      const result = await client.callTool({
        name: 'entity',
        arguments: {
          action: 'alias',
          entity: '.env',
          alias: 'SomeName',
        },
      });
      const data = parseResult(result);
      expect(data.success).toBe(false);
    });
  });

  // ============================================================
  // Symlink escape (if OS supports symlink creation)
  // ============================================================

  describe('symlink escape (note delete)', () => {
    it('rejects symlink pointing outside vault', async () => {
      // Create a temp dir outside the vault
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flywheel-outside-'));
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
        name: 'note',
        arguments: { action: 'delete', path: 'escape-link.md', confirm: true },
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
