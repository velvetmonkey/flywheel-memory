/**
 * MCP Initialize Freeze Test (arch-review S0)
 *
 * Pins the MCP initialize payload — server instructions, capabilities, and
 * visible tool list — for BOTH single-vault and multi-vault stdio boots,
 * against committed fixtures.
 *
 * Rationale (council finding, G2 §7 #3): the stdio server is constructed at
 * module load with vaultRegistry=null and pre-activation hasEmbeddingsIndex(),
 * so today's instructions deliberately lack the multi-vault section and may
 * include the init_semantic setup hint. S10 (index.ts dismantle) must preserve
 * that construction-equivalent timing; these snapshots are the oracle.
 *
 * serverInfo.version is excluded (release bumps are not surface changes).
 *
 * Regenerate: FW_UPDATE_SURFACE=1 npx vitest run test/catalog/initialize-freeze.test.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { spawnFlywheelStdio, type StdioServerConnection } from '../helpers/stdioHarness.js';

const FIXTURE_DIR = join(__dirname, '__fixtures__');

interface InitializeSnapshot {
  instructions: string | undefined;
  capabilities: Record<string, unknown> | undefined;
  serverName: string | undefined;
  tools: string[];
}

let connection: StdioServerConnection | null = null;
let tempRoot: string | null = null;

afterEach(async () => {
  if (connection) {
    await connection.close();
    connection = null;
  }
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

function makeVault(root: string, name: string): string {
  const vaultDir = join(root, name);
  mkdirSync(join(vaultDir, '.obsidian'), { recursive: true });
  writeFileSync(join(vaultDir, 'Inbox.md'), `# Inbox\n\n${name} snapshot fixture note.\n`);
  return vaultDir;
}

async function captureSnapshot(conn: StdioServerConnection): Promise<InitializeSnapshot> {
  const tools = await conn.client.listTools();
  return {
    instructions: conn.client.getInstructions(),
    capabilities: conn.client.getServerCapabilities() as Record<string, unknown> | undefined,
    serverName: conn.client.getServerVersion()?.name,
    tools: tools.tools.map((t) => t.name).sort(),
  };
}

function compareToFixture(snapshot: InitializeSnapshot, fixtureName: string): void {
  const fixturePath = join(FIXTURE_DIR, fixtureName);

  if (process.env.FW_UPDATE_SURFACE === '1') {
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, JSON.stringify(snapshot, null, 2) + '\n');
  }

  expect(
    existsSync(fixturePath),
    `${fixtureName} fixture missing — generate with FW_UPDATE_SURFACE=1`
  ).toBe(true);

  const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as InitializeSnapshot;
  expect(snapshot.tools).toEqual(fixture.tools);
  expect(snapshot.instructions).toEqual(fixture.instructions);
  expect(snapshot.capabilities).toEqual(fixture.capabilities);
  expect(snapshot.serverName).toEqual(fixture.serverName);
}

describe('MCP initialize freeze (arch-review S0)', () => {
  it('single-vault stdio initialize payload matches snapshot', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'fw-init-freeze-'));
    const vault = makeVault(tempRoot, 'solo');

    connection = await spawnFlywheelStdio({ PROJECT_PATH: vault });
    const snapshot = await captureSnapshot(connection);

    compareToFixture(snapshot, 'initialize.single.json');
  }, 60000);

  it('multi-vault stdio initialize payload matches snapshot', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'fw-init-freeze-mv-'));
    const vaultA = makeVault(tempRoot, 'alpha');
    const vaultB = makeVault(tempRoot, 'beta');

    connection = await spawnFlywheelStdio({
      FLYWHEEL_VAULTS: `alpha:${vaultA},beta:${vaultB}`,
    });
    const snapshot = await captureSnapshot(connection);

    compareToFixture(snapshot, 'initialize.multi.json');
  }, 60000);
});
