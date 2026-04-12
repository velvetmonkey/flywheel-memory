/**
 * Trace test: index staleness
 *
 * Verifies that refresh_index correctly handles external filesystem changes:
 * deleted files disappear from search, externally added files appear,
 * modified content is re-indexed, and FTS5/VaultIndex stay in sync.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('index staleness traces', () => {
  describe('stale result eliminated', () => {
    let ctx: WriteTestServerContext;
    let client: TestClient;

    beforeAll(async () => {
      ctx = await createWriteTestServer();
      client = connectTestClient(ctx.server);

      await createTestNote(ctx.vaultPath, 'notes/ephemeral.md', [
        '---',
        'type: note',
        '---',
        '',
        '# Ephemeral',
        '',
        'xyzstaleness unique content for deletion test.',
      ].join('\n'));

      await snap(client, 'refresh_index');
    }, 30_000);

    afterAll(async () => {
      await ctx?.cleanup();
    });

    it('deleted file disappears from search after refresh', async () => {
      // Confirm indexed
      const before = await snap(client, 'search', { query: 'xyzstaleness' });
      expect(before.total_results).toBeGreaterThanOrEqual(1);

      // Delete directly on disk
      unlinkSync(path.join(ctx.vaultPath, 'notes/ephemeral.md'));
      expect(existsSync(path.join(ctx.vaultPath, 'notes/ephemeral.md'))).toBe(false);

      // Refresh and verify gone
      await snap(client, 'refresh_index');
      const after = await snap(client, 'search', { query: 'xyzstaleness' });
      expect(after.total_results).toBe(0);
    });
  });

  describe('external add found', () => {
    let ctx: WriteTestServerContext;
    let client: TestClient;

    beforeAll(async () => {
      ctx = await createWriteTestServer();
      client = connectTestClient(ctx.server);

      // Initial refresh with empty vault
      await snap(client, 'refresh_index');
    }, 30_000);

    afterAll(async () => {
      await ctx?.cleanup();
    });

    it('externally written file appears in search after refresh', async () => {
      // Write file directly (bypassing MCP tools)
      const dir = path.join(ctx.vaultPath, 'notes');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, 'external.md'),
        '---\ntype: note\n---\n\n# External\n\nxyzexternal unique content added outside MCP.\n',
        'utf-8'
      );

      await snap(client, 'refresh_index');

      const result = await snap(client, 'search', { query: 'xyzexternal' });
      expect(result.total_results).toBeGreaterThanOrEqual(1);
    });
  });

  describe('modified content reflected', () => {
    let ctx: WriteTestServerContext;
    let client: TestClient;

    beforeAll(async () => {
      ctx = await createWriteTestServer();
      client = connectTestClient(ctx.server);

      await createTestNote(ctx.vaultPath, 'notes/mutable.md', [
        '---',
        'type: note',
        '---',
        '',
        '# Mutable',
        '',
        'v1unique content that will change.',
      ].join('\n'));

      await snap(client, 'refresh_index');
    }, 30_000);

    afterAll(async () => {
      await ctx?.cleanup();
    });

    it('overwritten content is re-indexed after refresh', async () => {
      // Confirm v1 indexed
      const before = await snap(client, 'search', { query: 'v1unique' });
      expect(before.total_results).toBeGreaterThanOrEqual(1);

      // Overwrite on disk
      writeFileSync(
        path.join(ctx.vaultPath, 'notes/mutable.md'),
        '---\ntype: note\n---\n\n# Mutable\n\nv2unique content that has changed.\n',
        'utf-8'
      );

      await snap(client, 'refresh_index');

      const afterV1 = await snap(client, 'search', { query: 'v1unique' });
      expect(afterV1.total_results).toBe(0);

      const afterV2 = await snap(client, 'search', { query: 'v2unique' });
      expect(afterV2.total_results).toBeGreaterThanOrEqual(1);
    });
  });

  describe('FTS5 / VaultIndex sync', () => {
    let ctx: WriteTestServerContext;
    let client: TestClient;

    beforeAll(async () => {
      ctx = await createWriteTestServer();
      client = connectTestClient(ctx.server);

      await createTestNote(ctx.vaultPath, 'notes/sync-a.md', [
        '---',
        'type: note',
        '---',
        '',
        '# Sync A',
        '',
        'First note.',
      ].join('\n'));

      await createTestNote(ctx.vaultPath, 'notes/sync-b.md', [
        '---',
        'type: note',
        '---',
        '',
        '# Sync B',
        '',
        'Second note.',
      ].join('\n'));

      await createTestNote(ctx.vaultPath, 'notes/sync-c.md', [
        '---',
        'type: note',
        '---',
        '',
        '# Sync C',
        '',
        'Third note.',
      ].join('\n'));
    }, 30_000);

    afterAll(async () => {
      await ctx?.cleanup();
    });

    it('vault_stats total_notes matches refresh_index notes_count', async () => {
      const refreshResult = await snap(client, 'refresh_index');
      const stats = await snap(client, 'doctor', { action: 'stats' });

      expect(stats.total_notes).toBe(refreshResult.notes_count);
    });
  });
});
