/**
 * Cross-Vault Runtime Isolation Test (arch-review S0, council binding mod 3)
 *
 * Boots the REAL multi-vault server over stdio and asserts vault isolation
 * at the tool layer and on disk.
 *
 * ── KNOWN DEFECT D4 (escalated to Ben, arch-review G3 S0, 2026-06-12) ──
 * The stdio server is constructed and gated at module load (index.ts:340-359)
 * with vaultRegistry=null — before main() builds the registry (index.ts:858).
 * applyToolGating therefore sees isMultiVault=false: no `vault` parameter is
 * injected into any tool schema, and no per-request vault activation wrapper
 * is installed. Over stdio in multi-vault mode:
 *   - `vault: "beta"` on any tool call is silently stripped by zod and the
 *     call runs against the fallback scope (normally the primary vault);
 *   - during a secondary vault's background boot, activateVault(ctx)
 *     (index.ts:1092) flips the fallback scope, so racing stdio writes can
 *     land in the mid-boot vault.
 * HTTP transport is unaffected: per-request servers are gated with the live
 * registry (createConfiguredServer, index.ts:272-292).
 *
 * Per council binding mod 1 (destructive-op safety valve), this is NOT fixed
 * in the arch-review: the tests below PIN today's behaviour (so refactor
 * slices can't change it silently in either direction) and `it.fails` pins
 * the desired contract — when the bug is fixed, that test flips and forces
 * promotion of the real assertions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnFlywheelStdio, type StdioServerConnection } from '../../helpers/stdioHarness.js';

let connection: StdioServerConnection;
let tempRoot: string;
let vaultA: string;
let vaultB: string;

function makeVault(root: string, name: string): string {
  const vaultDir = join(root, name);
  mkdirSync(join(vaultDir, '.obsidian'), { recursive: true });
  writeFileSync(join(vaultDir, 'Inbox.md'), `# Inbox\n\nVault ${name} seed note.\n`);
  return vaultDir;
}

function resultText(result: any): string {
  return (result?.content ?? [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
}

describe('Cross-vault runtime isolation over stdio (arch-review S0)', () => {
  beforeAll(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'fw-xvault-iso-'));
    vaultA = makeVault(tempRoot, 'alpha');
    vaultB = makeVault(tempRoot, 'beta');
    connection = await spawnFlywheelStdio({
      FLYWHEEL_VAULTS: `alpha:${vaultA},beta:${vaultB}`,
      FLYWHEEL_PRESET: 'full',
    });
    // Let the secondary vault's background boot finish so the fallback scope
    // is deterministically back on the primary (index.ts:1100).
    await new Promise((r) => setTimeout(r, 2000));
  }, 60000);

  afterAll(async () => {
    await connection?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('DEFECT PIN (D4): the stdio note schema exposes no vault parameter', async () => {
    const tools = await connection.client.listTools();
    const note = tools.tools.find((t) => t.name === 'note');
    expect(note).toBeDefined();
    const props = (note!.inputSchema as any)?.properties ?? {};
    // Desired contract: 'vault' IS present in multi-vault mode. Today it is
    // not (gating ran with a null registry at import time).
    expect(Object.keys(props)).not.toContain('vault');
  });

  it('DEFECT PIN (D4): create with vault:"beta" lands in the PRIMARY vault and reports success', async () => {
    const createResult = await connection.client.callTool({
      name: 'note',
      arguments: {
        action: 'create',
        path: 'misrouted-probe.md',
        content: '# Misrouted Probe',
        vault: 'beta',
        skipWikilinks: true,
      },
    });
    const createText = resultText(createResult);
    expect(createResult.isError ?? false, `create errored: ${createText}`).toBe(false);
    expect(JSON.parse(createText).success, `create response: ${createText}`).toBe(true);

    // Today's (wrong) behaviour: file written into alpha, beta untouched.
    expect(existsSync(join(vaultA, 'misrouted-probe.md'))).toBe(true);
    expect(existsSync(join(vaultB, 'misrouted-probe.md'))).toBe(false);
  });

  it.fails('DESIRED (flips when D4 is fixed): create with vault:"beta" writes into beta only', async () => {
    const createResult = await connection.client.callTool({
      name: 'note',
      arguments: {
        action: 'create',
        path: 'desired-routing-probe.md',
        content: '# Desired Routing Probe',
        vault: 'beta',
        skipWikilinks: true,
      },
    });
    expect(JSON.parse(resultText(createResult)).success).toBe(true);
    expect(existsSync(join(vaultB, 'desired-routing-probe.md'))).toBe(true);
    expect(existsSync(join(vaultA, 'desired-routing-probe.md'))).toBe(false);
  });

  it('writes against the active (primary) vault never leak into the secondary vault tree', async () => {
    const before = readdirSync(vaultB).sort();

    const createResult = await connection.client.callTool({
      name: 'note',
      arguments: {
        action: 'create',
        path: 'primary-only.md',
        content: '# Primary Only',
        skipWikilinks: true,
      },
    });
    const createText = resultText(createResult);
    expect(JSON.parse(createText).success, `create response: ${createText}`).toBe(true);

    expect(existsSync(join(vaultA, 'primary-only.md'))).toBe(true);
    expect(existsSync(join(vaultB, 'primary-only.md'))).toBe(false);
    // Secondary tree byte-identical in listing terms
    expect(readdirSync(vaultB).sort()).toEqual(before);
  });

  it('primary-vault note becomes readable after refresh_index, and stays invisible to beta state', async () => {
    const refresh = await connection.client.callTool({ name: 'refresh_index', arguments: {} });
    expect(refresh.isError ?? false).toBe(false);

    const read = await connection.client.callTool({
      name: 'read',
      arguments: { action: 'structure', path: 'primary-only.md' },
    });
    expect(resultText(read)).toContain('Primary Only');

    // The secondary vault's own state DB directory must not contain the note:
    // its .flywheel state lives under vaultB and indexes only vaultB files.
    expect(existsSync(join(vaultB, 'primary-only.md'))).toBe(false);
  });
});
