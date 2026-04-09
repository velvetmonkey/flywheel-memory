/**
 * Shared metadata filter helpers used by query.ts (date path) and find_notes.ts.
 */

import type { VaultNote } from '../../core/read/types.js';

/**
 * Check if a note matches frontmatter filters
 */
export function matchesFrontmatter(
  note: VaultNote,
  where: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(where)) {
    const noteValue = note.frontmatter[key];

    // Handle null/undefined
    if (value === null || value === undefined) {
      if (noteValue !== null && noteValue !== undefined) {
        return false;
      }
      continue;
    }

    // Handle arrays - check if any value matches
    if (Array.isArray(noteValue)) {
      if (!noteValue.some((v) => String(v).toLowerCase() === String(value).toLowerCase())) {
        return false;
      }
      continue;
    }

    // Handle string comparison (case-insensitive)
    if (typeof value === 'string' && typeof noteValue === 'string') {
      if (noteValue.toLowerCase() !== value.toLowerCase()) {
        return false;
      }
      continue;
    }

    // Handle other types (exact match)
    if (noteValue !== value) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a note has a specific tag.
 * When includeChildren is true, also matches child tags (e.g., "project" matches "project/active").
 */
export function hasTag(note: VaultNote, tag: string, includeChildren: boolean = false): boolean {
  const normalizedTag = tag.replace(/^#/, '').toLowerCase();
  return note.tags.some((t) => {
    const normalizedNoteTag = t.toLowerCase();
    if (normalizedNoteTag === normalizedTag) return true;
    if (includeChildren && normalizedNoteTag.startsWith(normalizedTag + '/')) return true;
    return false;
  });
}

/**
 * Check if a note has any of the specified tags
 */
export function hasAnyTag(note: VaultNote, tags: string[], includeChildren: boolean = false): boolean {
  return tags.some((tag) => hasTag(note, tag, includeChildren));
}

/**
 * Check if a note has all of the specified tags
 */
export function hasAllTags(note: VaultNote, tags: string[], includeChildren: boolean = false): boolean {
  return tags.every((tag) => hasTag(note, tag, includeChildren));
}

/**
 * Check if a note is in a folder
 */
export function inFolder(note: VaultNote, folder: string): boolean {
  const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
  return note.path.startsWith(normalizedFolder) || note.path.split('/')[0] === folder.replace('/', '');
}

/**
 * Sort notes by a field
 */
export function sortNotes(
  notes: VaultNote[],
  sortBy: 'modified' | 'created' | 'title',
  order: 'asc' | 'desc'
): VaultNote[] {
  const sorted = [...notes];

  sorted.sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'modified':
        comparison = a.modified.getTime() - b.modified.getTime();
        break;
      case 'created': {
        const aCreated = a.created || a.modified;
        const bCreated = b.created || b.modified;
        comparison = aCreated.getTime() - bCreated.getTime();
        break;
      }
      case 'title':
        comparison = a.title.localeCompare(b.title);
        break;
    }

    return order === 'desc' ? -comparison : comparison;
  });

  return sorted;
}
