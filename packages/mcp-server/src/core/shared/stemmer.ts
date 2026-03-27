import { STOPWORDS_EN } from '@velvetmonkey/vault-core';

/**
 * Check if a character is a consonant
 */
function isConsonant(word: string, i: number): boolean {
  const c = word[i];
  if (c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u') {
    return false;
  }
  if (c === 'y') {
    return i === 0 || !isConsonant(word, i - 1);
  }
  return true;
}

/**
 * Measure the number of consonant sequences between the start and a position
 * (Used in Porter algorithm to determine suffix removal rules)
 */
function measure(word: string, end: number): number {
  let n = 0;
  let i = 0;

  while (i <= end) {
    if (!isConsonant(word, i)) break;
    i++;
  }
  if (i > end) return n;

  i++;
  while (true) {
    while (i <= end) {
      if (isConsonant(word, i)) break;
      i++;
    }
    if (i > end) return n;

    n++;
    i++;

    while (i <= end) {
      if (!isConsonant(word, i)) break;
      i++;
    }
    if (i > end) return n;
    i++;
  }
}

/**
 * Check if the word contains a vowel
 */
function hasVowel(word: string, end: number): boolean {
  for (let i = 0; i <= end; i++) {
    if (!isConsonant(word, i)) return true;
  }
  return false;
}

/**
 * Check if word ends with a double consonant
 */
function endsWithDoubleConsonant(word: string, end: number): boolean {
  if (end < 1) return false;
  if (word[end] !== word[end - 1]) return false;
  return isConsonant(word, end);
}

/**
 * Check if word ends with consonant-vowel-consonant pattern
 * where the final consonant is not w, x, or y
 */
function cvcPattern(word: string, i: number): boolean {
  if (i < 2) return false;
  if (
    !isConsonant(word, i) ||
    isConsonant(word, i - 1) ||
    !isConsonant(word, i - 2)
  ) {
    return false;
  }
  const c = word[i];
  return c !== 'w' && c !== 'x' && c !== 'y';
}

/**
 * Replace suffix if conditions are met
 */
function replaceSuffix(
  word: string,
  suffix: string,
  replacement: string,
  minMeasure: number
): string {
  if (!word.endsWith(suffix)) return word;
  const stem = word.slice(0, word.length - suffix.length);
  if (measure(stem, stem.length - 1) > minMeasure) {
    return stem + replacement;
  }
  return word;
}

/**
 * Porter Stemmer - Step 1a
 * Handle plurals and past participles
 */
function step1a(word: string): string {
  if (word.endsWith('sses')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('ies')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('ss')) {
    return word;
  }
  if (word.endsWith('s')) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Porter Stemmer - Step 1b
 * Handle -ed and -ing endings
 */
function step1b(word: string): string {
  if (word.endsWith('eed')) {
    const stem = word.slice(0, -3);
    if (measure(stem, stem.length - 1) > 0) {
      return stem + 'ee';
    }
    return word;
  }

  let stem = '';
  let didRemove = false;

  if (word.endsWith('ed')) {
    stem = word.slice(0, -2);
    if (hasVowel(stem, stem.length - 1)) {
      word = stem;
      didRemove = true;
    }
  } else if (word.endsWith('ing')) {
    stem = word.slice(0, -3);
    if (hasVowel(stem, stem.length - 1)) {
      word = stem;
      didRemove = true;
    }
  }

  if (didRemove) {
    if (word.endsWith('at') || word.endsWith('bl') || word.endsWith('iz')) {
      return word + 'e';
    }
    if (endsWithDoubleConsonant(word, word.length - 1)) {
      const c = word[word.length - 1];
      if (c !== 'l' && c !== 's' && c !== 'z') {
        return word.slice(0, -1);
      }
    }
    if (measure(word, word.length - 1) === 1 && cvcPattern(word, word.length - 1)) {
      return word + 'e';
    }
  }

  return word;
}

/**
 * Porter Stemmer - Step 1c
 * Handle -y endings
 */
function step1c(word: string): string {
  if (word.endsWith('y')) {
    const stem = word.slice(0, -1);
    if (hasVowel(stem, stem.length - 1)) {
      return stem + 'i';
    }
  }
  return word;
}

/**
 * Porter Stemmer - Step 2
 * Handle common suffixes
 */
function step2(word: string): string {
  const suffixes: [string, string][] = [
    ['ational', 'ate'],
    ['tional', 'tion'],
    ['enci', 'ence'],
    ['anci', 'ance'],
    ['izer', 'ize'],
    ['abli', 'able'],
    ['alli', 'al'],
    ['entli', 'ent'],
    ['eli', 'e'],
    ['ousli', 'ous'],
    ['ization', 'ize'],
    ['ation', 'ate'],
    ['ator', 'ate'],
    ['alism', 'al'],
    ['iveness', 'ive'],
    ['fulness', 'ful'],
    ['ousness', 'ous'],
    ['aliti', 'al'],
    ['iviti', 'ive'],
    ['biliti', 'ble'],
  ];

  for (const [suffix, replacement] of suffixes) {
    if (word.endsWith(suffix)) {
      return replaceSuffix(word, suffix, replacement, 0);
    }
  }
  return word;
}

/**
 * Porter Stemmer - Step 3
 * Handle more suffixes
 */
function step3(word: string): string {
  const suffixes: [string, string][] = [
    ['icate', 'ic'],
    ['ative', ''],
    ['alize', 'al'],
    ['iciti', 'ic'],
    ['ical', 'ic'],
    ['ful', ''],
    ['ness', ''],
  ];

  for (const [suffix, replacement] of suffixes) {
    if (word.endsWith(suffix)) {
      return replaceSuffix(word, suffix, replacement, 0);
    }
  }
  return word;
}

/**
 * Porter Stemmer - Step 4
 * Remove -ant, -ence, etc. if m > 1
 */
function step4(word: string): string {
  const suffixes = [
    'al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement',
    'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize',
  ];

  for (const suffix of suffixes) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, word.length - suffix.length);
      if (measure(stem, stem.length - 1) > 1) {
        // Special handling for 'ion' - must be preceded by s or t
        if (suffix === 'ion') {
          const lastChar = stem[stem.length - 1];
          if (lastChar === 's' || lastChar === 't') {
            return stem;
          }
        } else {
          return stem;
        }
      }
    }
  }
  return word;
}

/**
 * Porter Stemmer - Step 5a
 * Remove trailing 'e' if m > 1, or m = 1 and not *o
 */
function step5a(word: string): string {
  if (word.endsWith('e')) {
    const stem = word.slice(0, -1);
    const m = measure(stem, stem.length - 1);
    if (m > 1) {
      return stem;
    }
    if (m === 1 && !cvcPattern(stem, stem.length - 1)) {
      return stem;
    }
  }
  return word;
}

/**
 * Porter Stemmer - Step 5b
 * Remove double 'l' if m > 1
 */
function step5b(word: string): string {
  if (word.endsWith('ll')) {
    const stem = word.slice(0, -1);
    if (measure(stem, stem.length - 1) > 1) {
      return stem;
    }
  }
  return word;
}

/**
 * Apply Porter Stemming algorithm to reduce a word to its root form
 *
 * @param word - Word to stem (should be lowercase)
 * @returns Stemmed word root
 *
 * @example
 * stem('philosophical') // 'philosoph'
 * stem('thinking') // 'think'
 * stem('consciousness') // 'conscious'
 */
export function stem(word: string): string {
  // Normalize to lowercase
  word = word.toLowerCase();

  // Skip very short words
  if (word.length < 3) {
    return word;
  }

  // Apply all steps
  word = step1a(word);
  word = step1b(word);
  word = step1c(word);
  word = step2(word);
  word = step3(word);
  word = step4(word);
  word = step5a(word);
  word = step5b(word);

  return word;
}

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
