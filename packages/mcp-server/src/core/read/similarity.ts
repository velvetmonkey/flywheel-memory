/**
 * Content Similarity Module
 *
 * Finds notes similar to a given note using FTS5 BM25 scoring.
 * Extracts high-signal terms from a source note, queries notes_fts,
 * and optionally filters out already-linked notes.
 */

import type Database from 'better-sqlite3';
import type { VaultIndex } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import {
  findSemanticallySimilar,
  buildEmbeddingsIndex,
  hasEmbeddingsIndex,
  reciprocalRankFusion,
  type ScoredNote,
} from './embeddings.js';

export interface SimilarNote {
  path: string;
  title: string;
  score: number;
  snippet: string;
}

const STOP_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
  'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there',
  'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get',
  'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no',
  'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your',
  'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then',
  'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first',
  'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
  'give', 'day', 'most', 'us', 'is', 'was', 'are', 'been', 'has',
  'had', 'did', 'being', 'were', 'does', 'done', 'may', 'should',
  'each', 'much', 'need', 'very', 'still', 'between', 'own',
]);

export function extractKeyTerms(content: string, maxTerms: number = 15): string[] {
  // Strip frontmatter
  const bodyMatch = content.match(/^---[\s\S]*?---\n([\s\S]*)$/);
  const body = bodyMatch ? bodyMatch[1] : content;

  // Strip markdown syntax, wikilinks, URLs, code blocks
  const cleaned = body
    .replace(/```[\s\S]*?```/g, '') // code blocks
    .replace(/`[^`]+`/g, '') // inline code
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1') // wikilinks -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // markdown links -> text
    .replace(/https?:\/\/\S+/g, '') // URLs
    .replace(/[#*_~>|=-]+/g, ' ') // markdown formatting
    .replace(/\d+/g, ' '); // numbers

  // Tokenize and count
  const words = cleaned.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const freq = new Map<string, number>();
  for (const w of words) {
    if (STOP_WORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  // Sort by frequency, take top N
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([word]) => word);
}

export function findSimilarNotes(
  db: Database.Database,
  vaultPath: string,
  index: VaultIndex,
  sourcePath: string,
  options: {
    limit?: number;
    excludeLinked?: boolean;
  } = {}
): SimilarNote[] {
  const limit = options.limit ?? 10;

  // Read source note content
  const absPath = path.join(vaultPath, sourcePath);
  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return [];
  }

  // Extract key terms
  const terms = extractKeyTerms(content);
  if (terms.length === 0) return [];

  // Build FTS5 query: OR the terms together
  const query = terms.join(' OR ');

  try {
    const results = db.prepare(`
      SELECT
        path,
        title,
        bm25(notes_fts) as score,
        snippet(notes_fts, 2, '[', ']', '...', 15) as snippet
      FROM notes_fts
      WHERE notes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit + 20) as Array<{
      path: string;
      title: string;
      score: number;
      snippet: string;
    }>;

    // Filter out source note
    let filtered = results.filter(r => r.path !== sourcePath);

    // Optionally filter out already-linked notes
    if (options.excludeLinked) {
      const note = index.notes.get(sourcePath);
      if (note) {
        const linkedPaths = new Set<string>();

        // Forward links
        for (const link of note.outlinks) {
          const resolved = index.entities.get(link.target.toLowerCase());
          if (resolved) linkedPaths.add(resolved);
        }

        // Backlinks
        const normalizedTitle = note.title.toLowerCase();
        const backlinks = index.backlinks.get(normalizedTitle) || [];
        for (const bl of backlinks) {
          linkedPaths.add(bl.source);
        }

        filtered = filtered.filter(r => !linkedPaths.has(r.path));
      }
    }

    return filtered.slice(0, limit).map(r => ({
      path: r.path,
      title: r.title,
      score: Math.round(Math.abs(r.score) * 1000) / 1000,
      snippet: r.snippet,
    }));
  } catch {
    return [];
  }
}

/**
 * Get linked paths for a source note (forward + backlinks).
 * Used to optionally exclude linked notes from similarity results.
 */
function getLinkedPaths(index: VaultIndex, sourcePath: string): Set<string> {
  const linkedPaths = new Set<string>();
  const note = index.notes.get(sourcePath);
  if (!note) return linkedPaths;

  // Forward links
  for (const link of note.outlinks) {
    const resolved = index.entities.get(link.target.toLowerCase());
    if (resolved) linkedPaths.add(resolved);
  }

  // Backlinks
  const normalizedTitle = note.title.toLowerCase();
  const backlinks = index.backlinks.get(normalizedTitle) || [];
  for (const bl of backlinks) {
    linkedPaths.add(bl.source);
  }

  return linkedPaths;
}

/**
 * Find semantically similar notes to a source note.
 */
export async function findSemanticSimilarNotes(
  vaultPath: string,
  index: VaultIndex,
  sourcePath: string,
  options: {
    limit?: number;
    excludeLinked?: boolean;
  } = {}
): Promise<SimilarNote[]> {
  const limit = options.limit ?? 10;

  // Ensure embeddings index is built
  if (!hasEmbeddingsIndex()) {
    await buildEmbeddingsIndex(vaultPath);
  }

  const excludePaths = options.excludeLinked ? getLinkedPaths(index, sourcePath) : undefined;
  const results = await findSemanticallySimilar(sourcePath, limit, excludePaths);

  return results.map(r => ({
    path: r.path,
    title: r.title,
    score: r.score,
    snippet: '', // Semantic results don't have snippets
  }));
}

/**
 * Find similar notes using hybrid BM25 + semantic merge via RRF.
 */
export async function findHybridSimilarNotes(
  db: Database.Database,
  vaultPath: string,
  index: VaultIndex,
  sourcePath: string,
  options: {
    limit?: number;
    excludeLinked?: boolean;
  } = {}
): Promise<SimilarNote[]> {
  const limit = options.limit ?? 10;

  // Get BM25 results
  const bm25Results = findSimilarNotes(db, vaultPath, index, sourcePath, {
    limit: limit * 2,
    excludeLinked: options.excludeLinked,
  });

  // Get semantic results
  let semanticResults: SimilarNote[];
  try {
    semanticResults = await findSemanticSimilarNotes(vaultPath, index, sourcePath, {
      limit: limit * 2,
      excludeLinked: options.excludeLinked,
    });
  } catch {
    // If semantic fails, return BM25 only
    return bm25Results.slice(0, limit);
  }

  // RRF merge
  const rrfScores = reciprocalRankFusion(
    bm25Results.map(r => ({ path: r.path })),
    semanticResults.map(r => ({ path: r.path }))
  );

  // Build merged result set with metadata from both
  const bm25Map = new Map(bm25Results.map(r => [r.path, r]));
  const semanticMap = new Map(semanticResults.map(r => [r.path, r]));
  const allPaths = new Set([...bm25Results.map(r => r.path), ...semanticResults.map(r => r.path)]);

  const merged: SimilarNote[] = Array.from(allPaths).map(p => {
    const bm25 = bm25Map.get(p);
    const semantic = semanticMap.get(p);
    return {
      path: p,
      title: bm25?.title || semantic?.title || p.replace(/\.md$/, '').split('/').pop() || p,
      score: Math.round((rrfScores.get(p) || 0) * 10000) / 10000,
      snippet: bm25?.snippet || '',
    };
  });

  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, limit);
}
