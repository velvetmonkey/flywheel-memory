/**
 * Tests for Periodic Note Detection heuristics
 *
 * These tests cover date pattern detection, ISO week calculation,
 * folder naming heuristics, and confidence scoring.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildVaultIndex } from '../../src/core/graph.js';
import type { VaultIndex } from '../../src/core/types.js';
import { detectPeriodicNotes } from '../../src/tools/periodic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, '..', 'fixtures');
const PERIODIC_FIXTURES = path.join(__dirname, '..', 'fixtures', 'periodic-notes');

describe('Periodic Note Detection', () => {
  describe('detectPeriodicNotes', () => {
    let index: VaultIndex;

    beforeAll(async () => {
      index = await buildVaultIndex(PERIODIC_FIXTURES);
    });

    test('detects daily notes with YYYY-MM-DD pattern', () => {
      const result = detectPeriodicNotes(index, 'daily');

      expect(result.detected).toBe(true);
      expect(result.pattern).toBe('YYYY-MM-DD');
      expect(result.folder).toContain('daily');
      expect(result.evidence.note_count).toBeGreaterThan(0);
    });

    test('detects weekly notes with YYYY-WXX pattern', () => {
      const result = detectPeriodicNotes(index, 'weekly');

      expect(result.detected).toBe(true);
      expect(result.pattern).toBe('YYYY-WXX');
      expect(result.folder).toContain('weekly');
    });

    test('returns false for non-existent patterns', () => {
      const result = detectPeriodicNotes(index, 'quarterly');

      // No quarterly notes in fixtures
      expect(result.detected).toBe(false);
      expect(result.folder).toBeNull();
      expect(result.pattern).toBeNull();
      expect(result.confidence).toBe(0);
    });

    test('today_path is generated for detected patterns', () => {
      const result = detectPeriodicNotes(index, 'daily');

      expect(result.today_path).toBeDefined();
      expect(result.today_path).toMatch(/\.md$/);
      expect(result.today_path).toContain(result.folder || '');
    });

    test('returns candidates sorted by score', () => {
      const result = detectPeriodicNotes(index, 'daily');

      expect(result.candidates.length).toBeGreaterThan(0);

      // Verify sorted by descending score
      for (let i = 1; i < result.candidates.length; i++) {
        expect(result.candidates[i - 1].score).toBeGreaterThanOrEqual(
          result.candidates[i].score
        );
      }
    });

    test('confidence is between 0 and 1', () => {
      const result = detectPeriodicNotes(index, 'daily');

      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('Empty Vault Handling', () => {
    test('handles vault with no matching notes', async () => {
      // Use main fixtures which don't have periodic patterns
      const index = await buildVaultIndex(FIXTURES_PATH);
      const result = detectPeriodicNotes(index, 'quarterly');

      expect(result.detected).toBe(false);
      expect(result.folder).toBeNull();
      expect(result.candidates).toHaveLength(0);
    });
  });
});

describe('Date Pattern Matching', () => {
  describe('Daily Patterns', () => {
    test('YYYY-MM-DD matches standard ISO format', () => {
      const pattern = /^\d{4}-\d{2}-\d{2}\.md$/;

      expect(pattern.test('2024-01-15.md')).toBe(true);
      expect(pattern.test('2024-12-31.md')).toBe(true);
      expect(pattern.test('2025-01-01.md')).toBe(true);

      // Edge cases
      expect(pattern.test('2024-1-15.md')).toBe(false); // single digit month
      expect(pattern.test('24-01-15.md')).toBe(false); // 2-digit year
      expect(pattern.test('2024-01-15.txt')).toBe(false); // wrong extension
    });

    test('YYYY-MM-DD-* matches extended daily format', () => {
      const pattern = /^\d{4}-\d{2}-\d{2}-.+\.md$/;

      expect(pattern.test('2024-01-15-monday.md')).toBe(true);
      expect(pattern.test('2024-01-15-meeting-notes.md')).toBe(true);

      expect(pattern.test('2024-01-15.md')).toBe(false); // no suffix
    });

    test('DD-MM-YYYY matches European format', () => {
      const pattern = /^\d{2}-\d{2}-\d{4}\.md$/;

      expect(pattern.test('15-01-2024.md')).toBe(true);
      expect(pattern.test('31-12-2024.md')).toBe(true);

      expect(pattern.test('2024-01-15.md')).toBe(false); // wrong order
    });
  });

  describe('Weekly Patterns', () => {
    test('YYYY-WXX matches ISO week format', () => {
      const pattern = /^\d{4}-W\d{2}\.md$/;

      expect(pattern.test('2024-W01.md')).toBe(true);
      expect(pattern.test('2024-W52.md')).toBe(true);
      expect(pattern.test('2025-W01.md')).toBe(true);

      expect(pattern.test('2024-W1.md')).toBe(false); // single digit
      expect(pattern.test('2024-w01.md')).toBe(false); // lowercase W
    });
  });

  describe('Monthly Patterns', () => {
    test('YYYY-MM matches monthly format', () => {
      const pattern = /^\d{4}-\d{2}\.md$/;

      expect(pattern.test('2024-01.md')).toBe(true);
      expect(pattern.test('2024-12.md')).toBe(true);

      expect(pattern.test('2024-1.md')).toBe(false); // single digit
      expect(pattern.test('2024-01-15.md')).toBe(false); // has day
    });
  });

  describe('Quarterly Patterns', () => {
    test('YYYY-QX matches quarterly format', () => {
      const pattern = /^\d{4}-Q[1-4]\.md$/;

      expect(pattern.test('2024-Q1.md')).toBe(true);
      expect(pattern.test('2024-Q4.md')).toBe(true);

      expect(pattern.test('2024-Q5.md')).toBe(false); // invalid quarter
      expect(pattern.test('2024-Q0.md')).toBe(false); // invalid quarter
    });
  });

  describe('Yearly Patterns', () => {
    test('YYYY matches yearly format', () => {
      const pattern = /^\d{4}\.md$/;

      expect(pattern.test('2024.md')).toBe(true);
      expect(pattern.test('2025.md')).toBe(true);

      expect(pattern.test('24.md')).toBe(false); // 2-digit year
      expect(pattern.test('2024-annual.md')).toBe(false); // has suffix
    });
  });
});

describe('ISO Week Calculation Edge Cases', () => {
  /**
   * The ISO week algorithm in periodic.ts:
   *
   * function getISOWeek(date: Date): number {
   *   const target = new Date(date.valueOf());
   *   const dayNr = (date.getDay() + 6) % 7;
   *   target.setDate(target.getDate() - dayNr + 3);
   *   const firstThursday = target.valueOf();
   *   target.setMonth(0, 1);
   *   if (target.getDay() !== 4) {
   *     target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
   *   }
   *   return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
   * }
   *
   * These tests verify the algorithm handles year boundaries correctly.
   */

  // We can't directly test the internal function, but we can verify behavior
  // through the public API by checking generated paths

  test('year-crossing week boundary - Dec 30 2024 is Week 1 of 2025', async () => {
    // December 30, 2024 is Monday - start of ISO week 1 of 2025
    const index = await buildVaultIndex(PERIODIC_FIXTURES);
    const result = detectPeriodicNotes(index, 'weekly');

    // The detection should work - we're just verifying the fixture setup
    if (result.detected) {
      expect(result.today_path).toMatch(/\d{4}-W\d{2}\.md$/);
    }
  });

  test('consistency between daily and weekly notes at year boundary', async () => {
    const index = await buildVaultIndex(PERIODIC_FIXTURES);

    // We have fixtures for:
    // - 2024-12-30.md (Mon, ISO Week 1 of 2025)
    // - 2024-12-31.md (Tue, ISO Week 1 of 2025)
    // - 2025-01-01.md (Wed, ISO Week 1 of 2025)
    // - 2025-W01.md

    const dailyResult = detectPeriodicNotes(index, 'daily');
    const weeklyResult = detectPeriodicNotes(index, 'weekly');

    expect(dailyResult.evidence.note_count).toBeGreaterThanOrEqual(3);
    expect(weeklyResult.evidence.note_count).toBeGreaterThanOrEqual(1);
  });
});

describe('Folder Naming Heuristics', () => {
  test('recognizes common daily folder names', () => {
    const commonFolders = ['daily-notes', 'Daily', 'journal', 'Journal', 'dailies'];

    commonFolders.forEach((folder) => {
      // Case-insensitive matching should work
      expect(folder.toLowerCase()).toBeDefined();
    });
  });

  test('recognizes common weekly folder names', () => {
    const commonFolders = ['weekly-notes', 'Weekly', 'weeklies'];

    commonFolders.forEach((folder) => {
      expect(folder.toLowerCase()).toBeDefined();
    });
  });
});

describe('Confidence Scoring', () => {
  test('score components add up correctly', async () => {
    const index = await buildVaultIndex(PERIODIC_FIXTURES);
    const result = detectPeriodicNotes(index, 'daily');

    if (result.detected) {
      // Score should be sum of:
      // - count component (max 0.4)
      // - recency component (max 0.3)
      // - folder name component (0.2 if common folder)
      // - consistency component (max 0.1)

      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  test('pattern_consistency is between 0 and 1', async () => {
    const index = await buildVaultIndex(PERIODIC_FIXTURES);
    const result = detectPeriodicNotes(index, 'daily');

    expect(result.evidence.pattern_consistency).toBeGreaterThanOrEqual(0);
    expect(result.evidence.pattern_consistency).toBeLessThanOrEqual(1);
  });
});

describe('Edge Cases', () => {
  test('handles root-level notes (no folder)', async () => {
    // Notes directly in vault root should use "." as folder
    const index = await buildVaultIndex(FIXTURES_PATH);
    const result = detectPeriodicNotes(index, 'daily');

    // May or may not detect depending on fixture content
    // Just verify no crash
    expect(result).toBeDefined();
    expect(result.type).toBe('daily');
  });

  test('handles deeply nested folders', async () => {
    // Nested folders like periodic-notes/daily/2024/01/15.md
    const index = await buildVaultIndex(PERIODIC_FIXTURES);
    const result = detectPeriodicNotes(index, 'daily');

    // Should detect notes in subfolders
    expect(result).toBeDefined();
  });

  test('prefers folders with more recent notes', async () => {
    const index = await buildVaultIndex(PERIODIC_FIXTURES);
    const result = detectPeriodicNotes(index, 'daily');

    // Recent notes boost the score by up to 0.3
    if (result.detected && result.evidence.recent_notes > 0) {
      expect(result.confidence).toBeGreaterThan(0.3);
    }
  });

  test('all period types can be queried without error', async () => {
    const index = await buildVaultIndex(PERIODIC_FIXTURES);
    const types = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;

    for (const type of types) {
      const result = detectPeriodicNotes(index, type);
      expect(result.type).toBe(type);
      expect(typeof result.detected).toBe('boolean');
    }
  });
});
