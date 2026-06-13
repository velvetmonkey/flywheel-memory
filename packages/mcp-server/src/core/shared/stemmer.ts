/**
 * Tokenization + stopword utilities for wikilink/search matching.
 *
 * D3 (arch-review, 2026-06-13): the Porter stemmer implementation that
 * lived here was unified with @velvetmonkey/vault-core's — the two were
 * proven extensionally IDENTICAL (0 diffs across the 10k-word corpus,
 * a 94-word morphology set, and case/short/alphanumeric edge probes;
 * see test/shared/stemmer-canonical.test.ts). This module now re-exports
 * the single canonical stem() and keeps the tokenize layer.
 */

import { STOPWORDS_EN, stem } from '@velvetmonkey/vault-core';

export { stem };

/**
 * Tokenize text into significant words for matching
 *
 * Extracts words that are:
 * - 4+ characters long
 * - Not stopwords
 * - Lowercase
 *
 * @param text - Text to tokenize
 * @returns Array of significant words
 *
 * @example
 * tokenize('Thinking about AI consciousness')
 * // ['thinking', 'about', 'consciousness']
 */
export function tokenize(text: string): string[] {
  // Remove wikilinks and markdown formatting for cleaner tokenization
  const cleanText = text
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1') // Extract wikilink text
    .replace(/[*_`#\[\]()]/g, ' ') // Remove markdown chars
    .toLowerCase();

  // Extract words (3+ chars starting with a letter, not stopwords)
  // Includes alphanumeric tokens like "k8s", "o11y", "p99" for tech alias matching
  const words = cleanText.match(/\b[a-z][a-z0-9]{2,}\b/g) || [];
  return words.filter(word => !STOPWORDS_EN.has(word));
}

/**
 * Tokenize and stem text for matching
 *
 * @param text - Text to process
 * @returns Object with tokens and their stems
 */
export function tokenizeAndStem(text: string): {
  tokens: string[];
  stems: Set<string>;
  tokenSet: Set<string>;
} {
  const tokens = tokenize(text);
  const tokenSet = new Set(tokens);
  const stems = new Set(tokens.map(t => stem(t)));

  return { tokens, stems, tokenSet };
}

/**
 * Check if a word is a stopword
 */
export function isStopword(word: string): boolean {
  return STOPWORDS_EN.has(word.toLowerCase());
}
