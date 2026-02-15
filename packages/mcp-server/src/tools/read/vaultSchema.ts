/**
 * Vault Schema - Unified schema intelligence tool
 *
 * Replaces: get_frontmatter_schema, get_field_values, find_frontmatter_inconsistencies,
 *           validate_frontmatter, find_missing_frontmatter, infer_folder_conventions,
 *           find_incomplete_notes, suggest_field_values
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
 * Register the unified vault_schema tool
 */
export function registerVaultSchemaTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string
): void {
  server.registerTool(
    'vault_schema',
    {
      title: 'Vault Schema',
      description:
        'Analyze and validate vault frontmatter schema. Use analysis to pick the mode:\n' +
        '- "overview": Schema of all frontmatter fields across the vault\n' +
        '- "field_values": All unique values for a specific field\n' +
        '- "inconsistencies": Fields with multiple types across notes\n' +
        '- "validate": Validate notes against a provided schema\n' +
        '- "missing": Find notes missing expected fields by folder\n' +
        '- "conventions": Auto-detect metadata conventions for a folder\n' +
        '- "incomplete": Find notes missing expected fields (inferred)\n' +
        '- "suggest_values": Suggest values for a field based on usage\n' +
        '- "contradictions": Find conflicting frontmatter values across notes referencing the same entity\n\n' +
        'Example: vault_schema({ analysis: "field_values", field: "status" })\n' +
        'Example: vault_schema({ analysis: "conventions", folder: "projects" })\n' +
        'Example: vault_schema({ analysis: "contradictions", entity: "project alpha" })',
      inputSchema: {
        analysis: z.enum([
          'overview', 'field_values', 'inconsistencies', 'validate',
          'missing', 'conventions', 'incomplete', 'suggest_values', 'contradictions',
        ]).describe('Type of schema analysis to perform'),
        field: z.string().optional().describe('Field name (field_values, suggest_values)'),
        entity: z.string().optional().describe('Entity name to scope contradiction detection to (contradictions mode)'),
        folder: z.string().optional().describe('Folder to scope analysis to'),
        schema: z.record(z.object({
          required: z.boolean().optional().describe('Whether field is required'),
          type: z.union([z.string(), z.array(z.string())]).optional().describe('Expected type(s)'),
          values: z.array(z.unknown()).optional().describe('Allowed values'),
        })).optional().describe('Schema to validate against (validate mode)'),
        folder_schemas: z.record(z.array(z.string())).optional().describe('Map of folder paths to required fields (missing mode)'),
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
}
