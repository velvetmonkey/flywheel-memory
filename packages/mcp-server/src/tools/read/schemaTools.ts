/**
 * schema merged tool — power preset
 *
 * Absorbs: vault_schema + schema_conventions + get_folder_structure +
 *          rename_field + rename_tag + migrate_field_values + schema_validate
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import {
  getFrontmatterSchema,
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
import { renameField, migrateFieldValues } from './migrations.js';
import { renameTag } from '../../core/write/tagRename.js';

export function registerSchemaTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
): void {
  server.registerTool(
    'schema',
    {
      title: 'Schema',
      description:
        'Inspect and evolve vault schema. action: overview — field usage. action: conventions — folder rules. action: folders — structure. action: rename_field — bulk rename field. action: rename_tag — bulk rename tag. action: migrate — update values. action: validate — check rules. Returns stats, conventions, or errors. Does not read note body content. e.g. { action:"overview" } { action:"rename_tag", old_name:"wip", new_name:"in-progress", dry_run:true }',
      inputSchema: {
        action: z.enum(['overview', 'conventions', 'folders', 'rename_field', 'rename_tag', 'migrate', 'validate'])
          .describe('Schema operation to perform'),

        folder: z.string().optional().describe('[conventions|validate] Folder to scope to'),

        old_name: z.string().optional().describe('[rename_field|rename_tag] Current field or tag name'),
        new_name: z.string().optional().describe('[rename_field|rename_tag] New field or tag name'),

        rename_children: z.boolean().optional().describe('[rename_tag] Also rename child tags (default true)'),

        field: z.string().optional().describe('[migrate] Field to migrate values for'),
        from_value: z.string().optional().describe('[migrate] Old field value to replace'),
        to_value: z.string().optional().describe('[migrate] New field value to set'),

        dry_run: z.boolean().optional().describe('[rename_field|rename_tag|migrate] Preview only (default true)'),

        path: z.string().optional().describe('[validate] Note path to validate (omit for whole vault)'),
      },
    },
    async (params) => {
      requireIndex();
      const index = getIndex();
      const vaultPath = getVaultPath();

      switch (params.action) {
        // -----------------------------------------------------------------
        // overview — frontmatter field usage across vault
        // -----------------------------------------------------------------
        case 'overview': {
          const result = getFrontmatterSchema(index);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // conventions — naming conventions for a folder
        // -----------------------------------------------------------------
        case 'conventions': {
          const result = inferFolderConventions(index, params.folder, 0.5);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // folders — vault folder structure
        // -----------------------------------------------------------------
        case 'folders': {
          // Build a folder → child-folder + note-count tree from the index
          const folderMap = new Map<string, { subfolders: Set<string>; note_count: number }>();

          const ensureFolder = (f: string) => {
            if (!folderMap.has(f)) {
              folderMap.set(f, { subfolders: new Set(), note_count: 0 });
            }
          };

          ensureFolder('');

          for (const note of index.notes.values()) {
            const parts = note.path.split('/');
            // Register each ancestor folder
            for (let depth = 1; depth < parts.length; depth++) {
              const folder = parts.slice(0, depth).join('/');
              const parent = parts.slice(0, depth - 1).join('/');
              ensureFolder(folder);
              folderMap.get(parent)!.subfolders.add(folder);
            }
            // Increment note count for the immediate parent folder
            const parentFolder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
            ensureFolder(parentFolder);
            folderMap.get(parentFolder)!.note_count += 1;
          }

          // Convert to sorted array
          const folders = Array.from(folderMap.entries())
            .filter(([f]) => f !== '')
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([path, data]) => ({
              path,
              note_count: data.note_count,
              subfolder_count: data.subfolders.size,
            }));

          const rootNoteCount = folderMap.get('')?.note_count ?? 0;

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              total_folders: folders.length,
              root_notes: rootNoteCount,
              folders,
            }, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // rename_field — bulk rename a frontmatter field
        // -----------------------------------------------------------------
        case 'rename_field': {
          if (!params.old_name || !params.new_name) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'old_name and new_name are required for action=rename_field',
              }, null, 2) }],
            };
          }
          const result = await renameField(index, vaultPath, params.old_name, params.new_name, {
            dry_run: params.dry_run ?? true,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // rename_tag — bulk rename a tag across vault
        // -----------------------------------------------------------------
        case 'rename_tag': {
          if (!params.old_name || !params.new_name) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'old_name and new_name are required for action=rename_tag',
              }, null, 2) }],
            };
          }
          const result = await renameTag(index, vaultPath, params.old_name, params.new_name, {
            rename_children: params.rename_children ?? true,
            dry_run: params.dry_run ?? true,
            commit: false,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // migrate — bulk update field values
        // -----------------------------------------------------------------
        case 'migrate': {
          if (!params.field || params.from_value === undefined || params.to_value === undefined) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: 'field, from_value, and to_value are required for action=migrate',
              }, null, 2) }],
            };
          }
          const mapping: Record<string, string> = { [params.from_value]: params.to_value };
          const result = await migrateFieldValues(index, vaultPath, params.field, mapping, {
            dry_run: params.dry_run ?? true,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        // -----------------------------------------------------------------
        // validate — check notes against schema rules
        // -----------------------------------------------------------------
        case 'validate': {
          // When path is supplied, validate that single note's frontmatter for completeness
          // by comparing to folder conventions. When omitted, run whole-vault conventions check.
          if (params.path) {
            const note = index.notes.get(params.path);
            if (!note) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({
                  error: `Note not found in index: ${params.path}`,
                }, null, 2) }],
              };
            }

            const noteFolder = note.path.includes('/')
              ? note.path.substring(0, note.path.lastIndexOf('/'))
              : '';
            const conventions = inferFolderConventions(index, noteFolder || undefined, 0.5);
            const expectedFields = conventions.inferred_fields.map((f: { name: string }) => f.name);
            const presentFields = Object.keys(note.frontmatter);
            const missingFields = expectedFields.filter((f: string) => !presentFields.includes(f));

            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                path: note.path,
                folder: noteFolder || '(root)',
                present_fields: presentFields,
                expected_fields: expectedFields,
                missing_fields: missingFields,
                compliant: missingFields.length === 0,
              }, null, 2) }],
            };
          }

          // Whole-vault: find notes missing frontmatter relative to folder peers
          const inconsistencies = findFrontmatterInconsistencies(index);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              inconsistency_count: inconsistencies.length,
              inconsistencies,
            }, null, 2) }],
          };
        }
      }
    },
  );
}
