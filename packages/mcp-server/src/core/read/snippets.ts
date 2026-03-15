/**
 * Paragraph-Level Snippet Extraction
 *
 * Extracts the most relevant paragraph(s) from a note for a given query.
 * Uses keyword overlap for cheap initial scoring, then optionally refines
 * with embedding similarity for the top candidates.
 */

import * as fs from 'fs';
import { embedTextCached, cosineSimilarity, hasEmbeddingsIndex } from './embeddings.js';
import { tokenize, stem } from '../shared/stemmer.js';

// =============================================================================
// Types
// =============================================================================

export interface Snippet {
  text: string;
  score: number;
}

export interface SnippetOptions {
  maxSnippets?: number;     // default 1
  maxChunkChars?: number;   // default 500
}

// =============================================================================
// Helpers
// =============================================================================

/** Strip YAML frontmatter from markdown content. */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---[\s\S]*?---\n([\s\S]*)$/);
  return match ? match[1] : content;
}

/** Split content into paragraphs, merging short ones with successor. */
function splitIntoParagraphs(content: string, maxChunkChars: number): string[] {
  const MIN_PARAGRAPH_CHARS = 50;
  const raw = content.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);

  // Merge short paragraphs with successor
  const merged: string[] = [];
  let buffer = '';
  for (const paragraph of raw) {
    if (buffer) {
      buffer += '\n\n' + paragraph;
      if (buffer.length >= MIN_PARAGRAPH_CHARS) {
        merged.push(buffer.slice(0, maxChunkChars));
        buffer = '';
      }
    } else if (paragraph.length < MIN_PARAGRAPH_CHARS) {
      buffer = paragraph;
    } else {
      merged.push(paragraph.slice(0, maxChunkChars));
    }
  }
  if (buffer) {
    merged.push(buffer.slice(0, maxChunkChars));
  }

  return merged;
}

/** Score a chunk by keyword overlap with query tokens. */
function scoreByKeywords(chunk: string, queryTokens: string[], queryStems: string[]): number {
  const chunkTokens = new Set(tokenize(chunk.toLowerCase()));
  const chunkStems = new Set([...chunkTokens].map(t => stem(t)));

  let score = 0;
  for (let i = 0; i < queryTokens.length; i++) {
    if (chunkTokens.has(queryTokens[i])) {
      score += 10; // exact match
    } else if (chunkStems.has(queryStems[i])) {
      score += 5;  // stem match
    }
  }
  return score;
}

// =============================================================================
// Main Export
// =============================================================================

/**
 * Extract the best snippet(s) from a note file for a given query.
 *
 * Strategy:
 * 1. Read file, strip frontmatter
 * 2. Split into paragraphs (merging short ones)
 * 3. Score by keyword overlap
 * 4. Top 5 keyword matches → embed + re-rank by cosine similarity (if embeddings available)
 * 5. Return top maxSnippets
 *
 * Fallback: if no embeddings, returns best keyword-overlap chunk.
 */
export async function extractBestSnippets(
  filePath: string,
  queryEmbedding: Float32Array | null,
  queryTokens: string[],
  options?: SnippetOptions,
): Promise<Snippet[]> {
  const maxSnippets = options?.maxSnippets ?? 1;
  const maxChunkChars = options?.maxChunkChars ?? 500;

  // Read file
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const body = stripFrontmatter(content);
  if (body.length < 50) {
    // Short note — return entire body
    return body.length > 0 ? [{ text: body, score: 1 }] : [];
  }

  const paragraphs = splitIntoParagraphs(body, maxChunkChars);
  if (paragraphs.length === 0) return [];

  // Pre-compute query stems
  const queryStems = queryTokens.map(t => stem(t));

  // Score all chunks by keyword overlap
  const scored = paragraphs.map((text, idx) => ({
    text,
    idx,
    keywordScore: scoreByKeywords(text, queryTokens, queryStems),
  }));

  // Sort by keyword score descending
  scored.sort((a, b) => b.keywordScore - a.keywordScore);

  // Take top 5 keyword matches for semantic re-ranking
  const topKeyword = scored.slice(0, 5);

  // If we have a query embedding and embeddings are available, re-rank by cosine similarity
  if (queryEmbedding && hasEmbeddingsIndex()) {
    try {
      const reranked: Array<{ text: string; score: number }> = [];
      for (const chunk of topKeyword) {
        const chunkEmbedding = await embedTextCached(chunk.text);
        const sim = cosineSimilarity(queryEmbedding, chunkEmbedding);
        reranked.push({ text: chunk.text, score: sim });
      }
      reranked.sort((a, b) => b.score - a.score);
      return reranked.slice(0, maxSnippets);
    } catch {
      // Fall through to keyword-only
    }
  }

  // Keyword-only fallback
  return topKeyword.slice(0, maxSnippets).map(c => ({
    text: c.text,
    score: c.keywordScore,
  }));
}
