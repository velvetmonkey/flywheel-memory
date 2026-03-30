/**
 * Trace test: rename_tag
 *
 * Verifies that renaming a tag propagates through refresh_index
 * to vault_schema and search.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('rename_tag traces', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);

    await createTestNote(ctx.vaultPath, 'projects/proj-a.md', [
      '---',
      'type: project',
      'tags:',
      '  - project',
      '---',
      '',
      '# Project A',
      '',
      'First project.',
    ].join('\n'));

    await createTestNote(ctx.vaultPath, 'projects/proj-b.md', [
      '---',
      'type: project',
      'tags:',
      '  - project',
      '---',
      '',
      '# Project B',
      '',
      'Second project.',
    ].join('\n'));

    await createTestNote(ctx.vaultPath, 'projects/proj-c.md', [
      '---',
      'type: project',
      'tags:',
      '  - project',
      '---',
      '',
      '# Project C',
      '',
      'Third project.',
    ].join('\n'));

    await snap(client, 'refresh_index');
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('old tag absent, new tag present in vault_schema', async () => {
    await snap(client, 'rename_tag', {
      old_tag: 'project',
      new_tag: 'work',
      dry_run: false,
    });
    await snap(client, 'refresh_index');

    const schema = await snap(client, 'vault_schema', { analysis: 'field_values', field: 'tags' });
    const tagValues = schema.values.map((v: any) => v.value);
    expect(tagValues).toContain('work');
    expect(tagValues).not.toContain('project');
  });

  it('search by new tag finds all renamed notes', async () => {
    const result = await snap(client, 'search', { has_tag: 'work' });
    expect(result.total_matches).toBeGreaterThanOrEqual(3);
  });
});
