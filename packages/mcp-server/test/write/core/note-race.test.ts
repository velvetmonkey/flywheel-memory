/**
 * Concurrent-writer race tests for note create CAS/locking
 * (arch-review S4, council binding mod 2 — written and verified green
 * BEFORE the critical section moves to core/write/noteLifecycle.ts).
 *
 * Pins the TOCTOU contract of note(action: create):
 *  - per-path lock + in-lock existence re-check: of N concurrent no-overwrite
 *    creators of the same path, exactly ONE succeeds, the rest fail with
 *    code FILE_EXISTS;
 *  - CAS via expectedHash on overwrite: a stale hash fails with code
 *    WRITE_CONFLICT and does NOT clobber the newer content;
 *  - of two concurrent overwriters holding the SAME starting hash, exactly
 *    one wins; the loser gets WRITE_CONFLICT.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerNoteTool } from '../../../src/tools/write/note.js';
import { readVaultFile } from '../../../src/core/write/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
}>;

function captureHandler(register: (server: McpServer) => void): ToolHandler {
  let handler: ToolHandler | null = null;
  const server = {
    tool(_name: string, ...args: unknown[]) {
      handler = args[args.length - 1] as ToolHandler;
      return { enabled: true };
    },
    registerTool(_name: string, _d: unknown, h: unknown) {
      handler = h as ToolHandler;
      return { enabled: true };
    },
  } as unknown as McpServer;
  register(server);
  if (!handler) throw new Error('no handler captured');
  return handler;
}

const parse = (r: Awaited<ReturnType<ToolHandler>>) => JSON.parse(r.content[0].text);

let vaultPath: string;
let handler: ToolHandler;

beforeEach(async () => {
  vaultPath = await createTempVault();
  handler = captureHandler((s) => registerNoteTool(s, () => vaultPath));
});

afterEach(async () => {
  await cleanupTempVault(vaultPath);
});

describe('note create — concurrent-writer races', () => {
  it('N concurrent no-overwrite creators: exactly one wins, losers get FILE_EXISTS', async () => {
    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        handler({
          action: 'create',
          path: 'race/contested.md',
          content: `# Writer ${i}`,
          skipWikilinks: true,
        }).then(parse),
      ),
    );

    const winners = results.filter((r) => r.success === true);
    const losers = results.filter((r) => r.success !== true);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(N - 1);
    for (const loser of losers) {
      expect(loser.code).toBe('FILE_EXISTS');
      expect(loser.message).toContain('Use overwrite:true to replace.');
    }

    // File content is exactly one writer's content, intact (no interleaving)
    const file = await readTestNote(vaultPath, 'race/contested.md');
    const writerIds = results.map((_, i) => i).filter((i) => file.includes(`Writer ${i}`));
    expect(writerIds).toHaveLength(1);
  });

  it('stale expectedHash on overwrite fails with WRITE_CONFLICT and preserves newer content', async () => {
    await createTestNote(vaultPath, 'race/cas.md', '# Version 1\n');
    const { contentHash: staleHash } = await readVaultFile(vaultPath, 'race/cas.md');

    // Someone else updates the file after our read
    const intermediate = parse(await handler({
      action: 'create', path: 'race/cas.md', content: '# Version 2',
      overwrite: true, skipWikilinks: true,
    }));
    expect(intermediate.success).toBe(true);

    // Our write with the stale hash must fail and not clobber Version 2
    const conflicted = parse(await handler({
      action: 'create', path: 'race/cas.md', content: '# Stale writer',
      overwrite: true, expectedHash: staleHash, skipWikilinks: true,
    }));
    expect(conflicted.success).not.toBe(true);
    expect(conflicted.code).toBe('WRITE_CONFLICT');

    const file = await readTestNote(vaultPath, 'race/cas.md');
    expect(file).toContain('Version 2');
    expect(file).not.toContain('Stale writer');
  });

  it('fresh expectedHash on overwrite succeeds', async () => {
    await createTestNote(vaultPath, 'race/cas-ok.md', '# Original\n');
    const { contentHash } = await readVaultFile(vaultPath, 'race/cas-ok.md');

    const result = parse(await handler({
      action: 'create', path: 'race/cas-ok.md', content: '# Updated',
      overwrite: true, expectedHash: contentHash, skipWikilinks: true,
    }));
    expect(result.success).toBe(true);
    expect(await readTestNote(vaultPath, 'race/cas-ok.md')).toContain('Updated');
  });

  it('two concurrent CAS overwriters with the same starting hash: one wins, one WRITE_CONFLICT', async () => {
    await createTestNote(vaultPath, 'race/cas-race.md', '# Base\n');
    const { contentHash } = await readVaultFile(vaultPath, 'race/cas-race.md');

    const [a, b] = await Promise.all([
      handler({
        action: 'create', path: 'race/cas-race.md', content: '# Writer A',
        overwrite: true, expectedHash: contentHash, skipWikilinks: true,
      }).then(parse),
      handler({
        action: 'create', path: 'race/cas-race.md', content: '# Writer B',
        overwrite: true, expectedHash: contentHash, skipWikilinks: true,
      }).then(parse),
    ]);

    const outcomes = [a, b];
    const winners = outcomes.filter((r) => r.success === true);
    const conflicts = outcomes.filter((r) => r.code === 'WRITE_CONFLICT');
    expect(winners).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    const file = await readTestNote(vaultPath, 'race/cas-race.md');
    const winnerContent = winners[0] === a ? '# Writer A' : '# Writer B';
    expect(file).toContain(winnerContent.replace('# ', ''));
  });

  it('repeated create/race rounds stay consistent (10 rounds)', async () => {
    for (let round = 0; round < 10; round++) {
      const p = `race/round-${round}.md`;
      const results = await Promise.all([
        handler({ action: 'create', path: p, content: '# A', skipWikilinks: true }).then(parse),
        handler({ action: 'create', path: p, content: '# B', skipWikilinks: true }).then(parse),
      ]);
      const winners = results.filter((r) => r.success === true);
      expect(winners, `round ${round}`).toHaveLength(1);
    }
  });
});
