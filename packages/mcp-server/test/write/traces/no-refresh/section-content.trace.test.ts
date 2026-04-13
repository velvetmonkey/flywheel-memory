import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../../read/helpers/createTestServer.js';
import { createTestNote, createTempVault } from '../../helpers/testUtils.js';
import { snap } from '../helpers/snapshotTools.js';

describe('Trace: Section content (no refresh)', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;
  const notePath = 'trace-section-content.md';

  beforeAll(async () => {
    // Create vault and populate BEFORE building the index
    const vaultPath = await createTempVault();
    await createTestNote(vaultPath, notePath, `---
type: test
---
# Section Content Trace

## Log

- Existing entry

## Notes

Some notes here
`);
    ctx = await createWriteTestServer(vaultPath);
    client = connectTestClient(ctx.server);
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('add visible in read', async () => {
    await snap(client, 'edit_section', {
      action: 'add',
      path: notePath,
      section: 'Log',
      content: 'New xyzunique entry',
      format: 'bullet',
    });

    const result = await snap(client, 'read', {
      action: 'section',
      path: notePath,
      heading: 'Log',
    });

    expect(result.content).toContain('New xyzunique entry');
  });

  it('remove visible in read', async () => {
    // Add a line we can remove
    await snap(client, 'edit_section', {
      action: 'add',
      path: notePath,
      section: 'Log',
      content: 'Removable qrsunique item',
      format: 'bullet',
    });

    // Verify it was added
    const before = await snap(client, 'read', {
      action: 'section',
      path: notePath,
      heading: 'Log',
    });
    expect(before.content).toContain('Removable qrsunique item');

    // Remove it
    await snap(client, 'edit_section', {
      action: 'remove',
      path: notePath,
      section: 'Log',
      pattern: 'Removable qrsunique item',
    });

    const after = await snap(client, 'read', {
      action: 'section',
      path: notePath,
      heading: 'Log',
    });
    expect(after.content).not.toContain('Removable qrsunique item');
  });

  it('replace visible in read', async () => {
    await snap(client, 'edit_section', {
      action: 'replace',
      path: notePath,
      section: 'Log',
      search: 'Existing entry',
      replacement: 'Replaced entry',
    });

    const result = await snap(client, 'read', {
      action: 'section',
      path: notePath,
      heading: 'Log',
    });

    expect(result.content).toContain('Replaced entry');
    expect(result.content).not.toContain('Existing entry');
  });
});
