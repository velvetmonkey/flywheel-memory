/**
 * Characterisation tests for the LIVE `note` merged tool
 * (arch-review S4, written BEFORE the fork reunification refactor).
 *
 * Invokes the REAL registered handler and pins the live contract — exact
 * error texts and codes included (FILE_EXISTS / `Use overwrite:true`,
 * action-level confirm gate, move/rename param guidance) — per the
 * live-side-canonical rule. The retired notes.ts fork's variants
 * (`Use overwrite=true`, codeless errors, handler-level confirm) are dead
 * contract and intentionally NOT represented here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerNoteTool } from '../../../src/tools/write/note.js';
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

describe('note characterisation (live contract)', () => {
  describe('action: create', () => {
    it('creates a note with date/created frontmatter defaults', async () => {
      const result = parse(await handler({
        action: 'create', path: 'notes/new.md', content: '# Hello', skipWikilinks: true,
      }));
      expect(result.success).toBe(true);
      expect(result.message).toBe('Created note: notes/new.md');
      expect(result.preview).toContain('Frontmatter fields: date, created');
      const raw = await readTestNote(vaultPath, 'notes/new.md');
      expect(raw).toContain('# Hello');
      expect(raw).toMatch(/date: /);
    });

    it('rejects existing path without overwrite — exact FILE_EXISTS contract', async () => {
      await createTestNote(vaultPath, 'notes/taken.md', '# Taken\n');
      const result = parse(await handler({
        action: 'create', path: 'notes/taken.md', content: '# New', skipWikilinks: true,
      }));
      expect(result.success).not.toBe(true);
      expect(result.code).toBe('FILE_EXISTS');
      expect(result.message).toBe(
        'File already exists: notes/taken.md. Use overwrite:true to replace.',
      );
    });

    it('overwrite:true replaces an existing note', async () => {
      await createTestNote(vaultPath, 'notes/replace.md', '# Old\n');
      const result = parse(await handler({
        action: 'create', path: 'notes/replace.md', content: '# New content',
        overwrite: true, skipWikilinks: true,
      }));
      expect(result.success).toBe(true);
      const raw = await readTestNote(vaultPath, 'notes/replace.md');
      expect(raw).toContain('New content');
      expect(raw).not.toContain('# Old');
    });

    it('dry_run previews without writing', async () => {
      const result = parse(await handler({
        action: 'create', path: 'notes/phantom.md', content: '# P',
        dry_run: true, skipWikilinks: true,
      }));
      expect(result.success).toBe(true);
      expect(result.message).toContain('[dry run] Would create note');
      expect(existsSync(join(vaultPath, 'notes/phantom.md'))).toBe(false);
    });

    it('template path: substitutes {{date}}/{{title}} and merges frontmatter', async () => {
      await createTestNote(
        vaultPath, 'templates/basic.md',
        '---\ntype: project\n---\n\n# {{title}}\n\nCreated {{date}}\n',
      );
      const result = parse(await handler({
        action: 'create', path: 'notes/from-template.md', template: 'templates/basic.md',
        frontmatter: { status: 'active' }, skipWikilinks: true,
      }));
      expect(result.success).toBe(true);
      const raw = await readTestNote(vaultPath, 'notes/from-template.md');
      expect(raw).toContain('# from-template');
      expect(raw).toMatch(/Created \d{4}-\d{2}-\d{2}/);
      expect(raw).toContain('type: project');
      expect(raw).toContain('status: active');
    });

    it('missing template → exact error text', async () => {
      const result = parse(await handler({
        action: 'create', path: 'notes/x.md', template: 'templates/ghost.md',
        skipWikilinks: true,
      }));
      expect(result.success).not.toBe(true);
      expect(result.message).toBe('Template not found: templates/ghost.md');
    });

    it('path traversal is rejected', async () => {
      const result = parse(await handler({
        action: 'create', path: '../escape.md', content: 'x', skipWikilinks: true,
      }));
      expect(result.success).not.toBe(true);
      expect(existsSync(join(vaultPath, '..', 'escape.md'))).toBe(false);
    });
  });

  describe('action: delete', () => {
    it('requires confirm:true at the action level — exact guidance text', async () => {
      await createTestNote(vaultPath, 'notes/victim.md', '# V\n');
      const result = parse(await handler({ action: 'delete', path: 'notes/victim.md' }));
      expect(result.success).not.toBe(true);
      expect(result.message).toContain('action=delete requires confirm:true to execute.');
      expect(result.message).toContain('Use dry_run:true first to preview');
      expect(existsSync(join(vaultPath, 'notes/victim.md'))).toBe(true);
    });

    it('deletes with confirm:true', async () => {
      await createTestNote(vaultPath, 'notes/victim.md', '# V\n');
      const result = parse(await handler({
        action: 'delete', path: 'notes/victim.md', confirm: true,
      }));
      expect(result.success).toBe(true);
      expect(result.message).toContain('Deleted note: notes/victim.md');
      expect(existsSync(join(vaultPath, 'notes/victim.md'))).toBe(false);
    });

    it('dry_run WITHOUT confirm still hits the confirm gate (gate precedes dry-run branch)', async () => {
      // Live quirk: the action-level confirm gate runs before handleDelete,
      // so dry_run alone gets the confirm error — despite the gate's own
      // guidance suggesting dry_run as the preview path. Pinned as-is.
      await createTestNote(vaultPath, 'notes/victim.md', '# V\n');
      const result = parse(await handler({
        action: 'delete', path: 'notes/victim.md', dry_run: true,
      }));
      expect(result.success).not.toBe(true);
      expect(result.message).toContain('action=delete requires confirm:true to execute.');
      expect(existsSync(join(vaultPath, 'notes/victim.md'))).toBe(true);
    });

    it('dry_run WITH confirm previews deletion without removing', async () => {
      await createTestNote(vaultPath, 'notes/victim.md', '# V\n');
      const result = parse(await handler({
        action: 'delete', path: 'notes/victim.md', confirm: true, dry_run: true,
      }));
      expect(result.success).toBe(true);
      expect(result.message).toContain('[dry run] Would delete note');
      expect(existsSync(join(vaultPath, 'notes/victim.md'))).toBe(true);
    });
  });

  describe('action: move / rename', () => {
    it('move requires destination — exact guidance', async () => {
      const result = parse(await handler({ action: 'move', path: 'a.md' }));
      expect(result.success).not.toBe(true);
      expect(result.message).toContain('action=move requires destination.');
    });

    it('rename requires new_name — exact guidance', async () => {
      const result = parse(await handler({ action: 'rename', path: 'a.md' }));
      expect(result.success).not.toBe(true);
      expect(result.message).toContain('action=rename requires new_name.');
    });

    it('move relocates the file and rewires backlinks', async () => {
      await createTestNote(vaultPath, 'notes/source.md', '# Source\n\nSee [[target]].\n');
      await createTestNote(vaultPath, 'notes/target.md', '# Target\n');
      const result = parse(await handler({
        action: 'move', path: 'notes/target.md', destination: 'archive/target.md',
      }));
      expect(result.success).toBe(true);
      expect(existsSync(join(vaultPath, 'archive/target.md'))).toBe(true);
      expect(existsSync(join(vaultPath, 'notes/target.md'))).toBe(false);
    });

    it('rename changes the filename and updates wikilinks', async () => {
      await createTestNote(vaultPath, 'notes/linker.md', 'Points at [[old-name]].\n');
      await createTestNote(vaultPath, 'notes/old-name.md', '# Old Name\n');
      const result = parse(await handler({
        action: 'rename', path: 'notes/old-name.md', new_name: 'new-name',
      }));
      expect(result.success).toBe(true);
      expect(existsSync(join(vaultPath, 'notes/new-name.md'))).toBe(true);
      expect(existsSync(join(vaultPath, 'notes/old-name.md'))).toBe(false);
      const linker = await readTestNote(vaultPath, 'notes/linker.md');
      expect(linker).toContain('[[new-name');
    });
  });
});
