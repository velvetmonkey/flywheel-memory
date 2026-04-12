import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../../read/helpers/createTestServer.js';
import { snap } from '../helpers/snapshotTools.js';

describe('Trace: Wikilink feedback (no refresh)', () => {
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
    const result = await snap(client, 'link', {
      action: 'feedback',
      entity: 'TestEntity_wfbtrace',
      accepted: false,
      note_path: 'test.md',
      context: 'test context for wikilink feedback',
    });

    // The feedback response includes total_feedback_rows
    expect(result.total_feedback_rows).toBeGreaterThanOrEqual(1);
    expect(result.reported.entity).toBe('TestEntity_wfbtrace');
  });

  it('dashboard updated', async () => {
    const dashBefore = await snap(client, 'link', { action: 'dashboard' });
    const countBefore = dashBefore.total_feedback ?? 0;

    await snap(client, 'link', {
      action: 'feedback',
      entity: 'DashEntity_wfbtrace',
      accepted: true,
      note_path: 'dash-test.md',
      context: 'dashboard count test context',
    });

    const dashAfter = await snap(client, 'link', { action: 'dashboard' });
    const countAfter = dashAfter.total_feedback ?? 0;

    expect(countAfter).toBeGreaterThan(countBefore);
  });
});
