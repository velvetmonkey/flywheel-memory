/**
 * Trace test: merge_entities
 *
 * Verifies that merging a source entity into a target removes the source,
 * transfers backlinks, and decreases total note count.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('merge_entities trace', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;
  let totalNotesBefore: number;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);

    // Setup: people/Bob.md
    await createTestNote(ctx.vaultPath, 'people/Bob.md', [
      '---',
      'type: person',
      '---',
      '',
      '# Bob',
      '',
      'The primary entity.',
    ].join('\n'));

    // Setup: people/Robert.md (source to be merged)
    await createTestNote(ctx.vaultPath, 'people/Robert.md', [
      '---',
      'type: person',
      '---',
      '',
      '# Robert',
      '',
      'An alternate entry for Bob.',
    ].join('\n'));

    // Setup: daily/2026-01-01.md with link to Robert
    await createTestNote(ctx.vaultPath, 'daily/2026-01-01.md', [
      '---',
      'type: daily',
      '---',
      '',
      '# 2026-01-01',
      '',
      'Discussed plans with [[Robert]].',
    ].join('\n'));

    // Build initial index
    await snap(client, 'refresh_index');

    // Capture total notes before merge
    const statsBefore = await snap(client, 'flywheel_doctor', { report: 'stats' });
    totalNotesBefore = statsBefore.total_notes;

    // Perform merge: Robert → Bob
    await snap(client, 'merge_entities', {
      source_path: 'people/Robert.md',
      target_path: 'people/Bob.md',
    });

    // Refresh after merge
    await snap(client, 'refresh_index');
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('source gone, target findable', async () => {
    const result = await snap(client, 'search', { query: 'Robert' });
    const paths = result.results.map((r: any) => r.path);

    // Robert.md should no longer exist as a separate note
    expect(paths).not.toContain('people/Robert.md');

    // Bob should be findable (via alias or content)
    const bobResult = await snap(client, 'search', { query: 'Bob' });
    const bobPaths = bobResult.results.map((r: any) => r.path);
    expect(bobPaths).toContain('people/Bob.md');
  });

  it('backlinks transferred', async () => {
    const result = await snap(client, 'search', { query: 'Bob' });
    const note = (result.results ?? []).find((n: any) => n.path === 'people/Bob.md');
    expect(note).toBeDefined();
    // After merge, Bob should have at least the backlink that was on Robert
    expect(note.backlink_count).toBeGreaterThanOrEqual(1);
  });

  it('vault_stats total decreased by 1', async () => {
    const statsAfter = await snap(client, 'flywheel_doctor', { report: 'stats' });
    expect(statsAfter.total_notes).toBe(totalNotesBefore - 1);
  });
});
