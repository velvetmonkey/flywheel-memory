/**
 * Levenshtein distance and fuzzy matching utilities.
 *
 * Used by the fuzzy_match scoring layer (Layer 3.5) in wikilink suggestion scoring.
 * Two fuzzy paths:
 *   1. Token-level typo matching — individual entity tokens vs content tokens
 *   2. Whole-term collapsed matching — delimiter-normalized multi-token comparison
 */

/**
 * Compute Levenshtein distance between two strings.
 * Returns the minimum number of single-character edits needed.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use single-row optimization: O(min(m,n)) space instead of O(m*n)
  if (a.length > b.length) { const t = a; a = b; b = t; }
  const row = new Uint16Array(a.length + 1);
  for (let j = 0; j <= a.length; j++) row[j] = j;

  for (let i = 1; i <= b.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= a.length; j++) {
      const cur = row[j];
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        row[j] = prev;
      } else {
        row[j] = 1 + Math.min(prev, row[j - 1], row[j]);
      }
      prev = cur;
    }
  }
  return row[a.length];
}

/**
 * Normalize a term for fuzzy comparison: lowercase, strip non-alphanumeric separators.
 * "turbo-pump" → "turbopump", "turbo pump" → "turbopump"
 */
export function normalizeFuzzyTerm(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Compute normalized similarity between two strings.
 * Returns value in [0, 1] where 1 = identical.
 */
export function fuzzySimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Return similarity if it meets the threshold, otherwise 0.
 */
export function fuzzyMatchScore(a: string, b: string, threshold: number): number {
  // Quick length-delta guard: Levenshtein can't be less than the length difference
  if (Math.abs(a.length - b.length) > 2) return 0;
  const sim = fuzzySimilarity(a, b);
  return sim >= threshold ? sim : 0;
}

/** Minimum normalized candidate length for fuzzy matching */
const MIN_FUZZY_LENGTH = 4;
/** Similarity threshold for fuzzy matching */
const FUZZY_THRESHOLD = 0.80;
/** Maximum absolute length delta for fuzzy candidates */
const MAX_LENGTH_DELTA = 2;

/**
 * Find the best fuzzy match for a token against a set of candidates.
 * Returns best similarity above threshold, or 0 if no match.
 *
 * Guards:
 * - candidate length >= MIN_FUZZY_LENGTH
 * - |len(token) - len(candidate)| <= MAX_LENGTH_DELTA
 * - similarity >= FUZZY_THRESHOLD
 */
export function bestFuzzyMatch(token: string, candidates: Set<string> | string[], threshold = FUZZY_THRESHOLD): number {
  if (token.length < MIN_FUZZY_LENGTH) return 0;
  let best = 0;
  for (const candidate of candidates) {
    if (candidate.length < MIN_FUZZY_LENGTH) continue;
    if (Math.abs(token.length - candidate.length) > MAX_LENGTH_DELTA) continue;
    const sim = fuzzySimilarity(token, candidate);
    if (sim >= threshold && sim > best) {
      best = sim;
    }
  }
  return best;
}

/**
 * Build a set of collapsed content terms from an ordered token stream.
 * Generates adjacent windows of 1-3 tokens, normalized (joined, lowercased, non-alpha stripped).
 * This makes "turbo pump", "turbo-pump", and "turbopump" comparable.
 */
export function buildCollapsedContentTerms(tokens: string[]): Set<string> {
  const terms = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    let collapsed = tokens[i];
    terms.add(collapsed);
    if (i + 1 < tokens.length) {
      collapsed += tokens[i + 1];
      terms.add(collapsed);
    }
    if (i + 2 < tokens.length) {
      collapsed += tokens[i + 2];
      terms.add(collapsed);
    }
  }
  return terms;
}

/**
 * Score fuzzy match for an entity name against note content.
 *
 * Path 1 (token-level): For each entity token with no exact/stem match,
 *   find best fuzzy match against content tokens.
 * Path 2 (whole-term collapsed): If the entity got zero hits from exact/stem/token-fuzzy,
 *   compare collapsed entity term against collapsed content terms.
 *
 * Returns { fuzzyScore, fuzzyMatchedWords, isWholeTermMatch }
 */
export function scoreFuzzyMatch(
  entityTokens: string[],
  unmatchedTokenIndices: number[],
  contentTokens: Set<string>,
  collapsedContentTerms: Set<string>,
  entityName: string,
  fuzzyMatchBonus: number,
  tokenIdfFn: (token: string) => number,
  tokenFuzzyCache: Map<string, number>,
): { fuzzyScore: number; fuzzyMatchedWords: number; isWholeTermMatch: boolean } {
  // Skip acronyms and very short entity names entirely
  if (entityName.length <= 3 || entityName === entityName.toUpperCase()) {
    return { fuzzyScore: 0, fuzzyMatchedWords: 0, isWholeTermMatch: false };
  }

  let fuzzyScore = 0;
  let fuzzyMatchedWords = 0;

  // Path 1: Token-level typo matching for unmatched tokens
  for (const idx of unmatchedTokenIndices) {
    const token = entityTokens[idx];
    if (token.length < MIN_FUZZY_LENGTH) continue;

    let sim: number;
    if (tokenFuzzyCache.has(token)) {
      sim = tokenFuzzyCache.get(token)!;
    } else {
      sim = bestFuzzyMatch(token, contentTokens, FUZZY_THRESHOLD);
      tokenFuzzyCache.set(token, sim);
    }

    if (sim > 0) {
      const idf = tokenIdfFn(token);
      fuzzyScore += fuzzyMatchBonus * idf * sim;
      fuzzyMatchedWords++;
    }
  }

  // Path 2: Whole-term collapsed matching — only if zero lexical hits at all
  if (fuzzyMatchedWords === 0 && unmatchedTokenIndices.length === entityTokens.length) {
    const collapsedEntity = normalizeFuzzyTerm(entityName);
    if (collapsedEntity.length >= MIN_FUZZY_LENGTH) {
      const sim = bestFuzzyMatch(collapsedEntity, collapsedContentTerms, FUZZY_THRESHOLD);
      if (sim > 0) {
        // Contribution: fuzzyMatchBonus * similarity * sum(tokenIdf)
        let idfSum = 0;
        for (const token of entityTokens) idfSum += tokenIdfFn(token);
        fuzzyScore = fuzzyMatchBonus * sim * idfSum;
        // On whole-term match, count all tokens as matched so match-ratio checks pass
        fuzzyMatchedWords = entityTokens.length;
        return { fuzzyScore: Math.round(fuzzyScore * 10) / 10, fuzzyMatchedWords, isWholeTermMatch: true };
      }
    }
  }

  return { fuzzyScore: Math.round(fuzzyScore * 10) / 10, fuzzyMatchedWords, isWholeTermMatch: false };
}
