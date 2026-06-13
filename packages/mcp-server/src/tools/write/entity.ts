/**
 * Entity merged tool
 * Tool: entity
 *
 * Absorbs: list_entities + absorb_as_alias + suggest_entity_aliases + merge_entities
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import type { VaultIndex } from '../../core/read/types.js';
import { getEntityIndexFromDb, getAllEntitiesFromDb, getDismissedMergePairs, recordMergeDismissal } from '@velvetmonkey/vault-core';
import { getInferredCategory } from '../../core/read/embeddings.js';
import { suggestEntityAliases } from '../../core/read/aliasSuggestions.js';
import { validatePathSecure, readVaultFile, writeVaultFile, type LineEnding } from '../../core/write/writer.js';
import type { MutationResult } from '../../core/write/types.js';
import { levenshteinDistance } from '../../core/shared/levenshtein.js';
import { extractAliases, getTitleFromPath } from '../../core/write/noteMove.js';
import { dismissProspect, resolveProspectForAlias } from '../../core/shared/prospects.js';
import { mergeEntities, absorbAlias } from '../../core/write/entityMerge.js';
import path from 'path';

/**
 * Register the entity merged tool with the MCP server
 */
export function registerEntityTool(
  server: McpServer,
  getVaultPath: () => string,
  getStateDb: () => StateDb | null,
  getIndex?: () => VaultIndex,
): void {
  server.tool(
    'entity',
    'Manage vault entities and aliases. action: list — browse by category. alias — add an alternate name. suggest_aliases — find missing aliases. merge — absorb one entity into another and rewire links. suggest_merges — find duplicates. dismiss_merge — mark a merge suggestion incorrect. dismiss_prospect — reject an unresolved prospect term so it stops surfacing as an active stub candidate. Returns lists, results, or candidates. Does not create notes.',
    {
      action: z.enum(['list', 'alias', 'suggest_aliases', 'merge', 'suggest_merges', 'dismiss_merge', 'dismiss_prospect']).describe('Operation to perform'),

      query: z.string().optional().describe('[list] Filter entities by name substring'),
      category: z.string().optional().describe('[list|suggest_aliases] Filter to a specific category'),
      limit: z.number().optional().describe('[list|suggest_aliases|suggest_merges] Maximum results to return'),
      include: z.array(z.enum(['backlink_count', 'recency'])).optional().describe('[list] Extra per-entity aggregates to attach: backlink_count (distinct notes linking to the entity name or any of its aliases) and recency ({ lastMentionedAt, mentionCount } or null). Omitted → lean response. aliases + isSuppressed are always present regardless.'),

      entity: z.string().optional().describe('[alias] Entity path to add alias to; [suggest_aliases] entity to get suggestions for'),
      alias: z.string().optional().describe('[alias] The alias to add'),
      source_name: z.string().optional().describe('[alias] Compatibility form: entity name to absorb as an alias of target_path, rewriting links. [dismiss_merge] Source entity name'),
      target_path: z.string().optional().describe('[alias] Compatibility form: target note path for source_name absorption. [dismiss_merge] Target entity path'),
      dry_run: z.boolean().optional().describe('[alias|merge] Preview the operation without writing: alias absorption or entity merge plan'),

      primary: z.string().optional().describe('[merge] Entity path to keep'),
      secondary: z.string().optional().describe('[merge] Entity path to absorb into primary'),

      source_path: z.string().optional().describe('[dismiss_merge] Source entity path'),
      target_name: z.string().optional().describe('[dismiss_merge] Target entity name'),
      reason: z.string().optional().describe('[dismiss_merge] Reason for the original suggestion'),
      prospect: z.string().optional().describe('[dismiss_prospect] Prospect term or display name to reject'),
      note_path: z.string().optional().describe('[dismiss_prospect] Optional note path that motivated the dismissal'),
    },
    async ({ action, query, category, limit, include, entity, alias, primary, secondary, source_path, target_path, source_name, target_name, reason, dry_run, prospect, note_path }) => {
      const stateDb = getStateDb();

      // ---- action: list ----
      if (action === 'list') {
        if (!stateDb) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
            isError: true,
          };
        }

        const entityIndex = getEntityIndexFromDb(stateDb);
        const perCategoryLimit = limit ?? 200;

        // Build suppression set
        const suppressedSet = new Set<string>(
          (stateDb.db.prepare('SELECT entity FROM wikilink_suppressions').all() as Array<{ entity: string }>)
            .map(r => r.entity.toLowerCase())
        );

        // Annotate entities with suppression status
        const allCategories = Object.keys(entityIndex).filter(k => k !== '_metadata') as string[];
        for (const cat of allCategories) {
          const arr = (entityIndex as any)[cat];
          if (Array.isArray(arr)) {
            for (const ent of arr) {
              ent.isSuppressed = suppressedSet.has(ent.name.toLowerCase());
            }
          }
        }

        // Annotate "other" with inferred categories
        const otherArr = (entityIndex as any).other;
        if (Array.isArray(otherArr)) {
          for (const ent of otherArr) {
            const inferred = getInferredCategory(ent.name);
            if (inferred) {
              ent.inferredCategory = inferred.category;
              ent.inferredConfidence = inferred.confidence;
            }
          }
        }

        // Optional aggregates (each costs one extra query; gated by `include`).
        // aliases + isSuppressed are already attached above unconditionally; these
        // two are opt-in because they scan note_links / recency.
        const includeSet = new Set<string>(include ?? []);

        if (includeSet.has('backlink_count')) {
          // distinct notes linking to each wikilink target string (one GROUP BY,
          // not N+1). target is the link text — match it against entity name AND
          // each alias, lowercased. A note that links both an entity's name and
          // one of its aliases is double-counted; acceptable for a V1 count.
          const rows = stateDb.db.prepare(
            'SELECT lower(target) AS t, COUNT(DISTINCT note_path) AS n FROM note_links GROUP BY lower(target)'
          ).all() as Array<{ t: string; n: number }>;
          const byTarget = new Map<string, number>();
          for (const r of rows) byTarget.set(r.t, r.n);
          for (const cat of allCategories) {
            const arr = (entityIndex as any)[cat];
            if (!Array.isArray(arr)) continue;
            for (const ent of arr) {
              let count = byTarget.get(String(ent.name).toLowerCase()) ?? 0;
              if (Array.isArray(ent.aliases)) {
                for (const a of ent.aliases) count += byTarget.get(String(a).toLowerCase()) ?? 0;
              }
              ent.backlinkCount = count;
            }
          }
        }

        if (includeSet.has('recency')) {
          const rows = stateDb.db.prepare(
            'SELECT entity_name_lower AS k, last_mentioned_at AS at, mention_count AS c FROM recency'
          ).all() as Array<{ k: string; at: number; c: number }>;
          const byName = new Map<string, { lastMentionedAt: number; mentionCount: number }>();
          for (const r of rows) byName.set(r.k, { lastMentionedAt: r.at, mentionCount: r.c });
          for (const cat of allCategories) {
            const arr = (entityIndex as any)[cat];
            if (!Array.isArray(arr)) continue;
            for (const ent of arr) {
              ent.recency = byName.get(String(ent.name).toLowerCase()) ?? null;
            }
          }
        }

        if (includeSet.size > 0) {
          (entityIndex as any)._metadata = {
            ...((entityIndex as any)._metadata ?? {}),
            include: Array.from(includeSet),
          };
        }

        // Filter by category
        if (category) {
          for (const cat of allCategories) {
            if (cat !== category) {
              (entityIndex as any)[cat] = [];
            }
          }
        }

        // Filter by query (name substring match, case-insensitive)
        if (query) {
          const q = query.toLowerCase();
          for (const cat of allCategories) {
            const arr = (entityIndex as any)[cat];
            if (Array.isArray(arr)) {
              (entityIndex as any)[cat] = arr.filter((ent: any) =>
                ent.name?.toLowerCase().includes(q) ||
                (Array.isArray(ent.aliases) && ent.aliases.some((a: string) => a.toLowerCase().includes(q)))
              );
            }
          }
        }

        // Apply per-category limit
        for (const cat of allCategories) {
          const arr = (entityIndex as any)[cat];
          if (Array.isArray(arr) && arr.length > perCategoryLimit) {
            (entityIndex as any)[cat] = arr.slice(0, perCategoryLimit);
          }
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(entityIndex) }],
        };
      }

      // ---- action: suggest_aliases ----
      if (action === 'suggest_aliases') {
        if (!stateDb) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
            isError: true,
          };
        }

        const suggestions = suggestEntityAliases(stateDb, entity || undefined);
        const effectiveLimit = Math.min(limit ?? 20, 50);
        const limited = suggestions.slice(0, effectiveLimit);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ suggestion_count: limited.length, suggestions: limited }, null, 2) }],
        };
      }

      // ---- action: alias ----
      if (action === 'alias') {
        if (source_name || target_path) {
          if (!source_name || !target_path) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'source_name and target_path are both required for alias absorption' }) }],
              isError: true,
            };
          }

          const vaultPath = getVaultPath();
          const result = await absorbAlias(vaultPath, source_name, target_path, dry_run ?? false);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }

        if (!entity) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'entity is required for action: alias' }) }],
            isError: true,
          };
        }
        if (!alias) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'alias is required for action: alias' }) }],
            isError: true,
          };
        }

        const vaultPath = getVaultPath();

        const entityPathValidation = await validatePathSecure(vaultPath, entity);
        if (!entityPathValidation.valid) {
          const result: MutationResult = { success: false, message: `Invalid target path: ${entityPathValidation.reason}`, path: entity };
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }

        let fileData: { content: string; frontmatter: Record<string, unknown>; lineEnding: string; contentHash: string };
        try {
          fileData = await readVaultFile(vaultPath, entity);
        } catch {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `Entity file not found: ${entity}` }) }],
            isError: true,
          };
        }

        const existingAliases = extractAliases(fileData.frontmatter);
        const deduped = new Set(existingAliases);
        const entityTitle = getTitleFromPath(entity);

        if (alias.toLowerCase() !== entityTitle.toLowerCase()) {
          deduped.add(alias);
        }
        fileData.frontmatter.aliases = Array.from(deduped);

        await writeVaultFile(vaultPath, entity, fileData.content, fileData.frontmatter, fileData.lineEnding as LineEnding, fileData.contentHash);

        const resolvedProspects = resolveProspectForAlias(entity, alias);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              entity,
              alias_added: alias,
              all_aliases: Array.from(deduped),
              ...(resolvedProspects.length > 0
                ? {
                    prospect_resolution: {
                      resolved_terms: resolvedProspects,
                      status: 'merged',
                      resolved_entity_path: entity,
                    },
                  }
                : {}),
            }, null, 2),
          }],
        };
      }

      // ---- action: merge ----
      if (action === 'merge') {
        if (!primary) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'primary is required for action: merge' }) }],
            isError: true,
          };
        }
        if (!secondary) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'secondary is required for action: merge' }) }],
            isError: true,
          };
        }

        const vaultPath = getVaultPath();
        const result = await mergeEntities(vaultPath, primary, secondary, dry_run ?? false);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }

      // ---- action: suggest_merges ----
      if (action === 'suggest_merges') {
        if (!stateDb) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ suggestions: [], error: 'StateDb not available' }) }],
          };
        }

        const entities = getAllEntitiesFromDb(stateDb);
        if (entities.length === 0) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ suggestions: [] }) }] };
        }

        const dismissedPairs = getDismissedMergePairs(stateDb);
        const effectiveLimit = limit ?? 50;

        interface MergeSuggestion {
          source: { name: string; path: string; category: string; hubScore: number; aliases: string[] };
          target: { name: string; path: string; category: string; hubScore: number; aliases: string[] };
          reason: string;
          confidence: number;
        }

        function normalizeName(name: string): string {
          return name.toLowerCase().replace(/[.\-_]/g, '').replace(/js$/, '').replace(/ts$/, '');
        }

        const suggestions: MergeSuggestion[] = [];
        const seen = new Set<string>();

        for (let i = 0; i < entities.length; i++) {
          for (let j = i + 1; j < entities.length; j++) {
            const a = entities[i];
            const b = entities[j];
            if (a.path === b.path) continue;
            const pairKey = [a.path, b.path].sort().join('::');
            if (seen.has(pairKey) || dismissedPairs.has(pairKey)) continue;

            const aLower = a.name.toLowerCase();
            const bLower = b.name.toLowerCase();
            const aNorm = normalizeName(a.name);
            const bNorm = normalizeName(b.name);

            let reason2 = '';
            let confidence = 0;

            if (aLower === bLower) {
              reason2 = 'exact name match (case-insensitive)';
              confidence = 0.95;
            } else if (aNorm === bNorm && aNorm.length >= 3) {
              reason2 = 'normalized name match';
              confidence = 0.85;
            } else if (aLower.length >= 3 && bLower.length >= 3) {
              if (aLower.includes(bLower) || bLower.includes(aLower)) {
                const shorter = aLower.length <= bLower.length ? aLower : bLower;
                const longer = aLower.length > bLower.length ? aLower : bLower;
                const ratio = shorter.length / longer.length;
                if (ratio > 0.5) {
                  reason2 = 'substring match';
                  confidence = 0.6 + (ratio * 0.2);
                }
              }
            }

            if (!reason2 && aLower.length >= 4 && bLower.length >= 4) {
              const maxLen = Math.max(aLower.length, bLower.length);
              const dist = levenshteinDistance(aLower, bLower);
              const ratio = dist / maxLen;
              if (ratio < 0.35) {
                reason2 = `similar name (edit distance ${dist})`;
                confidence = 0.5 + (1 - ratio) * 0.4;
              }
            }

            if (!reason2) continue;
            seen.add(pairKey);

            const aHub = a.hubScore ?? 0;
            const bHub = b.hubScore ?? 0;
            let source = a;
            let target = b;
            if (aHub > bHub || (aHub === bHub && a.name.length > b.name.length)) {
              source = b;
              target = a;
            }

            suggestions.push({
              source: { name: source.name, path: source.path, category: source.category, hubScore: source.hubScore ?? 0, aliases: source.aliases ?? [] },
              target: { name: target.name, path: target.path, category: target.category, hubScore: target.hubScore ?? 0, aliases: target.aliases ?? [] },
              reason: reason2,
              confidence,
            });
          }
        }

        suggestions.sort((a, b) => b.confidence - a.confidence);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ suggestions: suggestions.slice(0, effectiveLimit), total_candidates: suggestions.length }, null, 2) }],
        };
      }

      // ---- action: dismiss_merge ----
      if (action === 'dismiss_merge') {
        if (!stateDb) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ dismissed: false, error: 'StateDb not available' }) }],
          };
        }
        if (!source_path || !target_path || !source_name || !target_name || !reason) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'source_path, target_path, source_name, target_name, and reason are required for action: dismiss_merge' }) }],
            isError: true,
          };
        }
        recordMergeDismissal(stateDb, source_path, target_path, source_name, target_name, reason);
        const pairKey = [source_path, target_path].sort().join('::');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ dismissed: true, pair_key: pairKey }) }],
        };
      }

      // ---- action: dismiss_prospect ----
      if (action === 'dismiss_prospect') {
        if (!prospect) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'prospect is required for action: dismiss_prospect' }) }],
            isError: true,
          };
        }

        const dismissed = dismissProspect(prospect, reason ?? null, note_path ?? null);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              dismissed,
              prospect,
              status: dismissed ? 'rejected' : 'not_found',
              ...(reason ? { reason } : {}),
              ...(note_path ? { note_path } : {}),
            }, null, 2),
          }],
          ...(dismissed ? {} : { isError: true }),
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown action: ${action}` }) }],
        isError: true,
      };
    }
  );
}

