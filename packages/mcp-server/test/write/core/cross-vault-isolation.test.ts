/**
 * Cross-Vault Runtime Isolation Test (arch-review S0, council binding mod 3)
 *
 * Boots the REAL multi-vault server over stdio and asserts vault isolation
 * at the tool layer and on disk.
 *
 * ── DEFECT D4 — FIXED (arch-review G3 close-out, 2026-06-12) ──
 * Originally (found by this suite at S0): the stdio server was constructed and
 * gated at module load with vaultRegistry=null, before main() built the
 * registry. applyToolGating therefore saw isMultiVault=false — no `vault`
 * parameter was injected into any tool schema and no vault-activation wrapper
 * was installed, so over stdio in multi-vault mode `vault: "beta"` was silently
 * stripped and every call ran against the primary scope (writes to a named
 * secondary vault landed in the primary and reported success).
 *
 * The fix (this commit) builds the stdio server inside main(), AFTER the
 * registry's full membership is established (initializePrimaryVault +
 * registerSecondaryVaults), so multi-vault gating injects the `vault` param +
 * activation wrapper — mirroring the HTTP per-request path
 * (createConfiguredServer), which was always correct.
 *
 * The assertions below now PIN the FIXED contract: the `vault` param is present
 * in multi-vault stdio schemas, and `vault: "beta"` routes to beta. They guard
 * against a regression back into the silent-misroute behaviour.
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

  it('FIXED CONTRACT (D4): the stdio note schema exposes the vault parameter in multi-vault mode', async () => {
    const tools = await connection.client.listTools();
    const note = tools.tools.find((t) => t.name === 'note');
    expect(note).toBeDefined();
    const props = (note!.inputSchema as any)?.properties ?? {};
    // The `vault` param is injected by applyToolGating when the registry is
    // multi-vault. Pre-fix it was absent (gating ran with a null registry at
    // import time) — its presence is the routing fix made observable.
    expect(Object.keys(props)).toContain('vault');
  });

  it('FIXED CONTRACT (D4): create with vault:"beta" writes into beta only, never the primary', async () => {
    const createResult = await connection.client.callTool({
      name: 'note',
      arguments: {
        action: 'create',
        path: 'routing-probe.md',
        content: '# Routing Probe',
        vault: 'beta',
        skipWikilinks: true,
      },
    });
    const createText = resultText(createResult);
    expect(createResult.isError ?? false, `create errored: ${createText}`).toBe(false);
    expect(JSON.parse(createText).success, `create response: ${createText}`).toBe(true);

    // Fixed behaviour: the named vault receives the write, the primary does not.
    expect(existsSync(join(vaultB, 'routing-probe.md'))).toBe(true);
    expect(existsSync(join(vaultA, 'routing-probe.md'))).toBe(false);
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
