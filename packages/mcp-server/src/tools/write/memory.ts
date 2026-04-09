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
    'Remember and recall facts, preferences, and settings across sessions. action: store — save a fact or preference. action: get — retrieve by key. action: search — full-text search stored memories. action: list — browse all memories. action: forget — delete a memory. action: summarize_session — session summary. Returns stored/retrieved content. Does not search vault notes — use "search" for vault content. e.g. { action:"store", key:"u.theme", value:"dark", type:"preference" } { action:"search", query:"Sarah" }',
    {
      action: z.enum(['store', 'get', 'search', 'list', 'forget', 'summarize_session']).describe('Operation to perform'),
      key: z.string().optional().describe('[store|get|forget] Memory key (e.g., "user.pref.theme", "project.x.deadline")'),
      value: z.string().optional().describe('[store] The fact/preference/observation to store (up to 2000 chars)'),
      type: z.enum(['fact', 'preference', 'observation', 'summary']).optional().describe('[store|search] Memory type'),
      entity: z.string().optional().describe('[store|search] Primary entity association'),
      confidence: z.number().min(0).max(1).optional().describe('[store] Confidence level (0-1, default 1.0)'),
      ttl_days: z.number().min(1).optional().describe('[store] Time-to-live in days (null = permanent)'),
      query: z.string().optional().describe('[search] FTS5 search query'),
      limit: z.number().min(1).max(200).optional().describe('[search|list] Max results to return'),
      session_id: z.string().optional().describe('[summarize_session] Session ID'),
      summary: z.string().optional().describe('[summarize_session] Session summary text'),
      topics: z.array(z.string()).optional().describe('[summarize_session] Topics discussed'),
      notes_modified: z.array(z.string()).optional().describe('[summarize_session] Note paths modified'),
      tool_count: z.number().optional().describe('[summarize_session] Number of tool calls'),
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
