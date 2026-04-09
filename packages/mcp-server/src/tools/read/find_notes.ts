/**
 * find_notes — structural enumeration by metadata (folder, tags, frontmatter).
 * Complements search (which is for relevance-ranked concept retrieval).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex, VaultNote } from '../../core/read/types.js';
import { MAX_LIMIT } from '../../core/read/constants.js';
import { requireIndex } from '../../core/read/indexGuard.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { enrichResult, enrichResultLight } from '../../core/read/enrichment.js';
import {
  matchesFrontmatter,
  hasTag,
  hasAnyTag,
  hasAllTags,
  inFolder,
  sortNotes,
} from './filters.js';

export function registerFindNotesTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getStateDb: () => StateDb | null
): void {
  server.tool(
    'find_notes',
    'Enumerate notes by metadata — folder, tags, or frontmatter values. Use when you need a structural list, not relevance-ranked search. Returns lightweight note summaries (path, title, modified, frontmatter, tags). Does not perform full-text or semantic search — for concept search, use search instead.',
    {
      folder: z.string().optional().describe('Filter to notes inside this folder (and its subfolders)'),
      where: z.record(z.unknown()).optional().describe('Frontmatter filters as key-value pairs. Example: { "type": "project", "status": "active" }'),
      has_tag: z.string().optional().describe('Filter to notes with this tag'),
      has_any_tag: z.array(z.string()).optional().describe('Filter to notes with any of these tags'),
      has_all_tags: z.array(z.string()).optional().describe('Filter to notes with all of these tags'),
      include_children: z.boolean().default(false).describe('When true, tag filters also match child tags (e.g., has_tag: "project" also matches "project/active")'),
      title_contains: z.string().optional().describe('Filter to notes whose title contains this text (case-insensitive)'),
      modified_after: z.string().optional().describe('Only notes modified after this date (YYYY-MM-DD)'),
      modified_before: z.string().optional().describe('Only notes modified before this date (YYYY-MM-DD)'),
      sort_by: z.enum(['modified', 'created', 'title']).default('modified').describe('Field to sort by'),
      order: z.enum(['asc', 'desc']).default('desc').describe('Sort order'),
      limit: z.number().default(50).describe('Maximum number of results to return'),
      detail_count: z.number().optional().describe('Number of top results with full metadata. Remaining get lightweight summaries. Default: 5.'),
    },
    async ({ folder, where, has_tag, has_any_tag, has_all_tags, include_children, title_contains, modified_after, modified_before, sort_by, order, limit: requestedLimit, detail_count: requestedDetailCount }) => {
      requireIndex();
      const limit = Math.min(requestedLimit ?? 50, MAX_LIMIT);
      const enrichN = Math.min(requestedDetailCount ?? 5, limit);
      const index = getIndex();

      let notes: VaultNote[] = Array.from(index.notes.values());

      if (folder) {
        notes = notes.filter((note) => inFolder(note, folder));
      }
      if (where && Object.keys(where).length > 0) {
        notes = notes.filter((note) => matchesFrontmatter(note, where));
      }
      if (has_tag) {
        notes = notes.filter((note) => hasTag(note, has_tag, include_children));
      }
      if (has_any_tag && has_any_tag.length > 0) {
        notes = notes.filter((note) => hasAnyTag(note, has_any_tag, include_children));
      }
      if (has_all_tags && has_all_tags.length > 0) {
        notes = notes.filter((note) => hasAllTags(note, has_all_tags, include_children));
      }
      if (title_contains) {
        const term = title_contains.toLowerCase();
        notes = notes.filter((note) => note.title.toLowerCase().includes(term));
      }
      // Date filters use local timezone
      if (modified_after) {
        const afterDate = new Date(modified_after);
        afterDate.setHours(0, 0, 0, 0);
        notes = notes.filter((note) => note.modified >= afterDate);
      }
      if (modified_before) {
        const beforeDate = new Date(modified_before);
        beforeDate.setHours(23, 59, 59, 999);
        notes = notes.filter((note) => note.modified <= beforeDate);
      }

      notes = sortNotes(notes, sort_by ?? 'modified', order ?? 'desc');

      const totalMatches = notes.length;
      const limited = notes.slice(0, limit);
      const stateDb = getStateDb();

      const enriched = limited.map((note, i) =>
        (i < enrichN ? enrichResult : enrichResultLight)({ path: note.path, title: note.title }, index, stateDb)
      );

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total_matches: totalMatches,
            returned: enriched.length,
            notes: enriched,
          }, null, 2),
        }],
      };
    }
  );
}
