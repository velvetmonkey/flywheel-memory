/**
 * Trace test: cross-tool consistency
 *
 * Verifies that data reported by one tool is consistent with data
 * from another — backlink counts match stats, forward-link existence
 * matches disk, search paths are real, and task arithmetic is sound.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';
import { createWriteTestServer, type WriteTestServerContext } from '../../helpers/createWriteTestServer.js';
import { connectTestClient, type TestClient } from '../../read/helpers/createTestServer.js';
import { createTestNote } from '../helpers/testUtils.js';
import { snap } from './helpers/snapshotTools.js';

describe('cross-tool consistency traces', () => {
  let ctx: WriteTestServerContext;
  let client: TestClient;

  beforeAll(async () => {
    ctx = await createWriteTestServer();
    client = connectTestClient(ctx.server);

    // 5-note vault with various links
    await createTestNote(ctx.vaultPath, 'people/alice.md', [
      '---',
      'type: person',
      '---',
      '',
      '# Alice',
      '',
      'Alice leads [[Alpha]] and mentors [[Bob]].',
    ].join('\n'));

    await createTestNote(ctx.vaultPath, 'people/bob.md', [
      '---',
      'type: person',
      '---',
      '',
      '# Bob',
      '',
      'Bob works on [[Alpha]] with [[Alice]].',
    ].join('\n'));

    await createTestNote(ctx.vaultPath, 'projects/alpha.md', [
      '---',
      'type: project',
      '---',
      '',
      '# Alpha',
      '',
      'A flagship project led by [[Alice]].',
    ].join('\n'));

    await createTestNote(ctx.vaultPath, 'daily/2026-03-01.md', [
      '---',
      'type: daily',
      '---',
      '',
      '# 2026-03-01',
      '',
      'Met with [[Alice]] and [[Bob]] about [[Alpha]].',
    ].join('\n'));

    await createTestNote(ctx.vaultPath, 'notes/orphan.md', [
      '---',
      'type: note',
      '---',
      '',
      '# Orphan',
      '',
      'This note links to [[NonExistent]] which does not exist.',
    ].join('\n'));

    // Note with mixed tasks for task arithmetic test
    await createTestNote(ctx.vaultPath, 'tasks/mixed.md', [
      '---',
      'type: note',
      '---',
      '',
      '# Mixed Tasks',
      '',
      '- [ ] open task one',
      '- [ ] open task two',
      '- [x] done task one',
      '- [x] done task two',
      '- [x] done task three',
      '- [-] cancelled task one',
    ].join('\n'));

    await snap(client, 'refresh_index');
  }, 30_000);

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('backlink count matches vault_stats most_linked_notes', async () => {
    const stats = await snap(client, 'flywheel_doctor', { report: 'stats' });
    const topEntries = stats.most_linked_notes.slice(0, 2);

    for (const entry of topEntries) {
      const basename = entry.path.replace(/\.md$/, '').split('/').pop() ?? entry.path;
      const searchResult = await snap(client, 'search', { query: basename });
      const results = searchResult.results ?? searchResult.notes ?? [];
      const noteResult = results.find((r: any) => r.path === entry.path);
      expect(noteResult?.backlink_count ?? 0).toBe(entry.backlinks);
    }
  });

  it('forward link existence matches disk', async () => {
    // notes/orphan.md has a link to NonExistent (doesn't exist)
    // validate_links should report the dangling link
    const validation = await snap(client, 'validate_links', {});
    expect(validation.broken_links).toBeGreaterThanOrEqual(1);
    const targets = validation.broken.map((b: any) => b.target);
    expect(targets).toContain('NonExistent');
  });

  it('search paths are valid files on disk', async () => {
    // Use a word that actually appears in notes (not a stop word like "the")
    const result = await snap(client, 'search', { query: 'flagship' });
    expect(result.total_results).toBeGreaterThanOrEqual(1);

    for (const r of result.results) {
      const fullPath = path.join(ctx.vaultPath, r.path);
      expect(existsSync(fullPath)).toBe(true);
    }
  });

  it('task arithmetic: open + completed + cancelled = total', async () => {
    // Query tasks — status defaults to 'open' but response includes vault-wide counts
    const result = await snap(client, 'tasks', { limit: 100 });

    const openCount = result.open_count;
    const completedCount = result.completed_count;
    const cancelledCount = result.cancelled_count;
    const totalCount = result.total_count;

    // We know from our fixture: 2 open, 3 completed, 1 cancelled = 6 total
    expect(openCount).toBe(2);
    expect(completedCount).toBe(3);
    expect(cancelledCount).toBe(1);
    expect(openCount + completedCount + cancelledCount).toBe(totalCount);
  });
});
