/**
 * Empty Vault Tests
 *
 * Validates behavior when starting with an empty vault:
 * creating first notes, initializing entity index, etc.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
  extractHeadings,
} from '../../src/core/writer.js';

let tempVault: string;

describe('Empty Vault Operations', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('First Note Creation', () => {
    it('should create first note in empty vault', async () => {
      const notePath = 'daily-notes/2026-02-02.md';
      const content = `---
date: 2026-02-02
type: daily
---
# 2026-02-02

## Log

`;

      await createTestNote(tempVault, notePath, content);

      const exists = await fs.access(path.join(tempVault, notePath)).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      const readContent = await readTestNote(tempVault, notePath);
      expect(readContent).toContain('# 2026-02-02');
    });

    it('should create nested folder structure for first note', async () => {
      const deepPath = 'projects/2026/q1/sprint-1/planning.md';

      await createTestNote(tempVault, deepPath, '# Sprint 1 Planning');

      const exists = await fs.access(path.join(tempVault, deepPath)).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should read and write first note with frontmatter', async () => {
      const notePath = 'test.md';
      const content = `---
type: test
tags:
  - first
---
# Test Note

## Section

Content here.
`;

      await createTestNote(tempVault, notePath, content);

      const { content: readContent, frontmatter, lineEnding } = await readVaultFile(tempVault, notePath);

      expect(frontmatter.type).toBe('test');
      expect(frontmatter.tags).toContain('first');
      expect(readContent).toContain('# Test Note');

      // Modify and write back
      const section = findSection(readContent, 'Section');
      expect(section).not.toBeNull();

      const modified = insertInSection(readContent, section!, 'New content', 'append');
      await writeVaultFile(tempVault, notePath, modified, frontmatter, lineEnding);

      const final = await readTestNote(tempVault, notePath);
      expect(final).toContain('New content');
    });
  });

  describe('Directory Structure', () => {
    it('should create .claude directory on first cache write', async () => {
      const claudeDir = path.join(tempVault, '.claude');

      // Initially doesn't exist
      const beforeExists = await fs.access(claudeDir).then(() => true).catch(() => false);
      expect(beforeExists).toBe(false);

      // Create it
      await fs.mkdir(claudeDir, { recursive: true });

      const afterExists = await fs.access(claudeDir).then(() => true).catch(() => false);
      expect(afterExists).toBe(true);
    });

    it('should handle vault with only hidden directories', async () => {
      // Create only .obsidian directory
      await fs.mkdir(path.join(tempVault, '.obsidian'), { recursive: true });
      await fs.writeFile(path.join(tempVault, '.obsidian', 'app.json'), '{}');

      // Should be able to create first note
      await createTestNote(tempVault, 'first.md', '# First Note');

      const exists = await fs.access(path.join(tempVault, 'first.md')).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('Section Operations on New Files', () => {
    it('should find sections in a new note', async () => {
      const content = `# Note Title

## Section One

Content for section one.

## Section Two

Content for section two.
`;

      await createTestNote(tempVault, 'new.md', content);

      const { content: readContent } = await readVaultFile(tempVault, 'new.md');
      const headings = extractHeadings(readContent);
      const headingTexts = headings.map(h => h.text);

      expect(headingTexts).toContain('Note Title');
      expect(headingTexts).toContain('Section One');
      expect(headingTexts).toContain('Section Two');
    });

    it('should handle note without any sections', async () => {
      const content = `Just plain text content.
No headings at all.
Multiple lines.
`;

      await createTestNote(tempVault, 'plain.md', content);

      const { content: readContent } = await readVaultFile(tempVault, 'plain.md');
      const headings = extractHeadings(readContent);

      expect(headings).toHaveLength(0);

      // Section operations should fail gracefully
      const section = findSection(readContent, 'NonExistent');
      expect(section).toBeNull();
    });

    it('should handle note with only title heading', async () => {
      const content = `# Only Title

Some content but no sections.
`;

      await createTestNote(tempVault, 'title-only.md', content);

      const { content: readContent } = await readVaultFile(tempVault, 'title-only.md');
      const headings = extractHeadings(readContent);

      expect(headings).toHaveLength(1);
      expect(headings[0].text).toBe('Only Title');
    });
  });

  describe('Frontmatter Handling', () => {
    it('should handle note without frontmatter', async () => {
      const content = `# No Frontmatter

Just content.
`;

      await createTestNote(tempVault, 'no-fm.md', content);

      const { content: readContent, frontmatter } = await readVaultFile(tempVault, 'no-fm.md');

      expect(frontmatter).toEqual({});
      expect(readContent).toContain('# No Frontmatter');
    });

    it('should handle empty frontmatter', async () => {
      const content = `---
---
# Empty Frontmatter

Content.
`;

      await createTestNote(tempVault, 'empty-fm.md', content);

      const { content: readContent, frontmatter } = await readVaultFile(tempVault, 'empty-fm.md');

      expect(frontmatter).toEqual({});
    });

    it('should preserve complex frontmatter', async () => {
      const content = `---
type: project
status: active
tags:
  - important
  - urgent
metadata:
  created: "2026-01-01"
  author: Test
---
# Project Note
`;

      await createTestNote(tempVault, 'complex-fm.md', content);

      const { frontmatter } = await readVaultFile(tempVault, 'complex-fm.md');

      expect(frontmatter.type).toBe('project');
      expect(frontmatter.status).toBe('active');
      expect(frontmatter.tags).toEqual(['important', 'urgent']);
      expect(frontmatter.metadata).toEqual({ created: '2026-01-01', author: 'Test' });
    });
  });
});

describe('Edge Cases', () => {
  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should handle Unicode file names', async () => {
    const notePath = 'notes/日本語ノート.md';
    await createTestNote(tempVault, notePath, '# 日本語ノート\n\nContent');

    const exists = await fs.access(path.join(tempVault, notePath)).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    const content = await readTestNote(tempVault, notePath);
    expect(content).toContain('日本語ノート');
  });

  it('should handle file names with spaces', async () => {
    const notePath = 'notes/My Important Note.md';
    await createTestNote(tempVault, notePath, '# My Important Note');

    const exists = await fs.access(path.join(tempVault, notePath)).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('should handle deeply nested paths', async () => {
    const deepPath = 'a/b/c/d/e/f/g/note.md';
    await createTestNote(tempVault, deepPath, '# Deep Note');

    const exists = await fs.access(path.join(tempVault, deepPath)).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
