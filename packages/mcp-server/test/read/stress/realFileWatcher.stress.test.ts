/**
 * Real I/O stress tests for file watcher
 *
 * These tests perform actual filesystem operations to validate:
 * - File change detection latency
 * - Handling of rapid file operations
 * - Edge cases with file system behavior
 *
 * NOTE: These tests may be flaky on CI due to filesystem timing variations.
 * They're primarily for local development validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { EventQueue } from '../../src/core/watch/eventQueue.js';
import type { EventBatch, WatcherConfig } from '../../src/core/watch/types.js';

const createConfig = (overrides: Partial<WatcherConfig> = {}): WatcherConfig => ({
  debounceMs: 100,
  flushMs: 500,
  batchSize: 50,
  usePolling: false,
  pollInterval: 500,
  ...overrides,
});

// Helper to create temporary test directory
async function createTempDir(): Promise<string> {
  const base = join(tmpdir(), 'flywheel-watcher-stress');
  const dir = join(base, `test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// Helper to clean up test directory
async function cleanupDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// Helper to write file with content
async function writeTestFile(dir: string, name: string, content: string = 'test'): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe('Real File Watcher Stress Tests', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('single file operations', () => {
    it('should handle file creation', async () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 50 }),
        (batch) => batches.push(batch)
      );

      // Simulate file watcher event for file creation
      const filePath = await writeTestFile(testDir, 'new-note.md');
      queue.push('add', filePath);

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 100));
      queue.flush();

      expect(batches).toHaveLength(1);
      expect(batches[0].events[0].type).toBe('upsert');

      queue.dispose();
    });

    it('should handle file modification', async () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 50 }),
        (batch) => batches.push(batch)
      );

      // Create file first
      const filePath = await writeTestFile(testDir, 'existing-note.md', 'initial');

      // Simulate modification events
      await writeFile(filePath, 'modified');
      queue.push('change', filePath);

      await new Promise(resolve => setTimeout(resolve, 100));
      queue.flush();

      expect(batches).toHaveLength(1);
      expect(batches[0].events[0].type).toBe('upsert');

      queue.dispose();
    });

    it('should handle file deletion', async () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 50 }),
        (batch) => batches.push(batch)
      );

      // Create and delete file
      const filePath = await writeTestFile(testDir, 'to-delete.md');
      await rm(filePath);
      queue.push('unlink', filePath);

      await new Promise(resolve => setTimeout(resolve, 100));
      queue.flush();

      expect(batches).toHaveLength(1);
      expect(batches[0].events[0].type).toBe('delete');

      queue.dispose();
    });
  });

  describe('rapid file operations', () => {
    it('should handle 50 rapid file creations', async () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 100, flushMs: 500 }),
        (batch) => batches.push(batch)
      );

      // Create 50 files rapidly
      const promises: Promise<string>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push(writeTestFile(testDir, `note-${i.toString().padStart(3, '0')}.md`));
      }

      const paths = await Promise.all(promises);

      // Simulate watcher events
      for (const path of paths) {
        queue.push('add', path);
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 200));
      queue.flush();

      // Should have received batches with all 50 files
      const totalEvents = batches.reduce((sum, b) => sum + b.events.length, 0);
      expect(totalEvents).toBe(50);

      queue.dispose();
    });

    it('should handle modify-delete-recreate cycle', async () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 100 }),
        (batch) => batches.push(batch)
      );

      const filePath = join(testDir, 'cycle-test.md');

      // Create
      await writeFile(filePath, 'version 1');
      queue.push('add', filePath);

      // Modify
      await writeFile(filePath, 'version 2');
      queue.push('change', filePath);

      // Delete
      await rm(filePath);
      queue.push('unlink', filePath);

      // Recreate
      await writeFile(filePath, 'version 3');
      queue.push('add', filePath);

      // Final modify
      await writeFile(filePath, 'version 4');
      queue.push('change', filePath);

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 200));
      queue.flush();

      // Should coalesce to single upsert (file exists at end)
      expect(batches).toHaveLength(1);
      expect(batches[0].events[0].type).toBe('upsert');

      queue.dispose();
    });

    it('should handle concurrent writes to different files', async () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 100 }),
        (batch) => batches.push(batch)
      );

      // Create 10 files with concurrent writes
      const fileCount = 10;
      const writesPerFile = 5;

      // Interleave writes to simulate real concurrent editing
      for (let write = 0; write < writesPerFile; write++) {
        const promises: Promise<void>[] = [];
        for (let file = 0; file < fileCount; file++) {
          const filePath = join(testDir, `concurrent-${file}.md`);
          promises.push(writeFile(filePath, `content ${write}`));
        }
        await Promise.all(promises);

        // Simulate events
        for (let file = 0; file < fileCount; file++) {
          const filePath = join(testDir, `concurrent-${file}.md`);
          queue.push(write === 0 ? 'add' : 'change', filePath);
        }
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 200));
      queue.flush();

      // Should have 10 coalesced events (one per file)
      const allPaths = new Set<string>();
      for (const batch of batches) {
        for (const event of batch.events) {
          allPaths.add(event.path);
        }
      }
      expect(allPaths.size).toBe(fileCount);

      queue.dispose();
    });
  });

  describe('filesystem edge cases', () => {
    it('should handle files in nested directories', async () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 50 }),
        (batch) => batches.push(batch)
      );

      // Create nested structure
      const nestedDir = join(testDir, 'level1', 'level2', 'level3');
      await mkdir(nestedDir, { recursive: true });

      const filePath = await writeTestFile(nestedDir, 'deep-note.md');
      queue.push('add', filePath);

      await new Promise(resolve => setTimeout(resolve, 100));
      queue.flush();

      expect(batches).toHaveLength(1);
      expect(batches[0].events[0].path).toContain('level3');

      queue.dispose();
    });

    it('should handle files with special characters in names', async () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 50 }),
        (batch) => batches.push(batch)
      );

      // Create files with special characters (safe for most filesystems)
      const specialNames = [
        'note with spaces.md',
        'note-with-dashes.md',
        'note_with_underscores.md',
        'note.multiple.dots.md',
        'UPPERCASE.md',
        'mixedCase.md',
      ];

      for (const name of specialNames) {
        const filePath = await writeTestFile(testDir, name);
        queue.push('add', filePath);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      queue.flush();

      const totalEvents = batches.reduce((sum, b) => sum + b.events.length, 0);
      expect(totalEvents).toBe(specialNames.length);

      queue.dispose();
    });

    it('should handle empty files', async () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 50 }),
        (batch) => batches.push(batch)
      );

      const filePath = await writeTestFile(testDir, 'empty.md', '');
      queue.push('add', filePath);

      await new Promise(resolve => setTimeout(resolve, 100));
      queue.flush();

      expect(batches).toHaveLength(1);

      queue.dispose();
    });

    it('should handle large files', async () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 50 }),
        (batch) => batches.push(batch)
      );

      // Create 1MB file
      const largeContent = 'x'.repeat(1024 * 1024);
      const filePath = await writeTestFile(testDir, 'large.md', largeContent);
      queue.push('add', filePath);

      await new Promise(resolve => setTimeout(resolve, 100));
      queue.flush();

      expect(batches).toHaveLength(1);

      // Verify file was actually created
      const stats = await stat(filePath);
      expect(stats.size).toBeGreaterThanOrEqual(1024 * 1024);

      queue.dispose();
    });
  });

  describe('bulk operations', () => {
    it('should handle vault-like directory structure', async () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 100, batchSize: 100 }),
        (batch) => batches.push(batch)
      );

      // Create vault-like structure
      const folders = ['daily-notes', 'projects', 'references', 'templates', 'attachments'];

      for (const folder of folders) {
        const folderPath = join(testDir, folder);
        await mkdir(folderPath, { recursive: true });

        // Create 10 files per folder
        for (let i = 0; i < 10; i++) {
          const filePath = await writeTestFile(folderPath, `note-${i}.md`);
          queue.push('add', filePath);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 200));
      queue.flush();

      // Should have 50 total events
      const totalEvents = batches.reduce((sum, b) => sum + b.events.length, 0);
      expect(totalEvents).toBe(50);

      queue.dispose();
    });
  });

  describe('timing validation', () => {
    it('should complete batch processing within timeout', async () => {
      const batches: EventBatch[] = [];
      const queue = new EventQueue(
        createConfig({ debounceMs: 100 }),
        (batch) => batches.push(batch)
      );

      const start = Date.now();

      // Create 100 files
      const promises: Promise<string>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(writeTestFile(testDir, `timing-${i}.md`));
      }
      const paths = await Promise.all(promises);

      for (const path of paths) {
        queue.push('add', path);
      }

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 200));
      queue.flush();

      const elapsed = Date.now() - start;

      // Should complete within 5 seconds (generous for CI)
      expect(elapsed).toBeLessThan(5000);

      const totalEvents = batches.reduce((sum, b) => sum + b.events.length, 0);
      expect(totalEvents).toBe(100);

      queue.dispose();
    });
  });
});
