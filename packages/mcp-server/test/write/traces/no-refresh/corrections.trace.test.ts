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
    await snap(client, 'vault_record_correction', {
      correction_type: 'wrong_link',
      description: 'Alice should not link to Beta pqztrace',
    });

    const list = await snap(client, 'vault_list_corrections', {});
    expect(list.count).toBeGreaterThanOrEqual(1);

    const descriptions = list.corrections.map((c: any) => c.description);
    expect(descriptions).toEqual(expect.arrayContaining([
      expect.stringContaining('Alice should not link to Beta pqztrace'),
    ]));
  });

  it('resolve changes status', async () => {
    const recorded = await snap(client, 'vault_record_correction', {
      correction_type: 'wrong_entity',
      description: 'Entity Gamma miscategorized rsztrace',
    });

    const correctionId = recorded.correction?.id ?? recorded.correction?.correction_id;
    expect(correctionId).toBeDefined();

    await snap(client, 'vault_resolve_correction', {
      correction_id: correctionId,
      status: 'applied',
    });

    const applied = await snap(client, 'vault_list_corrections', { status: 'applied' });
    const appliedIds = applied.corrections.map((c: any) => c.id ?? c.correction_id);
    expect(appliedIds).toContain(correctionId);

    const pending = await snap(client, 'vault_list_corrections', { status: 'pending' });
    const pendingIds = pending.corrections.map((c: any) => c.id ?? c.correction_id);
    expect(pendingIds).not.toContain(correctionId);
  });

  it('pending correction in brief', async () => {
    await snap(client, 'vault_record_correction', {
      correction_type: 'general',
      description: 'Fix naming convention mwxtrace',
    });

    const result = await client.callTool('brief', {});
    const text = result.content[0].text;
    expect(text).toContain('correction');
  });
});
