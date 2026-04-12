import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../../read/helpers/createTestServer.js';
import { snap } from '../helpers/snapshotTools.js';

describe('Trace: Corrections (no refresh)', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('record appears in list', async () => {
    await snap(client, 'correct', {
      action: 'record',
      path: 'people/Alice.md',
      entity: 'Alice',
      note: 'Alice should not link to Beta pqztrace',
    });

    const list = await snap(client, 'correct', { action: 'list' });
    expect(list.count).toBeGreaterThanOrEqual(1);

    const notes = list.corrections.map((c: any) => c.note ?? c.description ?? '');
    expect(notes).toEqual(expect.arrayContaining([
      expect.stringContaining('Alice should not link to Beta pqztrace'),
    ]));
  });

  it('resolve changes status', async () => {
    const recorded = await snap(client, 'correct', {
      action: 'record',
      path: 'entities/Gamma.md',
      entity: 'Gamma',
      note: 'Entity Gamma miscategorized rsztrace',
    });

    const correctionId = recorded.correction?.id;
    expect(correctionId).toBeDefined();

    const resolved = await snap(client, 'correct', {
      action: 'resolve',
      correction_id: String(correctionId),
    });

    expect(resolved.resolved).toBe(true);
    expect(resolved.status).toBe('applied');
  });

  it('pending correction in brief', async () => {
    await snap(client, 'correct', {
      action: 'record',
      path: 'notes/naming.md',
      entity: 'naming',
      note: 'Fix naming convention mwxtrace',
    });

    const result = await client.callTool('memory', { action: 'brief' });
    const text = result.content[0].text;
    expect(text).toContain('correction');
  });
});
