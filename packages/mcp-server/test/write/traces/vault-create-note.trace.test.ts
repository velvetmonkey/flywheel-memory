/**
 * Trace test: vault_create_note
 *
 * Verifies that creating a note propagates through refresh_index
 * to search, backlinks, forward links, vault_stats, vault_schema,
 * and search(action: similar).
 *
 * Note: vault_create_note lowercases filenames via sanitizeNotePath,
 * so "people/Bob.md" becomes "people/bob.md".
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('vault_create_note traces', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  // Snapshots before mutation
  let statsBefore: any;
  let backlinksBefore: any;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);

    // Seed vault: 3 notes (created directly, no sanitization)
    await createTestNote(ctx.vaultPath, 'people/alice.md', [
      '---',
      'type: person',
      '---',
      '',
      '# Alice',
      '',
      'Alice works on [[Alpha]].',
    ].join('\n'));

    await createTestNote(ctx.vaultPath, 'projects/alpha.md', [
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
      'Daily note.',
    ].join('\n'));

    // Initial index build
    await snap(client, 'refresh_index');

    // Capture before-state
    statsBefore = await snap(client, 'doctor', { action: 'stats' });
    backlinksBefore = await snap(client, 'search', { query: 'Alpha' }).then((r: any) => {
      const note = (r.results ?? []).find((n: any) => n.path === 'projects/alpha.md');
      return { backlink_count: note?.backlink_count ?? 0 };
    });
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('appears in search after creation', async () => {
    await snap(client, 'note', { action: 'create',
      path: 'people/bob.md',
      content: '# Bob\n\nBob works on [[Alpha]].',
      frontmatter: { type: 'person' },
    });
    await snap(client, 'refresh_index');

    const result = await snap(client, 'search', { query: 'Bob' });
    expect(result.total_results).toBeGreaterThanOrEqual(1);
    const paths = result.results.map((r: any) => r.path);
    expect(paths).toContain('people/bob.md');
  });

  it('creates backlink on target note', async () => {
    const after = await snap(client, 'search', { query: 'Alpha' }).then((r: any) => {
      const note = (r.results ?? []).find((n: any) => n.path === 'projects/alpha.md');
      return { backlink_count: note?.backlink_count ?? 0 };
    });
    expect(after.backlink_count).toBeGreaterThan(backlinksBefore.backlink_count);
  });

  it('appears in forward links', async () => {
    const result = await snap(client, 'search', { query: 'Bob' });
    const note = (result.results ?? []).find((n: any) => n.path === 'people/bob.md');
    expect(note).toBeDefined();
    const outlinkNames: string[] = note?.outlink_names ?? [];
    expect(outlinkNames.length).toBeGreaterThanOrEqual(1);
    // Alpha should be in outlink_names (case-insensitive)
    expect(outlinkNames.some((n: string) => n.toLowerCase() === 'alpha')).toBe(true);
  });

  it('increases vault_stats total_notes by 1', async () => {
    const after = await snap(client, 'doctor', { action: 'stats' });
    expect(after.total_notes).toBe(statsBefore.total_notes + 1);
  });

  it('increases vault_stats total_links', async () => {
    const after = await snap(client, 'doctor', { action: 'stats' });
    expect(after.total_links).toBeGreaterThan(statsBefore.total_links);
  });

  it('new type appears in vault_schema field_values', async () => {
    await snap(client, 'note', { action: 'create',
      path: 'misc/widget-thing.md',
      content: '# Widget Thing\n\nA widget.',
      frontmatter: { type: 'widget' },
    });
    await snap(client, 'refresh_index');

    const schema = await snap(client, 'schema', { action: 'field_values', field: 'type' });
    const typeValues = schema.values.map((v: any) => v.value);
    expect(typeValues).toContain('widget');
  });

  it('findable by search(action: similar)', async () => {
    const similar = await snap(client, 'search', { action: 'similar', path: 'people/alice.md' });
    const paths = similar.similar.map((s: any) => s.path);
    expect(paths).toContain('people/bob.md');
  });
});
