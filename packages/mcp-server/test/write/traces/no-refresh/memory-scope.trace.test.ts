import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../../read/helpers/createTestServer.js';
import { snap } from '../helpers/snapshotTools.js';

describe('Trace: Memory scope and personal briefing', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('keeps private and shared memories isolated by scope', async () => {
    await snap(client, 'memory', {
      action: 'store',
      key: 'user.pref.drink',
      value: 'Shared coffee preference',
      type: 'preference',
      visibility: 'shared',
    });

    await snap(client, 'memory', {
      action: 'store',
      key: 'user.pref.drink',
      value: 'Private tea preference',
      type: 'preference',
      agent_id: 'tg-user:42',
      visibility: 'private',
    });

    const shared = await snap(client, 'memory', {
      action: 'get',
      key: 'user.pref.drink',
    });
    expect(shared.memory.value).toContain('Shared coffee preference');

    const scoped = await snap(client, 'memory', {
      action: 'get',
      key: 'user.pref.drink',
      agent_id: 'tg-user:42',
    });
    expect(scoped.memory.value).toContain('Private tea preference');
  });

  it('brief focus personal excludes global sections', async () => {
    await snap(client, 'memory', {
      action: 'store',
      key: 'user.pref.music',
      value: 'Likes ambient playlists trace-scope',
      type: 'preference',
      agent_id: 'tg-user:77',
      visibility: 'private',
    });

    const result = await snap(client, 'memory', {
      action: 'brief',
      agent_id: 'tg-user:77',
      focus: 'personal',
    });

    expect(result).toHaveProperty('recent_sessions');
    expect(result).toHaveProperty('active_memories');
    expect(result).toHaveProperty('_meta');
    expect(result).not.toHaveProperty('active_entities');
    expect(result).not.toHaveProperty('pending_corrections');
    expect(result).not.toHaveProperty('vault_pulse');
    expect(JSON.stringify(result)).toContain('ambient playlists trace-scope');
  });

  it('forget with agent_id deletes private only', async () => {
    await snap(client, 'memory', {
      action: 'store',
      key: 'user.pref.snack',
      value: 'Shared almonds',
      type: 'fact',
      visibility: 'shared',
    });

    await snap(client, 'memory', {
      action: 'store',
      key: 'user.pref.snack',
      value: 'Private mango',
      type: 'fact',
      agent_id: 'tg-user:9',
      visibility: 'private',
    });

    const forgotten = await snap(client, 'memory', {
      action: 'forget',
      key: 'user.pref.snack',
      agent_id: 'tg-user:9',
    });
    expect(forgotten.forgotten).toBe(true);

    const shared = await snap(client, 'memory', {
      action: 'get',
      key: 'user.pref.snack',
    });
    expect(shared.memory.value).toContain('Shared almonds');

    const scoped = await snap(client, 'memory', {
      action: 'get',
      key: 'user.pref.snack',
      agent_id: 'tg-user:9',
    });
    expect(scoped.memory.value).toContain('Shared almonds');
  });
});
