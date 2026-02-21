import { describe, it, expect, beforeAll } from 'vitest';
import { buildVaultIndex } from '../../../src/core/read/graph.js';
import { upsertNote, deleteNote } from '../../../src/core/read/watch/incrementalIndex.js';
import type { VaultIndex } from '../../../src/core/read/types.js';
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
