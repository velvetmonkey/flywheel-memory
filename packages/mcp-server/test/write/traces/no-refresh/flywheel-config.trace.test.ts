import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../../read/helpers/createTestServer.js';
import { snap } from '../helpers/snapshotTools.js';

describe('Trace: Flywheel config (no refresh)', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('set persists in get', async () => {
    await snap(client, 'doctor', {
      action: 'config',
      mode: 'set',
      key: 'wikilink_strictness',
      value: 'conservative',
    });

    const config = await snap(client, 'doctor', {
      action: 'config',
      mode: 'get',
    });

    expect(config.wikilink_strictness).toBe('conservative');
  });
});
