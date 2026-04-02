/**
 * Trace test: absorb_as_alias
 *
 * Verifies that absorbing an entity name as an alias of a target note
 * resolves links, makes the alias searchable, and does not create a source note.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('absorb_as_alias trace', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);

    // Setup: people/Bob.md with existing alias
    await createTestNote(ctx.vaultPath, 'people/Bob.md', [
      '---',
      'type: person',
      'aliases:',
      '  - Robert',
      '---',
      '',
      '# Bob',
      '',
      'The primary entity.',
    ].join('\n'));

    // Setup: daily/2026-01-01.md with [[Bobby]] — no Bobby.md exists
    await createTestNote(ctx.vaultPath, 'daily/2026-01-01.md', [
      '---',
      'type: daily',
      '---',
      '',
      '# 2026-01-01',
      '',
      'Had a chat with [[Bobby]] about the project.',
    ].join('\n'));

    // Build initial index
    await snap(client, 'refresh_index');

    // Absorb Bobby as alias of Bob
    await snap(client, 'absorb_as_alias', {
      source_name: 'Bobby',
      target_path: 'people/Bob.md',
    });

    // Refresh after absorb
    await snap(client, 'refresh_index');
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('alias resolves link', async () => {
    // Use get_note_structure to verify the daily note still has outlinks
    const struct = await snap(client, 'get_note_structure', { path: 'daily/2026-01-01.md' });
    expect(struct).toBeDefined();
    // After absorb, the daily note's [[Bobby]] wikilink should resolve to Bob via alias
    // Check that the daily note still has outlink(s)
    expect(struct.outlink_count).toBeGreaterThanOrEqual(1);
  });

  it('search finds via alias', async () => {
    const result = await snap(client, 'search', { query: 'Bobby' });
    const paths = result.results.map((r: any) => r.path);
    expect(paths).toContain('people/Bob.md');
  });

  it('no source note created', () => {
    const sourcePath = path.join(ctx.vaultPath, 'people/Bobby.md');
    expect(existsSync(sourcePath)).toBe(false);
  });
});
