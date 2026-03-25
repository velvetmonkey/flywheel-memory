import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(__dirname, '../data/google-10k-english.txt'), 'utf-8');

/**
 * Top ~10K most frequent English words from the Google Web Trillion Word Corpus.
 * Source: https://github.com/first20hours/google-10000-english (public domain)
 *
 * Used to filter single-word aliases that are common English words.
 * Entity NAMES are not affected — only frontmatter aliases.
 */
export const COMMON_ENGLISH_WORDS = new Set(
  raw.split('\n').map(w => w.trim().toLowerCase()).filter(Boolean)
);
