import { describe, it, expect } from 'vitest';
import {
  levenshteinDistance,
  normalizeFuzzyTerm,
  fuzzySimilarity,
  fuzzyMatchScore,
  bestFuzzyMatch,
  buildCollapsedContentTerms,
  scoreFuzzyMatch,
} from '../../src/core/shared/levenshtein.js';

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns length for empty comparisons', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('computes correct distance for single edits', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1); // substitution
    expect(levenshteinDistance('cat', 'cats')).toBe(1); // insertion
    expect(levenshteinDistance('cats', 'cat')).toBe(1); // deletion
  });

  it('handles multi-edit distances', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('normalizeFuzzyTerm', () => {
  it('lowercases and strips non-alphanumeric separators', () => {
    expect(normalizeFuzzyTerm('Turbo-Pump')).toBe('turbopump');
    expect(normalizeFuzzyTerm('turbo pump')).toBe('turbopump');
    expect(normalizeFuzzyTerm('TurboPump')).toBe('turbopump');
    expect(normalizeFuzzyTerm('hello_world')).toBe('helloworld');
  });
});

describe('fuzzySimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(fuzzySimilarity('hello', 'hello')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(fuzzySimilarity('a', 'z')).toBe(0);
  });

  it('returns correct similarity for close strings', () => {
    // fartimus vs fartmus: distance=1, maxLen=8 → 1 - 1/8 = 0.875
    const sim = fuzzySimilarity('fartimus', 'fartmus');
    expect(sim).toBeCloseTo(0.875, 2);
  });
});

describe('fuzzyMatchScore', () => {
  it('returns similarity when above threshold', () => {
    const score = fuzzyMatchScore('fartimus', 'fartmus', 0.80);
    expect(score).toBeCloseTo(0.875, 2);
  });

  it('returns 0 when below threshold', () => {
    const score = fuzzyMatchScore('hello', 'world', 0.80);
    expect(score).toBe(0);
  });

  it('rejects length delta > 2', () => {
    const score = fuzzyMatchScore('abc', 'abcdefg', 0.50);
    expect(score).toBe(0);
  });
});

describe('bestFuzzyMatch', () => {
  it('finds best match above threshold from candidates', () => {
    const candidates = new Set(['fartmus', 'hello', 'world', 'fartimus']);
    const best = bestFuzzyMatch('fartimus', candidates, 0.80);
    expect(best).toBe(1); // exact match in candidates
  });

  it('returns 0 when token is too short', () => {
    const candidates = new Set(['api', 'app', 'apt']);
    expect(bestFuzzyMatch('api', candidates, 0.80)).toBe(0);
  });

  it('skips candidates shorter than 4 chars', () => {
    const candidates = new Set(['api', 'xyz']);
    expect(bestFuzzyMatch('apis', candidates, 0.80)).toBe(0);
  });

  it('returns 0 when no candidates match', () => {
    const candidates = new Set(['completely', 'different', 'words']);
    expect(bestFuzzyMatch('fartimus', candidates, 0.80)).toBe(0);
  });
});

describe('buildCollapsedContentTerms', () => {
  it('builds 1/2/3-token windows', () => {
    const terms = buildCollapsedContentTerms(['turbo', 'pump', 'test']);
    expect(terms.has('turbo')).toBe(true);
    expect(terms.has('turbopump')).toBe(true);
    expect(terms.has('turbopumptest')).toBe(true);
    expect(terms.has('pump')).toBe(true);
    expect(terms.has('pumptest')).toBe(true);
    expect(terms.has('test')).toBe(true);
  });

  it('handles single token', () => {
    const terms = buildCollapsedContentTerms(['hello']);
    expect(terms.size).toBe(1);
    expect(terms.has('hello')).toBe(true);
  });

  it('handles empty input', () => {
    const terms = buildCollapsedContentTerms([]);
    expect(terms.size).toBe(0);
  });
});

describe('scoreFuzzyMatch', () => {
  const idfFn = () => 1.0;
  const cache = new Map<string, number>();

  it('rejects acronyms (all uppercase)', () => {
    const result = scoreFuzzyMatch(
      ['api'], [0], new Set(['apis']), new Set(), 'API', 4, idfFn, cache,
    );
    expect(result.fuzzyScore).toBe(0);
  });

  it('rejects very short entity names', () => {
    const result = scoreFuzzyMatch(
      ['go'], [0], new Set(['god']), new Set(), 'Go', 4, idfFn, cache,
    );
    expect(result.fuzzyScore).toBe(0);
  });

  it('matches token-level typos for unmatched tokens', () => {
    const cache2 = new Map<string, number>();
    const result = scoreFuzzyMatch(
      ['fartimus'], [0], new Set(['fartmus', 'hello', 'world']), new Set(), 'Fartimus', 4, idfFn, cache2,
    );
    expect(result.fuzzyScore).toBeGreaterThan(0);
    expect(result.fuzzyMatchedWords).toBe(1);
    expect(result.isWholeTermMatch).toBe(false);
  });

  it('does whole-term collapsed match when all tokens unmatched', () => {
    const cache2 = new Map<string, number>();
    const collapsedTerms = buildCollapsedContentTerms(['turbo', 'pump']);
    const result = scoreFuzzyMatch(
      ['turbopump'], [0], new Set(['turbo', 'pump']), collapsedTerms, 'TurboPump', 4, idfFn, cache2,
    );
    // "turbopump" should match collapsed "turbopump" from the content terms
    expect(result.fuzzyScore).toBeGreaterThan(0);
    expect(result.isWholeTermMatch).toBe(true);
    expect(result.fuzzyMatchedWords).toBe(1); // all tokens counted as matched
  });

  it('uses cache for repeated token lookups', () => {
    const cache2 = new Map<string, number>();
    const contentTokens = new Set(['fartmus', 'hello']);

    scoreFuzzyMatch(['fartimus'], [0], contentTokens, new Set(), 'Fartimus', 4, idfFn, cache2);
    expect(cache2.has('fartimus')).toBe(true);

    // Second call should use cache
    const result2 = scoreFuzzyMatch(['fartimus'], [0], contentTokens, new Set(), 'Fartimus', 4, idfFn, cache2);
    expect(result2.fuzzyScore).toBeGreaterThan(0);
  });
});
