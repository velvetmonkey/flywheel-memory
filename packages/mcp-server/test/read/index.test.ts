/**
 * Tests for Flywheel MCP server core functionality
 *
 * Run with: npm test
 */

import { describe, test, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { scanVault } from '../src/core/vault.js';
import { parseNote, parseNoteWithWarnings } from '../src/core/parser.js';
import { buildVaultIndex } from '../src/core/graph.js';
import type { VaultIndex } from '../src/core/types.js';

const FIXTURES_PATH = path.join(__dirname, 'fixtures');

describe('Vault Scanner', () => {
  test('finds all markdown files', async () => {
    const files = await scanVault(FIXTURES_PATH);
    expect(files.length).toBeGreaterThanOrEqual(7);

    const paths = files.map((f) => f.path);
    expect(paths).toContain('normal-note.md');
    expect(paths).toContain('Another Note.md');
    expect(paths).toContain('empty-file.md');
  });

  test('finds nested files', async () => {
    const files = await scanVault(FIXTURES_PATH);
    const nestedFile = files.find((f) => f.path.includes('Nested'));
    expect(nestedFile).toBeDefined();
    expect(nestedFile?.path).toBe('Nested/Deep Note.md');
  });

  test('normalizes paths to forward slashes', async () => {
    const files = await scanVault(FIXTURES_PATH);
    for (const file of files) {
      expect(file.path).not.toContain('\\');
    }
  });
});

describe('Markdown Parser', () => {
  test('parses normal note with frontmatter', async () => {
    const files = await scanVault(FIXTURES_PATH);
    const file = files.find((f) => f.path === 'normal-note.md')!;
    const note = await parseNote(file);

    expect(note.title).toBe('normal-note');
    expect(note.frontmatter.title).toBe('Normal Note');
    expect(note.frontmatter.status).toBe('active');
    expect(note.tags).toContain('test');
    expect(note.tags).toContain('fixture');
    expect(note.aliases).toContain('Test Note');
    expect(note.aliases).toContain('My Normal Note');
  });

  test('extracts wikilinks correctly', async () => {
    const files = await scanVault(FIXTURES_PATH);
    const file = files.find((f) => f.path === 'normal-note.md')!;
    const note = await parseNote(file);

    const targets = note.outlinks.map((l) => l.target);
    expect(targets).toContain('wikilinks');
    expect(targets).toContain('Another Note');
    expect(targets).toContain('Nested/Deep Note');
    expect(targets).toContain('Does Not Exist');
  });

  test('extracts aliased links', async () => {
    const files = await scanVault(FIXTURES_PATH);
    const file = files.find((f) => f.path === 'normal-note.md')!;
    const note = await parseNote(file);

    const aliasedLink = note.outlinks.find((l) => l.target === 'Another Note');
    expect(aliasedLink?.alias).toBe('an aliased link');
  });

  test('ignores links in code blocks', async () => {
    const files = await scanVault(FIXTURES_PATH);
    const file = files.find((f) => f.path === 'normal-note.md')!;
    const note = await parseNote(file);

    const targets = note.outlinks.map((l) => l.target);
    expect(targets).not.toContain('fake links');
    expect(targets).not.toContain('not a link');
    expect(targets).not.toContain('not matched');
  });

  test('extracts inline tags', async () => {
    const files = await scanVault(FIXTURES_PATH);
    const file = files.find((f) => f.path === 'normal-note.md')!;
    const note = await parseNote(file);

    expect(note.tags).toContain('inline-tags');
  });

  test('handles empty files gracefully', async () => {
    const files = await scanVault(FIXTURES_PATH);
    const file = files.find((f) => f.path === 'empty-file.md')!;
    const result = await parseNoteWithWarnings(file);

    expect(result.skipped).toBe(false);
    expect(result.warnings).toContain('Empty file');
    expect(result.note.outlinks).toHaveLength(0);
    expect(result.note.tags).toHaveLength(0);
  });

  test('handles frontmatter-only files', async () => {
    const files = await scanVault(FIXTURES_PATH);
    const file = files.find((f) => f.path === 'frontmatter-only.md')!;
    const note = await parseNote(file);

    expect(note.frontmatter.title).toBe('Frontmatter Only');
    expect(note.frontmatter.status).toBe('draft');
    expect(note.outlinks).toHaveLength(0);
  });

  test('handles malformed YAML gracefully', async () => {
    const files = await scanVault(FIXTURES_PATH);
    const file = files.find((f) => f.path === 'malformed-yaml.md')!;
    const result = await parseNoteWithWarnings(file);

    expect(result.skipped).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('Malformed frontmatter');

    // Should still extract wikilinks from content
    const targets = result.note.outlinks.map((l) => l.target);
    expect(targets).toContain('wikilinks');
  });

  test('handles files without frontmatter', async () => {
    const files = await scanVault(FIXTURES_PATH);
    const file = files.find((f) => f.path === 'no-frontmatter.md')!;
    const note = await parseNote(file);

    expect(note.frontmatter).toEqual({});
    expect(note.outlinks.map((l) => l.target)).toContain('wikilinks');
    expect(note.tags).toContain('tags');
  });
});

describe('Vault Index', () => {
  let index: VaultIndex;

  beforeAll(async () => {
    index = await buildVaultIndex(FIXTURES_PATH);
  });

  test('indexes all notes', () => {
    expect(index.notes.size).toBeGreaterThanOrEqual(7);
  });

  test('builds entity map with titles', () => {
    // Should be able to resolve by title
    expect(index.entities.has('normal-note')).toBe(true);
    expect(index.entities.has('another note')).toBe(true);
  });

  test('builds entity map with aliases', () => {
    // Should be able to resolve by alias
    expect(index.entities.has('test note')).toBe(true);
    expect(index.entities.has('my normal note')).toBe(true);
  });

  test('builds backlinks index', () => {
    // Normal Note should have backlinks from Another Note and orphan-note
    const normalNoteBacklinks = index.backlinks.get('normal-note');
    expect(normalNoteBacklinks).toBeDefined();
    expect(normalNoteBacklinks!.length).toBeGreaterThanOrEqual(2);
  });

  test('builds tag index', () => {
    expect(index.tags.has('test')).toBe(true);
    expect(index.tags.get('test')?.has('normal-note.md')).toBe(true);
  });

  test('identifies orphan notes', () => {
    const orphanNote = index.notes.get('orphan-note.md');
    expect(orphanNote).toBeDefined();

    // Check that orphan-note has no backlinks
    const backlinks = index.backlinks.get('orphan-note');
    expect(backlinks?.length ?? 0).toBe(0);
  });
});

describe('Graph Functions', () => {
  let index: VaultIndex;

  beforeAll(async () => {
    index = await buildVaultIndex(FIXTURES_PATH);
  });

  test('finds broken links', () => {
    const normalNote = index.notes.get('normal-note.md')!;
    const brokenLinks = normalNote.outlinks.filter((link) => {
      const normalized = link.target.toLowerCase().replace(/\.md$/, '');
      return !index.entities.has(normalized);
    });

    expect(brokenLinks.length).toBeGreaterThan(0);
    expect(brokenLinks.map((l) => l.target)).toContain('Does Not Exist');
  });
});

describe('Timeout Protection', () => {
  test('buildVaultIndex accepts timeout option', async () => {
    // Just verify the API accepts the option - actual timeout testing
    // would require a very large vault or mocking
    const index = await buildVaultIndex(FIXTURES_PATH, {
      timeoutMs: 60000,
    });
    expect(index.notes.size).toBeGreaterThan(0);
  });

  test('buildVaultIndex accepts progress callback', async () => {
    let progressCalled = false;
    await buildVaultIndex(FIXTURES_PATH, {
      onProgress: (parsed, total) => {
        progressCalled = true;
        expect(parsed).toBeLessThanOrEqual(total);
      },
    });
    // Progress may not be called for small vaults (under PROGRESS_INTERVAL)
    // So we just verify it doesn't throw
  });
});
