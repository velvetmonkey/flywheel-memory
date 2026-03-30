/**
 * Heuristic Misroute Detection (T15b)
 *
 * Detects probable wrong-category tool selections by matching query context
 * against category-specific patterns. Advisory only — heuristic rows are
 * stored with correct=NULL and never affect accuracy scoring.
 *
 * Rules have stable ruleId and ruleVersion for auditability.
 */

import type { StateDb } from '@velvetmonkey/vault-core';
import { TOOL_CATEGORY, type ToolCategory } from '../../config.js';

// =============================================================================
// TYPES
// =============================================================================

export interface MisrouteRule {
  ruleId: string;
  ruleVersion: number;
  patterns: RegExp[];
  expectedCategory: ToolCategory;
  description: string;
}

export interface MisrouteDetection {
  expectedCategory: ToolCategory;
  ruleId: string;
  ruleVersion: number;
  description: string;
}

// =============================================================================
// RULES
// =============================================================================

/** Tools that are valid catch-alls — never flagged as misroutes. */
const CATCH_ALL_TOOLS = new Set(['search', 'brief']);

const MISROUTE_RULES: MisrouteRule[] = [
  {
    ruleId: 'temporal-via-wrong-cat',
    ruleVersion: 1,
    patterns: [/\b(history|timeline|timelines|evolution|stale notes?|around date|weekly review|monthly review|quarterly review)\b/i],
    expectedCategory: 'temporal',
    description: 'temporal query routed to non-temporal tool',
  },
  {
    ruleId: 'graph-via-wrong-cat',
    ruleVersion: 1,
    patterns: [/\b(backlinks?|forward links?|connections?|link path|hubs?|orphans?|clusters?|bridges?)\b/i],
    expectedCategory: 'graph',
    description: 'graph query routed to non-graph tool',
  },
  {
    ruleId: 'schema-via-wrong-cat',
    ruleVersion: 1,
    patterns: [/\b(schema|schemas|frontmatter conventions?|rename field|rename tag|migrate)\b/i],
    expectedCategory: 'schema',
    description: 'schema query routed to non-schema tool',
  },
  {
    ruleId: 'wikilinks-via-wrong-cat',
    ruleVersion: 1,
    patterns: [/\b(wikilinks?|link suggestions?|stubs?|unlinked mentions?)\b/i],
    expectedCategory: 'wikilinks',
    description: 'wikilink query routed to non-wikilink tool',
  },
];

// =============================================================================
// DETECTION
// =============================================================================

/**
 * Detect a probable misroute from query context.
 *
 * Returns null when:
 * - queryContext is empty
 * - toolName is a catch-all (search, brief)
 * - tool's category matches the expected category
 * - no rule pattern matches
 */
export function detectMisroute(
  toolName: string,
  queryContext: string,
): MisrouteDetection | null {
  if (!queryContext || !queryContext.trim()) return null;
  if (CATCH_ALL_TOOLS.has(toolName)) return null;

  const toolCategory = TOOL_CATEGORY[toolName];
  if (!toolCategory) return null;

  for (const rule of MISROUTE_RULES) {
    if (toolCategory === rule.expectedCategory) continue;
    if (rule.patterns.some(p => p.test(queryContext))) {
      return {
        expectedCategory: rule.expectedCategory,
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        description: rule.description,
      };
    }
  }

  return null;
}

// =============================================================================
// RECORDING
// =============================================================================

/**
 * Record a heuristic advisory misroute.
 * Uses INSERT...SELECT to hydrate tool_name, query_context, session_id from
 * the invocation row — no reconstruction from caller.
 */
export function recordHeuristicMisroute(
  stateDb: StateDb,
  toolInvocationId: number,
  detection: MisrouteDetection,
): void {
  stateDb.db.prepare(`
    INSERT INTO tool_selection_feedback
      (timestamp, tool_invocation_id, tool_name, query_context, expected_category, correct, source, rule_id, rule_version, session_id)
    SELECT
      ?, id, tool_name, query_context, ?, NULL, 'heuristic', ?, ?, session_id
    FROM tool_invocations
    WHERE id = ?
  `).run(
    Date.now(),
    detection.expectedCategory,
    detection.ruleId,
    detection.ruleVersion,
    toolInvocationId,
  );
}
