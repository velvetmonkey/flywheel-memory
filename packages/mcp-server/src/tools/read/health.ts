/**
 * Vault health tools - diagnostics and statistics
 */

import * as fs from 'fs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { resolveTarget, getBacklinksForNote, findSimilarEntity, getIndexState, getIndexProgress, getIndexError, type IndexState } from '../../core/read/graph.js';
import { detectPeriodicNotes } from './periodic.js';
import { getActivitySummary } from './temporal.js';
import type { FlywheelConfig } from '../../core/read/config.js';
import { SCHEMA_VERSION, type StateDb } from '@velvetmonkey/vault-core';
import { getRecentIndexEvents } from '../../core/shared/indexActivity.js';
import { getFTS5State } from '../../core/read/fts5.js';
import { hasEmbeddingsIndex, getEmbeddingsCount } from '../../core/read/embeddings.js';

/** Staleness threshold in seconds (5 minutes) */
const STALE_THRESHOLD_SECONDS = 300;

/**
 * Register vault health tools
 */
export function registerHealthTools(
  server: McpServer,
  getIndex: () => VaultIndex,
  getVaultPath: () => string,
  getConfig: () => FlywheelConfig = () => ({}),
  getStateDb: () => StateDb | null = () => null
): void {
  // health_check - MCP server health status + periodic note detection + config
  const IndexProgressSchema = z.object({
    parsed: z.coerce.number().describe('Number of files parsed so far'),
    total: z.coerce.number().describe('Total number of files to parse'),
  }).optional();

  const PeriodicNoteInfoSchema = z.object({
    type: z.string(),
    detected: z.boolean(),
    folder: z.string().nullable(),
    pattern: z.string().nullable(),
    today_path: z.string().nullable(),
    today_exists: z.boolean(),
  });

  const HealthCheckOutputSchema = {
    status: z.enum(['healthy', 'degraded', 'unhealthy']).describe('Overall health status'),
    schema_version: z.coerce.number().describe('StateDb schema version'),
    vault_accessible: z.boolean().describe('Whether the vault path is accessible'),
    vault_path: z.string().describe('The vault path being used'),
    index_state: z.enum(['building', 'ready', 'error']).describe('Current state of the vault index'),
    index_progress: IndexProgressSchema.describe('Progress of index build (when building)'),
    index_error: z.string().optional().describe('Error message if index failed to build'),
    index_built: z.boolean().describe('Whether the index has been built'),
    index_age_seconds: z.coerce.number().describe('Seconds since the index was built'),
    index_stale: z.boolean().describe('Whether the index is stale (>5 minutes old)'),
    note_count: z.coerce.number().describe('Number of notes in the index'),
    entity_count: z.coerce.number().describe('Number of linkable entities (titles + aliases)'),
    tag_count: z.coerce.number().describe('Number of unique tags'),
    periodic_notes: z.array(PeriodicNoteInfoSchema).optional().describe('Detected periodic note conventions'),
    config: z.record(z.unknown()).optional().describe('Current flywheel config (paths, templates, etc.)'),
    last_rebuild: z.object({
      trigger: z.string(),
      timestamp: z.number(),
      duration_ms: z.number(),
      ago_seconds: z.number(),
    }).optional().describe('Most recent index rebuild event'),
    fts5_ready: z.boolean().describe('Whether the FTS5 keyword search index is ready'),
    fts5_building: z.boolean().describe('Whether the FTS5 keyword search index is currently building'),
    embeddings_ready: z.boolean().describe('Whether semantic embeddings have been built (enables hybrid keyword+semantic search)'),
    embeddings_count: z.coerce.number().describe('Number of notes with semantic embeddings'),
    recommendations: z.array(z.string()).describe('Suggested actions if any issues detected'),
  };

  type PeriodicNoteInfo = {
    type: string;
    detected: boolean;
    folder: string | null;
    pattern: string | null;
    today_path: string | null;
    today_exists: boolean;
  };

  type HealthCheckOutput = {
    status: 'healthy' | 'degraded' | 'unhealthy';
    schema_version: number;
    vault_accessible: boolean;
    vault_path: string;
    index_state: IndexState;
    index_progress?: { parsed: number; total: number };
    index_error?: string;
    index_built: boolean;
    index_age_seconds: number;
    index_stale: boolean;
    note_count: number;
    entity_count: number;
    tag_count: number;
    periodic_notes?: PeriodicNoteInfo[];
    config?: Record<string, unknown>;
    last_rebuild?: {
      trigger: string;
      timestamp: number;
      duration_ms: number;
      ago_seconds: number;
    };
    fts5_ready: boolean;
    fts5_building: boolean;
    embeddings_ready: boolean;
    embeddings_count: number;
    recommendations: string[];
  };

  server.registerTool(
    'health_check',
    {
      title: 'Health Check',
      description:
        'Check MCP server health status. Returns vault accessibility, index freshness, and recommendations. Use at session start to verify MCP is working correctly.',
      inputSchema: {},
      outputSchema: HealthCheckOutputSchema,
    },
    async (): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: HealthCheckOutput;
    }> => {
      const index = getIndex();
      const vaultPath = getVaultPath();
      const recommendations: string[] = [];

      // Get index state info
      const indexState = getIndexState();
      const indexProgress = getIndexProgress();
      const indexErrorObj = getIndexError();

      // Check vault accessibility
      let vaultAccessible = false;
      try {
        fs.accessSync(vaultPath, fs.constants.R_OK);
        vaultAccessible = true;
      } catch {
        vaultAccessible = false;
        recommendations.push('Vault path is not accessible. Check PROJECT_PATH environment variable.');
      }

      // Check index status
      const indexBuilt = indexState === 'ready' && index !== undefined && index.notes !== undefined;
      const indexAge = indexBuilt && index.builtAt
        ? Math.floor((Date.now() - index.builtAt.getTime()) / 1000)
        : -1;
      const indexStale = indexBuilt && indexAge > STALE_THRESHOLD_SECONDS;

      // Add state-specific recommendations
      if (indexState === 'building') {
        const { parsed, total } = indexProgress;
        const progress = total > 0 ? ` (${parsed}/${total} files)` : '';
        recommendations.push(`Index is building${progress}. Some tools may not be available yet.`);
      } else if (indexState === 'error') {
        recommendations.push(`Index failed to build: ${indexErrorObj?.message || 'unknown error'}`);
      } else if (indexStale) {
        recommendations.push(`Index is ${Math.floor(indexAge / 60)} minutes old. Consider running refresh_index.`);
      }

      // Count metrics (only if index is ready)
      const noteCount = indexBuilt ? index.notes.size : 0;
      const entityCount = indexBuilt ? index.entities.size : 0;
      const tagCount = indexBuilt ? index.tags.size : 0;

      if (indexBuilt && noteCount === 0 && vaultAccessible) {
        recommendations.push('No notes found in vault. Is PROJECT_PATH pointing to a markdown vault?');
      }

      // Determine overall status
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (!vaultAccessible || indexState === 'error') {
        status = 'unhealthy';
      } else if (indexState === 'building' || indexStale || recommendations.length > 0) {
        status = 'degraded';
      } else {
        status = 'healthy';
      }

      // Detect periodic note conventions (only when index is ready)
      let periodicNotes: PeriodicNoteInfo[] | undefined;
      if (indexBuilt) {
        const types = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
        periodicNotes = types.map(type => {
          const result = detectPeriodicNotes(index, type);
          return {
            type: result.type,
            detected: result.detected,
            folder: result.folder,
            pattern: result.pattern,
            today_path: result.today_path,
            today_exists: result.today_exists,
          };
        }).filter(p => p.detected);
      }

      // Include config info
      const config = getConfig();
      const configInfo = Object.keys(config).length > 0
        ? config as unknown as Record<string, unknown>
        : undefined;

      // Get last rebuild event from StateDb
      let lastRebuild: HealthCheckOutput['last_rebuild'];
      const stateDb = getStateDb();
      if (stateDb) {
        try {
          const events = getRecentIndexEvents(stateDb, 1);
          if (events.length > 0) {
            const event = events[0];
            lastRebuild = {
              trigger: event.trigger,
              timestamp: event.timestamp,
              duration_ms: event.duration_ms,
              ago_seconds: Math.floor((Date.now() - event.timestamp) / 1000),
            };
          }
        } catch {
          // Ignore errors reading index events
        }
      }

      const ftsState = getFTS5State();

      const output: HealthCheckOutput = {
        status,
        schema_version: SCHEMA_VERSION,
        vault_accessible: vaultAccessible,
        vault_path: vaultPath,
        index_state: indexState,
        index_progress: indexState === 'building' ? indexProgress : undefined,
        index_error: indexState === 'error' && indexErrorObj ? indexErrorObj.message : undefined,
        index_built: indexBuilt,
        index_age_seconds: indexAge,
        index_stale: indexStale,
        note_count: noteCount,
        entity_count: entityCount,
        tag_count: tagCount,
        periodic_notes: periodicNotes && periodicNotes.length > 0 ? periodicNotes : undefined,
        config: configInfo,
        last_rebuild: lastRebuild,
        fts5_ready: ftsState.ready,
        fts5_building: ftsState.building,
        embeddings_ready: hasEmbeddingsIndex(),
        embeddings_count: getEmbeddingsCount(),
        recommendations,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    }
  );

  // get_vault_stats - Comprehensive vault statistics
  const TagStatSchema = z.object({
    tag: z.string().describe('The tag name'),
    count: z.coerce.number().describe('Number of notes with this tag'),
  });

  const FolderStatSchema = z.object({
    folder: z.string().describe('Folder path'),
    note_count: z.coerce.number().describe('Number of notes in this folder'),
  });

  const OrphanStatsSchema = z.object({
    total: z.coerce.number().describe('Total orphan notes (no backlinks)'),
    periodic: z.coerce.number().describe('Orphan periodic notes (daily/weekly/monthly - expected)'),
    content: z.coerce.number().describe('Orphan content notes (non-periodic - may need linking)'),
  });

  const GetVaultStatsOutputSchema = {
    total_notes: z.coerce.number().describe('Total number of notes in the vault'),
    total_links: z.coerce.number().describe('Total number of wikilinks'),
    total_tags: z.coerce.number().describe('Total number of unique tags'),
    orphan_notes: OrphanStatsSchema.describe('Orphan notes breakdown'),
    broken_links: z.coerce.number().describe('Links pointing to non-existent notes'),
    average_links_per_note: z.coerce.number().describe('Average outgoing links per note'),
    most_linked_notes: z
      .array(
        z.object({
          path: z.string(),
          backlinks: z.number(),
        })
      )
      .describe('Top 10 most linked-to notes'),
    top_tags: z.array(TagStatSchema).describe('Top 20 most used tags'),
    folders: z.array(FolderStatSchema).describe('Note counts by top-level folder'),
    recent_activity: z.object({
      period_days: z.number(),
      notes_modified: z.number(),
      notes_created: z.number(),
      most_active_day: z.string().nullable(),
      daily_counts: z.record(z.number()),
    }).describe('Activity summary for the last 7 days'),
  };

  type VaultStatsOutput = {
    total_notes: number;
    total_links: number;
    total_tags: number;
    orphan_notes: {
      total: number;
      periodic: number;
      content: number;
    };
    broken_links: number;
    average_links_per_note: number;
    most_linked_notes: Array<{ path: string; backlinks: number }>;
    top_tags: Array<{ tag: string; count: number }>;
    folders: Array<{ folder: string; note_count: number }>;
    recent_activity: {
      period_days: number;
      notes_modified: number;
      notes_created: number;
      most_active_day: string | null;
      daily_counts: Record<string, number>;
    };
  };

  /**
   * Check if a note is a periodic note (daily, weekly, monthly, quarterly, yearly).
   * Periodic notes naturally have fewer backlinks - they're time-based, not topic-based.
   */
  function isPeriodicNote(path: string): boolean {
    const filename = path.split('/').pop() || '';
    const nameWithoutExt = filename.replace(/\.md$/, '');

    // Date patterns for periodic notes
    const patterns = [
      /^\d{4}-\d{2}-\d{2}$/,           // YYYY-MM-DD (daily)
      /^\d{4}-W\d{2}$/,                // YYYY-Wnn (weekly)
      /^\d{4}-\d{2}$/,                 // YYYY-MM (monthly)
      /^\d{4}-Q[1-4]$/,                // YYYY-Qn (quarterly)
      /^\d{4}$/,                       // YYYY (yearly)
    ];

    // Also check common folder names
    const periodicFolders = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'journal', 'journals'];
    const folder = path.split('/')[0]?.toLowerCase() || '';

    return patterns.some(p => p.test(nameWithoutExt)) || periodicFolders.includes(folder);
  }

  server.registerTool(
    'get_vault_stats',
    {
      title: 'Get Vault Statistics',
      description:
        'Get comprehensive statistics about the vault: note counts, link metrics, tag usage, and folder distribution.',
      inputSchema: {},
      outputSchema: GetVaultStatsOutputSchema,
    },
    async (): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: VaultStatsOutput;
    }> => {
      const index = getIndex();

      // Count totals
      const totalNotes = index.notes.size;
      let totalLinks = 0;
      let brokenLinks = 0;
      let orphanTotal = 0;
      let orphanPeriodic = 0;
      let orphanContent = 0;

      // Count links and broken links (only count as broken if similar entity exists)
      for (const note of index.notes.values()) {
        totalLinks += note.outlinks.length;

        for (const link of note.outlinks) {
          if (!resolveTarget(index, link.target)) {
            // Only count as broken if there's a similar entity (typo detection)
            const similar = findSimilarEntity(index, link.target);
            if (similar) {
              brokenLinks++;
            }
          }
        }
      }

      // Count orphans, separating periodic notes from content notes
      for (const note of index.notes.values()) {
        const backlinks = getBacklinksForNote(index, note.path);
        if (backlinks.length === 0) {
          orphanTotal++;
          if (isPeriodicNote(note.path)) {
            orphanPeriodic++;
          } else {
            orphanContent++;
          }
        }
      }

      // Calculate most linked notes
      const linkCounts: Array<{ path: string; backlinks: number }> = [];
      for (const note of index.notes.values()) {
        const backlinks = getBacklinksForNote(index, note.path);
        if (backlinks.length > 0) {
          linkCounts.push({ path: note.path, backlinks: backlinks.length });
        }
      }
      linkCounts.sort((a, b) => b.backlinks - a.backlinks);
      const mostLinkedNotes = linkCounts.slice(0, 10);

      // Calculate top tags
      const tagStats: Array<{ tag: string; count: number }> = [];
      for (const [tag, notes] of index.tags) {
        tagStats.push({ tag, count: notes.size });
      }
      tagStats.sort((a, b) => b.count - a.count);
      const topTags = tagStats.slice(0, 20);

      // Calculate folder distribution
      const folderCounts = new Map<string, number>();
      for (const note of index.notes.values()) {
        const parts = note.path.split('/');
        const folder = parts.length > 1 ? parts[0] : '(root)';

        folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
      }

      const folders = Array.from(folderCounts.entries())
        .map(([folder, count]) => ({ folder, note_count: count }))
        .sort((a, b) => b.note_count - a.note_count);

      // Get recent activity summary (last 7 days)
      const recentActivity = getActivitySummary(index, 7);

      const output: VaultStatsOutput = {
        total_notes: totalNotes,
        total_links: totalLinks,
        total_tags: index.tags.size,
        orphan_notes: {
          total: orphanTotal,
          periodic: orphanPeriodic,
          content: orphanContent,
        },
        broken_links: brokenLinks,
        average_links_per_note: totalNotes > 0 ? Math.round((totalLinks / totalNotes) * 100) / 100 : 0,
        most_linked_notes: mostLinkedNotes,
        top_tags: topTags,
        folders,
        recent_activity: recentActivity,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    }
  );
}
