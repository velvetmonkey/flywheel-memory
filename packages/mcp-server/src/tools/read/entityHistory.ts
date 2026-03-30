/**
 * Entity History Tool — vault_entity_history
 *
 * Unified timeline of everything that happened to an entity across
 * all tables: applications, feedback, suggestions, edge weights,
 * metadata changes, memories, and corrections.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { getEntityTimeline } from '../../core/read/entityHistory.js';

export function registerEntityHistoryTools(
  server: McpServer,
  getStateDb: () => StateDb | null,
): void {
  server.tool(
    'vault_entity_history',
    'Use when tracing the full history of a specific entity. Produces a unified timeline of link events, feedback, suggestion scores, and edge weight changes. Returns chronological entity events with timestamps. Does not modify the entity — read-only historical data.',
    {
      entity_name: z.string().describe('Entity name to query (case-insensitive)'),
      event_types: z.array(z.enum([
        'application', 'feedback', 'suggestion', 'edge_update',
        'metadata_change', 'memory', 'correction',
      ])).optional().describe('Filter to specific event types. Omit for all types.'),
      start_date: z.string().optional().describe('Start date (YYYY-MM-DD) for date range filter'),
      end_date: z.string().optional().describe('End date (YYYY-MM-DD) for date range filter'),
      limit: z.number().min(1).max(200).optional().describe('Max events to return (default: 50)'),
      offset: z.number().min(0).optional().describe('Offset for pagination (default: 0)'),
    },
    async (args) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
          isError: true,
        };
      }

      const result = getEntityTimeline(stateDb, args.entity_name, {
        event_types: args.event_types,
        start_date: args.start_date,
        end_date: args.end_date,
        limit: args.limit,
        offset: args.offset,
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          entity_name: args.entity_name,
          entity: result.entity,
          total_events: result.total_events,
          showing: result.timeline.length,
          offset: args.offset ?? 0,
          timeline: result.timeline,
        }, null, 2) }],
      };
    }
  );
}
