/**
 * Trace test: vault_delete_note
 *
 * Verifies that deleting a note propagates through refresh_index
 * to search, forward links, vault_stats, and validate_links.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('vault_delete_note traces', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  let statsBefore: any;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);

    // Seed vault: 3 notes — daily links to Alice
    await createTestNote(ctx.vaultPath, 'people/Alice.md', [
      '---',
      'type: person',
      '---',
      '',
      '# Alice',
      '',
      'Alice works on [[Alpha]].',
    ].join('\n'));

    await createTestNote(ctx.vaultPath, 'projects/Alpha.md', [
      '---',
      'type: project',
      '---',
      '',
      '# Alpha',
      '',
      'A flagship project.',
    ].join('\n'));

    await createTestNote(ctx.vaultPath, 'daily/2026-01-01.md', [
      '---',
      'type: daily',
      '---',
      '',
      '# 2026-01-01',
      '',
      'Met with [[Alice]] today.',
    ].join('\n'));

    await snap(client, 'refresh_index');
    statsBefore = await snap(client, 'doctor', { action: 'stats' });
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('removed from search by path', async () => {
    await snap(client, 'note', { action: 'delete', path: 'people/Alice.md', confirm: true });
    await snap(client, 'refresh_index');

    const result = await snap(client, 'search', { query: 'Alice' });
    const paths = (result.results || []).map((r: any) => r.path);
    expect(paths).not.toContain('people/Alice.md');
  });

  it('forward link to deleted note is a dangling reference', async () => {
    // After deleting Alice, the daily note still has [[Alice]] in its content
    // but Alice.md no longer exists. validate_links should report this.
    const validation = await snap(client, 'link', { action: 'validate' });
    expect(validation.broken_links).toBeGreaterThanOrEqual(1);
    const targets = validation.broken.map((b: any) => b.target);
    expect(targets).toContain('Alice');
  });

  it('vault_stats total_notes decreases by 1', async () => {
    const after = await snap(client, 'doctor', { action: 'stats' });
    expect(after.total_notes).toBe(statsBefore.total_notes - 1);
  });

  it('validate_links reports dangling link', async () => {
    const validation = await snap(client, 'link', { action: 'validate' });
    expect(validation.broken_links).toBeGreaterThanOrEqual(1);
    const targets = validation.broken.map((b: any) => b.target);
    expect(targets).toContain('Alice');
  });
});
