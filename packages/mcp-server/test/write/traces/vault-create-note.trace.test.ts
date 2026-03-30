/**
 * Trace test: vault_create_note
 *
 * Verifies that creating a note propagates through refresh_index
 * to search, backlinks, forward links, vault_stats, vault_schema,
 * and find_similar.
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
    statsBefore = await snap(client, 'get_vault_stats', {});
    backlinksBefore = await snap(client, 'get_backlinks', { path: 'projects/alpha.md' });
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('appears in search after creation', async () => {
    await snap(client, 'vault_create_note', {
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
    const after = await snap(client, 'get_backlinks', { path: 'projects/alpha.md' });
    expect(after.backlink_count).toBeGreaterThan(backlinksBefore.backlink_count);
    const sources = after.backlinks.map((b: any) => b.source);
    expect(sources).toContain('people/bob.md');
  });

  it('appears in forward links', async () => {
    const fwd = await snap(client, 'get_forward_links', { path: 'people/bob.md' });
    expect(fwd.forward_link_count).toBeGreaterThanOrEqual(1);
    const existingLinks = fwd.forward_links.filter((l: any) => l.exists);
    expect(existingLinks.length).toBeGreaterThanOrEqual(1);
  });

  it('increases vault_stats total_notes by 1', async () => {
    const after = await snap(client, 'get_vault_stats', {});
    expect(after.total_notes).toBe(statsBefore.total_notes + 1);
  });

  it('increases vault_stats total_links', async () => {
    const after = await snap(client, 'get_vault_stats', {});
    expect(after.total_links).toBeGreaterThan(statsBefore.total_links);
  });

  it('new type appears in vault_schema field_values', async () => {
    await snap(client, 'vault_create_note', {
      path: 'misc/widget-thing.md',
      content: '# Widget Thing\n\nA widget.',
      frontmatter: { type: 'widget' },
    });
    await snap(client, 'refresh_index');

    const schema = await snap(client, 'vault_schema', { analysis: 'field_values', field: 'type' });
    const typeValues = schema.values.map((v: any) => v.value);
    expect(typeValues).toContain('widget');
  });

  it('findable by find_similar', async () => {
    const similar = await snap(client, 'find_similar', { path: 'people/alice.md' });
    const paths = similar.similar.map((s: any) => s.path);
    expect(paths).toContain('people/bob.md');
  });
});
