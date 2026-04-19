/**
 * Link tool — merged wikilink management tool
 * Absorbs: wikilink_feedback, suggest_wikilinks, get_unlinked_mentions, validate_links, discover_stub_candidates
 *
 * action: suggest       — suggest_wikilinks
 * action: feedback      — wikilink_feedback (record accept/reject)
 * action: unlinked      — unlinked_mentions_report
 * action: validate      — validate_links
 * action: stubs         — discover_stub_candidates
 * action: dashboard     — wikilink_feedback dashboard mode
 * action: unsuppress    — wikilink_feedback unsuppress mode
 * action: timeline      — wikilink_feedback entity_timeline mode
 * action: layer_timeseries — wikilink_feedback layer_timeseries mode
 * action: snapshot_diff — wikilink_feedback snapshot_diff mode
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { resolveTarget } from '../../core/read/graph.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import { suggestRelatedLinks, getCooccurrenceIndex } from '../../core/write/wikilinks.js';
import { countFTS5Mentions } from '../../core/read/fts5.js';
import { detectImplicitEntities, COMMON_ENGLISH_WORDS, isCommonWordEntity } from '@velvetmonkey/vault-core';
import {
  recordFeedback,
  getEntityScoreTimeline,
  getLayerContributionTimeseries,
  getExtendedDashboardData,
  updateSuppressionList,
  suppressEntity,
  unsuppressEntity,
  getSuppressedCount,
  getWeightedEntityStats,
  computePosteriorMean,
  PRIOR_ALPHA,
  PRIOR_BETA,
  SUPPRESSION_MIN_OBSERVATIONS,
  SUPPRESSION_POSTERIOR_THRESHOLD,
  isAiConfigEntity,
  AI_CONFIG_PRIOR_ALPHA,
} from '../../core/write/wikilinkFeedback.js';
import { compareGraphSnapshots } from '../../core/shared/graphSnapshots.js';
import {
  recordProspectSightings,
  refreshProspectSummaries,
  getPromotionCandidates,
  getProspectSampleNotes,
  PROMOTION_THRESHOLD,
  type ProspectSighting,
  type ProspectStatus,
} from '../../core/shared/prospects.js';
import type { ScoredSuggestion } from '../../core/write/types.js';

// ============================================================================
// Entity matching helpers (copied from wikilinks.ts — same logic)
// ============================================================================

interface EntityMatch {
  entity: string;
  start: number;
  end: number;
  target: string;
}

interface ProspectMatch {
  entity: string;
  start: number;
  end: number;
  source: 'dead_link' | 'implicit' | 'both';
  confidence: 'high' | 'medium' | 'low';
  backlink_count?: number;
  pattern?: string;
  ledger_source?: 'implicit' | 'dead_link' | 'high_score';
  ledger_note_count?: number;
  ledger_day_count?: number;
  effective_score?: number;
  promotion_ready?: boolean;
  status?: ProspectStatus;
  resolved_entity_path?: string | null;
}

function findEntityMatches(text: string, entities: Map<string, string>, commonWordKeys: Set<string> = new Set()): EntityMatch[] {
  const matches: EntityMatch[] = [];

  const sortedEntities = Array.from(entities.entries())
    .filter(([name]) => name.length >= 2)
    .sort((a, b) => b[0].length - a[0].length);

  const skipRegions: Array<{ start: number; end: number }> = [];

  const frontmatterRegex = /^---\r?\n[\s\S]*?\r?\n---/;
  let match = frontmatterRegex.exec(text);
  if (match) skipRegions.push({ start: match.index, end: match.index + match[0].length });

  const wikilinkRegex = /\[\[[^\]]+\]\]/g;
  while ((match = wikilinkRegex.exec(text)) !== null) skipRegions.push({ start: match.index, end: match.index + match[0].length });

  const codeBlockRegex = /```[\s\S]*?```|`[^`\n]+`/g;
  while ((match = codeBlockRegex.exec(text)) !== null) skipRegions.push({ start: match.index, end: match.index + match[0].length });

  const urlRegex = /https?:\/\/[^\s)>\]]+/g;
  while ((match = urlRegex.exec(text)) !== null) skipRegions.push({ start: match.index, end: match.index + match[0].length });

  const headingRegex = /^#{1,6}\s.*$/gm;
  while ((match = headingRegex.exec(text)) !== null) skipRegions.push({ start: match.index, end: match.index + match[0].length });

  const footnoteRegex = /^\[\^[^\]]+\]:.*(?:\r?\n(?![\r\n]).*)*$/gm;
  while ((match = footnoteRegex.exec(text)) !== null) skipRegions.push({ start: match.index, end: match.index + match[0].length });

  const htmlCommentRegex = /<!--[\s\S]*?-->/g;
  while ((match = htmlCommentRegex.exec(text)) !== null) skipRegions.push({ start: match.index, end: match.index + match[0].length });

  const htmlTagRegex = /<[a-zA-Z][^>]*>[\s\S]*?<\/[a-zA-Z][^>]*>|<[a-zA-Z][^>]*\/>/g;
  while ((match = htmlTagRegex.exec(text)) !== null) skipRegions.push({ start: match.index, end: match.index + match[0].length });

  const matchedPositions = new Set<number>();

  function shouldSkip(start: number, end: number): boolean {
    for (const region of skipRegions) {
      if (start < region.end && end > region.start) return true;
    }
    for (let i = start; i < end; i++) {
      if (matchedPositions.has(i)) return true;
    }
    return false;
  }

  function markMatched(start: number, end: number): void {
    for (let i = start; i < end; i++) matchedPositions.add(i);
  }

  const textLower = text.toLowerCase();

  for (const [entityName, targetPath] of sortedEntities) {
    const entityLower = entityName.toLowerCase();
    let searchStart = 0;

    while (searchStart < textLower.length) {
      const pos = textLower.indexOf(entityLower, searchStart);
      if (pos === -1) break;

      const end = pos + entityName.length;
      const charBefore = pos > 0 ? text[pos - 1] : ' ';
      const charAfter = end < text.length ? text[end] : ' ';
      const isWordBoundaryBefore = /[\s\n\r.,;:!?()[\]{}'"<>-]/.test(charBefore);
      const isWordBoundaryAfter = /[\s\n\r.,;:!?()[\]{}'"<>-]/.test(charAfter);

      if (isWordBoundaryBefore && isWordBoundaryAfter && !shouldSkip(pos, end)) {
        const originalText = text.substring(pos, end);
        if (commonWordKeys.has(entityLower) && originalText === originalText.toLowerCase()) {
          searchStart = pos + 1;
          continue;
        }
        matches.push({ entity: originalText, start: pos, end, target: targetPath });
        markMatched(pos, end);
      }

      searchStart = pos + 1;
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

function findSimilarEntity(target: string, entities: Map<string, string>): string | undefined {
  const targetLower = target.toLowerCase();
  for (const [name, entityPath] of entities) {
    if (name.startsWith(targetLower) || targetLower.startsWith(name)) return entityPath;
  }
  for (const [name, entityPath] of entities) {
    if (name.includes(targetLower) || targetLower.includes(name)) return entityPath;
  }
  return undefined;
}

// ============================================================================
// Registration
// ============================================================================

export function registerLinkTool(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getStateDb: () => StateDb | null
): void {
  server.registerTool(
    'link',
    {
      title: 'Link',
      description:
        'Wikilink management. action: suggest — suggestions for text. action: feedback — accept/reject. action: unlinked — unlinked mentions. action: validate — broken links. action: stubs — stub candidates. action: dashboard — stats. action: unsuppress/timeline/layer_timeseries/snapshot_diff — advanced analytics. Returns suggestions, reports, or stats. Does not apply wikilinks. e.g. { action:"suggest", text:"Claude is an AI by Anthropic" } { action:"feedback", entity:"Claude", accepted:true }',
      inputSchema: {
        action: z.enum([
          'suggest', 'feedback', 'unlinked', 'validate', 'stubs',
          'dashboard', 'unsuppress', 'timeline', 'layer_timeseries', 'snapshot_diff',
        ]).describe('Operation to perform'),

        text: z.string().optional().describe('[suggest] Text to analyze for wikilink suggestions'),
        note_path: z.string().optional().describe('[suggest|feedback|validate] Vault-relative note path'),
        offset: z.coerce.number().optional().describe('[suggest] Suggestions to skip for pagination'),
        detail: z.boolean().optional().describe('[suggest] Include per-layer score breakdown'),

        entity: z.string().optional().describe('[feedback|unsuppress|timeline] Entity name (required)'),
        accepted: z.boolean().optional().describe('[feedback] Whether the suggestion was accepted (required)'),
        context: z.string().optional().describe('[feedback] Surrounding text context'),
        skip_status_update: z.boolean().optional().describe('[feedback] Skip marking application as removed'),

        typos_only: z.boolean().optional().describe('[validate] Only report broken links with a similar existing note'),
        group_by_target: z.boolean().optional().describe('[validate] Aggregate dead links by target, ranked by frequency'),
        fix: z.boolean().optional().describe('[validate] Reserved for future auto-fix support'),

        limit: z.number().optional().describe('Maximum items to return'),

        min_frequency: z.coerce.number().optional().describe('[stubs] Minimum reference count to include (default 5)'),
        status: z.enum(['prospect', 'entity_created', 'merged', 'rejected', 'all']).optional().describe('[stubs] Prospect lifecycle status filter (default: prospect)'),

        days_back: z.number().optional().describe('[timeline|layer_timeseries] Days to look back (default 30)'),
        granularity: z.enum(['day', 'week']).optional().describe('[layer_timeseries] Time bucket granularity (default: day)'),

        timestamp_before: z.number().optional().describe('[snapshot_diff] Earlier timestamp'),
        timestamp_after: z.number().optional().describe('[snapshot_diff] Later timestamp'),
      },
    },
    async ({
      action,
      text, note_path, offset, detail,
      entity, accepted, context, skip_status_update,
      typos_only, group_by_target,
      limit: rawLimit,
      min_frequency,
      status,
      days_back, granularity,
      timestamp_before, timestamp_after,
    }) => {
      const stateDb = getStateDb();

      // -----------------------------------------------------------------------
      // action: suggest
      // -----------------------------------------------------------------------
      if (action === 'suggest') {
        if (!text) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'text is required for action: suggest' }) }], isError: true };
        }

        const limit = Math.min(rawLimit ?? 50, MAX_LIMIT);
        requireIndex();
        const index = getIndex();

        const commonWordKeys = new Set<string>();
        for (const note of index.notes.values()) {
          if (isCommonWordEntity(note.title)) commonWordKeys.add(note.title.toLowerCase());
          for (const alias of note.aliases) {
            if (isCommonWordEntity(alias)) commonWordKeys.add(alias.toLowerCase());
          }
        }

        const allMatches = findEntityMatches(text, index.entities, commonWordKeys);
        const matches = allMatches.slice(offset ?? 0, (offset ?? 0) + limit);
        const linkedSet = new Set(allMatches.map(m => m.entity.toLowerCase()));

        // Prospect detection
        const prospects: ProspectMatch[] = [];
        const prospectSeen = new Set<string>();

        for (const [target, links] of index.backlinks) {
          if (links.length < 2) continue;
          if (index.entities.has(target.toLowerCase())) continue;
          if (linkedSet.has(target.toLowerCase())) continue;
          if (COMMON_ENGLISH_WORDS.has(target.toLowerCase())) continue;
          if (target.length < 4) continue;

          const targetLower = target.toLowerCase();
          const textLower = text.toLowerCase();
          let searchPos = 0;
          while (searchPos < textLower.length) {
            const pos = textLower.indexOf(targetLower, searchPos);
            if (pos === -1) break;
            const end = pos + target.length;
            const before = pos > 0 ? text[pos - 1] : ' ';
            const after = end < text.length ? text[end] : ' ';
            if (/[\s\n\r.,;:!?()[\]{}'"<>-]/.test(before) && /[\s\n\r.,;:!?()[\]{}'"<>-]/.test(after)) {
              if (!prospectSeen.has(targetLower)) {
                prospectSeen.add(targetLower);
                prospects.push({
                  entity: text.substring(pos, end),
                  start: pos,
                  end,
                  source: 'dead_link',
                  confidence: links.length >= 3 ? 'high' : 'medium',
                  backlink_count: links.length,
                });
              }
              break;
            }
            searchPos = pos + 1;
          }
        }

        const implicit = detectImplicitEntities(text);
        for (const imp of implicit) {
          const impLower = imp.text.toLowerCase();
          if (linkedSet.has(impLower)) continue;
          if (prospectSeen.has(impLower)) {
            const existing = prospects.find(p => p.entity.toLowerCase() === impLower);
            if (existing) { existing.source = 'both'; existing.confidence = 'high'; }
            continue;
          }
          prospectSeen.add(impLower);
          prospects.push({ entity: imp.text, start: imp.start, end: imp.end, source: 'implicit', confidence: 'low' });
        }

        if (note_path && prospects.length > 0) {
          const sightings: ProspectSighting[] = prospects.map(p => ({
            term: p.entity.toLowerCase(),
            displayName: p.entity,
            notePath: note_path,
            source: p.source === 'both' ? 'dead_link' as const : (p.source === 'dead_link' ? 'dead_link' as const : 'implicit' as const),
            confidence: p.confidence,
            backlinkCount: p.backlink_count,
          }));
          recordProspectSightings(sightings);
          const affectedTerms = [...new Set(sightings.map(s => s.term))];
          refreshProspectSummaries(affectedTerms);
        }

        if (stateDb && prospects.length > 0) {
          try {
            for (const prospect of prospects) {
              const row = stateDb.db.prepare(
                'SELECT note_count, day_count, best_source, best_score, promotion_score, last_seen_at, status, resolved_entity_path FROM prospect_summary WHERE term = ?'
              ).get(prospect.entity.toLowerCase()) as {
                note_count: number;
                day_count: number;
                best_source: string;
                best_score: number;
                promotion_score: number;
                last_seen_at: number;
                status: ProspectStatus;
                resolved_entity_path: string | null;
              } | undefined;
              if (row && row.status === 'prospect') {
                prospect.ledger_source = row.best_source as 'implicit' | 'dead_link' | 'high_score';
                prospect.ledger_note_count = row.note_count;
                prospect.ledger_day_count = row.day_count;
                const decay = Math.exp(-(Math.LN2 / 60) * (Date.now() - row.last_seen_at) / (24 * 60 * 60 * 1000));
                const effective = Math.round(row.promotion_score * decay * 10) / 10;
                prospect.effective_score = effective;
                prospect.promotion_ready = effective >= PROMOTION_THRESHOLD;
                prospect.status = row.status;
                prospect.resolved_entity_path = row.resolved_entity_path;
              }
            }
          } catch { /* ledger enrichment unavailable */ }
        }

        type SuggestOutput = {
          input_length: number;
          suggestion_count: number;
          returned_count: number;
          suggestions: EntityMatch[];
          prospects?: ProspectMatch[];
          scored_suggestions?: ScoredSuggestion[];
        };

        const output: SuggestOutput = {
          input_length: text.length,
          suggestion_count: allMatches.length,
          returned_count: matches.length,
          suggestions: matches,
        };

        if (prospects.length > 0) output.prospects = prospects;

        if (detail) {
          const scored = await suggestRelatedLinks(text, { detail: true, maxSuggestions: limit, strictness: 'balanced' });
          if (scored.detailed) {
            if (stateDb) {
              try {
                const weightedStats = getWeightedEntityStats(stateDb);
                const statsMap = new Map(weightedStats.map(s => [s.entity.toLowerCase(), s]));
                for (const suggestion of scored.detailed) {
                  const stat = statsMap.get(suggestion.entity.toLowerCase());
                  if (stat) {
                    const effectiveAlpha = isAiConfigEntity(suggestion.entity) ? AI_CONFIG_PRIOR_ALPHA : PRIOR_ALPHA;
                    const posteriorMean = computePosteriorMean(stat.weightedCorrect, stat.weightedFp, effectiveAlpha);
                    const totalObs = effectiveAlpha + stat.weightedCorrect + PRIOR_BETA + stat.weightedFp;
                    suggestion.suppressionContext = {
                      posteriorMean: Math.round(posteriorMean * 1000) / 1000,
                      totalObservations: Math.round(totalObs * 10) / 10,
                      isSuppressed: totalObs >= SUPPRESSION_MIN_OBSERVATIONS && posteriorMean < SUPPRESSION_POSTERIOR_THRESHOLD,
                      falsePositiveRate: Math.round(stat.weightedFpRate * 1000) / 1000,
                    };
                  }
                }
              } catch { /* suppression stats unavailable */ }
            }
            output.scored_suggestions = scored.detailed;
          }
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }] };
      }

      // -----------------------------------------------------------------------
      // action: feedback
      // -----------------------------------------------------------------------
      if (action === 'feedback') {
        if (!stateDb) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }], isError: true };
        }
        if (!entity || accepted === undefined) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'entity and accepted are required for action: feedback' }) }], isError: true };
        }

        console.error(`[Flywheel] link feedback: entity="${entity}" accepted=${JSON.stringify(accepted)}`);

        try {
          recordFeedback(stateDb, entity, context || '', note_path || '', accepted);
        } catch (e) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Failed to record feedback: ${e instanceof Error ? e.message : String(e)}` }) }], isError: true };
        }

        const rowCount = (stateDb.db.prepare('SELECT COUNT(*) as cnt FROM wikilink_feedback').get() as { cnt: number }).cnt;

        if (!accepted && note_path && !skip_status_update) {
          stateDb.db.prepare(
            `UPDATE wikilink_applications SET status = 'removed' WHERE entity = ? AND note_path = ? COLLATE NOCASE`
          ).run(entity, note_path);
        }

        const suppressionUpdated = updateSuppressionList(stateDb) > 0;
        if (!accepted) suppressEntity(stateDb, entity);

        const result = {
          action: 'feedback',
          reported: { entity, accepted, suppression_updated: suppressionUpdated },
          total_suppressed: getSuppressedCount(stateDb),
          total_feedback_rows: rowCount,
        };

        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }

      // -----------------------------------------------------------------------
      // action: unlinked
      // -----------------------------------------------------------------------
      if (action === 'unlinked') {
        const limit = Math.min(rawLimit ?? 20, 100);
        requireIndex();
        const index = getIndex();

        const linkedCounts = new Map<string, number>();
        for (const note of index.notes.values()) {
          for (const link of note.outlinks) {
            const key = link.target.toLowerCase();
            linkedCounts.set(key, (linkedCounts.get(key) || 0) + 1);
          }
        }

        const results: Array<{
          entity: string;
          path: string;
          total_mentions: number;
          linked_mentions: number;
          unlinked_mentions: number;
        }> = [];

        const seen = new Set<string>();
        for (const [name, entityPath] of index.entities) {
          if (seen.has(entityPath)) continue;
          seen.add(entityPath);

          const totalMentions = countFTS5Mentions(name);
          if (totalMentions === 0) continue;

          const pathKey = entityPath.toLowerCase().replace(/\.md$/, '');
          const linkedByName = linkedCounts.get(name) || 0;
          const linkedByPath = linkedCounts.get(pathKey) || 0;
          const linked = Math.max(linkedByName, linkedByPath);

          const unlinked = Math.max(0, totalMentions - linked - 1);
          if (unlinked <= 0) continue;

          const note = index.notes.get(entityPath);
          const displayName = note?.title || name;

          results.push({ entity: displayName, path: entityPath, total_mentions: totalMentions, linked_mentions: linked, unlinked_mentions: unlinked });
        }

        results.sort((a, b) => b.unlinked_mentions - a.unlinked_mentions);
        const top = results.slice(0, limit);

        const output = {
          total_entities_checked: seen.size,
          entities_with_unlinked: results.length,
          top_entities: top,
        };

        return { content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }] };
      }

      // -----------------------------------------------------------------------
      // action: validate
      // -----------------------------------------------------------------------
      if (action === 'validate') {
        const limit = Math.min(rawLimit ?? 50, MAX_LIMIT);
        requireIndex();
        const index = getIndex();

        type BrokenLink = { source: string; target: string; line: number; suggestion?: string };
        const allBroken: BrokenLink[] = [];
        let totalLinks = 0;
        let validLinks = 0;

        let notesToCheck: string[];
        if (note_path) {
          let resolvedPath = note_path;
          if (!note_path.endsWith('.md')) {
            const resolved = resolveTarget(index, note_path);
            resolvedPath = resolved ?? (note_path + '.md');
          }
          notesToCheck = [resolvedPath];
        } else {
          notesToCheck = Array.from(index.notes.keys());
        }

        for (const sourcePath of notesToCheck) {
          const note = index.notes.get(sourcePath);
          if (!note) continue;
          for (const link of note.outlinks) {
            totalLinks++;
            const resolved = resolveTarget(index, link.target);
            if (resolved) {
              validLinks++;
            } else {
              const suggestion = findSimilarEntity(link.target, index.entities);
              if (typos_only && !suggestion) continue;
              allBroken.push({ source: sourcePath, target: link.target, line: link.line, suggestion });
            }
          }
        }

        if (group_by_target) {
          const targetMap = new Map<string, { count: number; sources: Set<string>; suggestion?: string; displayTarget: string }>();
          for (const broken of allBroken) {
            const key = broken.target.toLowerCase();
            const existing = targetMap.get(key);
            if (existing) {
              existing.count++;
              if (existing.sources.size < 5) existing.sources.add(broken.source);
              if (!existing.suggestion && broken.suggestion) existing.suggestion = broken.suggestion;
            } else {
              targetMap.set(key, { count: 1, sources: new Set([broken.source]), suggestion: broken.suggestion, displayTarget: broken.target });
            }
          }

          const offsetVal = offset ?? 0;
          const targets = Array.from(targetMap.values())
            .map(data => ({
              target: data.displayTarget,
              mention_count: data.count,
              sources: Array.from(data.sources),
              ...(data.suggestion ? { suggestion: data.suggestion } : {}),
            }))
            .sort((a, b) => b.mention_count - a.mention_count)
            .slice(offsetVal, offsetVal + limit);

          return { content: [{ type: 'text' as const, text: JSON.stringify({
            scope: note_path || 'all',
            total_dead_targets: targetMap.size,
            total_broken_links: allBroken.length,
            returned_count: targets.length,
            targets,
          }, null, 2) }] };
        }

        const offsetVal = offset ?? 0;
        const broken = allBroken.slice(offsetVal, offsetVal + limit);

        return { content: [{ type: 'text' as const, text: JSON.stringify({
          scope: note_path || 'all',
          total_links: totalLinks,
          valid_links: validLinks,
          broken_links: allBroken.length,
          returned_count: broken.length,
          broken,
        }, null, 2) }] };
      }

      // -----------------------------------------------------------------------
      // action: stubs
      // -----------------------------------------------------------------------
      if (action === 'stubs') {
        const limit = Math.min(rawLimit ?? 20, 100);
        const minFreq = min_frequency ?? 5;
        const statusFilter = status ?? 'prospect';
        requireIndex();
        const index = getIndex();
        const hasLedgerSummaries = !!stateDb && (() => {
          try {
            const row = stateDb.db.prepare('SELECT COUNT(*) as cnt FROM prospect_summary').get() as { cnt: number };
            return row.cnt > 0;
          } catch {
            return false;
          }
        })();

        const prospectCandidates = getPromotionCandidates(limit * 4, statusFilter);
        if (prospectCandidates.length > 0) {
          const filtered = prospectCandidates
            .filter(c => c.backlinkMax >= minFreq)
            .slice(0, limit)
            .map(c => ({
              term: c.displayName,
              status: c.status,
              resolved_entity_path: c.resolvedEntityPath,
              wikilink_references: c.backlinkMax,
              content_mentions: countFTS5Mentions(c.term),
              sample_notes: getProspectSampleNotes(c.term, 3),
              first_seen_at: c.firstSeenAt,
              last_seen_at: c.lastSeenAt,
              note_count: c.noteCount,
              day_count: c.dayCount,
              effective_score: c.effectiveScore,
              promotion_ready: c.promotionReady,
            }));

          return { content: [{ type: 'text' as const, text: JSON.stringify({
            status: statusFilter,
            total_dead_targets: prospectCandidates.length,
            candidates_above_threshold: filtered.length,
            candidates: filtered,
          }, null, 2) }] };
        }

        if (hasLedgerSummaries || statusFilter !== 'prospect') {
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            status: statusFilter,
            total_dead_targets: 0,
            candidates_above_threshold: 0,
            candidates: [],
          }, null, 2) }] };
        }

        const targetMap = new Map<string, { count: number; sources: Set<string> }>();
        for (const note of index.notes.values()) {
          for (const link of note.outlinks) {
            if (!resolveTarget(index, link.target)) {
              const key = link.target.toLowerCase();
              const existing = targetMap.get(key);
              if (existing) {
                existing.count++;
                if (existing.sources.size < 3) existing.sources.add(note.path);
              } else {
                targetMap.set(key, { count: 1, sources: new Set([note.path]) });
              }
            }
          }
        }

        const candidates = Array.from(targetMap.entries())
          .filter(([, data]) => data.count >= minFreq)
          .map(([target, data]) => ({
            term: target,
            wikilink_references: data.count,
            content_mentions: countFTS5Mentions(target),
            sample_notes: Array.from(data.sources),
          }))
          .sort((a, b) => b.wikilink_references - a.wikilink_references)
          .slice(0, limit);

        return { content: [{ type: 'text' as const, text: JSON.stringify({
          total_dead_targets: targetMap.size,
          candidates_above_threshold: candidates.length,
          candidates,
        }, null, 2) }] };
      }

      // -----------------------------------------------------------------------
      // Remaining actions require stateDb
      // -----------------------------------------------------------------------
      if (!stateDb) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available — database not initialized yet' }) }], isError: true };
      }

      // -----------------------------------------------------------------------
      // action: dashboard
      // -----------------------------------------------------------------------
      if (action === 'dashboard') {
        const dashboard = getExtendedDashboardData(stateDb);
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          action: 'dashboard',
          dashboard,
          total_feedback: dashboard.total_feedback,
          total_suppressed: dashboard.total_suppressed,
        }, null, 2) }] };
      }

      // -----------------------------------------------------------------------
      // action: unsuppress
      // -----------------------------------------------------------------------
      if (action === 'unsuppress') {
        if (!entity) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'entity is required for action: unsuppress' }) }], isError: true };
        }
        const wasRemoved = unsuppressEntity(stateDb, entity);
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          action: 'unsuppress',
          entity,
          was_suppressed: wasRemoved,
          total_suppressed: getSuppressedCount(stateDb),
        }, null, 2) }] };
      }

      // -----------------------------------------------------------------------
      // action: timeline
      // -----------------------------------------------------------------------
      if (action === 'timeline') {
        if (!entity) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'entity is required for action: timeline' }) }] };
        }
        const timeline = getEntityScoreTimeline(stateDb, entity, days_back ?? 30, rawLimit ?? 100);
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          action: 'timeline',
          entity,
          timeline,
          count: timeline.length,
        }, null, 2) }] };
      }

      // -----------------------------------------------------------------------
      // action: layer_timeseries
      // -----------------------------------------------------------------------
      if (action === 'layer_timeseries') {
        const timeseries = getLayerContributionTimeseries(stateDb, granularity ?? 'day', days_back ?? 30);
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          action: 'layer_timeseries',
          granularity: granularity ?? 'day',
          timeseries,
          buckets: timeseries.length,
        }, null, 2) }] };
      }

      // -----------------------------------------------------------------------
      // action: snapshot_diff
      // -----------------------------------------------------------------------
      if (action === 'snapshot_diff') {
        if (!timestamp_before || !timestamp_after) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'timestamp_before and timestamp_after are required for action: snapshot_diff' }) }] };
        }
        const diff = compareGraphSnapshots(stateDb, timestamp_before, timestamp_after);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ action: 'snapshot_diff', diff }, null, 2) }] };
      }

      // Should be unreachable — zod enum guards all actions
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown action: ${action as string}` }) }], isError: true };
    }
  );
}
