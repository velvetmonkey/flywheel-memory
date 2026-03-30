/**
 * Tool Selection Feedback tools
 * Tools: tool_selection_feedback
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import {
  recordToolSelectionFeedback,
  getToolSelectionList,
  getToolSelectionStats,
  getHeuristicMisroutes,
  getToolEffectivenessScores,
} from '../../core/shared/toolSelectionFeedback.js';
import { loadEffectivenessSnapshot } from '../../core/read/toolRouting.js';
import { getActiveScopeOrNull } from '../../vault-scope.js';

/**
 * Register tool selection feedback tools
 */
export function registerToolSelectionFeedbackTools(
  server: McpServer,
  getStateDb: () => StateDb | null,
): void {
  server.registerTool(
    'tool_selection_feedback',
    {
      title: 'Tool Selection Feedback',
      description:
        'Use when reporting whether the right tool was picked for a query. Produces a feedback record tracking tool selection quality over time. Returns confirmation with feedback stats and accuracy history. Does not change tool routing — only records the signal for analysis.',
      inputSchema: {
        mode: z.enum(['report', 'list', 'stats', 'misroutes']).describe('Operation mode'),
        correct: z.boolean().optional().describe('Was the tool selection correct? (required for report mode)'),
        tool_invocation_id: z.number().optional().describe('ID of the tool invocation being evaluated (preferred — hydrates tool_name, query_context, session_id automatically)'),
        tool_name: z.string().optional().describe('Tool that was called (used when tool_invocation_id not available)'),
        expected_tool: z.string().optional().describe('Tool that should have been called instead'),
        expected_category: z.string().optional().describe('Category that should have been used instead'),
        reason: z.string().optional().describe('Optional reason for the feedback'),
        days_back: z.number().min(1).max(365).optional().describe('Lookback period for stats mode (default: 30)'),
        limit: z.number().min(1).max(200).optional().describe('Max entries for list mode (default: 50)'),
      },
    },
    async (args) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
          isError: true,
        };
      }

      switch (args.mode) {
        case 'report': {
          if (args.correct === undefined) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'correct (boolean) is required for report mode' }) }],
              isError: true,
            };
          }
          if (!args.tool_invocation_id && !args.tool_name) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Either tool_invocation_id or tool_name is required' }) }],
              isError: true,
            };
          }

          const id = recordToolSelectionFeedback(stateDb, {
            tool_invocation_id: args.tool_invocation_id,
            tool_name: args.tool_name,
            expected_tool: args.expected_tool,
            expected_category: args.expected_category,
            correct: args.correct,
          });

          // Refresh effectiveness snapshot for active vault (T15b)
          try {
            const vaultName = getActiveScopeOrNull()?.name;
            if (vaultName) {
              const scores = getToolEffectivenessScores(stateDb);
              loadEffectivenessSnapshot(vaultName, scores);
            }
          } catch { /* non-critical */ }

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              recorded: true,
              feedback_id: id,
              correct: args.correct,
              tool_invocation_id: args.tool_invocation_id ?? null,
              tool_name: args.tool_name ?? null,
              expected_tool: args.expected_tool ?? null,
              expected_category: args.expected_category ?? null,
            }, null, 2) }],
          };
        }

        case 'list': {
          const entries = getToolSelectionList(stateDb, args.limit ?? 50);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              count: entries.length,
              entries,
            }, null, 2) }],
          };
        }

        case 'stats': {
          const stats = getToolSelectionStats(stateDb, args.days_back ?? 30);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              period_days: args.days_back ?? 30,
              tools: stats,
            }, null, 2) }],
          };
        }

        case 'misroutes': {
          const misroutes = getHeuristicMisroutes(stateDb, args.limit ?? 50);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              count: misroutes.length,
              misroutes: misroutes.map(m => ({
                id: m.id,
                timestamp: m.timestamp,
                tool_invocation_id: m.tool_invocation_id,
                tool_name: m.tool_name,
                query_context: m.query_context,
                expected_category: m.expected_category,
                rule_id: m.rule_id,
                rule_version: m.rule_version,
              })),
            }, null, 2) }],
          };
        }

        default:
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown mode: ${args.mode}` }) }],
            isError: true,
          };
      }
    }
  );
}
