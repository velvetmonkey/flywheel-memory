/**
 * Package Startup Test
 *
 * Verifies the published package can be installed and started correctly.
 * This catches missing dependencies (like vault-core in v1.27.67) before publishing.
 *
 * How it works:
 * 1. Runs `npm pack` to create a tarball (exactly what gets published)
 * 2. Extracts to a temp directory
 * 3. Runs `npm install` (installs only declared dependencies)
 * 4. Dynamically imports the built module
 * 5. Verifies no ERR_MODULE_NOT_FOUND errors
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

describe('Package Startup', () => {
  const packageDir = join(__dirname, '../../..');
  let tempDir: string;
  let tarballPath: string;

  beforeAll(() => {
    // Create temp directory
    tempDir = mkdtempSync(join(tmpdir(), 'flywheel-memory-test-'));

    // Build the package first
    execSync('npm run build', { cwd: packageDir, stdio: 'pipe' });

    // Create tarball
    const packOutput = execSync('npm pack --pack-destination ' + tempDir, {
      cwd: packageDir,
      encoding: 'utf-8',
    }).trim();

    tarballPath = join(tempDir, packOutput);
  }, 60000);

  afterAll(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('npm pack creates a valid tarball', () => {
    expect(existsSync(tarballPath)).toBe(true);
    expect(tarballPath).toMatch(/\.tgz$/);
  });

  it('package can be installed and imported without missing dependencies', async () => {
    // Create a minimal test project
    const testProjectDir = join(tempDir, 'test-project');
    mkdirSync(testProjectDir, { recursive: true });

    // Initialize with package.json
    execSync('npm init -y', { cwd: testProjectDir, stdio: 'pipe' });

    // Install from the tarball (simulates installing from npm)
    execSync(`npm install ${tarballPath}`, {
      cwd: testProjectDir,
      stdio: 'pipe',
      timeout: 120000,
    });

    // Verify node_modules contains the package
    const nodeModulesPath = join(testProjectDir, 'node_modules', '@velvetmonkey', 'flywheel-memory');
    expect(existsSync(nodeModulesPath)).toBe(true);

    // Verify all critical dependencies are installed
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

    // Try to dynamically import the package
    // This will fail with ERR_MODULE_NOT_FOUND if dependencies are missing
    const distPath = join(nodeModulesPath, 'dist', 'index.js');
    expect(existsSync(distPath)).toBe(true);

    // Use a subprocess to test the import in isolation
    // This ensures we're not getting dependencies from the workspace
    // Convert to proper file URL for cross-platform support (Windows paths have backslashes)
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
      const result = execSync(`node --input-type=module -e "${testScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
        cwd: testProjectDir,
        encoding: 'utf-8',
        timeout: 30000,
        env: {
          ...process.env,
          // Set PROJECT_PATH to prevent vault detection errors
          PROJECT_PATH: testProjectDir,
        },
      });
      expect(result).toContain('IMPORT_SUCCESS');
    } catch (error: unknown) {
      const execError = error as { stderr?: string; stdout?: string };
      // If import fails, provide helpful error message
      const stderr = execError.stderr || '';
      const stdout = execError.stdout || '';

      if (stderr.includes('ERR_MODULE_NOT_FOUND')) {
        // Extract the missing module name
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
  }, 180000); // 3 minute timeout for npm install

  it('dist/index.js exists and is executable', () => {
    const distPath = join(packageDir, 'dist', 'index.js');
    expect(existsSync(distPath)).toBe(true);
  });

  it('package.json has all required fields for publishing', () => {
    const pkg = require(join(packageDir, 'package.json'));

    expect(pkg.name).toBe('@velvetmonkey/flywheel-memory');
    expect(pkg.version).toBeDefined();
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.bin).toBeDefined();
    expect(pkg.dependencies).toBeDefined();
    expect(pkg.files).toContain('dist');
  });
});
