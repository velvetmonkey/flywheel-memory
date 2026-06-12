/**
 * Characterisation tests for the LIVE `edit_section` merged tool
 * (arch-review S3, written BEFORE the fork reunification refactor).
 *
 * Unlike mutations.test.ts (which exercises core/write/writer.ts primitives),
 * these tests invoke the REAL registered handler — schema dispatch,
 * validation, withVaultFile, sharding, children assembly included — so the
 * live contract is pinned before any code moves. Expectations were verified
 * green against the pre-refactor implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerEditSectionTool } from '../../../src/tools/write/editSection.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function captureHandler(register: (server: McpServer) => void): ToolHandler {
  let handler: ToolHandler | null = null;
  const server = {
    tool(_name: string, ...args: unknown[]) {
      handler = args[args.length - 1] as ToolHandler;
      return { enabled: true };
    },
    registerTool(_name: string, _descriptor: unknown, h: unknown) {
      handler = h as ToolHandler;
      return { enabled: true };
    },
  } as unknown as McpServer;
  register(server);
  if (!handler) throw new Error('tool registration captured no handler');
  return handler;
}

function parseResult(res: Awaited<ReturnType<ToolHandler>>): any {
  return JSON.parse(res.content[0].text);
}

let vaultPath: string;
let handler: ToolHandler;

beforeEach(async () => {
  vaultPath = await createTempVault();
  handler = captureHandler((server) =>
    registerEditSectionTool(server, () => vaultPath, () => ({})),
  );
});

afterEach(async () => {
  await cleanupTempVault(vaultPath);
});

describe('edit_section characterisation (live contract)', () => {
  describe('action: add', () => {
    it('appends plain content under the section heading', async () => {
      await createTestNote(vaultPath, 'notes/log.md', '# Title\n\n## Log\n\n- existing\n');
      const result = parseResult(await handler({
        action: 'add', path: 'notes/log.md', section: 'Log',
        content: 'new entry', skipWikilinks: true,
      }));
      expect(result.success).toBe(true);
      expect(result.message).toBe('Added content to section "Log" in notes/log.md');
      const file = await readTestNote(vaultPath, 'notes/log.md');
      expect(file).toContain('new entry');
      expect(file.indexOf('existing')).toBeLessThan(file.indexOf('new entry'));
    });

    it('prepends when position=prepend, formats bullet', async () => {
      await createTestNote(vaultPath, 'notes/log.md', '# Title\n\n## Log\n\n- existing\n');
      const result = parseResult(await handler({
        action: 'add', path: 'notes/log.md', section: 'Log',
        content: 'first', position: 'prepend', format: 'bullet', skipWikilinks: true,
      }));
      expect(result.success).toBe(true);
      const file = await readTestNote(vaultPath, 'notes/log.md');
      expect(file).toContain('- first');
      expect(file.indexOf('- first')).toBeLessThan(file.indexOf('- existing'));
    });

    it('errors with the exact guidance text when content is missing', async () => {
      const result = parseResult(await handler({
        action: 'add', path: 'notes/none.md', section: 'Log',
      }));
      expect(result.success).toBe(false);
      expect(result.message).toContain('action=add requires content.');
      expect(result.message).toContain('Example: { action: "add"');
    });

    it('dry_run previews without writing', async () => {
      const original = '# Title\n\n## Log\n\n- existing\n';
      await createTestNote(vaultPath, 'notes/log.md', original);
      const result = parseResult(await handler({
        action: 'add', path: 'notes/log.md', section: 'Log',
        content: 'phantom', dry_run: true, skipWikilinks: true,
      }));
      expect(result.success).toBe(true);
      const file = await readTestNote(vaultPath, 'notes/log.md');
      expect(file).not.toContain('phantom');
    });

    it('create_if_missing creates the note (minimal template) then adds', async () => {
      const result = parseResult(await handler({
        action: 'add', path: 'notes/fresh.md', section: 'Log',
        content: 'born', create_if_missing: true, skipWikilinks: true,
      }));
      expect(result.success).toBe(true);
      expect(result.message).toContain('note created');
      const file = await readTestNote(vaultPath, 'notes/fresh.md');
      expect(file).toContain('born');
    });

    it('assembles children as labeled nested bullets', async () => {
      await createTestNote(vaultPath, 'notes/log.md', '# Title\n\n## Log\n');
      const result = parseResult(await handler({
        action: 'add', path: 'notes/log.md', section: 'Log',
        content: 'parent line', skipWikilinks: true,
        children: [
          { label: '**Result:**', content: 'all good' },
          { label: '**Next:**', content: 'ship it' },
        ],
      }));
      expect(result.success).toBe(true);
      const file = await readTestNote(vaultPath, 'notes/log.md');
      expect(file).toContain('- parent line');
      expect(file).toContain('- **Result:** all good');
      expect(file).toContain('- **Next:** ship it');
    });
  });

  describe('action: add with sharding', () => {
    it('routes content into a new audit shard and reports shard metadata', async () => {
      await createTestNote(
        vaultPath, 'daily-notes/2026-06-12.md',
        '# 2026-06-12\n\n## Log\n\n- morning\n',
      );
      const result = parseResult(await handler({
        action: 'add', path: 'daily-notes/2026-06-12.md', section: 'Log',
        content: 'audit entry one', skipWikilinks: true,
        shard: { enabled: true },
      }));
      expect(result.success).toBe(true);
      // Response reports the CANONICAL path, shard fields carry the real target
      expect(result.path).toBe('daily-notes/2026-06-12.md');
      expect(result.shardPath).toBe('daily-notes/logs/2026-06-12-audit-001.md');
      expect(result.shardIndex).toBe(1);
      expect(result.shardCreated).toBe(true);
      expect(result.message).toContain('via shard daily-notes/logs/2026-06-12-audit-001.md');

      // Shard file created with the shard frontmatter contract
      const shardRaw = readFileSync(
        join(vaultPath, 'daily-notes/logs/2026-06-12-audit-001.md'), 'utf-8',
      );
      expect(shardRaw).toContain('type: daily-log-shard');
      expect(shardRaw).toContain('flywheel_indexing: light');
      expect(shardRaw).toContain('audit entry one');

      // Canonical note gains a link to the shard
      const canonical = await readTestNote(vaultPath, 'daily-notes/2026-06-12.md');
      expect(canonical).toContain('Audit log shard 001');
    });

    it('reuses an existing under-limit shard (shardCreated=false)', async () => {
      await createTestNote(
        vaultPath, 'daily-notes/2026-06-12.md',
        '# 2026-06-12\n\n## Log\n',
      );
      const first = parseResult(await handler({
        action: 'add', path: 'daily-notes/2026-06-12.md', section: 'Log',
        content: 'entry A', skipWikilinks: true, shard: { enabled: true },
      }));
      expect(first.shardCreated).toBe(true);
      const second = parseResult(await handler({
        action: 'add', path: 'daily-notes/2026-06-12.md', section: 'Log',
        content: 'entry B', skipWikilinks: true, shard: { enabled: true },
      }));
      expect(second.shardCreated).toBe(false);
      expect(second.shardPath).toBe('daily-notes/logs/2026-06-12-audit-001.md');
      const shardRaw = readFileSync(
        join(vaultPath, 'daily-notes/logs/2026-06-12-audit-001.md'), 'utf-8',
      );
      expect(shardRaw).toContain('entry A');
      expect(shardRaw).toContain('entry B');
    });
  });

  describe('action: remove', () => {
    it('removes the first matching line and reports the count', async () => {
      await createTestNote(
        vaultPath, 'notes/log.md',
        '# T\n\n## Log\n\n- keep me\n- drop me\n- drop me\n',
      );
      const result = parseResult(await handler({
        action: 'remove', path: 'notes/log.md', section: 'Log', pattern: 'drop me',
      }));
      expect(result.success).toBe(true);
      expect(result.message).toContain('Removed 1 line(s) from section "Log"');
      const file = await readTestNote(vaultPath, 'notes/log.md');
      expect(file.match(/drop me/g)?.length).toBe(1);
    });

    it('mode=all removes every match', async () => {
      await createTestNote(
        vaultPath, 'notes/log.md',
        '# T\n\n## Log\n\n- keep me\n- drop me\n- drop me\n',
      );
      const result = parseResult(await handler({
        action: 'remove', path: 'notes/log.md', section: 'Log',
        pattern: 'drop me', mode: 'all',
      }));
      expect(result.message).toContain('Removed 2 line(s)');
      const file = await readTestNote(vaultPath, 'notes/log.md');
      expect(file).not.toContain('drop me');
      expect(file).toContain('keep me');
    });

    it('errors when nothing matches', async () => {
      await createTestNote(vaultPath, 'notes/log.md', '# T\n\n## Log\n\n- a\n');
      const result = parseResult(await handler({
        action: 'remove', path: 'notes/log.md', section: 'Log', pattern: 'ghost',
      }));
      expect(result.success).toBe(false);
      expect(result.message).toContain('No content matching "ghost" found in section "Log"');
    });

    it('errors with exact guidance when pattern is missing', async () => {
      const result = parseResult(await handler({
        action: 'remove', path: 'notes/log.md', section: 'Log',
      }));
      expect(result.success).toBe(false);
      expect(result.message).toContain('action=remove requires pattern.');
    });
  });

  describe('action: replace', () => {
    it('replaces first match within the section only', async () => {
      await createTestNote(
        vaultPath, 'notes/status.md',
        '# T\n\n## Status\n\n- state: draft\n\n## Other\n\n- state: draft\n',
      );
      const result = parseResult(await handler({
        action: 'replace', path: 'notes/status.md', section: 'Status',
        search: 'draft', replacement: 'final', skipWikilinks: true,
      }));
      expect(result.success).toBe(true);
      expect(result.message).toContain('Replaced 1 occurrence(s) in section "Status"');
      const file = await readTestNote(vaultPath, 'notes/status.md');
      expect(file).toContain('state: final');
      // The other section is untouched
      expect(file.split('## Other')[1]).toContain('draft');
    });

    it('errors with diagnostic when search not found', async () => {
      await createTestNote(vaultPath, 'notes/status.md', '# T\n\n## Status\n\n- ok\n');
      const result = parseResult(await handler({
        action: 'replace', path: 'notes/status.md', section: 'Status',
        search: 'ghost', replacement: 'x', skipWikilinks: true,
      }));
      expect(result.success).toBe(false);
      expect(result.message).toContain('No content matching "ghost" found in section "Status"');
    });

    it('errors with exact guidance when search/replacement missing', async () => {
      const result = parseResult(await handler({
        action: 'replace', path: 'notes/x.md', section: 'S', search: 'a',
      }));
      expect(result.success).toBe(false);
      expect(result.message).toContain('action=replace requires search and replacement.');
    });
  });
});
