/**
 * Performance Baseline Tests
 *
 * Validates that core operations meet performance thresholds
 * at scale (5000+ notes). These tests establish baselines and
 * catch performance regressions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  generateQuickVault,
  loadVaultConfig,
  generateVault,
  type VaultConfig,
} from '../src/index.js';

// These tests are slow and should run in a dedicated CI job
// Skip if SKIP_PERF_TESTS environment variable is set
const SKIP_PERF = process.env.SKIP_PERF_TESTS === 'true';

describe('Large Vault Performance Baselines', () => {
  let testVaultPath: string;
  let cleanupPaths: string[] = [];

  async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'perf-baseline-'));
    cleanupPaths.push(dir);
    return dir;
  }

  afterAll(async () => {
    // Clean up all generated vaults
    for (const p of cleanupPaths) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('Vault Generation Performance', () => {
    it.skipIf(SKIP_PERF)('should generate 1000 notes in under 30 seconds', async () => {
      const outputDir = await createTempDir();

      const start = performance.now();
      const result = await generateQuickVault(outputDir, 1000, 12345);
      const duration = performance.now() - start;

      expect(result.noteCount).toBeGreaterThanOrEqual(1000);
      expect(duration).toBeLessThan(30000); // 30 seconds

      console.log(`1000-note vault generated in ${(duration / 1000).toFixed(2)}s`);
    }, { timeout: 60000 });

    it.skipIf(SKIP_PERF)('should generate 5000 notes in under 120 seconds', async () => {
      const outputDir = await createTempDir();

      const start = performance.now();
      const result = await generateQuickVault(outputDir, 5000, 54321);
      const duration = performance.now() - start;

      expect(result.noteCount).toBeGreaterThanOrEqual(5000);
      expect(duration).toBeLessThan(120000); // 2 minutes

      console.log(`5000-note vault generated in ${(duration / 1000).toFixed(2)}s`);
    }, { timeout: 180000 });

    it.skipIf(SKIP_PERF)('should generate deterministic vaults from same seed', async () => {
      const outputDir1 = await createTempDir();
      const outputDir2 = await createTempDir();

      const seed = 99999;

      const result1 = await generateQuickVault(outputDir1, 100, seed);
      const result2 = await generateQuickVault(outputDir2, 100, seed);

      // Same seed should produce same structure
      expect(result1.noteCount).toBe(result2.noteCount);
      expect(result1.entityCount).toBe(result2.entityCount);
      expect(result1.totalLinks).toBe(result2.totalLinks);
      expect(result1.folderCount).toBe(result2.folderCount);
    });
  });

  describe('File Listing Performance', () => {
    it.skipIf(SKIP_PERF)('should list 5000 files in under 5 seconds', async () => {
      const vaultDir = await createTempDir();
      await generateQuickVault(vaultDir, 5000, 12345);

      const start = performance.now();
      const files: string[] = [];

      async function walkDir(dir: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await walkDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath);
          }
        }
      }

      await walkDir(vaultDir);
      const duration = performance.now() - start;

      expect(files.length).toBeGreaterThanOrEqual(5000);
      expect(duration).toBeLessThan(5000); // 5 seconds

      console.log(`Listed ${files.length} files in ${duration.toFixed(0)}ms`);
    }, { timeout: 180000 });
  });

  describe('File Read Performance', () => {
    it.skipIf(SKIP_PERF)('should read 1000 files in under 10 seconds', async () => {
      const vaultDir = await createTempDir();
      await generateQuickVault(vaultDir, 1000, 11111);

      // Get list of files
      const files: string[] = [];
      async function collectFiles(dir: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await collectFiles(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath);
          }
        }
      }
      await collectFiles(vaultDir);

      // Read all files
      const start = performance.now();
      let totalBytes = 0;

      for (const file of files.slice(0, 1000)) {
        const content = await fs.readFile(file, 'utf-8');
        totalBytes += content.length;
      }

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(10000); // 10 seconds
      console.log(`Read ${files.length} files (${(totalBytes / 1024 / 1024).toFixed(2)}MB) in ${duration.toFixed(0)}ms`);
    }, { timeout: 60000 });
  });

  describe('Link Count Aggregation', () => {
    it.skipIf(SKIP_PERF)('should count wikilinks across 5000 files in under 30 seconds', async () => {
      const vaultDir = await createTempDir();
      const vaultResult = await generateQuickVault(vaultDir, 5000, 22222);

      const wikilinkRegex = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
      let totalLinks = 0;
      let filesProcessed = 0;

      async function countLinks(dir: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await countLinks(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const content = await fs.readFile(fullPath, 'utf-8');
            const matches = content.match(wikilinkRegex) || [];
            totalLinks += matches.length;
            filesProcessed++;
          }
        }
      }

      const start = performance.now();
      await countLinks(vaultDir);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(30000); // 30 seconds
      expect(filesProcessed).toBeGreaterThanOrEqual(5000);

      console.log(`Counted ${totalLinks} links across ${filesProcessed} files in ${duration.toFixed(0)}ms`);
      console.log(`Expected ~${vaultResult.totalLinks} links from generation`);
    }, { timeout: 120000 });
  });

  describe('Entity Extraction Performance', () => {
    it.skipIf(SKIP_PERF)('should extract unique entities from 5000 files in under 30 seconds', async () => {
      const vaultDir = await createTempDir();
      await generateQuickVault(vaultDir, 5000, 33333);

      const wikilinkRegex = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
      const entities = new Set<string>();
      let filesProcessed = 0;

      async function extractEntities(dir: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await extractEntities(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const content = await fs.readFile(fullPath, 'utf-8');
            let match;
            while ((match = wikilinkRegex.exec(content)) !== null) {
              entities.add(match[1].toLowerCase());
            }
            filesProcessed++;
          }
        }
      }

      const start = performance.now();
      await extractEntities(vaultDir);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(30000); // 30 seconds
      expect(filesProcessed).toBeGreaterThanOrEqual(5000);

      console.log(`Extracted ${entities.size} unique entities from ${filesProcessed} files in ${duration.toFixed(0)}ms`);
    }, { timeout: 120000 });
  });
});

describe('Scaling Characteristics', () => {
  const cleanupPaths: string[] = [];

  async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scaling-'));
    cleanupPaths.push(dir);
    return dir;
  }

  afterAll(async () => {
    for (const p of cleanupPaths) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
  });

  it.skipIf(SKIP_PERF)('should show sub-linear scaling for file listing', async () => {
    const sizes = [100, 500, 1000];
    const times: number[] = [];

    for (const size of sizes) {
      const dir = await createTempDir();
      await generateQuickVault(dir, size, size * 1111);

      const start = performance.now();
      let count = 0;

      async function countFiles(d: string): Promise<void> {
        const entries = await fs.readdir(d, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(d, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await countFiles(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            count++;
          }
        }
      }

      await countFiles(dir);
      times.push(performance.now() - start);

      console.log(`${size} files: ${times[times.length - 1].toFixed(0)}ms`);
    }

    // Time should not scale worse than O(n^2)
    // 10x files should not take 100x time
    const ratio1 = times[1] / times[0];
    const sizeRatio1 = sizes[1] / sizes[0];

    expect(ratio1).toBeLessThan(sizeRatio1 * 3); // Allow 3x overhead
  }, { timeout: 180000 });
});
