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
  /** Which ## heading contains this snippet (null if top-level) */
  section?: string;
  /** Normalised relevance confidence 0-1 */
  confidence?: number;
}

export interface SnippetOptions {
  maxSnippets?: number;     // default 1
  maxChunkChars?: number;   // default 800
}

// =============================================================================
// Helpers
// =============================================================================

/** Strip YAML frontmatter from markdown content. */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---[\s\S]*?---\n([\s\S]*)$/);
  return match ? match[1] : content;
}

interface ParagraphInfo {
  text: string;
  section: string | undefined;
}

/** Split content into paragraphs with section heading context. */
function splitIntoParagraphs(content: string, maxChunkChars: number): ParagraphInfo[] {
  const MIN_PARAGRAPH_CHARS = 50;
  const raw = content.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);

  // Track current section heading
  let currentSection: string | undefined;
  const withSections: Array<{ text: string; section: string | undefined }> = [];
  for (const paragraph of raw) {
    const headingMatch = paragraph.match(/^#{1,6}\s+(.+)/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
    }
    withSections.push({ text: paragraph, section: currentSection });
  }

  // Merge short paragraphs with successor
  const merged: ParagraphInfo[] = [];
  let buffer = '';
  let bufferSection: string | undefined;
  for (const { text: paragraph, section } of withSections) {
    if (buffer) {
      buffer += '\n\n' + paragraph;
      if (buffer.length >= MIN_PARAGRAPH_CHARS) {
        merged.push({ text: buffer.slice(0, maxChunkChars), section: bufferSection });
        buffer = '';
      }
    } else if (paragraph.length < MIN_PARAGRAPH_CHARS) {
      buffer = paragraph;
      bufferSection = section;
    } else {
      merged.push({ text: paragraph.slice(0, maxChunkChars), section });
    }
  }
  if (buffer) {
    merged.push({ text: buffer.slice(0, maxChunkChars), section: bufferSection });
  }

  return merged;
}

/** Expand a matched paragraph with surrounding context (±2 paragraphs, capped at 800 chars). */
function expandWindow(paragraphs: ParagraphInfo[], matchIdx: number, maxChars: number = 800): string {
  let result = paragraphs[matchIdx].text;
  let lo = matchIdx;
  let hi = matchIdx;

  // Try to expand up to 2 paragraphs in each direction
  for (let step = 0; step < 2; step++) {
    // Try expanding backward
    if (lo > 0) {
      const candidate = paragraphs[lo - 1].text + '\n\n' + result;
      if (candidate.length <= maxChars) { result = candidate; lo--; }
    }
    // Try expanding forward
    if (hi < paragraphs.length - 1) {
      const candidate = result + '\n\n' + paragraphs[hi + 1].text;
      if (candidate.length <= maxChars) { result = candidate; hi++; }
    }
  }

  return result;
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
  const maxChunkChars = options?.maxChunkChars ?? 800;

  // Read file
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const body = stripFrontmatter(content);
  if (body.length < 50) {
    return body.length > 0 ? [{ text: body, score: 1, confidence: 1 }] : [];
  }

  const paragraphs = splitIntoParagraphs(body, maxChunkChars);
  if (paragraphs.length === 0) return [];

  // Pre-compute query stems
  const queryStems = queryTokens.map(t => stem(t));

  // Score all chunks by keyword overlap
  const scored = paragraphs.map((para, idx) => ({
    ...para,
    idx,
    keywordScore: scoreByKeywords(para.text, queryTokens, queryStems),
  }));

  // Sort by keyword score descending
  scored.sort((a, b) => b.keywordScore - a.keywordScore);

  // Max possible keyword score (all tokens exact match)
  const maxPossibleScore = queryTokens.length * 10;

  // Take top 5 keyword matches for semantic re-ranking
  const topKeyword = scored.slice(0, 5);

  // Build snippet with window expansion, section heading, and confidence
  const buildSnippet = (match: typeof topKeyword[0], score: number): Snippet => ({
    text: expandWindow(paragraphs, match.idx, maxChunkChars),
    score,
    section: match.section,
    confidence: maxPossibleScore > 0 ? Math.min(1, score / maxPossibleScore) : 0,
  });

  // If we have a query embedding and embeddings are available, re-rank by cosine similarity
  if (queryEmbedding && hasEmbeddingsIndex()) {
    try {
      const reranked: Array<{ match: typeof topKeyword[0]; sim: number }> = [];
      for (const chunk of topKeyword) {
        const chunkEmbedding = await embedTextCached(chunk.text);
        const sim = cosineSimilarity(queryEmbedding, chunkEmbedding);
        reranked.push({ match: chunk, sim });
      }
      reranked.sort((a, b) => b.sim - a.sim);
      return reranked.slice(0, maxSnippets).map(r => buildSnippet(r.match, r.sim));
    } catch {
      // Fall through to keyword-only
    }
  }

  // Keyword-only fallback
  return topKeyword.slice(0, maxSnippets).map(c => buildSnippet(c, c.keywordScore));
}
