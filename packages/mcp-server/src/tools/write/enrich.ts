/**
 * Vault initialization tool for Flywheel Memory
 * Tool: vault_init
 *
 * Scans notes with zero outgoing wikilinks and applies entity links.
 * Safe to re-run (idempotent) — notes that already have wikilinks are skipped.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  processWikilinks,
  isEntityIndexReady,
  checkAndRefreshIfStale,
  extractLinkedEntities,
} from '../../core/write/wikilinks.js';
import { trackWikilinkApplications, updateStoredNoteLinks } from '../../core/write/wikilinkFeedback.js';
import type { StateDb } from '@velvetmonkey/vault-core';

interface InitPreviewItem {
  note: string;
  entities: string[];
  match_count: number;
}

interface InitResult {
  success: boolean;
  mode: 'dry_run' | 'apply';
  notes_scanned: number;
  notes_with_matches: number;
  notes_skipped: number;
  total_matches: number;
  notes_modified?: number;
  preview: InitPreviewItem[];
  duration_ms: number;
  last_run_at?: string | null;
  total_enriched?: number;
}

/**
 * Check if a note has skipWikilinks: true in its frontmatter
 */
function hasSkipWikilinks(content: string): boolean {
  if (!content.startsWith('---')) return false;
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) return false;
  const frontmatter = content.substring(4, endIndex);
  return /^skipWikilinks:\s*true\s*$/m.test(frontmatter);
}

/**
 * Recursively collect all markdown file paths in a directory
 */
async function collectMarkdownFiles(
  dirPath: string,
  basePath: string,
  excludeFolders: string[],
): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (excludeFolders.some(f => entry.name.toLowerCase() === f.toLowerCase())) continue;
        const sub = await collectMarkdownFiles(fullPath, basePath, excludeFolders);
        results.push(...sub);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(path.relative(basePath, fullPath));
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return results;
}

/**
 * Folders to exclude from enrichment (same as entity scanning)
 */
const EXCLUDE_FOLDERS = [
  'daily-notes', 'daily', 'weekly', 'weekly-notes', 'monthly',
  'monthly-notes', 'quarterly', 'yearly-notes', 'periodic', 'journal',
  'inbox', 'templates', 'attachments', 'tmp',
  'clippings', 'readwise', 'articles', 'bookmarks', 'web-clips',
];

export function registerInitTools(
  server: McpServer,
  vaultPath: string,
  getStateDb: () => StateDb | null,
): void {
  server.tool(
    'vault_init',
    'Initialize vault for Flywheel — scans legacy notes with zero wikilinks and applies entity links. Safe to re-run (idempotent). Use dry_run (default) to preview.',
    {
      dry_run: z.boolean().default(true).describe('If true (default), preview what would be linked without modifying files'),
      batch_size: z.number().default(50).describe('Maximum notes to process per invocation (default: 50)'),
      offset: z.number().default(0).describe('Skip this many eligible notes (for pagination across invocations)'),
    },
    async ({ dry_run, batch_size, offset }) => {
      const startTime = Date.now();
      const stateDb = getStateDb();

      // Load metadata history
      const lastRunRow = stateDb?.getMetadataValue.get('vault_init_last_run_at') as { value: string } | undefined;
      const totalEnrichedRow = stateDb?.getMetadataValue.get('vault_init_total_enriched') as { value: string } | undefined;
      const previousTotal = totalEnrichedRow ? parseInt(totalEnrichedRow.value, 10) : 0;

      // Ensure entity index is ready
      checkAndRefreshIfStale();
      if (!isEntityIndexReady()) {
        const result: InitResult = {
          success: false,
          mode: dry_run ? 'dry_run' : 'apply',
          notes_scanned: 0,
          notes_with_matches: 0,
          notes_skipped: 0,
          total_matches: 0,
          preview: [],
          duration_ms: Date.now() - startTime,
          last_run_at: lastRunRow?.value ?? null,
          total_enriched: previousTotal,
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ...result, error: 'Entity index not ready' }, null, 2) }] };
      }

      // Collect all markdown files
      const allFiles = await collectMarkdownFiles(vaultPath, vaultPath, EXCLUDE_FOLDERS);

      // Find notes with zero outgoing wikilinks to known entities
      const eligible: Array<{ relativePath: string; content: string }> = [];
      let notesSkipped = 0;

      for (const relativePath of allFiles) {
        const fullPath = path.join(vaultPath, relativePath);
        let content: string;
        try {
          content = await fs.readFile(fullPath, 'utf-8');
        } catch {
          continue;
        }

        // Skip notes with skipWikilinks frontmatter
        if (hasSkipWikilinks(content)) {
          notesSkipped++;
          continue;
        }

        // Check if note already has outgoing wikilinks
        const existingLinks = extractLinkedEntities(content);
        if (existingLinks.size > 0) continue;

        eligible.push({ relativePath, content });
      }

      // Apply pagination
      const paged = eligible.slice(offset, offset + batch_size);

      // Process each eligible note
      const preview: InitPreviewItem[] = [];
      let totalMatches = 0;
      let notesModified = 0;

      for (const { relativePath, content } of paged) {
        // Run wikilink processing (same pipeline as normal mutations)
        const result = processWikilinks(content, relativePath);

        if (result.linksAdded === 0) continue;

        const entities = result.linkedEntities;
        totalMatches += result.linksAdded;

        preview.push({
          note: relativePath,
          entities,
          match_count: result.linksAdded,
        });

        if (!dry_run) {
          // Write enriched content back to file
          const fullPath = path.join(vaultPath, relativePath);
          await fs.writeFile(fullPath, result.content, 'utf-8');
          notesModified++;

          // Record applications in wikilink_applications table
          if (stateDb) {
            trackWikilinkApplications(stateDb, relativePath, entities);

            // Update note_links table
            const newLinks = extractLinkedEntities(result.content);
            updateStoredNoteLinks(stateDb, relativePath, newLinks);
          }
        }
      }

      // Update metadata after successful apply
      if (!dry_run && stateDb && notesModified > 0) {
        const newTotal = previousTotal + notesModified;
        stateDb.setMetadataValue.run('vault_init_last_run_at', new Date().toISOString());
        stateDb.setMetadataValue.run('vault_init_total_enriched', String(newTotal));
      }

      const currentLastRun = !dry_run && notesModified > 0
        ? new Date().toISOString()
        : (lastRunRow?.value ?? null);
      const currentTotal = !dry_run ? previousTotal + notesModified : previousTotal;

      const output: InitResult = {
        success: true,
        mode: dry_run ? 'dry_run' : 'apply',
        notes_scanned: allFiles.length,
        notes_with_matches: preview.length,
        notes_skipped: notesSkipped,
        total_matches: totalMatches,
        ...(dry_run ? {} : { notes_modified: notesModified }),
        preview: preview.slice(0, 20), // Cap preview to 20 items in output
        duration_ms: Date.now() - startTime,
        last_run_at: currentLastRun,
        total_enriched: currentTotal,
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }] };
    }
  );
}
