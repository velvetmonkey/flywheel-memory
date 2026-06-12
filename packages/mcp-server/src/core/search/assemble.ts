/**
 * Search result assembly — entity section, snippets, section expansion
 * (arch-review S6). Moved verbatim from tools/read/query.ts.
 */

import type { VaultIndex } from '../read/types.js';
import type { StateDb, EntitySearchResult } from '@velvetmonkey/vault-core';
import {
  hasEmbeddingsIndex,
  embedTextCached,
  findSemanticallySimilarEntities,
  hasEntityEmbeddingsIndex,
} from '../read/embeddings.js';
import { enrichEntityCompact } from '../read/enrichment.js';
import { extractBestSnippets, extractDates } from '../read/snippets.js';
import { tokenize } from '../shared/stemmer.js';
import { getSectionContent } from '../read/noteStructure.js';

/**
 * Build enriched entity section from entity search results.
 * Adds semantic entity search for longer queries when embeddings available.
 * Ported from recall.ts Channel 1 + Channel 4.
 */
export async function buildEntitySection(
  entityResults: EntitySearchResult[],
  query: string,
  stateDb: StateDb | null,
  index: VaultIndex,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  if (!stateDb || entityResults.length === 0 && query.length < 20) return [];

  // Start with FTS5 entity results (keyed by lowercase name for dedup)
  const entityMap = new Map<string, EntitySearchResult>();
  for (const e of entityResults) {
    entityMap.set(e.name.toLowerCase(), e);
  }

  // Channel 4: Semantic entity search (for longer queries)
  if (query.length >= 20 && hasEntityEmbeddingsIndex()) {
    try {
      const embedding = await embedTextCached(query);
      const semanticMatches = findSemanticallySimilarEntities(embedding, limit);
      for (const match of semanticMatches) {
        if (match.similarity < 0.3) continue;
        const key = match.entityName.toLowerCase();
        if (!entityMap.has(key)) {
          entityMap.set(key, {
            id: 0, name: match.entityName, nameLower: key,
            path: '', category: 'unknown' as EntitySearchResult['category'],
            aliases: [], hubScore: 0, rank: 0,
          });
        }
      }
    } catch { /* semantic search failure is non-fatal */ }
  }

  if (entityMap.size === 0) return [];

  // Enrich and return (capped at limit)
  const enriched: Array<Record<string, unknown>> = [];
  let count = 0;
  for (const [, entity] of entityMap) {
    if (count >= limit) break;
    enriched.push({
      name: entity.name,
      ...(entity.description ? { description: entity.description } : {}),
      ...enrichEntityCompact(entity.name, stateDb, index),
    });
    count++;
  }

  return enriched;
}

/**
 * Enhance snippets with semantic + token matching when embeddings are available.
 * Falls back to existing FTS5 snippets when embeddings are not built.
 */
export async function enhanceSnippets(
  results: Array<Record<string, unknown>>,
  query: string,
  vaultPath: string,
): Promise<void> {
  if (!hasEmbeddingsIndex()) return;

  const queryTokens = tokenize(query).map(t => t.toLowerCase());
  let queryEmb: Float32Array | null = null;
  try { queryEmb = await embedTextCached(query); } catch { /* non-fatal */ }

  for (const r of results) {
    if (!r.path) continue;
    try {
      const snippets = await extractBestSnippets(`${vaultPath}/${r.path}`, queryEmb, queryTokens);
      if (snippets.length > 0 && snippets[0].text.length > 0) {
        r.snippet = snippets[0].text;
        if (snippets[0].section) r.section = snippets[0].section;
        if (snippets[0].confidence != null) r.snippet_confidence = Math.round(snippets[0].confidence * 100) / 100;
        // Extract dates from snippet text
        const dates = extractDates(snippets[0].text);
        if (dates.length > 0) r.dates_mentioned = dates;
      }
    } catch { /* non-fatal */ }
  }
}

/**
 * Expand top-N results from snippet to full section content.
 * The snippet is the precision signal (which paragraph matched); the section
 * provides surrounding context so the LLM can reason about the match in context.
 * Requires enhanceSnippets() to have run first (populates r.section).
 */
export async function expandToSections(
  results: Array<Record<string, unknown>>,
  index: VaultIndex,
  vaultPath: string,
  maxExpand: number = 5,
  maxSectionChars: number = 2500,
): Promise<void> {
  const toExpand = results.slice(0, maxExpand);
  for (const r of toExpand) {
    const sectionHeading = r.section as string | undefined;
    const notePath = r.path as string | undefined;
    if (!sectionHeading || !notePath) continue;
    try {
      const section = await getSectionContent(index, notePath, sectionHeading, vaultPath, true);
      if (!section || !section.content) continue;
      const heading = `## ${section.heading}`;
      let content = section.content;
      if (content.length > maxSectionChars) {
        // Truncate at last paragraph boundary within budget
        const truncated = content.slice(0, maxSectionChars);
        const lastBreak = truncated.lastIndexOf('\n\n');
        content = (lastBreak > 0 ? truncated.slice(0, lastBreak) : truncated) + '\n…';
      }
      r.section_content = `${heading}\n\n${content}`;
    } catch { /* non-fatal — disk read failure or missing file */ }
  }
}
