/**
 * Tests for entity scanning, stop-entity list, and canonical casing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanVaultEntities, getAllEntities, STOP_ENTITIES } from '../src/entities.js';

describe('STOP_ENTITIES', () => {
  it('should contain expected stop words', () => {
    expect(STOP_ENTITIES.has('me')).toBe(true);
    expect(STOP_ENTITIES.has('mcp')).toBe(true);
    expect(STOP_ENTITIES.has('ok')).toBe(true);
    expect(STOP_ENTITIES.has('re')).toBe(true);
    expect(STOP_ENTITIES.has('vs')).toBe(true);
  });

  it('should not contain legitimate entity names', () => {
    expect(STOP_ENTITIES.has('react')).toBe(false);
    expect(STOP_ENTITIES.has('python')).toBe(false);
    expect(STOP_ENTITIES.has('claude')).toBe(false);
  });
});

describe('scanVaultEntities', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entities-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeNote(name: string, content = '') {
    fs.writeFileSync(path.join(tmpDir, `${name}.md`), content, 'utf-8');
  }

  describe('stop-entity filtering', () => {
    it('should exclude stop-listed entities', async () => {
      writeNote('me');
      writeNote('mcp');
      writeNote('ok');
      writeNote('React', '---\ntype: technology\n---\n');

      const index = await scanVaultEntities(tmpDir);
      const all = getAllEntities(index);
      const names = all.map(e => (typeof e === 'string' ? e : e.name));

      expect(names).not.toContain('me');
      expect(names).not.toContain('mcp');
      expect(names).not.toContain('ok');
    });

    it('should keep entities not in the stop list', async () => {
      writeNote('React');
      writeNote('Python');
      writeNote('Claude');

      const index = await scanVaultEntities(tmpDir);
      const all = getAllEntities(index);
      const names = all.map(e => (typeof e === 'string' ? e : e.name));

      expect(names).toContain('React');
      expect(names).toContain('Python');
      expect(names).toContain('Claude');
    });

    it('should be case-insensitive when checking stop list', async () => {
      writeNote('Me');
      writeNote('MCP');
      writeNote('OK');

      const index = await scanVaultEntities(tmpDir);
      const all = getAllEntities(index);
      const names = all.map(e => (typeof e === 'string' ? e : e.name));

      expect(names).not.toContain('Me');
      expect(names).not.toContain('MCP');
      expect(names).not.toContain('OK');
    });
  });

  describe('minimum name length filtering', () => {
    it('should exclude single-character entity names', async () => {
      writeNote('X');
      writeNote('a');
      writeNote('React');

      const index = await scanVaultEntities(tmpDir);
      const all = getAllEntities(index);
      const names = all.map(e => (typeof e === 'string' ? e : e.name));

      // Single-character names should be filtered (length < 2)
      expect(names).not.toContain('X');
      expect(names).not.toContain('a');
      // Normal names should pass
      expect(names).toContain('React');
    });

    it('should keep 2-character entity names', async () => {
      writeNote('Go', '---\ntype: technology\n---\n');
      writeNote('AI', '---\ntype: acronym\n---\n');

      const index = await scanVaultEntities(tmpDir);
      const all = getAllEntities(index);
      const names = all.map(e => (typeof e === 'string' ? e : e.name));

      // 2-char names should pass the length filter (may still be stop-listed)
      // "AI" is not in STOP_ENTITIES, so it should appear
      expect(names).toContain('AI');
    });

    it('should exclude entities matching date patterns', async () => {
      writeNote('2025-01-01');
      writeNote('2025-W17');
      writeNote('React');

      const index = await scanVaultEntities(tmpDir);
      const all = getAllEntities(index);
      const names = all.map(e => (typeof e === 'string' ? e : e.name));

      expect(names).not.toContain('2025-01-01');
      expect(names).not.toContain('2025-W17');
      expect(names).toContain('React');
    });
  });

  describe('canonical casing from filename', () => {
    it('should prefer entity name matching filename stem over alias variant', async () => {
      // Python.md has the canonical casing "Python"
      writeNote('Python', '---\ntype: technology\n---\n');
      // Another note has "python" as an alias — but since entities are scanned
      // from filenames, we simulate with a file named "python" (lowercase)
      writeNote('python', '');

      const index = await scanVaultEntities(tmpDir);
      const all = getAllEntities(index);
      const pythonEntity = all.find(
        e => (typeof e === 'string' ? e : e.name).toLowerCase() === 'python'
      );

      expect(pythonEntity).toBeDefined();
      const name = typeof pythonEntity === 'string' ? pythonEntity : pythonEntity!.name;
      // "Python" from Python.md should win because name === stem
      expect(name).toBe('Python');
    });

    it('should keep first occurrence when both match their filename stems', async () => {
      // Both files have names matching their stems — first scanned wins
      // (directory order is filesystem-dependent, but both match stems)
      writeNote('React');
      writeNote('Vue');

      const index = await scanVaultEntities(tmpDir);
      const all = getAllEntities(index);
      const names = all.map(e => (typeof e === 'string' ? e : e.name));

      // Both should be present (different names, no dedup conflict)
      expect(names).toContain('React');
      expect(names).toContain('Vue');
    });

    it('should deduplicate case-insensitive duplicates', async () => {
      writeNote('React');
      writeNote('react');

      const index = await scanVaultEntities(tmpDir);
      const all = getAllEntities(index);
      const reactEntities = all.filter(
        e => (typeof e === 'string' ? e : e.name).toLowerCase() === 'react'
      );

      // Should have exactly one entry
      expect(reactEntities).toHaveLength(1);
      // Both match their stems, so first-scanned wins — either is acceptable
      const name = typeof reactEntities[0] === 'string' ? reactEntities[0] : reactEntities[0].name;
      expect(name.toLowerCase()).toBe('react');
    });
  });
});
