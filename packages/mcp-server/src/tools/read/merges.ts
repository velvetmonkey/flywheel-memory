/**
 * Entity merge suggestions tool
 * Tool: suggest_entity_merges
 *
 * Compares all entities to find likely duplicates based on name similarity.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAllEntitiesFromDb, getDismissedMergePairs, recordMergeDismissal, type StateDb } from '@velvetmonkey/vault-core';
import { levenshteinDistance } from '../../core/shared/levenshtein.js';

interface MergeSuggestion {
  source: { name: string; path: string; category: string; hubScore: number; aliases: string[] };
  target: { name: string; path: string; category: string; hubScore: number; aliases: string[] };
  reason: string;
  confidence: number;
}

/**
 * Normalize a name for comparison: lowercase, strip common suffixes like .js, JS, etc.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.\-_]/g, '')
    .replace(/js$/, '')
    .replace(/ts$/, '');
}

/**
 * Register merge suggestion tools with the MCP server
 */
export function registerMergeTools(
  server: McpServer,
  getStateDb: () => StateDb | null
): void {
  server.tool(
    'suggest_entity_merges',
    'Find potential duplicate entities that could be merged based on name similarity',
    {
      limit: z.number().optional().default(50).describe('Maximum number of suggestions to return'),
    },
    async ({ limit }) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ suggestions: [], error: 'StateDb not available' }) }],
        };
      }

      const entities = getAllEntitiesFromDb(stateDb);
      if (entities.length === 0) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ suggestions: [] }) }],
        };
      }

      // Load dismissed pairs to filter them out
      const dismissedPairs = getDismissedMergePairs(stateDb);

      const suggestions: MergeSuggestion[] = [];
      const seen = new Set<string>();

      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          const a = entities[i];
          const b = entities[j];

          // Skip if same path (exact same entity)
          if (a.path === b.path) continue;

          // Create a canonical pair key to avoid duplicates
          const pairKey = [a.path, b.path].sort().join('::');
          if (seen.has(pairKey)) continue;
          if (dismissedPairs.has(pairKey)) continue;

          const aLower = a.name.toLowerCase();
          const bLower = b.name.toLowerCase();
          const aNorm = normalizeName(a.name);
          const bNorm = normalizeName(b.name);

          let reason = '';
          let confidence = 0;

          // 1. Case-insensitive exact match
          if (aLower === bLower) {
            reason = 'exact name match (case-insensitive)';
            confidence = 0.95;
          }
          // 2. Normalized match (React vs ReactJS vs React.js)
          else if (aNorm === bNorm && aNorm.length >= 3) {
            reason = 'normalized name match';
            confidence = 0.85;
          }
          // 3. One name is substring of the other (min 3 chars)
          else if (aLower.length >= 3 && bLower.length >= 3) {
            if (aLower.includes(bLower) || bLower.includes(aLower)) {
              const shorter = aLower.length <= bLower.length ? aLower : bLower;
              const longer = aLower.length > bLower.length ? aLower : bLower;
              // Only flag if the shorter name is a significant portion of the longer
              const ratio = shorter.length / longer.length;
              if (ratio > 0.5) {
                reason = 'substring match';
                confidence = 0.6 + (ratio * 0.2);
              }
            }
          }

          // 4. Levenshtein distance (typo detection) — only for names of similar length
          if (!reason && aLower.length >= 4 && bLower.length >= 4) {
            const maxLen = Math.max(aLower.length, bLower.length);
            const dist = levenshteinDistance(aLower, bLower);
            const ratio = dist / maxLen;
            if (ratio < 0.35) {
              reason = `similar name (edit distance ${dist})`;
              confidence = 0.5 + (1 - ratio) * 0.4;
            }
          }

          if (!reason) continue;

          seen.add(pairKey);

          // Target selection: higher hubScore becomes target (merge INTO the more connected one)
          // If equal, longer name becomes target (more descriptive)
          const aHub = a.hubScore ?? 0;
          const bHub = b.hubScore ?? 0;
          let source = a;
          let target = b;
          if (aHub > bHub || (aHub === bHub && a.name.length > b.name.length)) {
            source = b;
            target = a;
          }

          suggestions.push({
            source: {
              name: source.name,
              path: source.path,
              category: source.category,
              hubScore: source.hubScore ?? 0,
              aliases: source.aliases ?? [],
            },
            target: {
              name: target.name,
              path: target.path,
              category: target.category,
              hubScore: target.hubScore ?? 0,
              aliases: target.aliases ?? [],
            },
            reason,
            confidence,
          });
        }
      }

      // Sort by confidence descending
      suggestions.sort((a, b) => b.confidence - a.confidence);

      const result = {
        suggestions: suggestions.slice(0, limit),
        total_candidates: suggestions.length,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'dismiss_merge_suggestion',
    'Permanently dismiss a merge suggestion so it never reappears',
    {
      source_path: z.string().describe('Path of the source entity'),
      target_path: z.string().describe('Path of the target entity'),
      source_name: z.string().describe('Name of the source entity'),
      target_name: z.string().describe('Name of the target entity'),
      reason: z.string().describe('Original suggestion reason'),
    },
    async ({ source_path, target_path, source_name, target_name, reason }) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ dismissed: false, error: 'StateDb not available' }) }],
        };
      }

      recordMergeDismissal(stateDb, source_path, target_path, source_name, target_name, reason);
      const pairKey = [source_path, target_path].sort().join('::');

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ dismissed: true, pair_key: pairKey }) }],
      };
    }
  );
}
