import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../../read/helpers/createTestServer.js';
import { snap } from '../helpers/snapshotTools.js';

describe('Trace: Memory (no refresh)', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('stored memory searchable', async () => {
    await snap(client, 'memory', {
      action: 'store',
      key: 'user.pref.coffee',
      value: 'User prefers dark roast coffee',
      type: 'preference',
    });

    const result = await snap(client, 'memory', {
      action: 'search',
      query: 'coffee',
    });

    const memories = result.memories ?? result.results ?? [];
    const values = memories.map((m: any) => m.value ?? m.text ?? '');
    expect(values).toEqual(expect.arrayContaining([
      expect.stringContaining('dark roast coffee'),
    ]));
  });

  it('stored memory in brief', async () => {
    await snap(client, 'memory', {
      action: 'store',
      key: 'user.pref.tea',
      value: 'User enjoys oolong tea kqztrace',
      type: 'preference',
    });

    const result = await client.callTool('brief', {});
    const text = result.content[0].text;
    expect(text).toContain('oolong tea kqztrace');
  });
});
