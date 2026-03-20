/**
 * Incremental index operations
 *
 * Provides efficient single-file updates to the vault index,
 * avoiding full rebuilds for file changes.
 */

import path from 'path';
import type { VaultIndex, VaultNote, Backlink } from '../types.js';
import type { VaultFile } from '../vault.js';
import { parseNote } from '../parser.js';

/**
 * Normalize a link target for matching
 */
function normalizeTarget(target: string): string {
  return target.toLowerCase().replace(/\.md$/, '');
}

/**
 * Normalize a note path to a matchable key
 */
function normalizeNotePath(notePath: string): string {
  return notePath.toLowerCase().replace(/\.md$/, '');
}

/**
 * Transaction describing changes to the index
 */
export interface IndexTransaction {
  /** Paths of notes to remove */
  notesToRemove: string[];

  /** Notes to add/update */
  notesToAdd: VaultNote[];
}

/**
 * Result of an incremental update
 */
export interface IncrementalUpdateResult {
  success: boolean;
  action: 'added' | 'updated' | 'removed' | 'unchanged';
  path: string;
  error?: Error;
}

/**
 * Remove a note from the index
 *
 * This removes:
 * - The note from notes map
 * - All entity mappings that point to this note
 * - All tag mappings for this note
 * - All backlinks FROM this note
 *
 * Note: Does NOT remove backlinks TO this note (those become broken links)
 */
export function removeNoteFromIndex(index: VaultIndex, notePath: string): string[] {
  const note = index.notes.get(notePath);
  if (!note) {
    return [];
  }

  // Remove from notes map
  index.notes.delete(notePath);

  // Remove entity mappings, tracking released keys
  const releasedKeys: string[] = [];
  const normalizedTitle = normalizeTarget(note.title);
  const normalizedPath = normalizeNotePath(notePath);

  // Only remove if this path is the one mapped
  if (index.entities.get(normalizedTitle) === notePath) {
    index.entities.delete(normalizedTitle);
    releasedKeys.push(normalizedTitle);
  }
  if (index.entities.get(normalizedPath) === notePath) {
    index.entities.delete(normalizedPath);
    // Path keys are unique per note, no need to reconcile
  }

  // Remove alias mappings
  for (const alias of note.aliases) {
    const normalizedAlias = normalizeTarget(alias);
    if (index.entities.get(normalizedAlias) === notePath) {
      index.entities.delete(normalizedAlias);
      releasedKeys.push(normalizedAlias);
    }
  }

  // Remove tag mappings
  for (const tag of note.tags) {
    const tagPaths = index.tags.get(tag);
    if (tagPaths) {
      tagPaths.delete(notePath);
      if (tagPaths.size === 0) {
        index.tags.delete(tag);
      }
    }
  }

  // Remove backlinks FROM this note (to other notes)
  for (const link of note.outlinks) {
    const normalizedTarget = normalizeTarget(link.target);
    const targetPath = index.entities.get(normalizedTarget);
    const key = targetPath ? normalizeNotePath(targetPath) : normalizedTarget;

    const backlinks = index.backlinks.get(key);
    if (backlinks) {
      const filtered = backlinks.filter(bl => bl.source !== notePath);
      if (filtered.length === 0) {
        index.backlinks.delete(key);
      } else {
        index.backlinks.set(key, filtered);
      }
    }
  }

  return releasedKeys;
}

/**
 * After removing a note, scan remaining notes to reclaim any released entity keys.
 * This prevents orphaned keys when two notes compete for the same title/alias.
 */
export function reconcileReleasedKeys(index: VaultIndex, releasedKeys: string[]): void {
  for (const key of releasedKeys) {
    if (index.entities.has(key)) continue; // already reclaimed by addNoteToIndex

    for (const [, note] of index.notes) {
      const normalizedTitle = normalizeTarget(note.title);
      if (normalizedTitle === key) {
        index.entities.set(key, note.path);
        break;
      }
      for (const alias of note.aliases) {
        if (normalizeTarget(alias) === key) {
          index.entities.set(key, note.path);
          break;
        }
      }
      if (index.entities.has(key)) break;
    }
  }
}

/**
 * Add a note to the index
 *
 * This adds:
 * - The note to notes map
 * - Entity mappings for title, path, aliases
 * - Tag mappings
 * - Backlinks FROM this note
 */
export function addNoteToIndex(index: VaultIndex, note: VaultNote): void {
  // Add to notes map
  index.notes.set(note.path, note);

  // Add entity mappings
  const normalizedTitle = normalizeTarget(note.title);
  const normalizedPath = normalizeNotePath(note.path);

  // Map by title (only if not already mapped)
  if (!index.entities.has(normalizedTitle)) {
    index.entities.set(normalizedTitle, note.path);
  }

  // Map by full path (always set, path is unique)
  index.entities.set(normalizedPath, note.path);

  // Map by aliases (only if not already mapped)
  for (const alias of note.aliases) {
    const normalizedAlias = normalizeTarget(alias);
    if (!index.entities.has(normalizedAlias)) {
      index.entities.set(normalizedAlias, note.path);
    }
  }

  // Add tag mappings
  for (const tag of note.tags) {
    if (!index.tags.has(tag)) {
      index.tags.set(tag, new Set());
    }
    index.tags.get(tag)!.add(note.path);
  }

  // Add backlinks FROM this note
  for (const link of note.outlinks) {
    const normalizedTarget = normalizeTarget(link.target);
    const targetPath = index.entities.get(normalizedTarget);
    const key = targetPath ? normalizeNotePath(targetPath) : normalizedTarget;

    if (!index.backlinks.has(key)) {
      index.backlinks.set(key, []);
    }

    index.backlinks.get(key)!.push({
      source: note.path,
      line: link.line,
    });
  }
}

/**
 * Upsert a note into the index
 *
 * If the note already exists, removes old data first.
 */
export async function upsertNote(
  index: VaultIndex,
  vaultPath: string,
  notePath: string
): Promise<IncrementalUpdateResult> {
  try {
    // Check if note already exists
    const existed = index.notes.has(notePath);

    // Remove old data if exists
    let releasedKeys: string[] = [];
    if (existed) {
      releasedKeys = removeNoteFromIndex(index, notePath);
    }

    // Create VaultFile for parsing
    const fullPath = path.join(vaultPath, notePath);
    const fs = await import('fs/promises');
    const stats = await fs.stat(fullPath);

    const vaultFile: VaultFile = {
      path: notePath,
      absolutePath: fullPath,
      modified: stats.mtime,
    };

    // Parse the note
    const note = await parseNote(vaultFile);

    // Add to index, then reconcile any keys the old version released
    addNoteToIndex(index, note);
    if (releasedKeys.length > 0) {
      reconcileReleasedKeys(index, releasedKeys);
    }

    return {
      success: true,
      action: existed ? 'updated' : 'added',
      path: notePath,
    };
  } catch (error) {
    return {
      success: false,
      action: 'unchanged',
      path: notePath,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Delete a note from the index
 */
export function deleteNote(
  index: VaultIndex,
  notePath: string
): IncrementalUpdateResult {
  const existed = index.notes.has(notePath);
  const releasedKeys = removeNoteFromIndex(index, notePath);

  if (releasedKeys.length > 0) {
    reconcileReleasedKeys(index, releasedKeys);
  }

  return {
    success: existed,
    action: existed ? 'removed' : 'unchanged',
    path: notePath,
  };
}

/**
 * Apply a transaction to the index
 *
 * Removes notes first, then adds new notes.
 * This is useful for batched updates.
 */
export async function applyTransaction(
  index: VaultIndex,
  vaultPath: string,
  transaction: IndexTransaction
): Promise<IncrementalUpdateResult[]> {
  const results: IncrementalUpdateResult[] = [];
  const allReleasedKeys: string[] = [];

  // Remove notes first
  for (const notePath of transaction.notesToRemove) {
    const existed = index.notes.has(notePath);
    const releasedKeys = removeNoteFromIndex(index, notePath);
    allReleasedKeys.push(...releasedKeys);
    results.push({
      success: existed,
      action: existed ? 'removed' : 'unchanged',
      path: notePath,
    });
  }

  // Add new notes
  for (const note of transaction.notesToAdd) {
    // Remove if exists (for consistency)
    const releasedKeys = removeNoteFromIndex(index, note.path);
    allReleasedKeys.push(...releasedKeys);
    addNoteToIndex(index, note);
    results.push({
      success: true,
      action: 'added',
      path: note.path,
    });
  }

  // Reconcile all released keys once at the end
  if (allReleasedKeys.length > 0) {
    reconcileReleasedKeys(index, allReleasedKeys);
  }

  return results;
}

/**
 * Process a batch of events and update the index
 */
export async function processBatch(
  index: VaultIndex,
  vaultPath: string,
  events: Array<{ type: 'upsert' | 'delete'; path: string }>
): Promise<IncrementalUpdateResult[]> {
  const results: IncrementalUpdateResult[] = [];
  const allReleasedKeys: string[] = [];

  for (const event of events) {
    if (event.type === 'delete') {
      const existed = index.notes.has(event.path);
      const releasedKeys = removeNoteFromIndex(index, event.path);
      allReleasedKeys.push(...releasedKeys);
      results.push({
        success: existed,
        action: existed ? 'removed' : 'unchanged',
        path: event.path,
      });
    } else {
      // Upsert: remove old, parse new, add
      const existed = index.notes.has(event.path);
      if (existed) {
        const releasedKeys = removeNoteFromIndex(index, event.path);
        allReleasedKeys.push(...releasedKeys);
      }

      try {
        const fullPath = path.join(vaultPath, event.path);
        const fs = await import('fs/promises');
        const stats = await fs.stat(fullPath);
        const vaultFile: VaultFile = {
          path: event.path,
          absolutePath: fullPath,
          modified: stats.mtime,
        };
        const note = await parseNote(vaultFile);
        addNoteToIndex(index, note);
        results.push({
          success: true,
          action: existed ? 'updated' : 'added',
          path: event.path,
        });
      } catch (error) {
        results.push({
          success: false,
          action: 'unchanged',
          path: event.path,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  }

  // Reconcile all released keys once at the end
  if (allReleasedKeys.length > 0) {
    reconcileReleasedKeys(index, allReleasedKeys);
  }

  return results;
}
