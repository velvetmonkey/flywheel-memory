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
import { validatePath, validatePathSecure, readVaultFile, writeVaultFile, WriteConflictError, type LineEnding } from '../../core/write/writer.js';
import type { MutationResult } from '../../core/write/types.js';
import { initializeEntityIndex } from '../../core/write/wikilinks.js';
import { levenshteinDistance } from '../../core/shared/levenshtein.js';
import {
  findBacklinks,
  updateBacklinksInFile,
  extractAliases,
  getTitleFromPath,
  escapeRegex,
} from './move-notes.js';
import { dismissProspect, resolveProspectForAlias } from '../../core/shared/prospects.js';
import fs from 'fs/promises';
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
    'Manage vault entities and aliases. action: list — browse by category. alias — register alternate name (aka/nickname). suggest_aliases — find missing aliases. merge — absorb one entity into another, rewiring all links (deduplicate). suggest_merges — find duplicates. dismiss_merge — mark a suggestion incorrect (not the same entity). dismiss_prospect — reject an unresolved prospect term so it no longer surfaces as an active stub candidate. Returns list, result, or candidates. Does not create notes. e.g. { action:"list", category:"people" } { action:"alias", entity:"people/alice.md", alias:"Ali" }',
    {
      action: z.enum(['list', 'alias', 'suggest_aliases', 'merge', 'suggest_merges', 'dismiss_merge', 'dismiss_prospect']).describe('Operation to perform'),

      query: z.string().optional().describe('[list] Filter entities by name substring'),
      category: z.string().optional().describe('[list|suggest_aliases] Filter to a specific category'),
      limit: z.number().optional().describe('[list|suggest_aliases|suggest_merges] Maximum results to return'),

      entity: z.string().optional().describe('[alias] Entity path to add alias to; [suggest_aliases] entity to get suggestions for'),
      alias: z.string().optional().describe('[alias] The alias to add'),

      primary: z.string().optional().describe('[merge] Entity path to keep'),
      secondary: z.string().optional().describe('[merge] Entity path to absorb into primary'),

      source_path: z.string().optional().describe('[dismiss_merge] Source entity path'),
      target_path: z.string().optional().describe('[dismiss_merge] Target entity path'),
      source_name: z.string().optional().describe('[dismiss_merge] Source entity name'),
      target_name: z.string().optional().describe('[dismiss_merge] Target entity name'),
      reason: z.string().optional().describe('[dismiss_merge] Reason for the original suggestion'),
      prospect: z.string().optional().describe('[dismiss_prospect] Prospect term or display name to reject'),
      note_path: z.string().optional().describe('[dismiss_prospect] Optional note path that motivated the dismissal'),
    },
    async ({ action, query, category, limit, entity, alias, primary, secondary, source_path, target_path, source_name, target_name, reason, prospect, note_path }) => {
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

        const primaryValidation = await validatePathSecure(vaultPath, primary);
        if (!primaryValidation.valid) {
          const result: MutationResult = { success: false, message: `Invalid source path: ${primaryValidation.reason}`, path: primary };
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }
        const secondaryValidation = await validatePathSecure(vaultPath, secondary);
        if (!secondaryValidation.valid) {
          const result: MutationResult = { success: false, message: `Invalid target path: ${secondaryValidation.reason}`, path: secondary };
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }

        // Read secondary (source to absorb)
        let sourceContent: string;
        let sourceFrontmatter: Record<string, unknown>;
        try {
          const source = await readVaultFile(vaultPath, secondary);
          sourceContent = source.content;
          sourceFrontmatter = source.frontmatter;
        } catch {
          const result: MutationResult = { success: false, message: `Secondary file not found: ${secondary}`, path: secondary };
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }

        // Read primary (target to keep)
        let targetContent: string;
        let targetFrontmatter: Record<string, unknown>;
        let targetContentHash: string;
        try {
          const target = await readVaultFile(vaultPath, primary);
          targetContent = target.content;
          targetFrontmatter = target.frontmatter;
          targetContentHash = target.contentHash;
        } catch {
          const result: MutationResult = { success: false, message: `Primary file not found: ${primary}`, path: primary };
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }

        const sourceTitle = getTitleFromPath(secondary);
        const targetTitle = getTitleFromPath(primary);

        // Add source title and aliases to primary's aliases
        const existingAliases = extractAliases(targetFrontmatter);
        const sourceAliases = extractAliases(sourceFrontmatter);
        const allNewAliases = [sourceTitle, ...sourceAliases];
        const deduped = new Set([...existingAliases]);
        for (const a of allNewAliases) {
          if (a.toLowerCase() !== targetTitle.toLowerCase()) {
            deduped.add(a);
          }
        }
        targetFrontmatter.aliases = Array.from(deduped);

        // Append secondary content if non-trivial
        const trimmedSource = sourceContent.trim();
        if (trimmedSource.length > 10) {
          const mergedSection = `\n\n## Merged from ${sourceTitle}\n\n${trimmedSource}`;
          targetContent = targetContent.trimEnd() + mergedSection;
        }

        // Rewire backlinks from secondary → primary
        const allSourceTitles = [sourceTitle, ...sourceAliases];
        const backlinks = await findBacklinks(vaultPath, sourceTitle, sourceAliases);
        let totalBacklinksUpdated = 0;
        const modifiedFiles: string[] = [];

        for (const backlink of backlinks) {
          if (backlink.path === secondary || backlink.path === primary) continue;
          const updateResult = await updateBacklinksInFile(vaultPath, backlink.path, allSourceTitles, targetTitle);
          if (updateResult.updated) {
            totalBacklinksUpdated += updateResult.linksUpdated;
            modifiedFiles.push(backlink.path);
          }
        }

        // Write updated primary
        await writeVaultFile(vaultPath, primary, targetContent, targetFrontmatter, 'LF', targetContentHash);

        // Delete secondary
        await fs.unlink(`${vaultPath}/${secondary}`);

        // Rebuild entity index in background
        initializeEntityIndex(vaultPath).catch(err => {
          console.error(`[Flywheel] Entity cache rebuild failed: ${err}`);
        });

        const previewLines = [
          `Merged: "${sourceTitle}" → "${targetTitle}"`,
          `Aliases added: ${allNewAliases.join(', ')}`,
          `Source content appended: ${trimmedSource.length > 10 ? 'yes' : 'no'}`,
          `Backlinks updated: ${totalBacklinksUpdated}`,
        ];
        if (modifiedFiles.length > 0) {
          previewLines.push(`Files modified: ${modifiedFiles.join(', ')}`);
        }

        const result: MutationResult & { backlinks_updated?: number } = {
          success: true,
          message: `Merged "${sourceTitle}" into "${targetTitle}"`,
          path: primary,
          preview: previewLines.join('\n'),
          backlinks_updated: totalBacklinksUpdated,
        };

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
