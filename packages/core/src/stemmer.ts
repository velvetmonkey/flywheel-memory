/**
 * Porter Stemmer — extracted to vault-core for use in entity matching.
 *
 * Reduces words to their root forms for morphological matching:
 * - "pipelines" → "pipelin" (matches "pipeline")
 * - "sprinting" → "sprint"  (matches "sprint")
 * - "databases" → "databas" (matches "database")
 *
 * Based on the Porter Stemming Algorithm (1980)
 * https://tartarus.org/martin/PorterStemmer/
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

function hasVowel(word: string, end: number): boolean {
  for (let i = 0; i <= end; i++) {
    if (!isConsonant(word, i)) return true;
  }
  return false;
}

function endsWithDoubleConsonant(word: string, end: number): boolean {
  if (end < 1) return false;
  if (word[end] !== word[end - 1]) return false;
  return isConsonant(word, end);
}

function cvcPattern(word: string, i: number): boolean {
  if (i < 2) return false;
  if (!isConsonant(word, i) || isConsonant(word, i - 1) || !isConsonant(word, i - 2)) {
    return false;
  }
  const c = word[i];
  return c !== 'w' && c !== 'x' && c !== 'y';
}

function replaceSuffix(word: string, suffix: string, replacement: string, minMeasure: number): string {
  if (!word.endsWith(suffix)) return word;
  const s = word.slice(0, word.length - suffix.length);
  if (measure(s, s.length - 1) > minMeasure) {
    return s + replacement;
  }
  return word;
}

function step1a(word: string): string {
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ies')) return word.slice(0, -2);
  if (word.endsWith('ss')) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function step1b(word: string): string {
  if (word.endsWith('eed')) {
    const s = word.slice(0, -3);
    if (measure(s, s.length - 1) > 0) return s + 'ee';
    return word;
  }
  let s = '';
  let didRemove = false;
  if (word.endsWith('ed')) {
    s = word.slice(0, -2);
    if (hasVowel(s, s.length - 1)) { word = s; didRemove = true; }
  } else if (word.endsWith('ing')) {
    s = word.slice(0, -3);
    if (hasVowel(s, s.length - 1)) { word = s; didRemove = true; }
  }
  if (didRemove) {
    if (word.endsWith('at') || word.endsWith('bl') || word.endsWith('iz')) return word + 'e';
    if (endsWithDoubleConsonant(word, word.length - 1)) {
      const c = word[word.length - 1];
      if (c !== 'l' && c !== 's' && c !== 'z') return word.slice(0, -1);
    }
    if (measure(word, word.length - 1) === 1 && cvcPattern(word, word.length - 1)) return word + 'e';
  }
  return word;
}

function step1c(word: string): string {
  if (word.endsWith('y')) {
    const s = word.slice(0, -1);
    if (hasVowel(s, s.length - 1)) return s + 'i';
  }
  return word;
}

function step2(word: string): string {
  const suffixes: [string, string][] = [
    ['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'],
    ['izer', 'ize'], ['abli', 'able'], ['alli', 'al'], ['entli', 'ent'],
    ['eli', 'e'], ['ousli', 'ous'], ['ization', 'ize'], ['ation', 'ate'],
    ['ator', 'ate'], ['alism', 'al'], ['iveness', 'ive'], ['fulness', 'ful'],
    ['ousness', 'ous'], ['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble'],
  ];
  for (const [suffix, replacement] of suffixes) {
    if (word.endsWith(suffix)) return replaceSuffix(word, suffix, replacement, 0);
  }
  return word;
}

function step3(word: string): string {
  const suffixes: [string, string][] = [
    ['icate', 'ic'], ['ative', ''], ['alize', 'al'],
    ['iciti', 'ic'], ['ical', 'ic'], ['ful', ''], ['ness', ''],
  ];
  for (const [suffix, replacement] of suffixes) {
    if (word.endsWith(suffix)) return replaceSuffix(word, suffix, replacement, 0);
  }
  return word;
}

function step4(word: string): string {
  const suffixes = [
    'al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement',
    'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize',
  ];
  for (const suffix of suffixes) {
    if (word.endsWith(suffix)) {
      const s = word.slice(0, word.length - suffix.length);
      if (measure(s, s.length - 1) > 1) {
        if (suffix === 'ion') {
          const lastChar = s[s.length - 1];
          if (lastChar === 's' || lastChar === 't') return s;
        } else {
          return s;
        }
      }
    }
  }
  return word;
}

function step5a(word: string): string {
  if (word.endsWith('e')) {
    const s = word.slice(0, -1);
    const m = measure(s, s.length - 1);
    if (m > 1) return s;
    if (m === 1 && !cvcPattern(s, s.length - 1)) return s;
  }
  return word;
}

function step5b(word: string): string {
  if (word.endsWith('ll')) {
    const s = word.slice(0, -1);
    if (measure(s, s.length - 1) > 1) return s;
  }
  return word;
}

/**
 * Apply Porter Stemming algorithm to reduce a word to its root form.
 *
 * @example
 * stem('pipelines')  // 'pipelin'
 * stem('sprinting')  // 'sprint'
 * stem('databases')  // 'databas'
 */
export function stem(word: string): string {
  word = word.toLowerCase();
  if (word.length < 3) return word;
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
