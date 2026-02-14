/**
 * Tests for vault generator
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  generateVault,
  generateQuickVault,
  VAULT_PRESETS,
  SeededRandom,
  generateEntities,
  generateFrontmatter,
  generateFolderStructure
} from '../src/index.js';

describe('SeededRandom', () => {
  it('produces reproducible results with same seed', () => {
    const rng1 = new SeededRandom(12345);
    const rng2 = new SeededRandom(12345);

    const results1 = Array.from({ length: 10 }, () => rng1.next());
    const results2 = Array.from({ length: 10 }, () => rng2.next());

    expect(results1).toEqual(results2);
  });

  it('produces different results with different seeds', () => {
    const rng1 = new SeededRandom(12345);
    const rng2 = new SeededRandom(54321);

    const results1 = Array.from({ length: 10 }, () => rng1.next());
    const results2 = Array.from({ length: 10 }, () => rng2.next());

    expect(results1).not.toEqual(results2);
  });

  it('nextInt returns values in range', () => {
    const rng = new SeededRandom(42);

    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThanOrEqual(10);
    }
  });

  it('pick selects from array', () => {
    const rng = new SeededRandom(42);
    const arr = ['a', 'b', 'c', 'd', 'e'];

    for (let i = 0; i < 50; i++) {
      const val = rng.pick(arr);
      expect(arr).toContain(val);
    }
  });

  it('chance returns true with correct probability', () => {
    const rng = new SeededRandom(42);
    const trials = 1000;

    // Test 50% probability
    let trueCount = 0;
    for (let i = 0; i < trials; i++) {
      if (rng.chance(0.5)) trueCount++;
    }

    // Allow 10% tolerance
    expect(trueCount).toBeGreaterThan(trials * 0.4);
    expect(trueCount).toBeLessThan(trials * 0.6);
  });
});

describe('generateEntities', () => {
  it('generates correct number of entities', () => {
    const rng = new SeededRandom(42);
    const entities = generateEntities(
      rng,
      ['person', 'project', 'topic'],
      { person: 10, project: 5, topic: 8, location: 0, company: 0 }
    );

    const people = entities.filter(e => e.type === 'person');
    const projects = entities.filter(e => e.type === 'project');
    const topics = entities.filter(e => e.type === 'topic');

    expect(people.length).toBe(10);
    expect(projects.length).toBe(5);
    expect(topics.length).toBe(8);
    expect(entities.length).toBe(23);
  });

  it('generates unique entity names', () => {
    const rng = new SeededRandom(42);
    const entities = generateEntities(
      rng,
      ['person'],
      { person: 20, project: 0, topic: 0, location: 0, company: 0 }
    );

    const names = entities.map(e => e.name);
    const uniqueNames = new Set(names);

    expect(uniqueNames.size).toBe(names.length);
  });
});

describe('generateFrontmatter', () => {
  it('returns undefined when probability fails', () => {
    const rng = new SeededRandom(42);

    // With 0 probability, should always return undefined
    const fm = generateFrontmatter(rng, 'Test', { probability: 0 });
    expect(fm).toBeUndefined();
  });

  it('returns frontmatter when probability succeeds', () => {
    const rng = new SeededRandom(42);

    // With 1 probability, should always return something
    const fm = generateFrontmatter(rng, 'Test', { probability: 1 });
    expect(fm).toBeDefined();
    expect(typeof fm).toBe('object');
  });

  it('includes created date when enabled', () => {
    const rng = new SeededRandom(42);
    const fm = generateFrontmatter(rng, 'Test', {
      probability: 1,
      includeCreatedDate: true
    });

    expect(fm).toBeDefined();
    expect(fm?.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('generateFolderStructure', () => {
  it('generates appropriate folder count', () => {
    const rng = new SeededRandom(42);
    const folders = generateFolderStructure(rng, 3, 1000);

    // Should have root + subfolders
    expect(folders.length).toBeGreaterThan(1);

    // Should have reasonable folder count for 1000 notes
    expect(folders.length).toBeLessThan(100);
  });

  it('respects max depth', () => {
    const rng = new SeededRandom(42);
    const folders = generateFolderStructure(rng, 2, 1000);

    const maxDepth = Math.max(...folders.map(f => f.depth));
    expect(maxDepth).toBeLessThanOrEqual(2);
  });

  it('includes root folder', () => {
    const rng = new SeededRandom(42);
    const folders = generateFolderStructure(rng, 3, 100);

    const root = folders.find(f => f.path === '');
    expect(root).toBeDefined();
    expect(root?.depth).toBe(0);
  });
});

describe('generateQuickVault', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flywheel-bench-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('generates a small vault', async () => {
    const result = await generateQuickVault(tempDir, 10, 42);

    expect(result.noteCount).toBeGreaterThanOrEqual(10);
    expect(result.path).toBe(tempDir);
    expect(result.seed).toBe(42);

    // Check files exist
    const files = await fs.readdir(tempDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    expect(mdFiles.length).toBeGreaterThan(0);
  });

  it('produces reproducible vaults with same seed', async () => {
    const tempDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'flywheel-bench-test2-'));

    try {
      const result1 = await generateQuickVault(tempDir, 10, 12345);
      const result2 = await generateQuickVault(tempDir2, 10, 12345);

      // Same structure
      expect(result1.noteCount).toBe(result2.noteCount);
      expect(result1.entityCount).toBe(result2.entityCount);
      expect(result1.folderCount).toBe(result2.folderCount);
    } finally {
      await fs.rm(tempDir2, { recursive: true, force: true });
    }
  });
});

describe('VAULT_PRESETS', () => {
  it('has all expected presets', () => {
    expect(VAULT_PRESETS).toHaveProperty('1k');
    expect(VAULT_PRESETS).toHaveProperty('10k');
    expect(VAULT_PRESETS).toHaveProperty('50k');
    expect(VAULT_PRESETS).toHaveProperty('100k');
  });

  it('presets have increasing note counts', () => {
    expect(VAULT_PRESETS['1k'].noteCount).toBe(1000);
    expect(VAULT_PRESETS['10k'].noteCount).toBe(10000);
    expect(VAULT_PRESETS['50k'].noteCount).toBe(50000);
    expect(VAULT_PRESETS['100k'].noteCount).toBe(100000);
  });

  it('presets have valid entity counts', () => {
    for (const [, preset] of Object.entries(VAULT_PRESETS)) {
      const totalEntities = Object.values(preset.entityCount).reduce((a, b) => a + b, 0);
      expect(totalEntities).toBeGreaterThan(0);
      expect(totalEntities).toBeLessThan(preset.noteCount);
    }
  });
});

describe('generateVault (integration)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flywheel-bench-int-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('generates a complete vault with correct structure', async () => {
    const result = await generateVault({
      outputDir: tempDir,
      noteCount: 50,
      avgLinksPerNote: 2,
      entityTypes: ['person', 'project'],
      entityCount: { person: 5, project: 3, topic: 0, location: 0, company: 0 },
      folderDepth: 2,
      avgNoteLength: 200,
      frontmatterProbability: 0.5,
      seed: 42
    });

    // Check results
    expect(result.noteCount).toBeGreaterThanOrEqual(50);
    expect(result.entityCount).toBe(8);
    expect(result.totalLinks).toBeGreaterThan(0);

    // Check files
    const allFiles = await walkDir(tempDir);
    expect(allFiles.length).toBeGreaterThanOrEqual(50);

    // Check content of a random file
    const sampleFile = allFiles[0];
    const content = await fs.readFile(sampleFile, 'utf-8');

    // Should have a title
    expect(content).toMatch(/^(---[\s\S]*?---\s*)?#\s+.+/);
  });

  it('creates git repo when requested', async () => {
    await generateVault({
      outputDir: tempDir,
      noteCount: 10,
      avgLinksPerNote: 1,
      entityTypes: ['person'],
      entityCount: { person: 2, project: 0, topic: 0, location: 0, company: 0 },
      folderDepth: 1,
      avgNoteLength: 100,
      frontmatterProbability: 0.3,
      seed: 42,
      initGit: true
    });

    // Check .git exists
    const gitDir = path.join(tempDir, '.git');
    const stat = await fs.stat(gitDir);
    expect(stat.isDirectory()).toBe(true);
  });
});

async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(d: string) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}
