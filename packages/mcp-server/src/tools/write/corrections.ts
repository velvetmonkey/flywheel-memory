/**
 * Correction tools
 * Tools: vault_record_correction, vault_list_corrections, vault_resolve_correction
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import {
  recordCorrection,
  listCorrections,
  resolveCorrection,
} from '../../core/write/corrections.js';

/**
 * Register correction tools with the MCP server
 */
export function registerCorrectionTools(
  server: McpServer,
  getStateDb: () => StateDb | null
): void {
  server.tool(
    'vault_record_correction',
    'Record a persistent correction (e.g., "that link is wrong", "undo that"). Survives across sessions.',
    {
      correction_type: z.enum(['wrong_link', 'wrong_entity', 'wrong_category', 'general']).describe('Type of correction'),
      description: z.string().describe('What went wrong and what should be done'),
      entity: z.string().optional().describe('Entity name (if correction is about a specific entity)'),
      note_path: z.string().optional().describe('Note path (if correction is about a specific note)'),
    },
    async ({ correction_type, description, entity, note_path }) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
          isError: true,
        };
      }

      const correction = recordCorrection(stateDb, correction_type, description, 'user', entity, note_path);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            recorded: true,
            correction,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'vault_list_corrections',
    'List recorded corrections, optionally filtered by status or entity.',
    {
      status: z.enum(['pending', 'applied', 'dismissed']).optional().describe('Filter by status'),
      entity: z.string().optional().describe('Filter by entity name'),
      limit: z.number().min(1).max(200).default(50).describe('Max entries to return'),
    },
    async ({ status, entity, limit }) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
          isError: true,
        };
      }

      const corrections = listCorrections(stateDb, status, entity, limit);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            corrections,
            count: corrections.length,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'vault_resolve_correction',
    'Resolve a correction by marking it as applied or dismissed.',
    {
      correction_id: z.number().describe('ID of the correction to resolve'),
      status: z.enum(['applied', 'dismissed']).describe('New status'),
    },
    async ({ correction_id, status }) => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
          isError: true,
        };
      }

      const resolved = resolveCorrection(stateDb, correction_id, status);
      if (!resolved) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Correction ${correction_id} not found` }) }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            resolved: true,
            correction_id,
            status,
          }, null, 2),
        }],
      };
    }
  );
}
