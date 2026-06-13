/**
 * Characterisation tests for entity(action: merge) and the alias-absorption
 * path of entity(action: alias) (arch-review S5, written BEFORE the fork
 * reunification refactor).
 *
 * Pins the LIVE contract exactly, including the quirks the council flagged
 * (G2 §7, codex findings #8–#11):
 *  - response carries path: PRIMARY; messages say 'Secondary/Primary file
 *    not found' (not the retired fork's 'Source/Target');
 *  - path-validation labels still say 'Invalid source/target path' for
 *    primary/secondary — old fork wording, but part of the live contract;
 *  - merge HONOURS dry_run as of D2 (2026-06-13): full plan, zero writes
 *    (originally pinned as ignored; deliberately changed with schema update);
 *  - no WriteConflictError catch in the merge branch (retired fork had one).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerEntityTool } from '../../../src/tools/write/entity.js';
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
  handler = captureHandler((s) =>
    registerEntityTool(s, () => vaultPath, () => null, undefined),
  );
});

afterEach(async () => {
  await cleanupTempVault(vaultPath);
});

describe('entity(action: merge) characterisation (live contract)', () => {
  it('merges secondary into primary: aliases, merged-from section, backlinks, deletion', async () => {
    await createTestNote(
      vaultPath, 'people/robert.md',
      '---\naliases: ["Bob"]\n---\n\n# robert\n\nLong-time collaborator on several projects.\n',
    );
    await createTestNote(
      vaultPath, 'people/bobby.md',
      '---\naliases: ["Bobster"]\n---\n\n# bobby\n\nSame person, duplicate note with details worth keeping.\n',
    );
    await createTestNote(vaultPath, 'notes/mention.md', 'Talked to [[bobby]] today.\n');

    const result = parse(await handler({
      action: 'merge', primary: 'people/robert.md', secondary: 'people/bobby.md',
    }));

    expect(result.success).toBe(true);
    expect(result.message).toBe('Merged "bobby" into "robert"');
    expect(result.path).toBe('people/robert.md');
    expect(result.backlinks_updated).toBeGreaterThanOrEqual(1);
    expect(result.preview).toContain('Merged: "bobby" → "robert"');
    expect(result.preview).toContain('Source content appended: yes');

    const primary = await readTestNote(vaultPath, 'people/robert.md');
    expect(primary).toContain('## Merged from bobby');
    expect(primary).toContain('duplicate note with details');
    expect(primary).toContain('bobby');
    expect(primary).toContain('Bobster');
    expect(primary).toContain('Bob');

    expect(existsSync(join(vaultPath, 'people/bobby.md'))).toBe(false);

    const mention = await readTestNote(vaultPath, 'notes/mention.md');
    expect(mention).not.toMatch(/\[\[bobby\]\]/);
    expect(mention).toContain('robert');
  });

  it('trivial secondary content (≤10 chars) is not appended', async () => {
    await createTestNote(vaultPath, 'a/keep.md', '# keep\n\nReal content here.\n');
    await createTestNote(vaultPath, 'a/stub.md', 'x\n');
    const result = parse(await handler({
      action: 'merge', primary: 'a/keep.md', secondary: 'a/stub.md',
    }));
    expect(result.success).toBe(true);
    expect(result.preview).toContain('Source content appended: no');
    const primary = await readTestNote(vaultPath, 'a/keep.md');
    expect(primary).not.toContain('## Merged from');
  });

  it('missing primary/secondary params → isError contract', async () => {
    const noPrimary = await handler({ action: 'merge', secondary: 'a/b.md' });
    expect(noPrimary.isError).toBe(true);
    expect(parse(noPrimary).error).toBe('primary is required for action: merge');

    const noSecondary = await handler({ action: 'merge', primary: 'a/b.md' });
    expect(noSecondary.isError).toBe(true);
    expect(parse(noSecondary).error).toBe('secondary is required for action: merge');
  });

  it('nonexistent files → exact Secondary/Primary not-found messages and paths', async () => {
    await createTestNote(vaultPath, 'a/exists.md', '# exists\n');

    const noSecondary = parse(await handler({
      action: 'merge', primary: 'a/exists.md', secondary: 'a/ghost.md',
    }));
    expect(noSecondary.success).toBe(false);
    expect(noSecondary.message).toBe('Secondary file not found: a/ghost.md');
    expect(noSecondary.path).toBe('a/ghost.md');

    const noPrimary = parse(await handler({
      action: 'merge', primary: 'a/ghost.md', secondary: 'a/exists.md',
    }));
    expect(noPrimary.success).toBe(false);
    expect(noPrimary.message).toBe('Primary file not found: a/ghost.md');
    expect(noPrimary.path).toBe('a/ghost.md');
  });

  it('path validation keeps the legacy source/target labels (live quirk)', async () => {
    const badPrimary = parse(await handler({
      action: 'merge', primary: '../escape.md', secondary: 'a/b.md',
    }));
    expect(badPrimary.success).toBe(false);
    expect(badPrimary.message).toContain('Invalid source path');

    await createTestNote(vaultPath, 'a/ok.md', '# ok\n');
    const badSecondary = parse(await handler({
      action: 'merge', primary: 'a/ok.md', secondary: '../escape.md',
    }));
    expect(badSecondary.success).toBe(false);
    expect(badSecondary.message).toContain('Invalid target path');
  });

  it('merge HONOURS dry_run — full plan returned, zero disk writes (D2 fixed 2026-06-13)', async () => {
    await createTestNote(
      vaultPath, 'a/keep.md',
      '---\naliases: []\n---\n\n# keep\n\nReal content.\n',
    );
    await createTestNote(
      vaultPath, 'a/gone.md',
      '---\naliases: ["Goner"]\n---\n\n# gone\n\nSubstantial content worth keeping around.\n',
    );
    await createTestNote(vaultPath, 'a/mention.md', 'See [[gone]] for details.\n');
    const keepBefore = await readTestNote(vaultPath, 'a/keep.md');
    const mentionBefore = await readTestNote(vaultPath, 'a/mention.md');

    const result = parse(await handler({
      action: 'merge', primary: 'a/keep.md', secondary: 'a/gone.md', dry_run: true,
    }));

    // Plan returned: message, planned aliases, planned section, planned rewires
    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.message).toBe('[dry run] Would merge "gone" into "keep"');
    expect(result.path).toBe('a/keep.md');
    expect(result.preview).toContain('Would merge: "gone" → "keep"');
    expect(result.preview).toContain('Aliases to add: gone, Goner');
    expect(result.preview).toContain('Source content to append: yes');
    expect(result.preview).toContain('Files to modify: a/mention.md');
    expect(result.preview).toContain('Secondary to delete: a/gone.md');
    expect(result.backlinks_updated).toBeGreaterThanOrEqual(1);

    // ZERO disk writes: secondary intact, primary byte-identical, backlink file untouched
    expect(existsSync(join(vaultPath, 'a/gone.md'))).toBe(true);
    expect(await readTestNote(vaultPath, 'a/keep.md')).toBe(keepBefore);
    expect(await readTestNote(vaultPath, 'a/mention.md')).toBe(mentionBefore);
  });

  it('merge without dry_run still executes for real after the D2 change', async () => {
    await createTestNote(vaultPath, 'b/keep.md', '# keep\n\nContent.\n');
    await createTestNote(vaultPath, 'b/gone.md', '# gone\n\nSubstantial enough content.\n');
    const result = parse(await handler({
      action: 'merge', primary: 'b/keep.md', secondary: 'b/gone.md',
    }));
    expect(result.success).toBe(true);
    expect(result.dryRun).toBeUndefined();
    expect(existsSync(join(vaultPath, 'b/gone.md'))).toBe(false);
    expect(await readTestNote(vaultPath, 'b/keep.md')).toContain('## Merged from gone');
  });
});

describe('entity(action: alias) absorption characterisation (live contract)', () => {
  it('dry_run previews absorption without writing', async () => {
    await createTestNote(vaultPath, 'tech/kubernetes.md', '---\naliases: []\n---\n\n# kubernetes\n');
    await createTestNote(vaultPath, 'notes/infra.md', 'We deploy on [[k8s]].\n');
    await createTestNote(vaultPath, 'tech/k8s.md', '# k8s\n\nStub note.\n');

    const result = parse(await handler({
      action: 'alias', source_name: 'k8s', target_path: 'tech/kubernetes.md', dry_run: true,
    }));
    expect(result.success).toBe(true);
    expect(result.message).toBe('[dry run] Would absorb "k8s" as alias of "kubernetes"');
    expect(result.dryRun).toBe(true);
    // nothing changed on disk
    expect(existsSync(join(vaultPath, 'tech/k8s.md'))).toBe(true);
    expect(await readTestNote(vaultPath, 'notes/infra.md')).toContain('[[k8s]]');
  });

  it('absorbs: alias added, backlinks rewritten with display preservation, source deleted', async () => {
    await createTestNote(vaultPath, 'tech/kubernetes.md', '---\naliases: []\n---\n\n# kubernetes\n');
    await createTestNote(vaultPath, 'notes/infra.md', 'We deploy on [[k8s]] and [[k8s|the cluster]].\n');
    await createTestNote(vaultPath, 'tech/k8s.md', '# k8s\n\nStub note.\n');

    const result = parse(await handler({
      action: 'alias', source_name: 'k8s', target_path: 'tech/kubernetes.md',
    }));
    expect(result.success).toBe(true);
    expect(result.message).toBe('Absorbed "k8s" as alias of "kubernetes"');
    expect(result.path).toBe('tech/kubernetes.md');
    expect(result.backlinks_updated).toBe(2);

    const target = await readTestNote(vaultPath, 'tech/kubernetes.md');
    expect(target).toContain('k8s');

    const infra = await readTestNote(vaultPath, 'notes/infra.md');
    expect(infra).toContain('[[kubernetes|k8s]]');
    expect(infra).toContain('[[kubernetes|the cluster]]');

    expect(existsSync(join(vaultPath, 'tech/k8s.md'))).toBe(false);
  });

  it('requires both source_name and target_path', async () => {
    const result = await handler({ action: 'alias', source_name: 'only-one' });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toBe('source_name and target_path are both required for alias absorption');
  });

  it('nonexistent target → exact Target file not found message', async () => {
    const result = parse(await handler({
      action: 'alias', source_name: 'x', target_path: 'ghost/none.md',
    }));
    expect(result.success).toBe(false);
    expect(result.message).toBe('Target file not found: ghost/none.md');
  });
});
