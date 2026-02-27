/**
 * Memory tools
 * Tool: memory (unified with action parameter)
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import {
  storeMemory,
  getMemory,
  searchMemories,
  listMemories,
  forgetMemory,
  storeSessionSummary,
} from '../../core/write/memory.js';

/**
 * Register memory tools with the MCP server
 */
export function registerMemoryTools(
  server: McpServer,
  getStateDb: () => StateDb | null
): void {
  server.tool(
    'memory',
    'Store, retrieve, search, and manage agent working memory. Actions: store, get, search, list, forget, summarize_session.',
    {
      action: z.enum(['store', 'get', 'search', 'list', 'forget', 'summarize_session']).describe('Action to perform'),
      // store params
      key: z.string().optional().describe('Memory key (e.g., "user.pref.theme", "project.x.deadline")'),
      value: z.string().optional().describe('The fact/preference/observation to store (up to 2000 chars)'),
      type: z.enum(['fact', 'preference', 'observation', 'summary']).optional().describe('Memory type'),
      entity: z.string().optional().describe('Primary entity association'),
      confidence: z.number().min(0).max(1).optional().describe('Confidence level (0-1, default 1.0)'),
      ttl_days: z.number().min(1).optional().describe('Time-to-live in days (null = permanent)'),
      // search params
      query: z.string().optional().describe('FTS5 search query'),
      // list/search params
      limit: z.number().min(1).max(200).optional().describe('Max results to return'),
      // summarize_session params
      session_id: z.string().optional().describe('Session ID for summarize_session'),
      summary: z.string().optional().describe('Session summary text'),
      topics: z.array(z.string()).optional().describe('Topics discussed in session'),
      notes_modified: z.array(z.string()).optional().describe('Note paths modified during session'),
      tool_count: z.number().optional().describe('Number of tool calls in session'),
    },
    async (args) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
          isError: true,
        };
      }

      const agentId = process.env.FLYWHEEL_AGENT_ID || undefined;
      let sessionId: string | undefined;
      try {
        const { getSessionId } = await import('@velvetmonkey/vault-core');
        sessionId = getSessionId();
      } catch { /* no session */ }

      switch (args.action) {
        case 'store': {
          if (!args.key || !args.value || !args.type) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'store requires key, value, and type' }) }],
              isError: true,
            };
          }
          if (args.value.length > 2000) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'value must be 2000 chars or less' }) }],
              isError: true,
            };
          }
          const memory = storeMemory(stateDb, {
            key: args.key,
            value: args.value,
            type: args.type,
            entity: args.entity,
            confidence: args.confidence,
            ttl_days: args.ttl_days,
            agent_id: agentId,
            session_id: sessionId,
          });
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                stored: true,
                memory: {
                  key: memory.key,
                  value: memory.value,
                  type: memory.memory_type,
                  entity: memory.entity,
                  entities_detected: memory.entities_json ? JSON.parse(memory.entities_json) : [],
                  confidence: memory.confidence,
                },
              }, null, 2),
            }],
          };
        }

        case 'get': {
          if (!args.key) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'get requires key' }) }],
              isError: true,
            };
          }
          const memory = getMemory(stateDb, args.key);
          if (!memory) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ found: false, key: args.key }) }],
            };
          }
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                found: true,
                memory: {
                  key: memory.key,
                  value: memory.value,
                  type: memory.memory_type,
                  entity: memory.entity,
                  entities: memory.entities_json ? JSON.parse(memory.entities_json) : [],
                  confidence: memory.confidence,
                  created_at: memory.created_at,
                  updated_at: memory.updated_at,
                  accessed_at: memory.accessed_at,
                },
              }, null, 2),
            }],
          };
        }

        case 'search': {
          if (!args.query) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'search requires query' }) }],
              isError: true,
            };
          }
          const results = searchMemories(stateDb, {
            query: args.query,
            type: args.type,
            entity: args.entity,
            limit: args.limit,
            agent_id: agentId,
          });
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                results: results.map(m => ({
                  key: m.key,
                  value: m.value,
                  type: m.memory_type,
                  entity: m.entity,
                  confidence: m.confidence,
                  updated_at: m.updated_at,
                })),
                count: results.length,
              }, null, 2),
            }],
          };
        }

        case 'list': {
          const results = listMemories(stateDb, {
            type: args.type,
            entity: args.entity,
            limit: args.limit,
            agent_id: agentId,
          });
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                memories: results.map(m => ({
                  key: m.key,
                  value: m.value,
                  type: m.memory_type,
                  entity: m.entity,
                  confidence: m.confidence,
                  updated_at: m.updated_at,
                })),
                count: results.length,
              }, null, 2),
            }],
          };
        }

        case 'forget': {
          if (!args.key) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'forget requires key' }) }],
              isError: true,
            };
          }
          const deleted = forgetMemory(stateDb, args.key);
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ forgotten: deleted, key: args.key }, null, 2),
            }],
          };
        }

        case 'summarize_session': {
          const sid = args.session_id || sessionId;
          if (!sid || !args.summary) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'summarize_session requires session_id and summary' }) }],
              isError: true,
            };
          }
          const result = storeSessionSummary(stateDb, sid, args.summary, {
            topics: args.topics,
            notes_modified: args.notes_modified,
            agent_id: agentId,
            tool_count: args.tool_count,
          });
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                stored: true,
                session_id: result.session_id,
                summary_length: result.summary.length,
              }, null, 2),
            }],
          };
        }

        default:
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown action: ${args.action}` }) }],
            isError: true,
          };
      }
    }
  );
}
