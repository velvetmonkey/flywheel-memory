/**
 * Brief Tool — Context Assembly
 *
 * Assembles startup context for agents: session summaries, active entities,
 * active memories, pending corrections, vault pulse.
 *
 * Tool: brief
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { getRecentSessionSummaries, listMemories, findContradictions } from '../../core/write/memory.js';
import { getSessionHistory } from '../../core/shared/toolTracking.js';
import { listCorrections } from '../../core/write/corrections.js';
import { getProactiveLinkingSummary } from '../../core/shared/proactiveLinkingStats.js';

// =============================================================================
// Section builders
// =============================================================================

interface BriefSection {
  name: string;
  priority: number;  // lower = higher priority (truncated last)
  content: unknown;
  estimated_tokens: number;
}

/**
 * Estimate token count for a JSON-serializable value.
 */
function estimateTokens(value: unknown): number {
  const str = JSON.stringify(value);
  return Math.ceil(str.length / 4);
}

/**
 * Build session summaries section.
 */
function buildSessionSection(stateDb: StateDb, limit: number): BriefSection {
  // Try agent-generated summaries first
  const summaries = getRecentSessionSummaries(stateDb, limit);

  if (summaries.length > 0) {
    const content = summaries.map(s => ({
      session_id: s.session_id,
      summary: s.summary,
      topics: s.topics_json ? JSON.parse(s.topics_json) : [],
      ended_at: s.ended_at,
      tool_count: s.tool_count,
    }));
    return {
      name: 'recent_sessions',
      priority: 1,
      content,
      estimated_tokens: estimateTokens(content),
    };
  }

  // Fall back to tool invocation groups
  const sessions = getSessionHistory(stateDb);
  const recentSessions = sessions.slice(0, limit);
  if (recentSessions.length === 0) {
    return { name: 'recent_sessions', priority: 1, content: [], estimated_tokens: 0 };
  }

  const content = recentSessions.map(s => ({
    session_id: s.session_id,
    started_at: s.started_at,
    last_activity: s.last_activity,
    tool_count: s.tool_count,
    tools_used: s.unique_tools,
  }));
  return {
    name: 'recent_sessions',
    priority: 1,
    content,
    estimated_tokens: estimateTokens(content),
  };
}

/**
 * Build active entities section (top by recency).
 */
function buildActiveEntitiesSection(stateDb: StateDb, limit: number): BriefSection {
  const rows = stateDb.db.prepare(`
    SELECT r.entity_name_lower, r.last_mentioned_at, r.mention_count,
           e.name, e.category, e.description
    FROM recency r
    LEFT JOIN entities e ON e.name_lower = r.entity_name_lower
    ORDER BY r.last_mentioned_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    entity_name_lower: string;
    last_mentioned_at: number;
    mention_count: number;
    name: string | null;
    category: string | null;
    description: string | null;
  }>;

  const content = rows.map(r => ({
    name: r.name || r.entity_name_lower,
    category: r.category,
    description: r.description,
    last_mentioned: r.last_mentioned_at,
    mentions: r.mention_count,
  }));

  return {
    name: 'active_entities',
    priority: 2,
    content,
    estimated_tokens: estimateTokens(content),
  };
}

/**
 * Build active memories section.
 * Orders by type: recent observations first, then facts/preferences by confidence, then summaries.
 */
function buildActiveMemoriesSection(stateDb: StateDb, limit: number): BriefSection {
  // Fetch more than limit so we can reorder by type group, then truncate
  const memories = listMemories(stateDb, { limit: limit * 2 });

  const observations = memories.filter(m => m.memory_type === 'observation');
  const factsAndPrefs = memories.filter(m => m.memory_type === 'fact' || m.memory_type === 'preference');
  const summaries = memories.filter(m => m.memory_type === 'summary');

  // Observations by recency (already sorted by updated_at DESC from listMemories)
  // Facts/preferences by confidence descending
  factsAndPrefs.sort((a, b) => b.confidence - a.confidence);

  const ordered = [...observations, ...factsAndPrefs, ...summaries].slice(0, limit);

  const content = ordered.map(m => ({
    key: m.key,
    value: m.value,
    type: m.memory_type,
    entity: m.entity,
    confidence: m.confidence,
    updated_at: m.updated_at,
  }));

  return {
    name: 'active_memories',
    priority: 3,
    content,
    estimated_tokens: estimateTokens(content),
  };
}

/**
 * Build pending corrections section.
 */
function buildCorrectionsSection(stateDb: StateDb, limit: number): BriefSection {
  const corrections = listCorrections(stateDb, 'pending', undefined, limit);
  const content = corrections.map(c => ({
    id: c.id,
    type: c.correction_type,
    description: c.description,
    entity: c.entity,
    created_at: c.created_at,
  }));

  return {
    name: 'pending_corrections',
    priority: 4,
    content,
    estimated_tokens: estimateTokens(content),
  };
}

/**
 * Build vault pulse section (recent activity stats).
 */
function buildVaultPulseSection(stateDb: StateDb): BriefSection {
  const now = Date.now();
  const day = 86400000;

  // Recent note modifications (from tool_invocations)
  const recentToolCount = (stateDb.db.prepare(
    'SELECT COUNT(*) as cnt FROM tool_invocations WHERE timestamp > ?'
  ).get(now - day) as { cnt: number }).cnt;

  // Entity count
  const entityCount = (stateDb.db.prepare(
    'SELECT COUNT(*) as cnt FROM entities'
  ).get() as { cnt: number }).cnt;

  // Memory count
  const memoryCount = (stateDb.db.prepare(
    'SELECT COUNT(*) as cnt FROM memories WHERE superseded_by IS NULL'
  ).get() as { cnt: number }).cnt;

  // Note count (from FTS5)
  let noteCount = 0;
  try {
    noteCount = (stateDb.db.prepare(
      'SELECT COUNT(*) as cnt FROM notes_fts'
    ).get() as { cnt: number }).cnt;
  } catch { /* FTS5 not built yet */ }

  // Contradictions
  const contradictions = findContradictions(stateDb);

  const content = {
    notes: noteCount,
    entities: entityCount,
    memories: memoryCount,
    tool_calls_24h: recentToolCount,
    contradictions: contradictions.length,
  };

  return {
    name: 'vault_pulse',
    priority: 5,
    content,
    estimated_tokens: estimateTokens(content),
  };
}

function buildProactiveLinkingSection(stateDb: StateDb): BriefSection | null {
  const summary = getProactiveLinkingSummary(stateDb, 1);
  if (summary.total_applied === 0) return null;

  const content = {
    summary: `${summary.total_applied} ${summary.total_applied === 1 ? 'link' : 'links'} applied across ${summary.files_touched} ${summary.files_touched === 1 ? 'note' : 'notes'} (${summary.survived} survived, ${summary.survival_rate !== null ? Math.round(summary.survival_rate * 100) + '%' : 'n/a'} rate)`,
    total_applied_24h: summary.total_applied,
    survived_24h: summary.survived,
    removed_24h: summary.removed,
    files_24h: summary.files_touched,
    recent: summary.recent,
  };

  return {
    name: 'proactive_linking',
    priority: 6,
    content,
    estimated_tokens: estimateTokens(content),
  };
}

// =============================================================================
// Tool Registration
// =============================================================================

export function registerBriefTools(
  server: McpServer,
  getStateDb: () => StateDb | null,
): void {
  server.tool(
    'brief',
    'Use at conversation start for session context. Produces a startup briefing with recent sessions, active entities, stored memories, pending corrections, and vault stats. Returns a compact context payload. Does not search or read individual notes — use search to find specific content.',
    {
      max_tokens: z.number().optional().describe('Token budget (lower-priority sections truncated first)'),
      focus: z.string().optional().describe('Focus entity or topic (filters content)'),
    },
    async (args) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
          isError: true,
        };
      }

      const sections: BriefSection[] = [
        buildSessionSection(stateDb, 5),
        buildActiveEntitiesSection(stateDb, 10),
        buildActiveMemoriesSection(stateDb, 20),
        buildCorrectionsSection(stateDb, 10),
        buildVaultPulseSection(stateDb),
        buildProactiveLinkingSection(stateDb),
      ].filter((s): s is BriefSection => s !== null);

      // Token budgeting: if max_tokens specified, enforce as a hard cap
      if (args.max_tokens) {
        let totalTokens = 0;
        // Sort by priority (ascending = higher priority first)
        sections.sort((a, b) => a.priority - b.priority);

        // Filter to sections that fit, truncating the first partial one
        const kept: BriefSection[] = [];
        for (const section of sections) {
          if (totalTokens >= args.max_tokens) {
            // Budget exhausted — omit remaining sections entirely
            break;
          }
          if (totalTokens + section.estimated_tokens <= args.max_tokens) {
            // Fits entirely
            totalTokens += section.estimated_tokens;
            kept.push(section);
          } else if (Array.isArray(section.content)) {
            // Partially fits — truncate array content
            const remaining = args.max_tokens - totalTokens;
            const itemTokens = section.estimated_tokens / Math.max(1, (section.content as unknown[]).length);
            const keepCount = Math.max(1, Math.floor(remaining / itemTokens));
            section.content = (section.content as unknown[]).slice(0, keepCount);
            section.estimated_tokens = estimateTokens(section.content);
            totalTokens += section.estimated_tokens;
            kept.push(section);
            break; // Budget consumed after partial section
          }
          // Non-array section that doesn't fit — skip it
        }
        sections.length = 0;
        sections.push(...kept);
      }

      // Build response
      const response: Record<string, unknown> = {};
      let totalTokens = 0;
      for (const section of sections) {
        response[section.name] = section.content;
        totalTokens += section.estimated_tokens;
      }
      response._meta = { total_estimated_tokens: totalTokens };

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(response, null, 2),
        }],
      };
    }
  );
}
