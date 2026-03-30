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
    await snap(client, 'wikilink_feedback', {
      mode: 'report',
      entity: 'TestEntity_wfbtrace',
      note_path: 'test.md',
      context: 'test context for wikilink feedback',
      correct: false,
    });

    const stats = await snap(client, 'wikilink_feedback', {
      mode: 'stats',
    });

    // Stats should include an entry for our entity
    const entities = stats.entities ?? stats.stats ?? [];
    const entityNames = entities.map((e: any) => e.entity ?? e.name ?? '');
    expect(entityNames).toEqual(expect.arrayContaining([
      expect.stringContaining('TestEntity_wfbtrace'),
    ]));
  });

  it('dashboard updated', async () => {
    const dashBefore = await snap(client, 'wikilink_feedback', {
      mode: 'dashboard',
    });
    const countBefore = dashBefore.total_feedback ?? dashBefore.total ?? dashBefore.summary?.total ?? 0;

    await snap(client, 'wikilink_feedback', {
      mode: 'report',
      entity: 'DashEntity_wfbtrace',
      note_path: 'dash-test.md',
      context: 'dashboard count test context',
      correct: true,
    });

    const dashAfter = await snap(client, 'wikilink_feedback', {
      mode: 'dashboard',
    });
    const countAfter = dashAfter.total_feedback ?? dashAfter.total ?? dashAfter.summary?.total ?? 0;

    expect(countAfter).toBeGreaterThan(countBefore);
  });
});
