/**
 * Recall Tool — Unified knowledge retrieval
 *
 * "What do I know about X?" — queries across entities, notes, and memories,
 * ranked by the same scoring signals as the wikilink engine.
 *
 * Tool: recall
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { searchEntities as searchEntitiesDb } from '@velvetmonkey/vault-core';
import type { VaultIndex } from '../../core/read/types.js';
import { searchFTS5 } from '../../core/read/fts5.js';
import { enrichEntityResult, enrichNoteResult } from '../../core/read/enrichment.js';
import { searchMemories } from '../../core/write/memory.js';
import { getRecencyBoost, loadRecencyFromStateDb, type RecencyIndex } from '../../core/shared/recency.js';
import { getCooccurrenceBoost, type CooccurrenceIndex } from '../../core/shared/cooccurrence.js';
import { getEntityEdgeWeightMap } from '../../core/write/edgeWeights.js';
import { getAllFeedbackBoosts } from '../../core/write/wikilinkFeedback.js';
import { findSemanticallySimilarEntities, hasEntityEmbeddingsIndex, hasEmbeddingsIndex, embedTextCached, getEntityEmbedding, loadNoteEmbeddingsForPaths } from '../../core/read/embeddings.js';
import { tokenize, stem } from '../../core/shared/stemmer.js';
import { selectByMmr, type MmrCandidate } from '../../core/read/mmr.js';
import { extractBestSnippets } from '../../core/read/snippets.js';

// =============================================================================
// Types
// =============================================================================

interface RecallResult {
  type: 'entity' | 'note' | 'memory';
  id: string;           // entity name, note path, or memory key
  content: string;       // description, snippet, or memory value
  score: number;
  breakdown: {
    textRelevance: number;
    recencyBoost: number;
    cooccurrenceBoost: number;
    feedbackBoost: number;
    edgeWeightBoost: number;
    semanticBoost: number;
  };
}

// =============================================================================
// Scoring helpers
// =============================================================================

/**
 * Score text relevance between a query and a piece of content.
 * Uses IDF-weighted token matching (same as scoreNameAgainstContent).
 */
function scoreTextRelevance(query: string, content: string): number {
  const queryTokens = tokenize(query).map(t => t.toLowerCase());
  const queryStems = queryTokens.map(t => stem(t));
  const contentLower = content.toLowerCase();
  const contentTokens = new Set(tokenize(contentLower));
  const contentStems = new Set([...contentTokens].map(t => stem(t)));

  let score = 0;
  for (let i = 0; i < queryTokens.length; i++) {
    const token = queryTokens[i];
    const stemmed = queryStems[i];
    if (contentTokens.has(token)) {
      score += 10; // exact match
    } else if (contentStems.has(stemmed)) {
      score += 5;  // stem match
    }
  }

  // Bonus for phrase match
  if (contentLower.includes(query.toLowerCase())) {
    score += 15;
  }

  return score;
}

/**
 * Get edge weight boost for an entity.
 */
function getEdgeWeightBoost(entityName: string, edgeWeightMap: Map<string, number>): number {
  const avgWeight = edgeWeightMap.get(entityName.toLowerCase());
  if (!avgWeight || avgWeight <= 1.0) return 0;
  return Math.min((avgWeight - 1.0) * 3, 6);
}

// =============================================================================
// Core recall logic
// =============================================================================

async function performRecall(
  stateDb: StateDb,
  query: string,
  options: {
    max_results?: number;
    focus?: 'entities' | 'notes' | 'memories';
    entity?: string;
    max_tokens?: number;
    diversity?: number;
    vaultPath?: string;
  } = {},
): Promise<RecallResult[]> {
  const {
    max_results = 20,
    focus,
    entity,
    max_tokens,
    diversity = 0.7,
    vaultPath,
  } = options;

  const results: RecallResult[] = [];

  // Load graph signals once
  const recencyIndex = loadRecencyFromStateDb();
  const edgeWeightMap = getEntityEdgeWeightMap(stateDb);
  const feedbackBoosts = getAllFeedbackBoosts(stateDb);

  // ─── Channel 1: Entity search ───
  if (!focus || focus === 'entities') {
    try {
      const entityResults = searchEntitiesDb(stateDb, query, max_results);
      for (const e of entityResults) {
        const textScore = scoreTextRelevance(query, `${e.name} ${e.description || ''}`);
        const recency = recencyIndex ? getRecencyBoost(e.name, recencyIndex) : 0;
        const feedback = feedbackBoosts.get(e.name) ?? 0;
        const edgeWeight = getEdgeWeightBoost(e.name, edgeWeightMap);

        const total = textScore + recency + feedback + edgeWeight;
        if (total > 0) {
          results.push({
            type: 'entity',
            id: e.name,
            content: e.description || `Entity: ${e.name} (${e.category})`,
            score: total,
            breakdown: {
              textRelevance: textScore,
              recencyBoost: recency,
              cooccurrenceBoost: 0,
              feedbackBoost: feedback,
              edgeWeightBoost: edgeWeight,
              semanticBoost: 0,
            },
          });
        }
      }
    } catch { /* entity search failure is non-fatal */ }
  }

  // ─── Channel 2: Note search (FTS5) ───
  if (!focus || focus === 'notes') {
    try {
      const noteResults = searchFTS5('', query, max_results);
      for (const n of noteResults) {
        const textScore = Math.max(10, scoreTextRelevance(query, `${n.title || ''} ${n.snippet || ''}`));
        results.push({
          type: 'note',
          id: n.path,
          content: n.snippet || n.title || n.path,
          score: textScore,
          breakdown: {
            textRelevance: textScore,
            recencyBoost: 0,
            cooccurrenceBoost: 0,
            feedbackBoost: 0,
            edgeWeightBoost: 0,
            semanticBoost: 0,
          },
        });
      }
    } catch { /* FTS5 search failure is non-fatal */ }
  }

  // ─── Channel 3: Memory search ───
  if (!focus || focus === 'memories') {
    try {
      const memResults = searchMemories(stateDb, {
        query,
        entity,
        limit: max_results,
      });
      for (const m of memResults) {
        const textScore = scoreTextRelevance(query, `${m.key} ${m.value}`);
        const memScore = textScore + (m.confidence * 5); // confidence boost
        results.push({
          type: 'memory',
          id: m.key,
          content: m.value,
          score: memScore,
          breakdown: {
            textRelevance: textScore,
            recencyBoost: 0,
            cooccurrenceBoost: 0,
            feedbackBoost: m.confidence * 5,
            edgeWeightBoost: 0,
            semanticBoost: 0,
          },
        });
      }
    } catch { /* memory search failure is non-fatal */ }
  }

  // ─── Channel 4: Semantic entity search ───
  if ((!focus || focus === 'entities') && query.length >= 20 && hasEntityEmbeddingsIndex()) {
    try {
      const embedding = await embedTextCached(query);
      const semanticMatches = findSemanticallySimilarEntities(embedding, max_results);
      for (const match of semanticMatches) {
        if (match.similarity < 0.3) continue;
        const boost = match.similarity * 15;

        // Check if entity is already in results
        const existing = results.find(r => r.type === 'entity' && r.id === match.entityName);
        if (existing) {
          existing.score += boost;
          existing.breakdown.semanticBoost = boost;
        } else {
          results.push({
            type: 'entity',
            id: match.entityName,
            content: `Semantically similar to: "${query}"`,
            score: boost,
            breakdown: {
              textRelevance: 0,
              recencyBoost: 0,
              cooccurrenceBoost: 0,
              feedbackBoost: 0,
              edgeWeightBoost: 0,
              semanticBoost: boost,
            },
          });
        }
      }
    } catch { /* semantic search failure is non-fatal */ }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Deduplicate (same id + type)
  const seen = new Set<string>();
  const deduped = results.filter(r => {
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ─── MMR diversity filtering ───
  let selected: RecallResult[];
  if (hasEmbeddingsIndex() && deduped.length > max_results) {
    // Build MMR candidates with embeddings
    const notePaths = deduped.filter(r => r.type === 'note').map(r => r.id);
    const noteEmbeddings = loadNoteEmbeddingsForPaths(notePaths);

    // Pre-compute query embedding for memory results
    let queryEmbedding: Float32Array | null = null;

    const mmrCandidates: MmrCandidate[] = [];
    for (const r of deduped) {
      let embedding: Float32Array | null = null;
      if (r.type === 'entity') {
        embedding = getEntityEmbedding(r.id);
      } else if (r.type === 'note') {
        embedding = noteEmbeddings.get(r.id) ?? null;
      } else if (r.type === 'memory') {
        try {
          if (!queryEmbedding) queryEmbedding = await embedTextCached(query);
          embedding = await embedTextCached(r.content);
        } catch { /* embedding failure is non-fatal */ }
      }
      mmrCandidates.push({ id: `${r.type}:${r.id}`, score: r.score, embedding });
    }

    const mmrSelected = selectByMmr(mmrCandidates, max_results, diversity);
    const selectedIds = new Set(mmrSelected.map(m => m.id));
    selected = deduped.filter(r => selectedIds.has(`${r.type}:${r.id}`));

    // Preserve MMR ordering
    const orderMap = new Map(mmrSelected.map((m, i) => [m.id, i]));
    selected.sort((a, b) => (orderMap.get(`${a.type}:${a.id}`) ?? 0) - (orderMap.get(`${b.type}:${b.id}`) ?? 0));
  } else {
    selected = deduped.slice(0, max_results);
  }

  // ─── Snippet extraction for note results ───
  if (vaultPath) {
    const queryTokens = tokenize(query).map(t => t.toLowerCase());
    let queryEmb: Float32Array | null = null;
    if (hasEmbeddingsIndex()) {
      try { queryEmb = await embedTextCached(query); } catch { /* non-fatal */ }
    }

    for (const r of selected) {
      if (r.type !== 'note') continue;
      try {
        const absPath = vaultPath + '/' + r.id;
        const snippets = await extractBestSnippets(absPath, queryEmb, queryTokens);
        if (snippets.length > 0 && snippets[0].text.length > 0) {
          r.content = snippets[0].text;
        }
      } catch { /* snippet failure is non-fatal */ }
    }
  }

  // Token budgeting: if max_tokens specified, truncate content
  if (max_tokens) {
    let tokenBudget = max_tokens;
    const budgeted: RecallResult[] = [];
    for (const r of selected) {
      const estimatedTokens = Math.ceil(r.content.length / 4);
      if (tokenBudget - estimatedTokens < 0 && budgeted.length > 0) break;
      tokenBudget -= estimatedTokens;
      budgeted.push(r);
    }
    return budgeted;
  }

  return selected;
}

// =============================================================================
// Tool Registration
// =============================================================================

export function registerRecallTools(
  server: McpServer,
  getStateDb: () => StateDb | null,
  getVaultPath?: () => string,
  getIndex?: () => VaultIndex | null,
): void {
  server.tool(
    'recall',
    'Query everything the system knows about a topic. Searches across entities, notes, and memories with graph-boosted ranking.',
    {
      query: z.string().describe('What to recall (e.g., "Project X", "meetings about auth")'),
      max_results: z.number().min(1).max(100).optional().describe('Max results (default: 20)'),
      focus: z.enum(['entities', 'notes', 'memories']).optional().describe('Limit to a specific result type. Omit for best results (searches everything).'),
      entity: z.string().optional().describe('Filter memories by entity association'),
      max_tokens: z.number().optional().describe('Token budget for response (truncates lower-ranked results)'),
      diversity: z.number().min(0).max(1).optional().describe('Relevance vs diversity tradeoff (0=max diversity, 1=pure relevance, default: 0.7)'),
    },
    async (args) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
          isError: true,
        };
      }

      const results = await performRecall(stateDb, args.query, {
        max_results: args.max_results,
        focus: args.focus,
        entity: args.entity,
        max_tokens: args.max_tokens,
        diversity: args.diversity,
        vaultPath: getVaultPath?.(),
      });

      // Group by type for structured output
      const entities = results.filter(r => r.type === 'entity');
      const notes = results.filter(r => r.type === 'note');
      const memories = results.filter(r => r.type === 'memory');

      const index = getIndex?.() ?? null;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            query: args.query,
            total: results.length,
            entities: entities.map(e => ({
              name: e.id,
              description: e.content,
              score: Math.round(e.score * 10) / 10,
              breakdown: e.breakdown,
              ...enrichEntityResult(e.id, stateDb, index),
            })),
            notes: notes.map(n => ({
              path: n.id,
              snippet: n.content,
              score: Math.round(n.score * 10) / 10,
              ...enrichNoteResult(n.id, stateDb, index),
            })),
            memories: memories.map(m => ({
              key: m.id,
              value: m.content,
              score: Math.round(m.score * 10) / 10,
            })),
          }, null, 2),
        }],
      };
    }
  );
}
