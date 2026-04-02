/**
 * Trace test: vault_add_to_section
 *
 * Verifies that adding content to a section propagates through
 * refresh_index to search and backlinks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('vault_add_to_section traces', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);

    await createTestNote(ctx.vaultPath, 'people/Alice.md', [
      '---',
      'type: person',
      '---',
      '',
      '# Alice',
      '',
      'Alice is an engineer.',
    ].join('\n'));

    await createTestNote(ctx.vaultPath, 'journal/entry.md', [
      '---',
      'type: journal',
      '---',
      '',
      '# Entry',
      '',
      '## Log',
      '',
      '- Started the day',
    ].join('\n'));

    await snap(client, 'refresh_index');
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('added content appears in search', async () => {
    await snap(client, 'vault_add_to_section', {
      path: 'journal/entry.md',
      section: 'Log',
      content: '- xyzunique groceries pickup',
    });
    await snap(client, 'refresh_index');

    const result = await snap(client, 'search', { query: 'xyzunique' });
    expect(result.total_results).toBeGreaterThanOrEqual(1);
  });

  it('wikilink in added content creates backlink', async () => {
    await snap(client, 'vault_add_to_section', {
      path: 'journal/entry.md',
      section: 'Log',
      content: '- Spoke with [[Alice]] about the project',
    });
    await snap(client, 'refresh_index');

    const result = await snap(client, 'search', { query: 'Alice' });
    const note = (result.results ?? []).find((n: any) => n.path === 'people/Alice.md');
    expect(note).toBeDefined();
    expect(note.backlink_count).toBeGreaterThanOrEqual(1);
  });
});
