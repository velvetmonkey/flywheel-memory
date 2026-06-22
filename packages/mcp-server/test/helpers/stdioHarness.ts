/**
 * Stdio spawn harness (arch-review S0)
 *
 * Boots the REAL server entry (src/index.ts via tsx) over stdio with a
 * controlled environment, so tests exercise the production boot path —
 * including the import-time server construction — rather than hand-assembled
 * tool registries.
 *
 * The env passed to the child is explicit and minimal: no CLAUDECODE leak
 * (which would suppress the memory tool), embeddings auto-build disabled.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'child_process';
import { join } from 'path';

const PACKAGE_DIR = join(__dirname, '../..');

// tsx cannot load src/index.ts directly (type-only exports imported in value
// position trip per-file transforms), so spawn the esbuild bundle — the same
// artifact production runs. Rebuilt once per vitest process so the bundle
// always reflects the current src.
let distBuilt = false;
function ensureFreshDist(): void {
  if (distBuilt) return;
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: PACKAGE_DIR,
    stdio: 'pipe',
    timeout: 120000,
    // Node >=18.20/20.12/22 refuses to execFile a .cmd/.bat without a shell
    // (CVE-2024-27980), throwing EINVAL on Windows. The build command is static.
    shell: process.platform === 'win32',
  });
  distBuilt = true;
}

export interface StdioServerConnection {
  client: Client;
  transport: StdioClientTransport;
  stderr: string[];
  close(): Promise<void>;
}

export async function spawnFlywheelStdio(
  envOverrides: Record<string, string>,
): Promise<StdioServerConnection> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    // Never auto-build embeddings (model load/download) in tests
    FLYWHEEL_SKIP_EMBEDDINGS: 'true',
    ...envOverrides,
    // CLAUDECODE deliberately absent: full surface incl. memory tool
  };

  ensureFreshDist();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(PACKAGE_DIR, 'dist', 'index.js')],
    cwd: PACKAGE_DIR,
    env,
    stderr: 'pipe',
  });

  const stderr: string[] = [];
  transport.stderr?.on('data', (chunk: Buffer | string) => {
    stderr.push(chunk.toString());
  });

  const client = new Client(
    { name: 'arch-review-s0-harness', version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);

  return {
    client,
    transport,
    stderr,
    async close() {
      await client.close();
      await transport.close();
    },
  };
}
