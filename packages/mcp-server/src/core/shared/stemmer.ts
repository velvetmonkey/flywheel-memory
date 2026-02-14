/**
 * Porter Stemmer Implementation
 *
 * Reduces words to their root forms for improved matching:
 * - "philosophical" → "philosoph"
 * - "thinking" → "think"
 * - "consciousness" → "conscious"
 * - "deterministic" → "determinist"
 *
 * Based on the Porter Stemming Algorithm (1980)
 * https://tartarus.org/martin/PorterStemmer/
 */

/**
 * Common stopwords to exclude from tokenization
 *
 * Organized by category:
 * - Articles/pronouns/prepositions (basic)
 * - Common verbs (action words that create false matches)
 * - Time words (temporal references)
 * - Generic/filler words (low semantic value)
 * - Descriptive words (qualifiers and modifiers)
 */
const STOPWORDS = new Set([
  // Articles, pronouns, prepositions (basic)
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what',
  'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also',
  'about', 'after', 'before', 'being', 'between', 'into', 'through', 'during',
  'above', 'below', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'any', 'now', 'even', 'much', 'back',

  // Common verbs (critical for reducing false positives)
  // These create matches like "Completed" → "Complete Guide"
  'going', 'went', 'gone', 'come', 'came', 'coming',
  'work', 'worked', 'working', 'works',
  'make', 'made', 'making', 'makes',
  'take', 'took', 'taken', 'taking', 'takes',
  'give', 'gave', 'given', 'giving', 'gives',
  'find', 'found', 'finding', 'finds',
  'know', 'knew', 'known', 'knowing', 'knows',
  'think', 'thought', 'thinking', 'thinks',
  'look', 'looked', 'looking', 'looks',
  'want', 'wanted', 'wanting', 'wants',
  'tell', 'told', 'telling', 'tells',
  'keep', 'kept', 'keeping', 'keeps',
  'start', 'started', 'starting', 'starts',
  'complete', 'completed', 'completing', 'completes',
  'finish', 'finished', 'finishing', 'finishes',
  'begin', 'began', 'begun', 'beginning', 'begins',
  'end', 'ended', 'ending', 'ends',
  'add', 'added', 'adding', 'adds',
  'update', 'updated', 'updating', 'updates',
  'change', 'changed', 'changing', 'changes',
  'remove', 'removed', 'removing', 'removes',
  'fix', 'fixed', 'fixing', 'fixes',
  'create', 'created', 'creating', 'creates',
  'build', 'built', 'building', 'builds',
  'run', 'ran', 'running', 'runs',
  'test', 'tested', 'testing', 'tests',
  'release', 'released', 'releasing', 'releases',
  'use', 'used', 'using', 'uses',
  'get', 'got', 'gotten', 'getting', 'gets',
  'set', 'setting', 'sets',
  'put', 'putting', 'puts',
  'try', 'tried', 'trying', 'tries',
  'move', 'moved', 'moving', 'moves',
  'show', 'showed', 'shown', 'showing', 'shows',
  'help', 'helped', 'helping', 'helps',
  'read', 'reading', 'reads',
  'write', 'wrote', 'written', 'writing', 'writes',
  'call', 'called', 'calling', 'calls',
  'feel', 'felt', 'feeling', 'feels',
  'seem', 'seemed', 'seeming', 'seems',
  'turn', 'turned', 'turning', 'turns',
  'leave', 'left', 'leaving', 'leaves',
  'play', 'played', 'playing', 'plays',
  'hold', 'held', 'holding', 'holds',
  'bring', 'brought', 'bringing', 'brings',
  'happen', 'happened', 'happening', 'happens',
  'include', 'included', 'including', 'includes',
  'continue', 'continued', 'continuing', 'continues',
  'send', 'sent', 'sending', 'sends',
  'receive', 'received', 'receiving', 'receives',
  'follow', 'followed', 'following', 'follows',
  'stop', 'stopped', 'stopping', 'stops',
  'open', 'opened', 'opening', 'opens',
  'close', 'closed', 'closing', 'closes',
  'done', 'doing',

  // Time words
  'today', 'tomorrow', 'yesterday',
  'daily', 'weekly', 'monthly', 'yearly', 'annually',
  'morning', 'afternoon', 'evening', 'night',
  'week', 'month', 'year', 'hour', 'minute', 'second',
  'time', 'date', 'day', 'days', 'weeks', 'months', 'years',
  'currently', 'recently', 'later', 'earlier', 'soon',
  'always', 'never', 'sometimes', 'often', 'usually', 'rarely',

  // Generic/filler words
  'thing', 'things', 'stuff',
  'something', 'anything', 'nothing', 'everything',
  'someone', 'anyone', 'noone', 'everyone',
  'somewhere', 'anywhere', 'nowhere', 'everywhere',
  'good', 'better', 'best', 'great', 'nice', 'okay', 'fine',
  'right', 'wrong', 'bad', 'worse', 'worst',
  'lot', 'lots', 'many', 'several', 'various',
  'different', 'similar', 'another', 'next', 'last',
  'first', 'second', 'third', 'new', 'old',
  'big', 'small', 'large', 'little', 'long', 'short',
  'high', 'low', 'full', 'empty', 'whole', 'part',
  'real', 'true', 'false', 'actual', 'main', 'important',

  // Descriptive/qualifier words
  'really', 'actually', 'basically', 'probably', 'definitely',
  'certainly', 'possibly', 'maybe', 'perhaps',
  'like', 'likely', 'unlikely',
  'almost', 'nearly', 'quite', 'rather', 'pretty',
  'still', 'already', 'yet', 'though', 'although',
  'however', 'therefore', 'thus', 'hence',
  'truly', 'simply', 'easily', 'quickly', 'slowly',
  'well', 'just', 'ever',
  'either', 'neither', 'whether',
  'because', 'since', 'while', 'until', 'unless',
  'except', 'besides', 'anyway', 'otherwise', 'instead',
  'meanwhile', 'furthermore', 'moreover', 'nevertheless',

  // Domain-specific (vault/PKM terms - prevent false matches)
  'note', 'notes', 'page', 'pages', 'vault', 'link', 'links',
  'wikilink', 'wikilinks', 'markdown', 'frontmatter',
  'file', 'files', 'folder', 'folders', 'path', 'paths',
  'section', 'sections', 'heading', 'headings', 'template', 'templates',

  // Task/productivity terms
  'todo', 'todos', 'task', 'tasks', 'pending', 'inbox', 'archive', 'draft',

  // Additional discourse markers
  'nonetheless', 'accordingly', 'alternatively', 'specifically',
  'essentially', 'particularly', 'primarily', 'additionally',
]);

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

  // Extract words (4+ chars, not stopwords)
  const words = cleanText.match(/\b[a-z]{4,}\b/g) || [];
  return words.filter(word => !STOPWORDS.has(word));
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
  return STOPWORDS.has(word.toLowerCase());
}
