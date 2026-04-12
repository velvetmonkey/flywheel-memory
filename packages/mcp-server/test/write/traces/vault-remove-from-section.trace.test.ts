/**
 * Trace test: vault_remove_from_section
 *
 * Verifies that removing content from a section propagates through
 * refresh_index — removed content is no longer searchable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('vault_remove_from_section traces', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);

    await createTestNote(ctx.vaultPath, 'notes/remove-test.md', [
      '---',
      'type: note',
      '---',
      '',
      '# Remove Test',
      '',
      '## Details',
      '',
      'Some preamble.',
      'removemeunique content that should vanish.',
      'Some epilogue.',
    ].join('\n'));

    await snap(client, 'refresh_index');
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('removed content no longer searchable', async () => {
    // Verify content is indexed
    const before = await snap(client, 'search', { query: 'removemeunique' });
    expect(before.total_results).toBeGreaterThanOrEqual(1);

    await snap(client, 'edit_section', {
      action: 'remove',
      path: 'notes/remove-test.md',
      section: 'Details',
      pattern: 'removemeunique content that should vanish.',
    });
    await snap(client, 'refresh_index');

    const after = await snap(client, 'search', { query: 'removemeunique' });
    expect(after.total_results).toBe(0);
  });
});
