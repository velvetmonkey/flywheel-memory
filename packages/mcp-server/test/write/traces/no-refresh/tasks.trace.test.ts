import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWriteTestServer, type WriteTestServerContext } from '../../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../../read/helpers/createTestServer.js';
import { createTestNote, createTempVault } from '../../helpers/testUtils.js';
import { snap } from '../helpers/snapshotTools.js';

describe('Trace: Tasks (no refresh)', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;
  const notePath = 'trace-tasks.md';

  beforeAll(async () => {
    // Create vault and populate BEFORE building the index
    const vaultPath = await createTempVault();
    await createTestNote(vaultPath, notePath, `---
type: test
---
# Task Trace

## Tasks

- [ ] Buy milk
- [ ] Write tests
`);
    ctx = await createWriteTestServer(vaultPath);
    client = connectTestClient(ctx.server);
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('toggle reflects in tasks tool', async () => {
    await snap(client, 'vault_toggle_task', {
      path: notePath,
      task: 'Buy milk',
    });

    const open = await snap(client, 'tasks', {
      path: notePath,
      status: 'open',
    });
    const openTexts = (open.tasks ?? []).map((t: any) => t.text ?? t.task ?? '');
    expect(openTexts.join(' ')).not.toContain('Buy milk');

    const completed = await snap(client, 'tasks', {
      path: notePath,
      status: 'completed',
    });
    const completedTexts = (completed.tasks ?? []).map((t: any) => t.text ?? t.task ?? '');
    expect(completedTexts.join(' ')).toContain('Buy milk');
  });

  it('add_task appears in tasks tool', async () => {
    const before = await snap(client, 'tasks', { path: notePath });
    const countBefore = before.total_count ?? (before.tasks ?? []).length;

    await snap(client, 'vault_add_task', {
      path: notePath,
      task: 'Review PR zxtrace',
      section: 'Tasks',
    });

    const after = await snap(client, 'tasks', { path: notePath });
    const countAfter = after.total_count ?? (after.tasks ?? []).length;
    expect(countAfter).toBe(countBefore + 1);
  });

  it('sections stable after task add', async () => {
    const beforeStructure = await snap(client, 'get_note_structure', { path: notePath });
    const sectionsBefore = (beforeStructure.sections ?? beforeStructure.headings ?? [])
      .map((s: any) => s.heading ?? s.text);

    await snap(client, 'vault_add_task', {
      path: notePath,
      task: 'Another task wvtrace',
      section: 'Tasks',
    });

    const afterStructure = await snap(client, 'get_note_structure', { path: notePath });
    const sectionsAfter = (afterStructure.sections ?? afterStructure.headings ?? [])
      .map((s: any) => s.heading ?? s.text);

    expect(sectionsAfter).toEqual(sectionsBefore);
  });
});
