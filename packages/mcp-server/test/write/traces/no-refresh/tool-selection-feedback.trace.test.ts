import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../../read/helpers/createTestServer.js';
import { snap } from '../helpers/snapshotTools.js';

describe('Trace: Tool selection feedback (no refresh)', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('report recorded in stats', async () => {
    const listBefore = await snap(client, 'tool_selection_feedback', {
      mode: 'list',
    });
    const countBefore = listBefore.count ?? 0;

    await snap(client, 'tool_selection_feedback', {
      mode: 'report',
      tool_name: 'search',
      correct: true,
    });

    const listAfter = await snap(client, 'tool_selection_feedback', {
      mode: 'list',
    });
    const countAfter = listAfter.count ?? 0;

    expect(countAfter).toBeGreaterThan(countBefore);
  });
});
