/**
 * Trace test: vault_update_frontmatter
 *
 * Verifies that updating frontmatter propagates through refresh_index
 * to search and vault_schema.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('vault_update_frontmatter traces', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);

    await createTestNote(ctx.vaultPath, 'people/carol.md', [
      '---',
      'type: person',
      '---',
      '',
      '# Carol',
      '',
      'Carol is a designer.',
    ].join('\n'));

    await createTestNote(ctx.vaultPath, 'people/dan.md', [
      '---',
      'type: person',
      '---',
      '',
      '# Dan',
      '',
      'Dan is an engineer.',
    ].join('\n'));

    await snap(client, 'refresh_index');
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('new frontmatter field appears in search', async () => {
    await snap(client, 'vault_update_frontmatter', {
      path: 'people/carol.md',
      frontmatter: { department: 'engineering' },
    });
    await snap(client, 'refresh_index');

    const result = await snap(client, 'search', { query: 'engineering' });
    expect(result.total_results).toBeGreaterThanOrEqual(1);
  });

  it('changed type appears in vault_schema field_values', async () => {
    await snap(client, 'vault_update_frontmatter', {
      path: 'people/dan.md',
      frontmatter: { type: 'gadget' },
    });
    await snap(client, 'refresh_index');

    const schema = await snap(client, 'schema', { action: 'field_values', field: 'type' });
    const typeValues = schema.values.map((v: any) => v.value);
    expect(typeValues).toContain('gadget');
  });
});
