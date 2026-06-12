/**
 * Field Migration Tools
 *
 * Bulk operations for renaming fields and transforming values.
 * All operations are dry-run by default for safety.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
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

// registerMigrationTools removed (arch-review S12): the standalone
// rename_field / migrate_field_values tools were retired in T43 B3+ and
// production never registered them. This file stays as the helper library
// behind schema(action: rename_field|migrate) — schemaTools.ts imports
// renameField and migrateFieldValues.
