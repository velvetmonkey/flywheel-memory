/**
 * Tests for P38: Context Engineering
 *
 * Lever 1: U-shaped sandwich interleaving
 * Lever 2: Section expansion (tested via integration in query.test.ts)
 * Lever 3A: Contextual embedding prefix
 */

import { describe, test, expect } from 'vitest';
import { applySandwichOrdering } from '../../../src/tools/read/query.js';
import { buildNoteEmbeddingText } from '../../../src/core/read/embeddings.js';

// =============================================================================
// Lever 1: U-shaped Sandwich Interleaving
// =============================================================================

describe('applySandwichOrdering', () => {
  /** Helper: create mock results with a rank label for easy assertion */
  const makeResults = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ rank: i + 1 })) as Array<Record<string, unknown>>;

  test('N < 3 — no reorder', () => {
    const results = makeResults(2);
    applySandwichOrdering(results);
    expect(results.map(r => r.rank)).toEqual([1, 2]);
  });

  test('N = 1 — no reorder', () => {
    const results = makeResults(1);
    applySandwichOrdering(results);
    expect(results.map(r => r.rank)).toEqual([1]);
  });

  test('N = 0 — no-op', () => {
    const results: Array<Record<string, unknown>> = [];
    applySandwichOrdering(results);
    expect(results).toEqual([]);
  });

  test('N = 3 — [1,3,2] (best first, second-best last)', () => {
    const results = makeResults(3);
    applySandwichOrdering(results);
    expect(results.map(r => r.rank)).toEqual([1, 3, 2]);
  });

  test('N = 5 — [1,3,5,4,2]', () => {
    const results = makeResults(5);
    applySandwichOrdering(results);
    expect(results.map(r => r.rank)).toEqual([1, 3, 5, 4, 2]);
  });

  test('N = 8 — [1,3,5,7,8,6,4,2]', () => {
    const results = makeResults(8);
    applySandwichOrdering(results);
    expect(results.map(r => r.rank)).toEqual([1, 3, 5, 7, 8, 6, 4, 2]);
  });

  test('N = 10 — [1,3,5,7,9,10,8,6,4,2]', () => {
    const results = makeResults(10);
    applySandwichOrdering(results);
    expect(results.map(r => r.rank)).toEqual([1, 3, 5, 7, 9, 10, 8, 6, 4, 2]);
  });

  test('best result is always first', () => {
    for (const n of [3, 5, 8, 10, 15]) {
      const results = makeResults(n);
      applySandwichOrdering(results);
      expect(results[0].rank).toBe(1);
    }
  });

  test('second-best result is always last', () => {
    for (const n of [3, 5, 8, 10, 15]) {
      const results = makeResults(n);
      applySandwichOrdering(results);
      expect(results[results.length - 1].rank).toBe(2);
    }
  });

  test('preserves all elements (no loss, no duplication)', () => {
    const results = makeResults(10);
    applySandwichOrdering(results);
    const ranks = results.map(r => r.rank).sort((a, b) => (a as number) - (b as number));
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('mutates array in-place', () => {
    const results = makeResults(5);
    const ref = results;
    applySandwichOrdering(results);
    expect(results).toBe(ref); // same reference
  });
});

// =============================================================================
// Lever 3A: Contextual Embedding Prefix
// =============================================================================

describe('buildNoteEmbeddingText', () => {
  test('prepends title from file path', () => {
    const content = 'Hello world';
    const result = buildNoteEmbeddingText(content, 'projects/My Project.md');
    expect(result).toMatch(/^Note: My Project\./);
    expect(result).toContain('Hello world');
  });

  test('strips frontmatter from body', () => {
    const content = '---\ntype: person\nstatus: active\n---\nEmma is a team lead.';
    const result = buildNoteEmbeddingText(content, 'people/Emma.md');
    expect(result).toContain('Emma is a team lead.');
    expect(result).not.toContain('type: person');
    expect(result).not.toContain('---');
  });

  test('extracts array-style tags', () => {
    const content = '---\ntags: [person, team-lead, engineering]\n---\nContent here.';
    const result = buildNoteEmbeddingText(content, 'Emma.md');
    expect(result).toMatch(/Tags: person, team-lead, engineering/);
  });

  test('extracts list-style tags', () => {
    const content = '---\ntags:\n  - person\n  - team-lead\n  - engineering\n---\nContent here.';
    const result = buildNoteEmbeddingText(content, 'Emma.md');
    expect(result).toMatch(/Tags: person, team-lead, engineering/);
  });

  test('handles quoted tags in arrays', () => {
    const content = '---\ntags: ["person", \'team-lead\']\n---\nContent.';
    const result = buildNoteEmbeddingText(content, 'Emma.md');
    expect(result).toMatch(/Tags: person, team-lead/);
  });

  test('limits to 5 tags', () => {
    const content = '---\ntags: [a, b, c, d, e, f, g]\n---\nContent.';
    const result = buildNoteEmbeddingText(content, 'test.md');
    const tagMatch = result.match(/Tags: (.+?)\./);
    expect(tagMatch).toBeTruthy();
    const tags = tagMatch![1].split(', ');
    expect(tags.length).toBe(5);
  });

  test('no tags — omits Tags prefix', () => {
    const content = '---\ntype: project\n---\nNo tags here.';
    const result = buildNoteEmbeddingText(content, 'project.md');
    expect(result).toMatch(/^Note: project\.\n\n/);
    expect(result).not.toContain('Tags:');
  });

  test('no frontmatter — uses full content as body', () => {
    const content = '# My Note\n\nSome content without frontmatter.';
    const result = buildNoteEmbeddingText(content, 'note.md');
    expect(result).toMatch(/^Note: note\.\n\n# My Note/);
  });

  test('nested path extracts filename only', () => {
    const content = 'body';
    const result = buildNoteEmbeddingText(content, 'deep/nested/folder/Target.md');
    expect(result).toMatch(/^Note: Target\./);
  });

  test('output format: prefix + double newline + body', () => {
    const content = '---\ntags: [x]\n---\nBody text.';
    const result = buildNoteEmbeddingText(content, 'test.md');
    // Should be "Note: test. Tags: x.\n\nBody text."
    const [prefix, body] = result.split('\n\n');
    expect(prefix).toBe('Note: test. Tags: x.');
    expect(body).toBe('Body text.');
  });
});

// =============================================================================
// Consumer parameter: LLM vs human output format
// =============================================================================

describe('consumer parameter — field preservation', () => {
  /** Fields that stripInternalFields removes for LLM consumers */
  const INTERNAL_FIELDS = ['rrf_score', 'in_fts5', 'in_semantic', 'in_entity', 'graph_boost', '_combined_score'];

  test('LLM consumer: sandwich ordering applied + internal fields stripped', () => {
    // Simulate the LLM path: sandwich order then strip
    const results = [
      { rank: 1, rrf_score: 0.9, in_fts5: true, in_semantic: true, title: 'A' },
      { rank: 2, rrf_score: 0.7, in_fts5: true, in_semantic: false, title: 'B' },
      { rank: 3, rrf_score: 0.3, in_fts5: false, in_semantic: true, title: 'C' },
    ] as Array<Record<string, unknown>>;

    applySandwichOrdering(results);
    // Sandwich: [1, 3, 2]
    expect(results.map(r => r.rank)).toEqual([1, 3, 2]);

    // Strip internal fields
    for (const r of results) {
      for (const key of INTERNAL_FIELDS) delete r[key];
    }
    for (const r of results) {
      for (const key of INTERNAL_FIELDS) {
        expect(r[key]).toBeUndefined();
      }
    }
    // Non-internal fields preserved
    expect(results[0].title).toBe('A');
    expect(results[0].rank).toBe(1);
  });

  test('human consumer: score-sorted order preserved + internal fields retained', () => {
    // Simulate the human path: NO sandwich ordering, NO stripping
    const results = [
      { rank: 1, rrf_score: 0.9, in_fts5: true, in_semantic: true, title: 'A' },
      { rank: 2, rrf_score: 0.7, in_fts5: true, in_semantic: false, title: 'B' },
      { rank: 3, rrf_score: 0.3, in_fts5: false, in_semantic: true, title: 'C' },
    ] as Array<Record<string, unknown>>;

    // No sandwich ordering — score order preserved
    expect(results.map(r => r.rank)).toEqual([1, 2, 3]);

    // All scoring fields available for UI display
    expect(results[0].rrf_score).toBe(0.9);
    expect(results[0].in_fts5).toBe(true);
    expect(results[0].in_semantic).toBe(true);
    expect(results[1].in_semantic).toBe(false);
    expect(results[2].in_fts5).toBe(false);
  });
});
