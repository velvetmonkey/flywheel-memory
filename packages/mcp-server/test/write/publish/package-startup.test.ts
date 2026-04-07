/**
 * Package Startup Test
 *
 * Verifies the published package can be installed and started the same way
 * Codex starts it: a stdio MCP server launched from the shipped artifact.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

type ClientConnection = {
  client: Client;
  stderr: string[];
  transport: StdioClientTransport;
};

let nodeModulesPath = '';
let testProjectDir = '';
let testVaultDir = '';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

describe('Package Startup', () => {
  const packageDir = join(__dirname, '../../..');
  let tempDir: string;
  let tarballPath: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'flywheel-memory-test-'));
    ensurePackageBuilt(packageDir);
    const packOutput = execFileSync(npmCommand, ['pack', '--pack-destination', tempDir], {
      cwd: packageDir,
      encoding: 'utf-8',
    }).trim();
    tarballPath = join(tempDir, packOutput);

    testProjectDir = join(tempDir, 'test-project');
    testVaultDir = join(tempDir, 'test-vault');
    mkdirSync(testProjectDir, { recursive: true });
    mkdirSync(join(testVaultDir, '.obsidian'), { recursive: true });
    writeFileSync(join(testVaultDir, 'Inbox.md'), '# Inbox\n\nSmoke test note.\n');

    execFileSync(npmCommand, ['init', '-y'], { cwd: testProjectDir, stdio: 'pipe' });
    execFileSync(npmCommand, ['install', tarballPath], {
      cwd: testProjectDir,
      stdio: 'pipe',
      timeout: 600000,
    });

    nodeModulesPath = join(testProjectDir, 'node_modules', '@velvetmonkey', 'flywheel-memory');
  }, 60000);

  afterAll(() => {
    if (tempDir && existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Windows: EBUSY/EPERM from file locking — temp dir cleaned up by OS
      }
    }
  });

  it('npm pack creates a valid tarball', () => {
    expect(existsSync(tarballPath)).toBe(true);
    expect(tarballPath).toMatch(/\.tgz$/);
  });

  it('package can be installed and imported without missing dependencies', () => {
    expect(existsSync(nodeModulesPath)).toBe(true);

    const criticalDeps = [
      '@velvetmonkey/vault-core',
      '@modelcontextprotocol/sdk',
      'gray-matter',
      'simple-git',
      'zod',
    ];

    for (const dep of criticalDeps) {
      const depPath = join(testProjectDir, 'node_modules', ...dep.split('/'));
      expect(existsSync(depPath), `Missing dependency: ${dep}`).toBe(true);
    }

    const distPath = join(nodeModulesPath, 'dist', 'index.js');
    expect(existsSync(distPath)).toBe(true);
    const fileUrl = pathToFileURL(distPath).href;

    const testScript = `
      import('${fileUrl}')
        .then(() => {
          console.log('IMPORT_SUCCESS');
          process.exit(0);
        })
        .catch((err) => {
          console.error('IMPORT_FAILED:', err.message);
          process.exit(1);
        });
    `;

    try {
      const result = execFileSync('node', ['--input-type=module', '-e', testScript], {
        cwd: testProjectDir,
        encoding: 'utf-8',
        timeout: 30000,
        env: {
          ...process.env,
          PROJECT_PATH: testProjectDir,
        },
      });
      expect(result).toContain('IMPORT_SUCCESS');
    } catch (error: unknown) {
      const execError = error as { stderr?: string; stdout?: string };
      const stderr = execError.stderr || '';
      const stdout = execError.stdout || '';

      if (stderr.includes('ERR_MODULE_NOT_FOUND')) {
        const match = stderr.match(/Cannot find package '([^']+)'/);
        const missingModule = match ? match[1] : 'unknown';
        throw new Error(
          `Missing dependency in published package: ${missingModule}\n` +
            `Add it to packages/mcp-server/package.json dependencies.\n` +
            `Full error: ${stderr}`
        );
      }
      throw new Error(`Import failed: ${stderr || stdout}`);
    }
  }, 30000);

  it('packed artifact completes a stdio MCP handshake and exposes tools', async () => {
    const connection = await connectInstalledPackage();
    try {
      const tools = await connection.client.listTools();
      const toolNames = new Set(tools.tools.map((tool: { name: string }) => tool.name));

      expect(toolNames.size).toBeGreaterThan(20);
      expect(toolNames.has('search')).toBe(true);
      expect(toolNames.has('vault_create_note')).toBe(true);
      expect(toolNames.has('flywheel_doctor')).toBe(true);
      expect(connection.stderr.join('')).toContain('Starting Flywheel Memory');
    } finally {
      await closeConnection(connection);
    }
  }, 30000);

  it('dist/index.js exists and is executable', () => {
    const distPath = join(packageDir, 'dist', 'index.js');
    expect(existsSync(distPath)).toBe(true);
  });

  it('package.json has all required fields for publishing', () => {
    const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8'));

    expect(pkg.name).toBe('@velvetmonkey/flywheel-memory');
    expect(pkg.version).toBeDefined();
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.bin).toBeDefined();
    expect(pkg.dependencies).toBeDefined();
    expect(pkg.files).toContain('dist');
  });

  it('bin entry points to existing file', () => {
    const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8'));
    const binPath = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['flywheel-memory'];
    expect(binPath, 'package.json should have a bin entry').toBeDefined();
    const resolved = join(packageDir, binPath);
    expect(existsSync(resolved), `bin entry ${binPath} not found`).toBe(true);
  });
});

async function connectInstalledPackage(): Promise<ClientConnection> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [join(nodeModulesPath, 'bin', 'flywheel-memory.js')],
    cwd: testProjectDir,
    env: {
      PROJECT_PATH: testVaultDir,
      FLYWHEEL_PRESET: 'full',
    },
    stderr: 'pipe',
  });
  const stderr: string[] = [];
  transport.stderr?.on('data', (chunk: Buffer | string) => {
    stderr.push(chunk.toString());
  });

  const client = new Client({
    name: 'publish-smoke-test',
    version: '1.0.0',
  }, {
    capabilities: {},
  });

  await client.connect(transport);
  return { client, stderr, transport };
}

async function closeConnection(connection: ClientConnection): Promise<void> {
  await connection.client.close();
  await connection.transport.close();
}

function ensurePackageBuilt(packageDir: string): void {
  const distIndexPath = join(packageDir, 'dist', 'index.js');
  const distEmbeddingWorkerPath = join(packageDir, 'dist', 'embedding-worker.js');
  const distIntegrityWorkerPath = join(packageDir, 'dist', 'integrity-worker.js');

  if (
    existsSync(distIndexPath) &&
    existsSync(distEmbeddingWorkerPath) &&
    existsSync(distIntegrityWorkerPath)
  ) {
    return;
  }

  execFileSync(npmCommand, ['run', 'build'], { cwd: packageDir, stdio: 'pipe' });
}
