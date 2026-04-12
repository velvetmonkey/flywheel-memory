/**
 * Trace test: vault_rename_note
 *
 * Verifies that renaming a note makes it findable by the new name,
 * updates backlinks, and does not change the total note count.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('vault_rename_note trace', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;
  let totalNotesBefore: number;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);

    // Setup: people/Alice.md
    await createTestNote(ctx.vaultPath, 'people/Alice.md', [
      '---',
      'type: person',
      '---',
      '',
      '# Alice',
      '',
      'A team member.',
    ].join('\n'));

    // Setup: daily/2026-01-01.md with backlink to Alice
    await createTestNote(ctx.vaultPath, 'daily/2026-01-01.md', [
      '---',
      'type: daily',
      '---',
      '',
      '# 2026-01-01',
      '',
      'Spoke with [[Alice]] about the plan.',
    ].join('\n'));

    // Build initial index
    await snap(client, 'refresh_index');

    // Capture total notes before rename
    const statsBefore = await snap(client, 'doctor', { action: 'stats' });
    totalNotesBefore = statsBefore.total_notes;

    // Perform the rename
    await snap(client, 'note', {
      action: 'rename',
      path: 'people/Alice.md',
      new_name: 'AliceRenamed',
    });

    // Refresh after rename
    await snap(client, 'refresh_index');
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('findable by new name', async () => {
    const result = await snap(client, 'search', { query: 'AliceRenamed' });
    expect(result.total_results).toBeGreaterThanOrEqual(1);
  });

  it('backlinks updated', async () => {
    const result = await snap(client, 'search', { query: 'AliceRenamed' });
    const note = (result.results ?? []).find((n: any) => n.path === 'people/AliceRenamed.md');
    expect(note).toBeDefined();
    expect(note.backlink_count).toBeGreaterThanOrEqual(1);
  });

  it('vault_stats total unchanged', async () => {
    const statsAfter = await snap(client, 'doctor', { action: 'stats' });
    expect(statsAfter.total_notes).toBe(totalNotesBefore);
  });
});
