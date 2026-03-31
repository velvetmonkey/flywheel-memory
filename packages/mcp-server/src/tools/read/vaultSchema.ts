/**
 * Vault Schema - Schema intelligence tools
 *
 * Split into 3 focused tools:
 * - vault_schema: overview, field_values, inconsistencies, contradictions
 * - schema_conventions: conventions, incomplete, suggest_values
 * - schema_validate: validate, missing
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import {
  getFrontmatterSchema,
  getFieldValues,
  findFrontmatterInconsistencies,
  validateFrontmatter,
  findMissingFrontmatter,
} from './frontmatter.js';
import {
  inferFolderConventions,
  findIncompleteNotes,
  suggestFieldValues,
  findContradictions,
} from './schema.js';

/**
 * Register the vault_schema, schema_conventions, and schema_validate tools
 */
export function registerVaultSchemaTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string
): void {
  // -------------------------------------------------------------------------
  // vault_schema: overview, field_values, inconsistencies, contradictions
  // -------------------------------------------------------------------------
  server.registerTool(
    'vault_schema',
    {
      title: 'Vault Schema',
      description:
        'Use when inspecting vault frontmatter field usage. Produces schema overviews, field value distributions, or per-type field analysis. Returns structured metadata about frontmatter usage patterns across notes. Does not modify any frontmatter — read-only schema inspection.',
      inputSchema: {
        analysis: z.enum(['overview', 'field_values', 'inconsistencies', 'contradictions']).describe('Type of schema inspection'),
        field: z.string().optional().describe('Field name (required for field_values)'),
        entity: z.string().optional().describe('Entity name to scope contradiction detection to (contradictions)'),
        limit: z.coerce.number().default(50).describe('Maximum results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip'),
      },
    },
    async (params) => {
      requireIndex();
      const limit = Math.min(params.limit ?? 50, MAX_LIMIT);
      const index = getIndex();

      switch (params.analysis) {
        case 'overview': {
          const result = getFrontmatterSchema(index);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'field_values': {
          if (!params.field) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'field parameter is required for field_values analysis',
              }, null, 2) }],
            };
          }
          const result = getFieldValues(index, params.field);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'inconsistencies': {
          const result = findFrontmatterInconsistencies(index);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              inconsistency_count: result.length,
              inconsistencies: result,
            }, null, 2) }],
          };
        }

        case 'contradictions': {
          const allContradictions = findContradictions(index, params.entity);
          const paginated = allContradictions.slice(params.offset ?? 0, (params.offset ?? 0) + limit);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              analysis: 'contradictions',
              entity: params.entity || null,
              total_count: allContradictions.length,
              returned_count: paginated.length,
              contradictions: paginated,
            }, null, 2) }],
          };
        }
      }
    }
  );

  // -------------------------------------------------------------------------
  // schema_conventions: conventions, incomplete, suggest_values
  // -------------------------------------------------------------------------
  server.registerTool(
    'schema_conventions',
    {
      title: 'Schema Conventions',
      description:
        'Use when inferring or checking frontmatter conventions from actual vault usage. Produces convention rules from folder patterns, finds notes with incomplete metadata, or suggests field values. Returns convention objects with evidence and compliance data. Does not enforce conventions — use schema_validate for compliance checking.',
      inputSchema: {
        analysis: z.enum(['conventions', 'incomplete', 'suggest_values']).describe('Type of convention analysis'),
        folder: z.string().optional().describe('Folder to scope analysis to'),
        field: z.string().optional().describe('Field name (required for suggest_values)'),
        min_confidence: z.coerce.number().min(0).max(1).optional().describe('Minimum confidence threshold (conventions)'),
        min_frequency: z.coerce.number().min(0).max(1).optional().describe('Minimum field frequency (incomplete)'),
        existing_frontmatter: z.record(z.unknown()).optional().describe('Existing frontmatter for context (suggest_values)'),
        limit: z.coerce.number().default(50).describe('Maximum results to return'),
        offset: z.coerce.number().default(0).describe('Number of results to skip'),
      },
    },
    async (params) => {
      requireIndex();
      const limit = Math.min(params.limit ?? 50, MAX_LIMIT);
      const index = getIndex();

      switch (params.analysis) {
        case 'conventions': {
          const result = inferFolderConventions(
            index,
            params.folder,
            params.min_confidence ?? 0.5
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'incomplete': {
          const result = findIncompleteNotes(
            index,
            params.folder,
            params.min_frequency ?? 0.7,
            limit,
            params.offset ?? 0
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'suggest_values': {
          if (!params.field) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'field parameter is required for suggest_values analysis',
              }, null, 2) }],
            };
          }
          const result = suggestFieldValues(index, params.field, {
            folder: params.folder,
            existing_frontmatter: params.existing_frontmatter,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }
      }
    }
  );

  // -------------------------------------------------------------------------
  // schema_validate: validate, missing
  // -------------------------------------------------------------------------
  server.registerTool(
    'schema_validate',
    {
      title: 'Schema Validate',
      description:
        'Use when checking frontmatter compliance against explicit rules or folder expectations. Produces validation results per note with pass/fail, missing fields, and type mismatches. Returns a compliance report with fixable issues highlighted. Does not fix issues — use vault_update_frontmatter to remediate.',
      inputSchema: {
        analysis: z.enum(['validate', 'missing']).describe('Type of validation'),
        schema: z.record(z.object({
          required: z.boolean().optional().describe('Whether field is required'),
          type: z.union([z.string(), z.array(z.string())]).optional().describe('Expected type(s)'),
          values: z.array(z.unknown()).optional().describe('Allowed values'),
        })).optional().describe('Schema to validate against (validate mode)'),
        folder_schemas: z.record(z.array(z.string())).optional().describe('Map of folder paths to required fields (missing mode)'),
        folder: z.string().optional().describe('Folder to scope validation to (validate mode)'),
      },
    },
    async (params) => {
      requireIndex();
      const index = getIndex();

      switch (params.analysis) {
        case 'validate': {
          if (!params.schema) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'schema parameter is required for validate analysis',
              }, null, 2) }],
            };
          }
          const result = validateFrontmatter(
            index,
            params.schema as Record<string, { required?: boolean; type?: string | string[]; values?: unknown[] }>,
            params.folder
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              notes_with_issues: result.length,
              results: result,
            }, null, 2) }],
          };
        }

        case 'missing': {
          if (!params.folder_schemas) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'folder_schemas parameter is required for missing analysis',
              }, null, 2) }],
            };
          }
          const result = findMissingFrontmatter(
            index,
            params.folder_schemas as Record<string, string[]>
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              notes_with_missing_fields: result.length,
              results: result,
            }, null, 2) }],
          };
        }
      }
    }
  );
}
