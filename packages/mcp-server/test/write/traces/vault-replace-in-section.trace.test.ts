/**
 * Trace test: vault_replace_in_section
 *
 * Verifies that replacing content in a section propagates through
 * refresh_index — old content gone from search, new content appears.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('vault_replace_in_section traces', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);

    await createTestNote(ctx.vaultPath, 'notes/replace-test.md', [
      '---',
      'type: note',
      '---',
      '',
      '# Replace Test',
      '',
      '## Details',
      '',
      'oldunique text here with details.',
    ].join('\n'));

    await snap(client, 'refresh_index');
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('old content gone, new content searchable', async () => {
    // Verify old content is indexed
    const before = await snap(client, 'search', { query: 'oldunique' });
    expect(before.total_results).toBeGreaterThanOrEqual(1);

    await snap(client, 'vault_replace_in_section', {
      path: 'notes/replace-test.md',
      section: 'Details',
      search: 'oldunique text here with details.',
      replacement: 'newunique text here with details.',
    });
    await snap(client, 'refresh_index');

    const afterOld = await snap(client, 'search', { query: 'oldunique' });
    expect(afterOld.total_results).toBe(0);

    const afterNew = await snap(client, 'search', { query: 'newunique' });
    expect(afterNew.total_results).toBeGreaterThanOrEqual(1);
  });
});
