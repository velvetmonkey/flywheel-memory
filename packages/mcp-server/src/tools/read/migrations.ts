/**
 * Field Migration Tools
 *
 * Bulk operations for renaming fields and transforming values.
 * All operations are dry-run by default for safety.
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex, VaultNote } from '../../core/read/types.js';
import { requireIndex } from '../../core/read/indexGuard.js';

// =============================================================================
// TYPES
// =============================================================================

/** Preview of a field rename operation */
export interface RenamePreview {
  path: string;
  old_value: unknown;
  status: 'pending' | 'applied' | 'conflict';  // conflict if new_name exists
}

/** Result of field rename */
export interface RenameFieldResult {
  old_name: string;
  new_name: string;
  dry_run: boolean;
  affected_notes: number;
  notes: RenamePreview[];
  conflicts: number;
}

/** Preview of a value migration */
export interface MigrationPreview {
  path: string;
  old_value: unknown;
  new_value: unknown;
  status: 'pending' | 'applied' | 'no_match';
}

/** Result of value migration */
export interface MigrateResult {
  field: string;
  dry_run: boolean;
  total_notes: number;
  migrated: number;
  unchanged: number;
  previews: MigrationPreview[];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get notes in a specific folder (or all notes if no folder)
 */
function getNotesInFolder(index: VaultIndex, folder?: string): VaultNote[] {
  const notes: VaultNote[] = [];
  for (const note of index.notes.values()) {
    const noteFolder = note.path.includes('/')
      ? note.path.substring(0, note.path.lastIndexOf('/'))
      : '';

    if (!folder || note.path.startsWith(folder + '/') || noteFolder === folder) {
      notes.push(note);
    }
  }
  return notes;
}

/**
 * Read file content
 */
async function readFileContent(
  notePath: string,
  vaultPath: string
): Promise<string | null> {
  const fullPath = path.join(vaultPath, notePath);
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write file content
 */
async function writeFileContent(
  notePath: string,
  vaultPath: string,
  content: string
): Promise<boolean> {
  const fullPath = path.join(vaultPath, notePath);
  try {
    await fs.writeFile(fullPath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Update frontmatter in a file
 */
async function updateFrontmatter(
  notePath: string,
  vaultPath: string,
  updateFn: (fm: Record<string, unknown>) => Record<string, unknown>
): Promise<boolean> {
  const content = await readFileContent(notePath, vaultPath);
  if (content === null) return false;

  try {
    const parsed = matter(content);
    const newFrontmatter = updateFn(parsed.data as Record<string, unknown>);

    // Reconstruct the file
    const newContent = matter.stringify(parsed.content, newFrontmatter);
    return await writeFileContent(notePath, vaultPath, newContent);
  } catch {
    return false;
  }
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Rename a frontmatter field across notes
 */
export async function renameField(
  index: VaultIndex,
  vaultPath: string,
  oldName: string,
  newName: string,
  options?: {
    folder?: string;
    dry_run?: boolean;
  }
): Promise<RenameFieldResult> {
  const dryRun = options?.dry_run ?? true;
  const notes = getNotesInFolder(index, options?.folder);

  const previews: RenamePreview[] = [];
  let conflicts = 0;

  for (const note of notes) {
    const oldValue = note.frontmatter[oldName];
    if (oldValue === undefined) continue;

    // Check for conflict
    const hasNewField = note.frontmatter[newName] !== undefined;

    if (hasNewField) {
      previews.push({
        path: note.path,
        old_value: oldValue,
        status: 'conflict',
      });
      conflicts++;
      continue;
    }

    if (dryRun) {
      previews.push({
        path: note.path,
        old_value: oldValue,
        status: 'pending',
      });
    } else {
      // Actually perform the rename
      const success = await updateFrontmatter(note.path, vaultPath, (fm) => {
        const newFm = { ...fm };
        delete newFm[oldName];
        newFm[newName] = oldValue;
        return newFm;
      });

      previews.push({
        path: note.path,
        old_value: oldValue,
        status: success ? 'applied' : 'pending',
      });
    }
  }

  return {
    old_name: oldName,
    new_name: newName,
    dry_run: dryRun,
    affected_notes: previews.length,
    notes: previews,
    conflicts,
  };
}

/**
 * Migrate field values using a mapping
 */
export async function migrateFieldValues(
  index: VaultIndex,
  vaultPath: string,
  field: string,
  mapping: Record<string, unknown>,
  options?: {
    folder?: string;
    dry_run?: boolean;
  }
): Promise<MigrateResult> {
  const dryRun = options?.dry_run ?? true;
  const notes = getNotesInFolder(index, options?.folder);

  const previews: MigrationPreview[] = [];
  let migrated = 0;
  let unchanged = 0;

  for (const note of notes) {
    const currentValue = note.frontmatter[field];
    if (currentValue === undefined) continue;

    // Check if current value matches any key in mapping
    const currentKey = String(currentValue);
    const newValue = mapping[currentKey];

    if (newValue === undefined) {
      previews.push({
        path: note.path,
        old_value: currentValue,
        new_value: currentValue,
        status: 'no_match',
      });
      unchanged++;
      continue;
    }

    if (dryRun) {
      previews.push({
        path: note.path,
        old_value: currentValue,
        new_value: newValue,
        status: 'pending',
      });
      migrated++;
    } else {
      // Actually perform the migration
      const success = await updateFrontmatter(note.path, vaultPath, (fm) => {
        return { ...fm, [field]: newValue };
      });

      previews.push({
        path: note.path,
        old_value: currentValue,
        new_value: newValue,
        status: success ? 'applied' : 'pending',
      });

      if (success) migrated++;
    }
  }

  return {
    field,
    dry_run: dryRun,
    total_notes: notes.filter(n => n.frontmatter[field] !== undefined).length,
    migrated,
    unchanged,
    previews,
  };
}

// =============================================================================
// MCP TOOL REGISTRATION
// =============================================================================

/**
 * Register migration tools
 */
export function registerMigrationTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string
): void {
  // rename_field
  server.registerTool(
    'rename_field',
    {
      title: 'Rename Field',
      description:
        'Bulk rename a frontmatter field across notes. Dry-run by default (preview only). Detects conflicts where new field name already exists.',
      inputSchema: {
        old_name: z.string().describe('Current field name to rename'),
        new_name: z.string().describe('New field name'),
        folder: z.string().optional().describe('Limit to notes in this folder'),
        dry_run: z.boolean().optional().describe('Preview only, no changes (default: true)'),
      },
    },
    async ({ old_name, new_name, folder, dry_run }) => {
      const index = getIndex();
      const vaultPath = getVaultPath();
      const result = await renameField(index, vaultPath, old_name, new_name, {
        folder,
        dry_run: dry_run ?? true,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // migrate_field_values
  server.registerTool(
    'migrate_field_values',
    {
      title: 'Migrate Field Values',
      description:
        'Transform field values in bulk using a mapping (e.g., "high" -> 1). Dry-run by default.',
      inputSchema: {
        field: z.string().describe('Field to migrate values for'),
        mapping: z.record(z.unknown()).describe('Mapping of old values to new values (e.g., {"high": 1, "medium": 2, "low": 3})'),
        folder: z.string().optional().describe('Limit to notes in this folder'),
        dry_run: z.boolean().optional().describe('Preview only, no changes (default: true)'),
      },
    },
    async ({ field, mapping, folder, dry_run }) => {
      const index = getIndex();
      const vaultPath = getVaultPath();
      const result = await migrateFieldValues(index, vaultPath, field, mapping, {
        folder,
        dry_run: dry_run ?? true,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}
