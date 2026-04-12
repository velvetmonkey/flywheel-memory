/**
 * Trace test: vault_move_note
 *
 * Verifies that moving a note updates the index, preserves forward links,
 * and updates referring notes to point to the new path.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('vault_move_note trace', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);

    // Setup: people/Alice.md with forward link to Alpha
    await createTestNote(ctx.vaultPath, 'people/Alice.md', [
      '---',
      'type: person',
      '---',
      '',
      '# Alice',
      '',
      'Working on [[Alpha]] project.',
    ].join('\n'));

    // Setup: projects/Alpha.md
    await createTestNote(ctx.vaultPath, 'projects/Alpha.md', [
      '---',
      'type: project',
      '---',
      '',
      '# Alpha',
      '',
      'A key project.',
    ].join('\n'));

    // Setup: daily/2026-01-01.md with backlink to Alice
    await createTestNote(ctx.vaultPath, 'daily/2026-01-01.md', [
      '---',
      'type: daily',
      '---',
      '',
      '# 2026-01-01',
      '',
      'Met with [[Alice]] today.',
    ].join('\n'));

    // Build initial index
    await snap(client, 'refresh_index');

    // Perform the move
    await snap(client, 'note', {
      action: 'move',
      path: 'people/Alice.md',
      destination: 'team/Alice.md',
    });

    // Refresh after move
    await snap(client, 'refresh_index');
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('findable at new path', async () => {
    const result = await snap(client, 'search', { query: 'Alice' });
    const paths = result.results.map((r: any) => r.path);
    expect(paths).toContain('team/Alice.md');
  });

  it('referring note resolves to new path', async () => {
    const result = await snap(client, 'search', { query: '2026-01-01' });
    const note = (result.results ?? []).find((n: any) => n.path === 'daily/2026-01-01.md');
    expect(note).toBeDefined();
    // The daily note should have outlink_names containing Alice
    const outlinkNames: string[] = note?.outlink_names ?? [];
    expect(outlinkNames.some((n: string) => n.toLowerCase() === 'alice')).toBe(true);
  });

  it('forward links preserved', async () => {
    const result = await snap(client, 'search', { query: 'Alice' });
    const note = (result.results ?? []).find((n: any) => n.path === 'team/Alice.md');
    expect(note).toBeDefined();
    const outlinkNames: string[] = note?.outlink_names ?? [];
    expect(outlinkNames.some((n: string) => n.toLowerCase() === 'alpha')).toBe(true);
  });

  it('old path absent from search', async () => {
    const result = await snap(client, 'search', { query: 'Alice' });
    const paths = result.results.map((r: any) => r.path);
    expect(paths).not.toContain('people/Alice.md');
  });
});
