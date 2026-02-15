/**
 * Tests for Semantic Search Embeddings Module
 *
 * Tests cosine similarity math, content hash change detection,
 * RRF merge, and graceful error handling.
 */

import { describe, test, expect } from 'vitest';
import {
  cosineSimilarity,
  reciprocalRankFusion,
} from '../../../src/core/read/embeddings.js';

describe('Embeddings Module', () => {
  describe('cosineSimilarity', () => {
    test('identical vectors have similarity 1', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test('orthogonal vectors have similarity 0', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
    });

    test('opposite vectors have similarity -1', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([-1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
    });

    test('handles normalized vectors correctly', () => {
      // Normalize [3, 4] => [0.6, 0.8]
      const a = new Float32Array([0.6, 0.8]);
      const b = new Float32Array([0.6, 0.8]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    test('handles non-normalized vectors', () => {
      const a = new Float32Array([3, 4]);
      const b = new Float32Array([4, 3]);
      // cos(θ) = (3*4 + 4*3) / (5 * 5) = 24/25 = 0.96
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.96, 5);
    });

    test('handles zero vectors gracefully', () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    test('works with high-dimensional vectors (384 dims like MiniLM)', () => {
      const dims = 384;
      const a = new Float32Array(dims);
      const b = new Float32Array(dims);

      // Create two similar but not identical vectors
      for (let i = 0; i < dims; i++) {
        a[i] = Math.sin(i * 0.1);
        b[i] = Math.sin(i * 0.1) + (Math.random() - 0.5) * 0.01;
      }

      const sim = cosineSimilarity(a, b);
      expect(sim).toBeGreaterThan(0.99); // Very similar
      expect(sim).toBeLessThanOrEqual(1.0);
    });

    test('symmetry: sim(a,b) == sim(b,a)', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([4, 5, 6]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
    });
  });

  describe('reciprocalRankFusion', () => {
    test('single list returns RRF scores', () => {
      const list = [
        { path: 'a.md' },
        { path: 'b.md' },
        { path: 'c.md' },
      ];

      const scores = reciprocalRankFusion(list);

      // rank 0 -> 1/(60+1) = 1/61 ≈ 0.01639
      // rank 1 -> 1/(60+2) = 1/62 ≈ 0.01613
      // rank 2 -> 1/(60+3) = 1/63 ≈ 0.01587
      expect(scores.get('a.md')).toBeCloseTo(1 / 61, 5);
      expect(scores.get('b.md')).toBeCloseTo(1 / 62, 5);
      expect(scores.get('c.md')).toBeCloseTo(1 / 63, 5);
    });

    test('two lists merge scores additively', () => {
      const list1 = [
        { path: 'a.md' },
        { path: 'b.md' },
      ];
      const list2 = [
        { path: 'b.md' },
        { path: 'c.md' },
      ];

      const scores = reciprocalRankFusion(list1, list2);

      // a.md: only in list1 rank 0 -> 1/61
      expect(scores.get('a.md')).toBeCloseTo(1 / 61, 5);

      // b.md: list1 rank 1 (1/62) + list2 rank 0 (1/61)
      expect(scores.get('b.md')).toBeCloseTo(1 / 62 + 1 / 61, 5);

      // c.md: only in list2 rank 1 -> 1/62
      expect(scores.get('c.md')).toBeCloseTo(1 / 62, 5);
    });

    test('item in both lists ranks higher than single-list items', () => {
      const list1 = [{ path: 'shared.md' }, { path: 'only1.md' }];
      const list2 = [{ path: 'shared.md' }, { path: 'only2.md' }];

      const scores = reciprocalRankFusion(list1, list2);

      expect(scores.get('shared.md')!).toBeGreaterThan(scores.get('only1.md')!);
      expect(scores.get('shared.md')!).toBeGreaterThan(scores.get('only2.md')!);
    });

    test('empty lists return empty scores', () => {
      const scores = reciprocalRankFusion([], []);
      expect(scores.size).toBe(0);
    });

    test('handles three lists', () => {
      const list1 = [{ path: 'a.md' }];
      const list2 = [{ path: 'a.md' }];
      const list3 = [{ path: 'a.md' }];

      const scores = reciprocalRankFusion(list1, list2, list3);

      // a.md in all three at rank 0: 3 * (1/61)
      expect(scores.get('a.md')).toBeCloseTo(3 / 61, 5);
    });
  });
});
