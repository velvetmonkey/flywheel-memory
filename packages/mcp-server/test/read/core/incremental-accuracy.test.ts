import { describe, it, expect, beforeAll } from 'vitest';
import { buildVaultIndex } from '../../../src/core/read/graph.js';
import { upsertNote, deleteNote, removeNoteFromIndex, addNoteToIndex, reconcileReleasedKeys } from '../../../src/core/read/watch/incrementalIndex.js';
import type { VaultIndex, VaultNote } from '../../../src/core/read/types.js';
import * as fs from 'node:fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT_PATH = path.resolve(__dirname, '../../fixtures/vaults/test-vault');

describe('incremental accuracy', () => {
  let baselineIndex: VaultIndex;

  beforeAll(async () => {
    baselineIndex = await buildVaultIndex(VAULT_PATH);
  });

  it('upsertNote after outlink change matches fresh build', async () => {
    const testFile = 'notes/Daily Note.md';
    const filePath = path.join(VAULT_PATH, testFile);
    const original = await fs.readFile(filePath, 'utf-8');
    const modified = original + '\nAlso discussed [[Standalone]].\n';
    await fs.writeFile(filePath, modified);
    try {
      const incremental = structuredClone(baselineIndex);
      await upsertNote(incremental, VAULT_PATH, testFile);
      const fresh = await buildVaultIndex(VAULT_PATH);

      expect(incremental.notes.size).toBe(fresh.notes.size);
      const incNote = incremental.notes.get(testFile);
      const freshNote = fresh.notes.get(testFile);
      expect(incNote?.outlinks).toEqual(freshNote?.outlinks);
      // backlinks to Standalone should match
      const incBacklinks = incremental.backlinks.get('notes/standalone');
      const freshBacklinks = fresh.backlinks.get('notes/standalone');
      expect(incBacklinks).toEqual(freshBacklinks);
    } finally {
      await fs.writeFile(filePath, original);
    }
  });

  it('upsertNote after alias change matches fresh build', async () => {
    const testFile = 'notes/Alice Smith.md';
    const filePath = path.join(VAULT_PATH, testFile);
    const original = await fs.readFile(filePath, 'utf-8');
    const modified = original.replace('aliases: [Alice, A. Smith]', 'aliases: [Alice, A. Smith, Ali]');
    await fs.writeFile(filePath, modified);
    try {
      const incremental = structuredClone(baselineIndex);
      await upsertNote(incremental, VAULT_PATH, testFile);
      const fresh = await buildVaultIndex(VAULT_PATH);

      const incNote = incremental.notes.get(testFile);
      const freshNote = fresh.notes.get(testFile);
      expect(incNote?.aliases).toEqual(freshNote?.aliases);
      // New alias should be in entities map
      expect(incremental.entities.has('ali')).toBe(fresh.entities.has('ali'));
    } finally {
      await fs.writeFile(filePath, original);
    }
  });

  it('upsertNote after frontmatter tag change matches fresh build', async () => {
    const testFile = 'notes/Standalone.md';
    const filePath = path.join(VAULT_PATH, testFile);
    const original = await fs.readFile(filePath, 'utf-8');
    const modified = original.replace('tags: [misc]', 'tags: [misc, important]');
    await fs.writeFile(filePath, modified);
    try {
      const incremental = structuredClone(baselineIndex);
      await upsertNote(incremental, VAULT_PATH, testFile);
      const fresh = await buildVaultIndex(VAULT_PATH);

      const incNote = incremental.notes.get(testFile);
      const freshNote = fresh.notes.get(testFile);
      expect(incNote?.tags).toEqual(freshNote?.tags);
      // 'important' tag should now exist in tags map
      expect(incremental.tags.has('important')).toBe(fresh.tags.has('important'));
    } finally {
      await fs.writeFile(filePath, original);
    }
  });

  it('deleteNote matches fresh build', async () => {
    const testFile = 'notes/Standalone.md';
    const filePath = path.join(VAULT_PATH, testFile);
    const original = await fs.readFile(filePath, 'utf-8');
    await fs.unlink(filePath);
    try {
      const incremental = structuredClone(baselineIndex);
      deleteNote(incremental, testFile);
      const fresh = await buildVaultIndex(VAULT_PATH);

      expect(incremental.notes.size).toBe(fresh.notes.size);
      expect(incremental.notes.has(testFile)).toBe(false);
      expect(fresh.notes.has(testFile)).toBe(false);
    } finally {
      await fs.writeFile(filePath, original);
    }
  });

  it('rename (delete + upsert) matches fresh build', async () => {
    const oldFile = 'notes/Standalone.md';
    const newFile = 'notes/Renamed.md';
    const oldPath = path.join(VAULT_PATH, oldFile);
    const newPath = path.join(VAULT_PATH, newFile);
    const original = await fs.readFile(oldPath, 'utf-8');
    await fs.rename(oldPath, newPath);
    try {
      const incremental = structuredClone(baselineIndex);
      deleteNote(incremental, oldFile);
      await upsertNote(incremental, VAULT_PATH, newFile);
      const fresh = await buildVaultIndex(VAULT_PATH);

      expect(incremental.notes.has(oldFile)).toBe(false);
      expect(incremental.notes.has(newFile)).toBe(fresh.notes.has(newFile));
      expect(incremental.notes.size).toBe(fresh.notes.size);
    } finally {
      await fs.rename(newPath, oldPath);
    }
  });
});

describe('entity reconciliation', () => {
  function makeNote(title: string, notePath: string, aliases: string[] = []): VaultNote {
    return {
      title,
      path: notePath,
      aliases,
      frontmatter: {},
      tags: [],
      outlinks: [],
      headings: [],
      modified: new Date(),
    };
  }

  function emptyIndex(): VaultIndex {
    return {
      notes: new Map(),
      entities: new Map(),
      tags: new Map(),
      backlinks: new Map(),
    };
  }

  it('alias reclaimed after rename releases it', () => {
    const index = emptyIndex();
    const noteA = makeNote('Note A', 'a.md', ['foo']);
    const noteB = makeNote('Note B', 'b.md', ['foo']);

    // A wins "foo" by first-wins
    addNoteToIndex(index, noteA);
    addNoteToIndex(index, noteB);
    expect(index.entities.get('foo')).toBe('a.md');

    // Remove A — "foo" is released and should be reclaimed by B
    const released = removeNoteFromIndex(index, 'a.md');
    expect(released).toContain('foo');
    reconcileReleasedKeys(index, released);
    expect(index.entities.get('foo')).toBe('b.md');
  });

  it('title release reclaimed by note with matching alias', () => {
    const index = emptyIndex();
    const noteA = makeNote('Concept', 'a.md');
    const noteB = makeNote('Other', 'b.md', ['Concept']);

    addNoteToIndex(index, noteA);
    addNoteToIndex(index, noteB);
    // A owns "concept" by title
    expect(index.entities.get('concept')).toBe('a.md');

    // Delete A — B has alias "Concept", should reclaim
    const released = removeNoteFromIndex(index, 'a.md');
    reconcileReleasedKeys(index, released);
    expect(index.entities.get('concept')).toBe('b.md');
  });

  it('deleteNote reconciles released keys', () => {
    const index = emptyIndex();
    const noteA = makeNote('Shared', 'a.md');
    const noteB = makeNote('Other', 'b.md', ['Shared']);

    addNoteToIndex(index, noteA);
    addNoteToIndex(index, noteB);
    expect(index.entities.get('shared')).toBe('a.md');

    deleteNote(index, 'a.md');
    expect(index.entities.get('shared')).toBe('b.md');
  });

  it('new note in batch claims key over reconciliation', () => {
    const index = emptyIndex();
    const noteA = makeNote('Widget', 'a.md');
    const noteB = makeNote('Other', 'b.md', ['Widget']);

    addNoteToIndex(index, noteA);
    addNoteToIndex(index, noteB);
    expect(index.entities.get('widget')).toBe('a.md');

    // Simulate batch: delete A, add C which claims "widget"
    const noteC = makeNote('Widget', 'c.md');
    const released = removeNoteFromIndex(index, 'a.md');
    addNoteToIndex(index, noteC);
    // C claimed "widget" via addNoteToIndex, reconcile should be a no-op
    reconcileReleasedKeys(index, released);
    expect(index.entities.get('widget')).toBe('c.md');
  });
});
