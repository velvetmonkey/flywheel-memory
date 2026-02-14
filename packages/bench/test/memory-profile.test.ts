/**
 * Memory Profile Tests
 *
 * Validates memory usage scales linearly with vault size
 * and detects memory leaks in long-running operations.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { generateQuickVault } from '../src/index.js';

// Skip these tests if not running with --expose-gc
const hasGC = typeof global.gc === 'function';

// Skip if SKIP_MEMORY_TESTS environment variable is set
const SKIP_MEMORY = process.env.SKIP_MEMORY_TESTS === 'true';

/**
 * Get current memory usage in MB
 */
function getMemoryMB(): number {
  if (hasGC) {
    global.gc!();
  }
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

/**
 * Force garbage collection if available
 */
function forceGC(): void {
  if (hasGC) {
    global.gc!();
  }
}

describe('Memory Usage Scaling', () => {
  const cleanupPaths: string[] = [];

  async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-test-'));
    cleanupPaths.push(dir);
    return dir;
  }

  afterAll(async () => {
    for (const p of cleanupPaths) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
  });

  it.skipIf(SKIP_MEMORY)('should show linear memory scaling for file content loading', async () => {
    const sizes = [100, 500, 1000];
    const memoryUsages: number[] = [];

    for (const size of sizes) {
      forceGC();
      const baseMemory = getMemoryMB();

      const dir = await createTempDir();
      await generateQuickVault(dir, size, size * 9999);

      // Load all files into memory
      const contents: string[] = [];

      async function loadFiles(d: string): Promise<void> {
        const entries = await fs.readdir(d, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(d, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await loadFiles(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            contents.push(await fs.readFile(fullPath, 'utf-8'));
          }
        }
      }

      await loadFiles(dir);

      const peakMemory = getMemoryMB();
      const memoryUsed = peakMemory - baseMemory;
      memoryUsages.push(memoryUsed);

      console.log(`${size} files: ${memoryUsed.toFixed(2)}MB used (${contents.length} files loaded)`);

      // Release references
      contents.length = 0;
    }

    // Memory should scale roughly linearly (within 3x ratio)
    // 10x files should not use 30x memory
    if (memoryUsages[0] > 0.1) { // Only test if baseline is meaningful
      const ratio = memoryUsages[2] / memoryUsages[0];
      const sizeRatio = sizes[2] / sizes[0];

      expect(ratio).toBeLessThan(sizeRatio * 3);
    }
  }, { timeout: 180000 });

  it.skipIf(SKIP_MEMORY)('should not leak memory during repeated file operations', async () => {
    const dir = await createTempDir();
    await generateQuickVault(dir, 100, 88888);

    forceGC();
    const baselineMemory = getMemoryMB();

    // Perform 10 iterations of file loading
    for (let iteration = 0; iteration < 10; iteration++) {
      const contents: string[] = [];

      async function loadFiles(d: string): Promise<void> {
        const entries = await fs.readdir(d, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(d, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await loadFiles(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            contents.push(await fs.readFile(fullPath, 'utf-8'));
          }
        }
      }

      await loadFiles(dir);

      // Process contents (simulate wikilink extraction)
      const wikilinkRegex = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
      for (const content of contents) {
        content.match(wikilinkRegex);
      }

      // Clear references
      contents.length = 0;
    }

    forceGC();
    const finalMemory = getMemoryMB();
    const memoryGrowth = finalMemory - baselineMemory;

    console.log(`Memory growth after 10 iterations: ${memoryGrowth.toFixed(2)}MB`);

    // Should not grow more than 50MB after 10 iterations
    expect(memoryGrowth).toBeLessThan(50);
  }, { timeout: 60000 });
});

describe('Memory Thresholds', () => {
  const cleanupPaths: string[] = [];

  async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-threshold-'));
    cleanupPaths.push(dir);
    return dir;
  }

  afterAll(async () => {
    for (const p of cleanupPaths) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
  });

  it.skipIf(SKIP_MEMORY)('should stay under 500MB for 5000 files in memory', async () => {
    forceGC();
    const baselineMemory = getMemoryMB();

    const dir = await createTempDir();
    await generateQuickVault(dir, 5000, 77777);

    const contents: string[] = [];

    async function loadFiles(d: string): Promise<void> {
      const entries = await fs.readdir(d, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await loadFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          contents.push(await fs.readFile(fullPath, 'utf-8'));
        }
      }
    }

    await loadFiles(dir);

    const peakMemory = getMemoryMB();
    const memoryUsed = peakMemory - baselineMemory;

    console.log(`5000 files loaded: ${memoryUsed.toFixed(2)}MB used`);
    console.log(`Total files loaded: ${contents.length}`);
    console.log(`Average per file: ${(memoryUsed / contents.length * 1024).toFixed(2)}KB`);

    expect(memoryUsed).toBeLessThan(500); // 500MB threshold
  }, { timeout: 180000 });

  it.skipIf(SKIP_MEMORY)('should process files without holding all in memory', async () => {
    const dir = await createTempDir();
    await generateQuickVault(dir, 1000, 66666);

    forceGC();
    const baselineMemory = getMemoryMB();

    // Stream-style processing (process one at a time)
    let processedCount = 0;
    let totalLinks = 0;
    const wikilinkRegex = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;

    async function processFiles(d: string): Promise<void> {
      const entries = await fs.readdir(d, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await processFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const content = await fs.readFile(fullPath, 'utf-8');
          const matches = content.match(wikilinkRegex) || [];
          totalLinks += matches.length;
          processedCount++;
          // Content goes out of scope here, eligible for GC
        }
      }
    }

    await processFiles(dir);

    forceGC();
    const finalMemory = getMemoryMB();
    const memoryUsed = finalMemory - baselineMemory;

    console.log(`Processed ${processedCount} files with ${totalLinks} links`);
    console.log(`Memory used: ${memoryUsed.toFixed(2)}MB`);

    // Stream processing should use much less memory than batch loading
    expect(memoryUsed).toBeLessThan(100); // Should stay under 100MB for streaming
  }, { timeout: 120000 });
});

describe('Index Building Memory', () => {
  const cleanupPaths: string[] = [];

  async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'index-memory-'));
    cleanupPaths.push(dir);
    return dir;
  }

  afterAll(async () => {
    for (const p of cleanupPaths) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
  });

  it.skipIf(SKIP_MEMORY)('should build entity index with linear memory usage', async () => {
    const dir = await createTempDir();
    await generateQuickVault(dir, 1000, 55555);

    forceGC();
    const baselineMemory = getMemoryMB();

    // Build an index of all entities and their backlinks
    interface EntityIndex {
      entities: Map<string, string>; // entity -> file path
      backlinks: Map<string, Set<string>>; // target -> source files
    }

    const index: EntityIndex = {
      entities: new Map(),
      backlinks: new Map(),
    };

    const wikilinkRegex = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;

    async function buildIndex(d: string, relativePath = ''): Promise<void> {
      const entries = await fs.readdir(d, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(d, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await buildIndex(fullPath, relPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const content = await fs.readFile(fullPath, 'utf-8');

          // Register entity
          const entityName = entry.name.replace('.md', '');
          index.entities.set(entityName.toLowerCase(), relPath);

          // Extract and register links
          let match;
          while ((match = wikilinkRegex.exec(content)) !== null) {
            const target = match[1].toLowerCase();
            if (!index.backlinks.has(target)) {
              index.backlinks.set(target, new Set());
            }
            index.backlinks.get(target)!.add(relPath);
          }
        }
      }
    }

    await buildIndex(dir);

    const peakMemory = getMemoryMB();
    const memoryUsed = peakMemory - baselineMemory;

    console.log(`Index built with ${index.entities.size} entities`);
    console.log(`Backlink map has ${index.backlinks.size} targets`);
    console.log(`Memory used: ${memoryUsed.toFixed(2)}MB`);

    // Should stay reasonable for 1000-file index
    expect(memoryUsed).toBeLessThan(200); // 200MB threshold
  }, { timeout: 120000 });
});
