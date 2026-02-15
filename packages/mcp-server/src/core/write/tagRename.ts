/**
 * Bulk Tag Rename
 *
 * Renames tags across vault notes in both frontmatter and inline content.
 * Supports hierarchical rename, folder scoping, and dry-run preview.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import type { VaultIndex, VaultNote } from '../read/types.js';
import { getProtectedZones, type ProtectedZone } from '@velvetmonkey/vault-core';

// =============================================================================
// TYPES
// =============================================================================

export interface TagChange {
  old: string;
  new: string;
  line?: number;
}

export interface TagRenamePreview {
  path: string;
  frontmatter_changes: TagChange[];
  content_changes: TagChange[];
  total_changes: number;
}

export interface TagRenameResult {
  old_tag: string;
  new_tag: string;
  rename_children: boolean;
  dry_run: boolean;
  affected_notes: number;
  total_changes: number;
  previews: TagRenamePreview[];
}

// =============================================================================
// HELPERS
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
 * Check if a tag matches the old tag (exact or child if rename_children is true)
 * Case-insensitive matching.
 */
function tagMatches(tag: string, oldTag: string, renameChildren: boolean): boolean {
  const tagLower = tag.toLowerCase();
  const oldLower = oldTag.toLowerCase();

  if (tagLower === oldLower) return true;
  if (renameChildren && tagLower.startsWith(oldLower + '/')) return true;
  return false;
}

/**
 * Transform a matched tag to its new form.
 * Preserves child path segments.
 */
function transformTag(tag: string, oldTag: string, newTag: string): string {
  const tagLower = tag.toLowerCase();
  const oldLower = oldTag.toLowerCase();

  if (tagLower === oldLower) {
    return newTag;
  }

  // Child tag: replace prefix, preserve suffix
  if (tagLower.startsWith(oldLower + '/')) {
    const suffix = tag.substring(oldTag.length);
    return newTag + suffix;
  }

  return tag;
}

/**
 * Check if a position overlaps with any protected zone, EXCEPT hashtag zones.
 * We want to allow replacement within hashtag zones (that's the target).
 */
function isProtected(start: number, end: number, zones: ProtectedZone[]): boolean {
  for (const zone of zones) {
    // Skip hashtag zones — those are the targets we want to replace
    if (zone.type === 'hashtag') continue;
    // Skip frontmatter zones — we handle frontmatter separately
    if (zone.type === 'frontmatter') continue;

    if (
      (start >= zone.start && start < zone.end) ||
      (end > zone.start && end <= zone.end) ||
      (start <= zone.start && end >= zone.end)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Find and replace inline tags in content body.
 * Skips protected zones (code blocks, inline code, wikilinks, etc.)
 * but allows replacement within hashtag zones.
 */
function replaceInlineTags(
  content: string,
  oldTag: string,
  newTag: string,
  renameChildren: boolean,
): { content: string; changes: TagChange[] } {
  const zones = getProtectedZones(content);
  const changes: TagChange[] = [];

  // Build regex pattern that matches #tag at word boundary
  // Escape special regex characters in the tag
  const escapedOld = oldTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match the tag with optional child path
  const pattern = renameChildren
    ? new RegExp(`(^|\\s)#(${escapedOld}(?:/[a-zA-Z0-9_/-]*)?)(?=[\\s,;.!?)]|$)`, 'gim')
    : new RegExp(`(^|\\s)#(${escapedOld})(?=[/\\s,;.!?)]|$)`, 'gim');

  // Track line numbers
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineStarts.push(i + 1);
  }

  function getLineNumber(pos: number): number {
    for (let i = lineStarts.length - 1; i >= 0; i--) {
      if (pos >= lineStarts[i]) return i + 1;
    }
    return 1;
  }

  // Collect all matches first, then replace from end to preserve positions
  const matches: Array<{ index: number; fullMatch: string; prefix: string; matchedTag: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const prefix = match[1];
    const matchedTag = match[2];
    const tagStart = match.index + prefix.length + 1; // +1 for #
    const tagEnd = tagStart + matchedTag.length;

    // Skip if in a protected zone
    if (isProtected(match.index, tagEnd, zones)) continue;

    // Verify it actually matches (case-insensitive check)
    if (!tagMatches(matchedTag, oldTag, renameChildren)) continue;

    matches.push({
      index: match.index,
      fullMatch: match[0],
      prefix,
      matchedTag,
    });
  }

  // Replace from end to start to preserve indices
  let result = content;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const transformed = transformTag(m.matchedTag, oldTag, newTag);
    const replacement = m.prefix + '#' + transformed;
    const start = m.index;
    const end = start + m.fullMatch.length;
    result = result.substring(0, start) + replacement + result.substring(end);

    changes.unshift({
      old: '#' + m.matchedTag,
      new: '#' + transformed,
      line: getLineNumber(start),
    });
  }

  return { content: result, changes };
}

// =============================================================================
// CORE FUNCTION
// =============================================================================

/**
 * Rename a tag across vault notes.
 *
 * @param index - VaultIndex for finding affected notes
 * @param vaultPath - Absolute path to vault root
 * @param oldTag - Tag to rename (without #)
 * @param newTag - New tag name (without #)
 * @param options - Configuration options
 */
export async function renameTag(
  index: VaultIndex,
  vaultPath: string,
  oldTag: string,
  newTag: string,
  options?: {
    rename_children?: boolean;
    folder?: string;
    dry_run?: boolean;
    commit?: boolean;
  }
): Promise<TagRenameResult> {
  const renameChildren = options?.rename_children ?? true;
  const dryRun = options?.dry_run ?? true;
  const folder = options?.folder;

  // Strip leading # if provided
  const cleanOld = oldTag.replace(/^#/, '');
  const cleanNew = newTag.replace(/^#/, '');

  // Find candidate notes
  const notes = getNotesInFolder(index, folder);

  // Filter to notes that have the tag (or child tags if rename_children)
  const affectedNotes: VaultNote[] = [];
  for (const note of notes) {
    const hasTag = note.tags.some(t => tagMatches(t, cleanOld, renameChildren));
    if (hasTag) {
      affectedNotes.push(note);
    }
  }

  const previews: TagRenamePreview[] = [];
  let totalChanges = 0;

  for (const note of affectedNotes) {
    const fullPath = path.join(vaultPath, note.path);
    let fileContent: string;
    try {
      fileContent = await fs.readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const preview: TagRenamePreview = {
      path: note.path,
      frontmatter_changes: [],
      content_changes: [],
      total_changes: 0,
    };

    // Parse with gray-matter
    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(fileContent);
    } catch {
      continue;
    }

    const fm = parsed.data as Record<string, unknown>;
    let fmChanged = false;

    // 1. Rename in frontmatter tags array
    if (Array.isArray(fm.tags)) {
      const newTags: string[] = [];
      // Pre-populate seen set with all non-matching tags for dedup
      const seen = new Set<string>();
      for (const tag of fm.tags) {
        if (typeof tag !== 'string') continue;
        const stripped = tag.replace(/^#/, '');
        if (!tagMatches(stripped, cleanOld, renameChildren)) {
          seen.add(stripped.toLowerCase());
        }
      }

      for (const tag of fm.tags) {
        if (typeof tag !== 'string') {
          newTags.push(tag);
          continue;
        }

        const stripped = tag.replace(/^#/, '');
        if (tagMatches(stripped, cleanOld, renameChildren)) {
          const transformed = transformTag(stripped, cleanOld, cleanNew);

          // Dedup: if new tag already exists, skip (merge)
          const key = transformed.toLowerCase();
          if (seen.has(key)) {
            // Still record as a change (merge)
            preview.frontmatter_changes.push({
              old: stripped,
              new: `${transformed} (merged)`,
            });
            fmChanged = true;
            continue;
          }
          seen.add(key);

          preview.frontmatter_changes.push({
            old: stripped,
            new: transformed,
          });

          newTags.push(transformed);
          fmChanged = true;
        } else {
          newTags.push(tag);
        }
      }

      if (fmChanged) {
        fm.tags = newTags;
      }
    }

    // 2. Rename inline tags in content
    const { content: updatedContent, changes: contentChanges } = replaceInlineTags(
      parsed.content,
      cleanOld,
      cleanNew,
      renameChildren,
    );

    preview.content_changes = contentChanges;
    preview.total_changes = preview.frontmatter_changes.length + preview.content_changes.length;
    totalChanges += preview.total_changes;

    if (preview.total_changes > 0) {
      previews.push(preview);

      // Write back if not dry-run
      if (!dryRun) {
        const newContent = matter.stringify(updatedContent, fm);
        await fs.writeFile(fullPath, newContent, 'utf-8');
      }
    }
  }

  return {
    old_tag: cleanOld,
    new_tag: cleanNew,
    rename_children: renameChildren,
    dry_run: dryRun,
    affected_notes: previews.length,
    total_changes: totalChanges,
    previews,
  };
}
