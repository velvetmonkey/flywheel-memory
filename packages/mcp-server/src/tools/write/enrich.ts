/**
 * Vault initialization tool for Flywheel Memory
 * Tool: vault_init
 *
 * Three modes:
 * - status: Check initialization state and report what's ready/missing
 * - run: Execute missing init steps (entities, fts5, enrichment)
 * - enrich: Legacy enrichment mode — scan notes with zero wikilinks and apply entity links
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
import { scanVaultEntities, SCHEMA_VERSION, type StateDb } from '@velvetmonkey/vault-core';
import { buildFTS5Index, getFTS5State } from '../../core/read/fts5.js';
import { loadConfig } from '../../core/read/config.js';
import { hasEmbeddingsIndex } from '../../core/read/embeddings.js';

interface InitPreviewItem {
  note: string;
  entities: string[];
  match_count: number;
}

interface EnrichResult {
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

// =============================================================================
// Status mode
// =============================================================================

interface StatusReport {
  mode: 'status';
  schema_version: number;
  statedb: { exists: boolean; path: string };
  entities: { count: number; ready: boolean };
  fts5: { note_count: number; ready: boolean };
  embeddings: { ready: boolean; count: number };
  enrichment: { last_run_at: string | null; total_enriched: number };
  recommendations: string[];
}

function buildStatusReport(stateDb: StateDb | null, vaultPath: string): StatusReport {
  const recommendations: string[] = [];

  // StateDb
  const dbPath = path.join(vaultPath, '.flywheel', 'state.db');
  const statedbExists = stateDb !== null;
  if (!statedbExists) {
    recommendations.push('StateDb not initialized — server needs restart');
  }

  // Entities
  let entityCount = 0;
  if (stateDb) {
    try {
      entityCount = (stateDb.db.prepare('SELECT COUNT(*) as cnt FROM entities').get() as { cnt: number }).cnt;
    } catch { /* table may not exist */ }
  }
  if (entityCount === 0) {
    recommendations.push('Run with mode "run" to scan vault entities');
  }

  // FTS5
  const fts5State = getFTS5State();
  if (!fts5State.ready || fts5State.noteCount === 0) {
    recommendations.push('Run with mode "run" to build FTS5 search index');
  }

  // Embeddings
  const embeddingsReady = hasEmbeddingsIndex();
  let embeddingsCount = 0;
  if (stateDb && embeddingsReady) {
    try {
      embeddingsCount = (stateDb.db.prepare('SELECT COUNT(*) as cnt FROM note_embeddings').get() as { cnt: number }).cnt;
    } catch { /* table may not exist */ }
  }
  if (!embeddingsReady) {
    recommendations.push('Call init_semantic to build embeddings for hybrid search');
  }

  // Enrichment metadata
  let lastRunAt: string | null = null;
  let totalEnriched = 0;
  if (stateDb) {
    const lastRunRow = stateDb.getMetadataValue.get('vault_init_last_run_at') as { value: string } | undefined;
    const totalRow = stateDb.getMetadataValue.get('vault_init_total_enriched') as { value: string } | undefined;
    lastRunAt = lastRunRow?.value ?? null;
    totalEnriched = totalRow ? parseInt(totalRow.value, 10) : 0;
  }

  return {
    mode: 'status',
    schema_version: SCHEMA_VERSION,
    statedb: { exists: statedbExists, path: dbPath },
    entities: { count: entityCount, ready: entityCount > 0 },
    fts5: { note_count: fts5State.noteCount, ready: fts5State.ready },
    embeddings: { ready: embeddingsReady, count: embeddingsCount },
    enrichment: { last_run_at: lastRunAt, total_enriched: totalEnriched },
    recommendations,
  };
}

// =============================================================================
// Run mode
// =============================================================================

interface RunResult {
  mode: 'run';
  steps: Array<{
    step: string;
    status: 'completed' | 'skipped' | 'error';
    detail?: string;
    duration_ms?: number;
  }>;
  recommendations: string[];
}

async function executeRun(stateDb: StateDb | null, vaultPath: string): Promise<RunResult> {
  const steps: RunResult['steps'] = [];
  const recommendations: string[] = [];

  if (!stateDb) {
    return {
      mode: 'run',
      steps: [{ step: 'statedb', status: 'error', detail: 'StateDb not available — server needs restart' }],
      recommendations: ['Restart the MCP server to initialize StateDb'],
    };
  }

  // Step 1: Entity scanning
  let entityCount = 0;
  try {
    entityCount = (stateDb.db.prepare('SELECT COUNT(*) as cnt FROM entities').get() as { cnt: number }).cnt;
  } catch { /* ignore */ }

  if (entityCount === 0) {
    const start = Date.now();
    try {
      const config = loadConfig(stateDb);
      const entityIndex = await scanVaultEntities(vaultPath, { excludeFolders: EXCLUDE_FOLDERS, customCategories: config.custom_categories });
      stateDb.replaceAllEntities(entityIndex);
      const newCount = entityIndex._metadata.total_entities;
      steps.push({
        step: 'entities',
        status: 'completed',
        detail: `Scanned ${newCount} entities`,
        duration_ms: Date.now() - start,
      });
    } catch (err) {
      steps.push({
        step: 'entities',
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - start,
      });
    }
  } else {
    steps.push({ step: 'entities', status: 'skipped', detail: `${entityCount} entities already indexed` });
  }

  // Step 2: FTS5 index
  const fts5State = getFTS5State();
  if (!fts5State.ready || fts5State.noteCount === 0) {
    const start = Date.now();
    try {
      const result = await buildFTS5Index(vaultPath);
      steps.push({
        step: 'fts5',
        status: 'completed',
        detail: `Indexed ${result.noteCount} notes`,
        duration_ms: Date.now() - start,
      });
    } catch (err) {
      steps.push({
        step: 'fts5',
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - start,
      });
    }
  } else {
    steps.push({ step: 'fts5', status: 'skipped', detail: `${fts5State.noteCount} notes already indexed` });
  }

  // Step 3: Embeddings — don't duplicate init_semantic, just advise
  const embeddingsReady = hasEmbeddingsIndex();
  if (!embeddingsReady) {
    steps.push({
      step: 'embeddings',
      status: 'skipped',
      detail: 'Call init_semantic separately to build embeddings',
    });
    recommendations.push('Call init_semantic to build embeddings for hybrid search');
  } else {
    steps.push({ step: 'embeddings', status: 'skipped', detail: 'Embeddings already built' });
  }

  // Step 4: Enrichment — run a dry_run to report how many notes are eligible
  try {
    checkAndRefreshIfStale();
    if (isEntityIndexReady()) {
      const allFiles = await collectMarkdownFiles(vaultPath, vaultPath, EXCLUDE_FOLDERS);
      let eligible = 0;
      for (const relativePath of allFiles) {
        const fullPath = path.join(vaultPath, relativePath);
        let content: string;
        try {
          content = await fs.readFile(fullPath, 'utf-8');
        } catch { continue; }
        if (hasSkipWikilinks(content)) continue;
        const existingLinks = extractLinkedEntities(content);
        if (existingLinks.size > 0) continue;
        eligible++;
      }

      if (eligible > 0) {
        steps.push({
          step: 'enrich',
          status: 'skipped',
          detail: `${eligible} notes with zero wikilinks — use mode "enrich" with dry_run: false to apply`,
        });
        recommendations.push(`${eligible} notes can be enriched with wikilinks — use mode "enrich"`);
      } else {
        steps.push({ step: 'enrich', status: 'skipped', detail: 'All notes already have wikilinks' });
      }
    } else {
      steps.push({ step: 'enrich', status: 'skipped', detail: 'Entity index not ready — enrichment deferred' });
    }
  } catch (err) {
    steps.push({
      step: 'enrich',
      status: 'error',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  return { mode: 'run', steps, recommendations };
}

// =============================================================================
// Enrich mode (preserved from original)
// =============================================================================

async function executeEnrich(
  stateDb: StateDb | null,
  vaultPath: string,
  dryRun: boolean,
  batchSize: number,
  offset: number,
): Promise<EnrichResult> {
  const startTime = Date.now();

  // Load metadata history
  const lastRunRow = stateDb?.getMetadataValue.get('vault_init_last_run_at') as { value: string } | undefined;
  const totalEnrichedRow = stateDb?.getMetadataValue.get('vault_init_total_enriched') as { value: string } | undefined;
  const previousTotal = totalEnrichedRow ? parseInt(totalEnrichedRow.value, 10) : 0;

  // Ensure entity index is ready
  checkAndRefreshIfStale();
  if (!isEntityIndexReady()) {
    return {
      success: false,
      mode: dryRun ? 'dry_run' : 'apply',
      notes_scanned: 0,
      notes_with_matches: 0,
      notes_skipped: 0,
      total_matches: 0,
      preview: [],
      duration_ms: Date.now() - startTime,
      last_run_at: lastRunRow?.value ?? null,
      total_enriched: previousTotal,
    };
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
  const paged = eligible.slice(offset, offset + batchSize);

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

    if (!dryRun) {
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
  if (!dryRun && stateDb && notesModified > 0) {
    const newTotal = previousTotal + notesModified;
    stateDb.setMetadataValue.run('vault_init_last_run_at', new Date().toISOString());
    stateDb.setMetadataValue.run('vault_init_total_enriched', String(newTotal));
  }

  const currentLastRun = !dryRun && notesModified > 0
    ? new Date().toISOString()
    : (lastRunRow?.value ?? null);
  const currentTotal = !dryRun ? previousTotal + notesModified : previousTotal;

  return {
    success: true,
    mode: dryRun ? 'dry_run' : 'apply',
    notes_scanned: allFiles.length,
    notes_with_matches: preview.length,
    notes_skipped: notesSkipped,
    total_matches: totalMatches,
    ...(dryRun ? {} : { notes_modified: notesModified }),
    preview: preview.slice(0, 20),
    duration_ms: Date.now() - startTime,
    last_run_at: currentLastRun,
    total_enriched: currentTotal,
  };
}

// =============================================================================
// Tool registration
// =============================================================================

export function registerInitTools(
  server: McpServer,
  getVaultPath: () => string,
  getStateDb: () => StateDb | null,
): void {
  server.tool(
    'vault_init',
    'Initialize vault for Flywheel. Modes: "status" (check what\'s ready/missing), "run" (execute missing init steps), "enrich" (scan notes with zero wikilinks and apply entity links).',
    {
      mode: z.enum(['status', 'run', 'enrich']).default('status').describe('Operation mode (default: status)'),
      dry_run: z.boolean().default(true).describe('For enrich mode: preview without modifying files (default: true)'),
      batch_size: z.number().default(50).describe('For enrich mode: max notes per invocation (default: 50)'),
      offset: z.number().default(0).describe('For enrich mode: skip this many eligible notes (for pagination)'),
    },
    async ({ mode, dry_run, batch_size, offset }) => {
      const stateDb = getStateDb();
      const vaultPath = getVaultPath();

      switch (mode) {
        case 'status': {
          const report = buildStatusReport(stateDb, vaultPath);
          return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
        }

        case 'run': {
          const result = await executeRun(stateDb, vaultPath);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }

        case 'enrich': {
          const result = await executeEnrich(stateDb, vaultPath, dry_run, batch_size, offset);
          if (!result.success) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ ...result, error: 'Entity index not ready' }, null, 2) }] };
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        }
      }
    }
  );
}
