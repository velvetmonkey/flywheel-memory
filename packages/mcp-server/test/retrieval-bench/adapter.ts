/**
 * Retrieval Benchmark Adapter
 *
 * Builds a temporary vault from benchmark questions, indexes it,
 * and runs FTS5 retrieval to measure quality metrics.
 */

import * as os from 'os';
import * as path from 'path';
import { mkdir, writeFile, rm } from 'fs/promises';
import { mkdtemp } from 'fs/promises';
import { openStateDb, deleteStateDb } from '@velvetmonkey/vault-core';
import type { StateDb } from '@velvetmonkey/vault-core';
import { buildFTS5Index, searchFTS5, setFTS5Database } from '../../src/core/read/fts5.js';
import { setWriteStateDb } from '../../src/core/write/wikilinks.js';
import { setRecencyStateDb } from '../../src/core/shared/recency.js';

export interface BenchmarkQuestion {
  /** The retrieval query */
  question: string;
  /** Expected answer (for display, not scored) */
  answer: string;
  /** Document titles that contain the answer */
  supporting_docs: string[];
  /** Sentence-level ground truth: [title, sentence_index] */
  supporting_facts?: Array<[string, number]>;
  /** All context documents: [title, sentences_or_paragraphs[]] */
  context: Array<[string, string[]]>;
  /** Question type: bridge (multi-hop) or comparison */
  type: 'bridge' | 'comparison';
  /** Difficulty level */
  level?: 'easy' | 'medium' | 'hard';
}

export interface TempBenchVault {
  vaultPath: string;
  stateDb: StateDb;
  /** Map from document title to note file path */
  docPathMap: Map<string, string>;
  cleanup: () => Promise<void>;
}

/**
 * Build a temporary vault from benchmark questions.
 * Each context document becomes a markdown note.
 */
export async function buildBenchmarkVault(questions: BenchmarkQuestion[]): Promise<TempBenchVault> {
  const vaultPath = await mkdtemp(path.join(os.tmpdir(), 'flywheel-bench-'));
  const docPathMap = new Map<string, string>();

  // Collect unique documents across all questions
  const docs = new Map<string, string[]>();
  for (const q of questions) {
    for (const [title, paragraphs] of q.context) {
      if (!docs.has(title)) {
        docs.set(title, paragraphs);
      }
    }
  }

  // Write each document as a note
  for (const [title, paragraphs] of docs) {
    const safeName = title.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    const filePath = `docs/${safeName}.md`;
    const fullPath = path.join(vaultPath, filePath);

    await mkdir(path.dirname(fullPath), { recursive: true });

    const content = `# ${title}\n\n${paragraphs.join('\n\n')}`;
    await writeFile(fullPath, content, 'utf-8');

    docPathMap.set(title, filePath);
  }

  // Initialize StateDb and FTS5
  const stateDb = openStateDb(vaultPath);
  setWriteStateDb(stateDb);
  setRecencyStateDb(stateDb);
  setFTS5Database(stateDb.db);
  await buildFTS5Index(vaultPath);

  const cleanup = async () => {
    setWriteStateDb(null);
    setRecencyStateDb(null);
    setFTS5Database(null);
    stateDb.close();
    deleteStateDb(vaultPath);
    await rm(vaultPath, { recursive: true, force: true });
  };

  return { vaultPath, stateDb, docPathMap, cleanup };
}

/**
 * Run a single retrieval query against the vault and return ranked note paths.
 * Tokenizes the query for FTS5 compatibility (OR-joined terms).
 */
export function runQuery(vaultPath: string, query: string, maxResults: number = 20): string[] {
  // Convert natural language query to FTS5 query:
  // split into words, filter short/stop words, join with OR
  const words = query.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 3)
    .filter(w => !STOP_WORDS.has(w));

  if (words.length === 0) return [];

  const fts5Query = words.join(' OR ');

  try {
    const results = searchFTS5(vaultPath, fts5Query, maxResults);
    return results.map(r => r.path);
  } catch {
    return [];
  }
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her',
  'was', 'one', 'our', 'out', 'has', 'have', 'been', 'many', 'some', 'them',
  'than', 'its', 'over', 'such', 'that', 'this', 'what', 'with', 'will',
  'each', 'make', 'like', 'from', 'when', 'who', 'which', 'their', 'how',
  'did', 'does', 'more', 'other',
]);
