/**
 * P42 Issue 1 regression tests — case-insensitive filesystem dedup.
 *
 * On Windows NTFS and macOS APFS default volumes, `Flywheel.md` and
 * `flywheel.md` refer to the same physical file. The scanner and
 * watcher previously disagreed on casing, so the index accumulated
 * two entries per file and doubled backlink counts in the doctor
 * report. These tests lock in the fix: with the module-level
 * case-insensitive flag enabled, mixed-case inserts collapse to one
 * entry; with the flag disabled, Linux case-sensitive semantics are
 * preserved.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setModuleCaseInsensitive,
  _resetModuleCaseInsensitive,
  detectCaseInsensitive,
  canonicalPath,
} from '../../../src/core/read/caseSensitivity.js';
import {
  addNoteToIndex,
  removeNoteFromIndex,
} from '../../../src/core/read/watch/incrementalIndex.js';
import {
  getBacklinksForNote,
  getIndexedNote,
  deserializeVaultIndex,
} from '../../../src/core/read/graph.js';
import type { VaultIndex, VaultNote } from '../../../src/core/read/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function emptyIndex(): VaultIndex {
  return {
    notes: new Map(),
    backlinks: new Map(),
    entities: new Map(),
    tags: new Map(),
    builtAt: new Date(),
  };
}

function makeNote(
  notePath: string,
  outlinks: Array<{ target: string; line: number }> = [],
  overrides: Partial<VaultNote> = {},
): VaultNote {
  const title = notePath.replace(/\.md$/, '').split('/').pop() ?? notePath;
  return {
    path: notePath,
    title,
    aliases: [],
    frontmatter: {},
    outlinks,
    tags: [],
    modified: new Date(),
    ...overrides,
  };
}

describe('P42 Issue 1 — case-insensitive path handling', () => {
  afterEach(() => {
    _resetModuleCaseInsensitive();
  });

  describe('on a case-insensitive filesystem', () => {
    beforeEach(() => {
      setModuleCaseInsensitive(true);
    });

    it('collapses mixed-case inserts into a single notes entry', () => {
      const index = emptyIndex();
      addNoteToIndex(index, makeNote('tech/flywheel/Flywheel.md'));
      addNoteToIndex(index, makeNote('tech/flywheel/flywheel.md'));

      expect(index.notes.size).toBe(1);
      expect(getIndexedNote(index, 'tech/flywheel/Flywheel.md')).toBeTruthy();
      expect(getIndexedNote(index, 'tech/flywheel/flywheel.md')).toBeTruthy();
      expect(getIndexedNote(index, 'TECH/FLYWHEEL/FLYWHEEL.MD')).toBeTruthy();
    });

    it('dedups backlinks when two sources link to the same note with different casing', () => {
      const index = emptyIndex();
      addNoteToIndex(index, makeNote('tech/flywheel/Flywheel.md'));
      addNoteToIndex(
        index,
        makeNote('notes/a.md', [{ target: 'Flywheel', line: 1 }]),
      );
      addNoteToIndex(
        index,
        makeNote('notes/b.md', [{ target: 'flywheel', line: 2 }]),
      );

      const fromMixed = getBacklinksForNote(index, 'tech/flywheel/Flywheel.md');
      const fromLower = getBacklinksForNote(index, 'tech/flywheel/flywheel.md');
      expect(fromMixed.length).toBe(2);
      expect(fromLower.length).toBe(2);
      expect(fromMixed).toEqual(fromLower);
    });

    it('removes both case variants when removeNoteFromIndex is called with either case', () => {
      const index = emptyIndex();
      addNoteToIndex(index, makeNote('tech/flywheel/Flywheel.md'));
      expect(index.notes.size).toBe(1);

      removeNoteFromIndex(index, 'tech/flywheel/flywheel.md');
      expect(index.notes.size).toBe(0);
      expect(getIndexedNote(index, 'tech/flywheel/Flywheel.md')).toBeUndefined();
    });

    it('tag index keys notes by canonical path, so mixed-case inserts share one tag membership', () => {
      const index = emptyIndex();
      addNoteToIndex(
        index,
        makeNote('tech/flywheel/Flywheel.md', [], { tags: ['flywheel'] }),
      );
      addNoteToIndex(
        index,
        makeNote('tech/flywheel/flywheel.md', [], { tags: ['flywheel'] }),
      );

      const tagSet = index.tags.get('flywheel');
      expect(tagSet).toBeDefined();
      expect(tagSet!.size).toBe(1);
    });

    it('deserializeVaultIndex canonicalizes keys from a cache persisted under mixed casing', () => {
      const cached = {
        notes: [
          {
            path: 'tech/flywheel/Flywheel.md',
            title: 'Flywheel',
            aliases: [],
            frontmatter: {},
            outlinks: [],
            tags: ['flywheel'],
            modified: Date.now(),
            created: undefined,
          },
        ],
        backlinks: [
          [
            'tech/flywheel/flywheel',
            [{ source: 'notes/A.md', line: 1 }, { source: 'notes/b.md', line: 1 }],
          ],
        ] as Array<[string, Array<{ source: string; line: number }>]>,
        entities: [
          ['flywheel', 'tech/flywheel/Flywheel.md'],
        ] as Array<[string, string]>,
        tags: [
          ['flywheel', ['tech/flywheel/Flywheel.md']],
        ] as Array<[string, string[]]>,
        builtAt: Date.now(),
      };

      // deserializeVaultIndex signature is lenient — cast to the cached data shape.
      const index = deserializeVaultIndex(cached as any);

      // All notes keyed by canonical path
      expect([...index.notes.keys()]).toEqual(['tech/flywheel/flywheel.md']);
      // Entity value rewritten to canonical key so `notes.get(entities.get(x))` resolves
      expect(index.entities.get('flywheel')).toBe('tech/flywheel/flywheel.md');
      // Backlink sources canonicalized
      const bl = index.backlinks.get('tech/flywheel/flywheel');
      expect(bl?.map(b => b.source).sort()).toEqual(['notes/a.md', 'notes/b.md']);
      // Tag set values canonicalized
      expect([...(index.tags.get('flywheel') ?? [])]).toEqual([
        'tech/flywheel/flywheel.md',
      ]);
    });

    it('getIndexedNote resolves a user-provided on-disk path against canonical keys', () => {
      const index = emptyIndex();
      addNoteToIndex(index, makeNote('tech/flywheel/flywheel.md'));
      expect(getIndexedNote(index, 'tech/flywheel/Flywheel.md')).toBeTruthy();
    });
  });

  describe('on a case-sensitive filesystem', () => {
    beforeEach(() => {
      setModuleCaseInsensitive(false);
    });

    it('keeps mixed-case notes as distinct entries', () => {
      const index = emptyIndex();
      addNoteToIndex(index, makeNote('tech/flywheel/Flywheel.md'));
      addNoteToIndex(index, makeNote('tech/flywheel/flywheel.md'));

      expect(index.notes.size).toBe(2);
      expect(getIndexedNote(index, 'tech/flywheel/Flywheel.md')).toBeTruthy();
      expect(getIndexedNote(index, 'tech/flywheel/flywheel.md')).toBeTruthy();
      // And they must be different records
      expect(getIndexedNote(index, 'tech/flywheel/Flywheel.md')).not.toBe(
        getIndexedNote(index, 'tech/flywheel/flywheel.md'),
      );
    });

    it('canonicalPath is an identity function when the flag is false', () => {
      expect(canonicalPath('tech/flywheel/Flywheel.md')).toBe(
        'tech/flywheel/Flywheel.md',
      );
    });
  });

  describe('detectCaseInsensitive() probe', () => {
    it('returns a boolean consistent with the host filesystem', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-case-probe-'));
      try {
        const probe = detectCaseInsensitive(tmp);
        expect(typeof probe).toBe('boolean');

        // Sanity: on Linux the common case is ext4 (case-sensitive). On macOS
        // the default APFS is case-insensitive. Windows NTFS is case-insensitive.
        // We don't force a platform check here — the probe itself is the source
        // of truth — but assert it matches a known-good expectation per platform.
        if (process.platform === 'linux') {
          expect(probe).toBe(false);
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
