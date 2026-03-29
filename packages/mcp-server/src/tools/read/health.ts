/**
 * Vault health tools - diagnostics and statistics
 */

import * as fs from 'fs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../../core/read/types.js';
import { resolveTarget, getBacklinksForNote, findSimilarEntity, getIndexState, getIndexProgress, getIndexError, normalizeTarget, type IndexState } from '../../core/read/graph.js';
import { detectPeriodicNotes } from './periodic.js';
import { getActivitySummary } from './temporal.js';
import type { FlywheelConfig } from '../../core/read/config.js';
import { SCHEMA_VERSION, type StateDb } from '@velvetmonkey/vault-core';
import { getRecentIndexEvents, getRecentPipelineEvent, getLastSuccessfulEvent, getLastEventByTrigger, type PipelineStep } from '../../core/shared/indexActivity.js';
import type { PipelineActivity } from '../../core/read/watch/pipeline.js';
import { getFTS5State } from '../../core/read/fts5.js';
import { hasEmbeddingsIndex, isEmbeddingsBuilding, getEmbeddingsCount, getActiveModelId, diagnoseEmbeddings } from '../../core/read/embeddings.js';
import { isTaskCacheReady, isTaskCacheBuilding } from '../../core/read/taskCache.js';
import { getServerLog, type LogEntry } from '../../core/shared/serverLog.js';
import { getSweepResults, type SweepResults } from '../../core/read/sweep.js';
import { getSuppressedCount, getEntityStats, getWeightedEntityStats, computePosteriorMean, PRIOR_ALPHA, PRIOR_BETA, SUPPRESSION_MIN_OBSERVATIONS, SUPPRESSION_POSTERIOR_THRESHOLD } from '../../core/write/wikilinkFeedback.js';
import { getEntityEmbeddingsCount } from '../../core/read/embeddings.js';
import type { WatcherStatus } from '../../core/read/watch/types.js';
import { TOOL_CATEGORY, parseEnabledCategories, ALL_CATEGORIES } from '../../config.js';
import { getRecentInvocations } from '../../core/shared/toolTracking.js';
import { searchFTS5 } from '../../core/read/fts5.js';
import { recordBenchmark, getBenchmarkHistory, getBenchmarkTrends } from '../../core/shared/benchmarks.js';

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
  getStateDb: () => StateDb | null = () => null,
  getWatcherStatus: () => WatcherStatus | null = () => null,
  getVersion: () => string = () => 'unknown',
  getPipelineActivityState: () => Readonly<PipelineActivity> | null = () => null,
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
    vault_health_score: z.coerce.number().describe('Composite vault health score (0-100)'),
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
    link_count: z.coerce.number().describe('Total number of outgoing wikilinks'),
    periodic_notes: z.array(PeriodicNoteInfoSchema).optional().describe('Detected periodic note conventions'),
    config: z.record(z.unknown()).optional().describe('Current flywheel config (paths, templates, etc.)'),
    last_rebuild: z.object({
      trigger: z.string(),
      timestamp: z.number(),
      duration_ms: z.number(),
      ago_seconds: z.number(),
    }).optional().describe('Most recent index rebuild event'),
    last_pipeline: z.object({
      timestamp: z.number(),
      trigger: z.string(),
      duration_ms: z.number(),
      files_changed: z.number().nullable(),
      changed_paths: z.array(z.string()).nullable(),
      steps: z.array(z.object({
        name: z.string(),
        duration_ms: z.number(),
        input: z.record(z.unknown()),
        output: z.record(z.unknown()),
        skipped: z.boolean().optional(),
        skip_reason: z.string().optional(),
      })),
    }).optional().describe('Most recent watcher pipeline run with per-step timing'),
    recent_pipelines: z.array(z.object({
      timestamp: z.number(),
      trigger: z.string(),
      duration_ms: z.number(),
      files_changed: z.number().nullable(),
      changed_paths: z.array(z.string()).nullable(),
      steps: z.array(z.object({
        name: z.string(),
        duration_ms: z.number(),
        input: z.record(z.unknown()),
        output: z.record(z.unknown()),
        skipped: z.boolean().optional(),
        skip_reason: z.string().optional(),
      })),
    })).optional().describe('Up to 5 most recent pipeline runs with steps data'),
    fts5_ready: z.boolean().describe('Whether the FTS5 keyword search index is ready'),
    fts5_building: z.boolean().describe('Whether the FTS5 keyword search index is currently building'),
    embeddings_building: z.boolean().describe('Whether semantic embeddings are currently building'),
    embeddings_ready: z.boolean().describe('Whether semantic embeddings have been built (enables hybrid keyword+semantic search)'),
    embeddings_count: z.coerce.number().describe('Number of notes with semantic embeddings'),
    embedding_model: z.string().optional().describe('Active embedding model ID (when embeddings are built)'),
    embedding_diagnosis: z.object({
      healthy: z.boolean(),
      checks: z.array(z.object({
        name: z.string(),
        status: z.enum(['ok', 'stale', 'warning']),
        detail: z.string(),
      })),
      counts: z.object({
        embedded: z.coerce.number(),
        vaultNotes: z.coerce.number(),
        orphaned: z.coerce.number(),
        missing: z.coerce.number(),
      }),
    }).optional().describe('Detailed embedding health diagnosis (when embeddings exist)'),
    tasks_ready: z.boolean().describe('Whether the task cache is ready to serve queries'),
    tasks_building: z.boolean().describe('Whether the task cache is currently rebuilding'),
    watcher_state: z.enum(['starting', 'ready', 'rebuilding', 'dirty', 'error']).optional()
      .describe('Current file watcher state'),
    watcher_pending: z.coerce.number().optional()
      .describe('Number of pending file events in the watcher queue'),
    last_index_activity_at: z.number().optional()
      .describe('Epoch ms of latest successful index event (any trigger)'),
    last_index_activity_ago_seconds: z.coerce.number().optional()
      .describe('Seconds since last successful index event'),
    last_full_rebuild_at: z.number().optional()
      .describe('Epoch ms of latest startup_build or manual_refresh event'),
    last_watcher_batch_at: z.number().optional()
      .describe('Epoch ms of latest watcher batch event'),
    pipeline_activity: z.object({
      busy: z.boolean(),
      current_step: z.string().nullable(),
      started_at: z.number().nullable(),
      progress: z.string().nullable(),
      last_completed_ago_seconds: z.number().nullable(),
    }).optional().describe('Live pipeline activity state'),
    dead_link_count: z.coerce.number().optional().describe('Total number of broken/dead wikilinks across the vault (full mode only)'),
    top_dead_link_targets: z.array(z.object({
      target: z.string().describe('The dead link target'),
      mention_count: z.coerce.number().describe('How many notes reference this dead target'),
    })).optional().describe('Top 5 most-referenced dead link targets (highest-ROI candidates to create, full mode only)'),
    sweep: z.object({
      last_sweep_at: z.number().describe('When the last background sweep completed (ms epoch)'),
      sweep_duration_ms: z.number().describe('How long the last sweep took'),
      dead_link_count: z.number().describe('Dead links found by sweep'),
      top_dead_targets: z.array(z.object({
        target: z.string(),
        wikilink_references: z.number(),
        content_mentions: z.number(),
      })).describe('Top dead link targets with FTS5 content mention counts'),
      top_unlinked_entities: z.array(z.object({
        entity: z.string(),
        path: z.string(),
        unlinked_mentions: z.number(),
      })).describe('Entities with the most unlinked plain-text mentions'),
    }).optional().describe('Background sweep results (graph hygiene metrics, updated every 5 min)'),
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
    vault_health_score: number;
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
    link_count: number;
    periodic_notes?: PeriodicNoteInfo[];
    config?: Record<string, unknown>;
    last_rebuild?: {
      trigger: string;
      timestamp: number;
      duration_ms: number;
      ago_seconds: number;
    };
    last_pipeline?: {
      timestamp: number;
      trigger: string;
      duration_ms: number;
      files_changed: number | null;
      changed_paths: string[] | null;
      steps: PipelineStep[];
    };
    recent_pipelines?: Array<{
      timestamp: number;
      trigger: string;
      duration_ms: number;
      files_changed: number | null;
      changed_paths: string[] | null;
      steps: PipelineStep[];
    }>;
    fts5_ready: boolean;
    fts5_building: boolean;
    embeddings_building: boolean;
    embeddings_ready: boolean;
    embeddings_count: number;
    embedding_model?: string;
    embedding_diagnosis?: {
      healthy: boolean;
      checks: Array<{ name: string; status: 'ok' | 'stale' | 'warning'; detail: string }>;
      counts: { embedded: number; vaultNotes: number; orphaned: number; missing: number };
    };
    tasks_ready: boolean;
    tasks_building: boolean;
    watcher_state?: 'starting' | 'ready' | 'rebuilding' | 'dirty' | 'error';
    watcher_pending?: number;
    last_index_activity_at?: number;
    last_index_activity_ago_seconds?: number;
    last_full_rebuild_at?: number;
    last_watcher_batch_at?: number;
    pipeline_activity?: {
      busy: boolean;
      current_step: string | null;
      started_at: number | null;
      progress: string | null;
      last_completed_ago_seconds: number | null;
    };
    dead_link_count?: number;
    top_dead_link_targets?: Array<{ target: string; mention_count: number }>;
    sweep?: SweepResults;
    recommendations: string[];
  };

  server.registerTool(
    'health_check',
    {
      title: 'Health Check',
      description:
        'Check MCP server health status. Returns vault accessibility, index freshness, and recommendations. Use at session start to verify MCP is working correctly. ' +
        'Pass mode="summary" (default) for lightweight polling or mode="full" for complete diagnostics.',
      inputSchema: {
        mode: z.enum(['summary', 'full']).optional().default('summary')
          .describe('Output mode: "summary" omits config, periodic notes, dead links, sweep, and recent pipelines; "full" returns everything'),
      },
      outputSchema: HealthCheckOutputSchema,
    },
    async ({ mode = 'summary' }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: HealthCheckOutput;
    }> => {
      const isFull = mode === 'full';
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

      // Check database integrity
      let dbIntegrityFailed = false;
      const stateDb = getStateDb();
      if (stateDb) {
        try {
          const result = stateDb.db.pragma('quick_check') as Array<Record<string, string>>;
          const ok = result.length === 1 && Object.values(result[0])[0] === 'ok';
          if (!ok) {
            dbIntegrityFailed = true;
            recommendations.push(`Database integrity check failed: ${Object.values(result[0])[0] ?? 'unknown error'}`);
          }
        } catch (err) {
          dbIntegrityFailed = true;
          recommendations.push(`Database integrity check error: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Check index status
      const indexBuilt = indexState === 'ready' && index !== undefined && index.notes !== undefined;

      // Canonical timestamps from index_events
      let lastIndexActivityAt: number | undefined;
      let lastFullRebuildAt: number | undefined;
      let lastWatcherBatchAt: number | undefined;
      if (stateDb) {
        try {
          const lastAny = getLastSuccessfulEvent(stateDb);
          if (lastAny) lastIndexActivityAt = lastAny.timestamp;
          const lastBuild = getLastEventByTrigger(stateDb, 'startup_build');
          const lastManual = getLastEventByTrigger(stateDb, 'manual_refresh');
          lastFullRebuildAt = Math.max(lastBuild?.timestamp ?? 0, lastManual?.timestamp ?? 0) || undefined;
          const lastWatcher = getLastEventByTrigger(stateDb, 'watcher');
          if (lastWatcher) lastWatcherBatchAt = lastWatcher.timestamp;
        } catch { /* ignore */ }
      }

      // Use last index activity for freshness (not builtAt which may lag)
      const freshnessTimestamp = lastIndexActivityAt ?? (indexBuilt && index.builtAt ? index.builtAt.getTime() : undefined);
      const indexAge = freshnessTimestamp
        ? Math.floor((Date.now() - freshnessTimestamp) / 1000)
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
      let linkCount = 0;
      if (indexBuilt) {
        for (const note of index.notes.values()) linkCount += note.outlinks.length;
      }

      if (indexBuilt && noteCount === 0 && vaultAccessible) {
        recommendations.push('No notes found in vault. Is PROJECT_PATH pointing to a markdown vault?');
      }

      // Determine overall status
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (!vaultAccessible || indexState === 'error' || dbIntegrityFailed) {
        status = 'unhealthy';
      } else if (indexState === 'building' || indexStale || recommendations.length > 0) {
        status = 'degraded';
      } else {
        status = 'healthy';
      }

      // Detect periodic note conventions (only when index is ready, full mode only)
      let periodicNotes: PeriodicNoteInfo[] | undefined;
      if (isFull && indexBuilt) {
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

      // Include config info (full mode only)
      let configInfo: Record<string, unknown> | undefined;
      if (isFull) {
        const config = getConfig();
        configInfo = Object.keys(config).length > 0
          ? config as unknown as Record<string, unknown>
          : undefined;
      }

      // Get last rebuild event from StateDb
      let lastRebuild: HealthCheckOutput['last_rebuild'];
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

      // Get last pipeline run (most recent event with steps data — survives restarts)
      let lastPipeline: HealthCheckOutput['last_pipeline'];
      let recentPipelines: HealthCheckOutput['recent_pipelines'];
      if (stateDb) {
        try {
          const evt = getRecentPipelineEvent(stateDb);
          if (evt && evt.steps && evt.steps.length > 0) {
            lastPipeline = {
              timestamp: evt.timestamp,
              trigger: evt.trigger,
              duration_ms: evt.duration_ms,
              files_changed: evt.files_changed,
              changed_paths: evt.changed_paths,
              steps: evt.steps,
            };
          }
        } catch {
          // Ignore errors reading pipeline data
        }

        // Recent pipeline events (last 5 with steps) — full mode only
        if (isFull) {
          try {
            const events = getRecentIndexEvents(stateDb, 10)
              .filter(e => e.steps && e.steps.length > 0)
              .slice(0, 5);
            if (events.length > 0) {
              recentPipelines = events.map(e => ({
                timestamp: e.timestamp,
                trigger: e.trigger,
                duration_ms: e.duration_ms,
                files_changed: e.files_changed,
                changed_paths: e.changed_paths,
                steps: e.steps!,
              }));
            }
          } catch {
            // Ignore errors reading recent pipeline data
          }
        }
      }

      const ftsState = getFTS5State();

      // Dead link scan — full mode only (iterates all outlinks)
      let deadLinkCount = 0;
      let topDeadLinkTargets: Array<{ target: string; mention_count: number }> = [];
      if (isFull && indexBuilt) {
        const deadTargetCounts = new Map<string, number>();
        for (const note of index.notes.values()) {
          for (const link of note.outlinks) {
            if (!resolveTarget(index, link.target)) {
              deadLinkCount++;
              const key = link.target.toLowerCase();
              deadTargetCounts.set(key, (deadTargetCounts.get(key) || 0) + 1);
            }
          }
        }
        topDeadLinkTargets = Array.from(deadTargetCounts.entries())
          .map(([target, mention_count]) => ({ target, mention_count }))
          .sort((a, b) => b.mention_count - a.mention_count)
          .slice(0, 5);
      }

      // Compute vault health score (0-100)
      let vault_health_score = 0;
      if (indexBuilt && noteCount > 0) {
        // Link density: avg outlinks per note, target 3+
        const avgOutlinks = linkCount / noteCount;
        const linkDensity = Math.min(1, avgOutlinks / 3);

        // Orphan ratio: notes with 0 backlinks (excluding periodic notes)
        let orphanCount = 0;
        for (const note of index.notes.values()) {
          const bl = index.backlinks.get(normalizeTarget(note.path));
          if (!bl || bl.length === 0) orphanCount++;
        }
        const orphanRatio = 1 - (orphanCount / noteCount);

        // Dead link ratio
        const totalLinks = linkCount > 0 ? linkCount : 1;
        const deadLinkRatio = 1 - (deadLinkCount / totalLinks);

        // Frontmatter coverage
        let notesWithFm = 0;
        for (const note of index.notes.values()) {
          if (Object.keys(note.frontmatter).length > 0) notesWithFm++;
        }
        const fmCoverage = notesWithFm / noteCount;

        // Freshness: notes modified in last 90 days
        const freshCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
        let freshCount = 0;
        for (const note of index.notes.values()) {
          if (note.modified && note.modified.getTime() > freshCutoff) freshCount++;
        }
        const freshness = freshCount / noteCount;

        // Entity coverage: target 1 entity per 2 notes
        const entityCoverage = Math.min(1, entityCount / (noteCount * 0.5));

        // Weighted composite
        vault_health_score = Math.round(
          (linkDensity * 25 +
           orphanRatio * 20 +
           deadLinkRatio * 15 +
           fmCoverage * 15 +
           freshness * 15 +
           entityCoverage * 10)
        );
      }

      // Pipeline activity (always included — lightweight process-local read)
      const activity = getPipelineActivityState();
      const pipelineActivity = {
        busy: activity?.busy ?? false,
        current_step: activity?.current_step ?? null,
        started_at: activity?.started_at ?? null,
        progress: activity && activity.busy && activity.total_steps > 0
          ? `${activity.completed_steps}/${activity.total_steps} steps`
          : null,
        last_completed_ago_seconds: activity?.last_completed_at
          ? Math.floor((Date.now() - activity.last_completed_at) / 1000)
          : null,
      };

      const output: HealthCheckOutput = {
        status,
        vault_health_score,
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
        link_count: linkCount,
        periodic_notes: periodicNotes && periodicNotes.length > 0 ? periodicNotes : undefined,
        config: configInfo,
        last_rebuild: lastRebuild,
        last_pipeline: lastPipeline,
        recent_pipelines: recentPipelines,
        fts5_ready: ftsState.ready,
        fts5_building: ftsState.building,
        embeddings_building: isEmbeddingsBuilding(),
        embeddings_ready: hasEmbeddingsIndex(),
        embeddings_count: getEmbeddingsCount(),
        embedding_model: hasEmbeddingsIndex() ? getActiveModelId() : undefined,
        embedding_diagnosis: isFull && hasEmbeddingsIndex() ? diagnoseEmbeddings(vaultPath) : undefined,
        tasks_ready: isTaskCacheReady(),
        tasks_building: isTaskCacheBuilding(),
        watcher_state: getWatcherStatus()?.state,
        watcher_pending: getWatcherStatus()?.pendingEvents,
        last_index_activity_at: lastIndexActivityAt,
        last_index_activity_ago_seconds: lastIndexActivityAt
          ? Math.floor((Date.now() - lastIndexActivityAt) / 1000) : undefined,
        last_full_rebuild_at: lastFullRebuildAt,
        last_watcher_batch_at: lastWatcherBatchAt,
        pipeline_activity: pipelineActivity,
        dead_link_count: isFull ? deadLinkCount : undefined,
        top_dead_link_targets: isFull ? topDeadLinkTargets : undefined,
        sweep: isFull ? (getSweepResults() ?? undefined) : undefined,
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

  // pipeline_status — live pipeline activity surface
  server.registerTool(
    'pipeline_status',
    {
      title: 'Pipeline Status',
      description:
        'Live pipeline activity: whether a batch is running, current step, and recent completions. ' +
        'Lightweight process-local read — no DB queries unless detail=true.',
      inputSchema: {
        detail: z.boolean().optional().default(false)
          .describe('Include per-step timings for recent runs'),
      },
    },
    async ({ detail = false }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
    }> => {
      const activity = getPipelineActivityState();
      const now = Date.now();

      const output: Record<string, unknown> = {
        busy: activity?.busy ?? false,
        trigger: activity?.trigger ?? null,
        started_at: activity?.started_at ?? null,
        age_ms: activity?.busy && activity.started_at ? now - activity.started_at : null,
        current_step: activity?.current_step ?? null,
        progress: activity && activity.busy && activity.total_steps > 0
          ? `${activity.completed_steps}/${activity.total_steps} steps`
          : null,
        pending_events: activity?.pending_events ?? 0,
        last_completed: activity?.last_completed_at ? {
          at: activity.last_completed_at,
          ago_seconds: Math.floor((now - activity.last_completed_at) / 1000),
          trigger: activity.last_completed_trigger,
          duration_ms: activity.last_completed_duration_ms,
          files: activity.last_completed_files,
          steps: activity.last_completed_steps,
        } : null,
      };

      if (detail) {
        const stateDb = getStateDb();
        if (stateDb) {
          try {
            const events = getRecentIndexEvents(stateDb, 10)
              .filter(e => e.steps && e.steps.length > 0)
              .slice(0, 5);
            output.recent_runs = events.map(e => ({
              timestamp: e.timestamp,
              trigger: e.trigger,
              duration_ms: e.duration_ms,
              files_changed: e.files_changed,
              steps: e.steps,
            }));
          } catch { /* ignore */ }
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
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

  // server_log — Query the in-memory activity log
  const LogEntrySchema = z.object({
    ts: z.number().describe('Unix timestamp (ms)'),
    component: z.string().describe('Source component'),
    message: z.string().describe('Log message'),
    level: z.enum(['info', 'warn', 'error']).describe('Log level'),
  });

  const ServerLogOutputSchema = {
    entries: z.array(LogEntrySchema).describe('Log entries (oldest first)'),
    server_uptime_ms: z.coerce.number().describe('Server uptime in milliseconds'),
  };

  type ServerLogOutput = {
    entries: LogEntry[];
    server_uptime_ms: number;
  };

  server.registerTool(
    'server_log',
    {
      title: 'Server Activity Log',
      description:
        'Query the server activity log. Returns timestamped entries for startup stages, indexing progress, errors, and runtime events. Useful for diagnosing startup issues or checking what the server has been doing.',
      inputSchema: {
        since: z.coerce.number().optional().describe('Only return entries after this Unix timestamp (ms)'),
        component: z.string().optional().describe('Filter by component (server, index, fts5, semantic, tasks, watcher, statedb, config)'),
        limit: z.coerce.number().optional().describe('Max entries to return (default 100)'),
      },
      outputSchema: ServerLogOutputSchema,
    },
    async (params: { since?: number; component?: string; limit?: number }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: ServerLogOutput;
    }> => {
      const result = getServerLog({
        since: params.since,
        component: params.component,
        limit: params.limit,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };
    }
  );

  // flywheel_doctor — Comprehensive diagnostic report
  server.registerTool(
    'flywheel_doctor',
    {
      title: 'Flywheel Doctor',
      description:
        'Run comprehensive vault diagnostics and produce a one-page report. ' +
        'Actively checks for problems (unlike health_check which reports status). ' +
        'Checks: schema version, index freshness, embedding coverage, suppression health, ' +
        'cache freshness, FTS5 integrity, watcher state, and disk usage.',
      inputSchema: {},
    },
    async (): Promise<{
      content: Array<{ type: 'text'; text: string }>;
    }> => {
      const checks: Array<{
        name: string;
        status: 'ok' | 'warning' | 'error';
        detail: string;
        fix?: string;
      }> = [];

      const index = getIndex();
      const vaultPath = getVaultPath();
      const stateDb = getStateDb();
      const watcherStatus = getWatcherStatus();

      // 1. Schema version
      checks.push({
        name: 'schema_version',
        status: 'ok',
        detail: `Schema version ${SCHEMA_VERSION}`,
      });

      // 2. Vault accessibility
      try {
        fs.accessSync(vaultPath, fs.constants.R_OK | fs.constants.W_OK);
        checks.push({ name: 'vault_access', status: 'ok', detail: `Vault readable and writable at ${vaultPath}` });
      } catch {
        checks.push({ name: 'vault_access', status: 'error', detail: `Vault not accessible at ${vaultPath}`, fix: 'Check PROJECT_PATH environment variable and directory permissions' });
      }

      // 3. Index activity freshness (uses index_events, not builtAt)
      const indexState = getIndexState();
      const indexBuilt = indexState === 'ready' && index?.notes !== undefined;
      if (indexState === 'ready' && indexBuilt) {
        let activityAge: number | null = null;
        if (stateDb) {
          try {
            const lastEvt = getLastSuccessfulEvent(stateDb);
            if (lastEvt) activityAge = Math.floor((Date.now() - lastEvt.timestamp) / 1000);
          } catch { /* ignore */ }
        }
        // Fall back to builtAt if no events recorded yet
        const age = activityAge ?? Math.floor((Date.now() - index.builtAt.getTime()) / 1000);
        if (age > STALE_THRESHOLD_SECONDS) {
          checks.push({ name: 'index_activity', status: 'warning', detail: `Last index activity ${Math.floor(age / 60)} minutes ago`, fix: 'Run refresh_index to rebuild' });
        } else {
          checks.push({ name: 'index_activity', status: 'ok', detail: `Last activity ${age}s ago, ${index.notes.size} notes, ${index.entities.size} entities` });
        }
        // Separate snapshot age check (informational only)
        const snapshotAge = Math.floor((Date.now() - index.builtAt.getTime()) / 1000);
        checks.push({ name: 'index_snapshot_age', status: 'ok', detail: `In-memory snapshot built ${snapshotAge}s ago` });
      } else if (indexState === 'building') {
        const progress = getIndexProgress();
        checks.push({ name: 'index_activity', status: 'warning', detail: `Index building (${progress.parsed}/${progress.total} files)` });
      } else {
        const err = getIndexError();
        checks.push({ name: 'index_activity', status: 'error', detail: `Index in ${indexState} state${err ? ': ' + err.message : ''}`, fix: 'Run refresh_index' });
      }

      // 4. Embedding coverage
      const embReady = hasEmbeddingsIndex();
      const embCount = getEmbeddingsCount();
      const noteCount = indexBuilt ? index.notes.size : 0;
      if (embReady && noteCount > 0) {
        const coverage = Math.round((embCount / noteCount) * 100);
        if (coverage < 50) {
          checks.push({ name: 'embedding_coverage', status: 'warning', detail: `${embCount}/${noteCount} notes embedded (${coverage}%)`, fix: 'Run init_semantic with force=true to rebuild' });
        } else {
          checks.push({ name: 'embedding_coverage', status: 'ok', detail: `${embCount}/${noteCount} notes embedded (${coverage}%), model: ${getActiveModelId() || 'default'}` });
        }
        // Entity embeddings
        const entityEmbCount = getEntityEmbeddingsCount();
        const entityCount = indexBuilt ? index.entities.size : 0;
        if (entityCount > 0) {
          const entityCoverage = Math.round((entityEmbCount / entityCount) * 100);
          checks.push({ name: 'entity_embedding_coverage', status: entityCoverage < 50 ? 'warning' : 'ok', detail: `${entityEmbCount}/${entityCount} entities embedded (${entityCoverage}%)` });
        }
      } else if (!embReady) {
        checks.push({ name: 'embedding_coverage', status: 'warning', detail: 'Semantic embeddings not built', fix: 'Run init_semantic to enable hybrid search' });
      } else if (isEmbeddingsBuilding()) {
        checks.push({ name: 'embedding_coverage', status: 'warning', detail: 'Embedding build in progress' });
      }

      // 5. FTS5 state
      const fts = getFTS5State();
      if (fts.ready) {
        checks.push({ name: 'fts5', status: 'ok', detail: `FTS5 ready, ${fts.noteCount ?? 0} notes indexed` });
      } else if (fts.building) {
        checks.push({ name: 'fts5', status: 'warning', detail: 'FTS5 index building' });
      } else {
        checks.push({ name: 'fts5', status: 'error', detail: 'FTS5 not available', fix: 'Will build automatically on next index rebuild' });
      }

      // 6. Watcher state
      if (watcherStatus) {
        if (watcherStatus.state === 'ready') {
          checks.push({ name: 'watcher', status: 'ok', detail: `Watcher running, ${watcherStatus.pendingEvents ?? 0} pending events` });
        } else if (watcherStatus.state === 'error') {
          checks.push({ name: 'watcher', status: 'error', detail: 'Watcher in error state', fix: 'Restart the MCP server' });
        } else {
          checks.push({ name: 'watcher', status: 'warning', detail: `Watcher state: ${watcherStatus.state}${watcherStatus.pendingEvents ? `, ${watcherStatus.pendingEvents} pending` : ''}` });
        }
      } else {
        checks.push({ name: 'watcher', status: 'warning', detail: 'No watcher status available' });
      }

      // 7. Task cache
      if (isTaskCacheReady()) {
        checks.push({ name: 'task_cache', status: 'ok', detail: 'Task cache ready' });
      } else if (isTaskCacheBuilding()) {
        checks.push({ name: 'task_cache', status: 'warning', detail: 'Task cache building' });
      } else {
        checks.push({ name: 'task_cache', status: 'warning', detail: 'Task cache not ready' });
      }

      // 8. Suppression health
      if (stateDb) {
        try {
          const suppressedCount = getSuppressedCount(stateDb);
          const stats = getEntityStats(stateDb);
          const entityCount = indexBuilt ? index.entities.size : 0;

          if (entityCount > 0 && suppressedCount > entityCount * 0.2) {
            checks.push({ name: 'suppression_health', status: 'warning', detail: `${suppressedCount} entities suppressed (${Math.round(suppressedCount / entityCount * 100)}% of total)`, fix: 'Review suppressed entities — high suppression rate may indicate overly aggressive feedback' });
          } else {
            checks.push({ name: 'suppression_health', status: 'ok', detail: `${suppressedCount} entities suppressed, ${stats.length} entities with feedback` });
          }
        } catch {
          checks.push({ name: 'suppression_health', status: 'ok', detail: 'No suppression data yet' });
        }
      }

      // 9. StateDb disk usage
      if (stateDb) {
        try {
          const dbPath = stateDb.db.name;
          if (dbPath && dbPath !== ':memory:') {
            const dbStat = fs.statSync(dbPath);
            const dbSizeMb = Math.round(dbStat.size / 1024 / 1024 * 10) / 10;
            let walSizeMb = 0;
            try {
              const walStat = fs.statSync(dbPath + '-wal');
              walSizeMb = Math.round(walStat.size / 1024 / 1024 * 10) / 10;
            } catch { /* no WAL file */ }

            if (walSizeMb > 100) {
              checks.push({ name: 'disk_usage', status: 'warning', detail: `StateDb: ${dbSizeMb}MB, WAL: ${walSizeMb}MB`, fix: 'WAL file is large. Consider running PRAGMA wal_checkpoint(TRUNCATE)' });
            } else {
              checks.push({ name: 'disk_usage', status: 'ok', detail: `StateDb: ${dbSizeMb}MB${walSizeMb > 0 ? `, WAL: ${walSizeMb}MB` : ''}` });
            }
          }
        } catch {
          checks.push({ name: 'disk_usage', status: 'ok', detail: 'Unable to check disk usage' });
        }
      }

      // 10. Cache freshness — co-occurrence
      if (stateDb) {
        try {
          const row = stateDb.db.prepare(
            `SELECT built_at FROM cooccurrence_cache LIMIT 1`
          ).get() as { built_at: number } | undefined;
          if (row) {
            const ageHours = Math.round((Date.now() - row.built_at) / 3600000 * 10) / 10;
            checks.push({ name: 'cooccurrence_cache', status: ageHours > 24 ? 'warning' : 'ok', detail: `Co-occurrence cache ${ageHours}h old`, ...(ageHours > 24 ? { fix: 'Will rebuild automatically on next watcher batch' } : {}) });
          } else {
            checks.push({ name: 'cooccurrence_cache', status: 'warning', detail: 'Co-occurrence cache not built', fix: 'Will build on next index rebuild' });
          }
        } catch {
          checks.push({ name: 'cooccurrence_cache', status: 'ok', detail: 'Co-occurrence cache check skipped' });
        }
      }

      // 11. Pipeline health (last pipeline run)
      if (stateDb) {
        try {
          const evt = getRecentPipelineEvent(stateDb);
          if (evt) {
            const ageMin = Math.round((Date.now() - evt.timestamp) / 60000);
            const failedSteps = evt.steps?.filter((s: PipelineStep) => s.skipped && s.skip_reason?.includes('error')) || [];
            if (failedSteps.length > 0) {
              checks.push({ name: 'pipeline', status: 'warning', detail: `Last pipeline ${ageMin}min ago (${evt.duration_ms}ms), ${failedSteps.length} failed steps: ${failedSteps.map((s: PipelineStep) => s.name).join(', ')}` });
            } else {
              checks.push({ name: 'pipeline', status: 'ok', detail: `Last pipeline ${ageMin}min ago, ${evt.duration_ms}ms, ${evt.steps?.length ?? 0} steps` });
            }
          }
        } catch {
          checks.push({ name: 'pipeline', status: 'ok', detail: 'No pipeline data' });
        }
      }

      // 12. Hub scores
      if (stateDb) {
        try {
          const hubStats = stateDb.db.prepare(
            `SELECT COUNT(*) as total, COUNT(CASE WHEN hub_score > 0 THEN 1 END) as with_score,
             MAX(hub_score) as max_score, ROUND(AVG(CASE WHEN hub_score > 0 THEN hub_score END), 1) as avg_score
             FROM entities`
          ).get() as { total: number; with_score: number; max_score: number; avg_score: number } | undefined;
          if (hubStats) {
            checks.push({ name: 'hub_scores', status: 'ok',
              detail: `${hubStats.with_score}/${hubStats.total} entities have hub scores (max: ${hubStats.max_score}, avg: ${hubStats.avg_score ?? 0})` });
          }
        } catch { /* skip */ }
      }

      // 13. Edge weights
      if (stateDb) {
        try {
          const edgeStats = stateDb.db.prepare(
            `SELECT COUNT(*) as total, COUNT(CASE WHEN weight > 1.0 THEN 1 END) as weighted,
             COUNT(CASE WHEN weight > 3.0 THEN 1 END) as strong,
             ROUND(AVG(weight), 2) as avg_weight
             FROM note_links WHERE weight IS NOT NULL`
          ).get() as { total: number; weighted: number; strong: number; avg_weight: number } | undefined;
          if (edgeStats && edgeStats.total > 0) {
            checks.push({ name: 'edge_weights', status: 'ok',
              detail: `${edgeStats.total} links, ${edgeStats.weighted} weighted (>${1.0}), ${edgeStats.strong} strong (>${3.0}), avg: ${edgeStats.avg_weight}` });
          }
        } catch { /* skip */ }
      }

      // 14. Content hashes
      if (stateDb) {
        try {
          const hashCount = stateDb.db.prepare(
            `SELECT COUNT(*) as count FROM content_hashes`
          ).get() as { count: number } | undefined;
          if (hashCount) {
            checks.push({ name: 'content_hashes', status: 'ok',
              detail: `${hashCount.count} content hashes cached` });
          }
        } catch { /* skip */ }
      }

      // Summary
      const errorCount = checks.filter(c => c.status === 'error').length;
      const warningCount = checks.filter(c => c.status === 'warning').length;
      const overallStatus = errorCount > 0 ? 'unhealthy' : warningCount > 0 ? 'needs_attention' : 'healthy';

      const output = {
        status: overallStatus,
        summary: `${checks.length} checks: ${checks.length - errorCount - warningCount} ok, ${warningCount} warnings, ${errorCount} errors`,
        checks,
        fixes: checks.filter(c => c.fix).map(c => ({ check: c.name, fix: c.fix })),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    }
  );

  // flywheel_trust_report — Auditable config + write activity manifest
  const WRITE_CATEGORIES = new Set(['write', 'note-ops', 'corrections', 'schema']);

  server.registerTool(
    'flywheel_trust_report',
    {
      title: 'Flywheel Trust Report',
      description:
        'Auditable manifest of what this server can do and what it has done. ' +
        'Returns active config/preset, enabled tool categories, transport mode, ' +
        'recent write operations, and enforced boundaries. ' +
        'Supports the cognitive sovereignty thesis with verifiable transparency.',
      inputSchema: {},
    },
    async (): Promise<{
      content: Array<{ type: 'text'; text: string }>;
    }> => {
      const version = getVersion();
      const vaultPath = getVaultPath();
      const stateDb = getStateDb();
      const watcherStatus = getWatcherStatus();

      // Transport
      const transportMode = (process.env.FLYWHEEL_TRANSPORT ?? 'stdio').toLowerCase();
      const httpPort = transportMode !== 'stdio' ? parseInt(process.env.FLYWHEEL_HTTP_PORT ?? '3111', 10) : undefined;
      const httpHost = transportMode !== 'stdio' ? (process.env.FLYWHEEL_HTTP_HOST ?? '127.0.0.1') : undefined;

      // Preset & categories
      const presetEnv = process.env.FLYWHEEL_TOOLS || process.env.FLYWHEEL_PRESET || 'default';
      const enabledCategories = parseEnabledCategories(presetEnv);
      const disabledCategories = ALL_CATEGORIES.filter(c => !enabledCategories.has(c));

      // Tool count
      const totalTools = Object.keys(TOOL_CATEGORY).length;
      const enabledTools = Object.entries(TOOL_CATEGORY).filter(([, cat]) => enabledCategories.has(cat)).length;

      // Recent write operations
      let recentWrites: Array<{
        timestamp: number;
        tool: string;
        success: boolean;
        duration_ms: number | null;
      }> = [];
      if (stateDb) {
        try {
          const recent = getRecentInvocations(stateDb, 50);
          recentWrites = recent
            .filter(inv => {
              const cat = TOOL_CATEGORY[inv.tool_name];
              return cat && WRITE_CATEGORIES.has(cat);
            })
            .slice(0, 10)
            .map(inv => ({
              timestamp: inv.timestamp,
              tool: inv.tool_name,
              success: inv.success,
              duration_ms: inv.duration_ms,
            }));
        } catch { /* no data yet */ }
      }

      const output = {
        version,
        transport_mode: transportMode,
        ...(httpPort !== undefined && { http_port: httpPort }),
        ...(httpHost !== undefined && { http_host: httpHost }),
        preset: presetEnv,
        enabled_categories: [...enabledCategories],
        disabled_categories: disabledCategories,
        tool_count: { enabled: enabledTools, total: totalTools },
        boundaries: {
          file_types: '*.md only',
          path_traversal: 'blocked (validatePath + symlink resolution)',
          sensitive_patterns: '86 patterns blocked',
          network: 'none (except one-time embedding model download)',
          git_scope: 'vault directory only',
          flywheel_dir: 'not accessible via mutation tools',
        },
        recent_writes: recentWrites,
        watcher: watcherStatus ? {
          state: watcherStatus.state,
          pending_events: watcherStatus.pendingEvents ?? 0,
        } : null,
        vault_path: vaultPath,
        generated_at: Date.now(),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      };
    }
  );

  // flywheel_benchmark — Longitudinal performance benchmarks
  server.registerTool(
    'flywheel_benchmark',
    {
      title: 'Flywheel Benchmark',
      description:
        'Run, record, and trend longitudinal performance benchmarks. ' +
        'Modes: "run" executes live benchmarks (search latency, entity lookup, index/watcher timing) and records results; ' +
        '"history" shows past benchmark results; "trends" shows regression/improvement analysis over time.',
      inputSchema: {
        mode: z.enum(['run', 'history', 'trends']).default('run')
          .describe('run = execute benchmarks, history = past results, trends = regression analysis'),
        benchmark: z.string().optional()
          .describe('Filter to a specific benchmark name (e.g. "search_latency")'),
        days_back: z.number().optional().default(30)
          .describe('For trends mode: how many days to analyze'),
        limit: z.number().optional().default(20)
          .describe('For history mode: max results to return'),
      },
    },
    async (params: {
      mode: 'run' | 'history' | 'trends';
      benchmark?: string;
      days_back?: number;
      limit?: number;
    }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
    }> => {
      const stateDb = getStateDb();
      if (!stateDb) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'StateDb not available' }) }] };
      }

      const version = getVersion();

      if (params.mode === 'history') {
        const history = getBenchmarkHistory(stateDb, params.benchmark, params.limit ?? 20);
        return { content: [{ type: 'text', text: JSON.stringify({ mode: 'history', results: history }, null, 2) }] };
      }

      if (params.mode === 'trends') {
        if (!params.benchmark) {
          // Get all unique benchmark names and trend each
          const names = stateDb.db.prepare(
            'SELECT DISTINCT benchmark FROM performance_benchmarks ORDER BY benchmark'
          ).all() as Array<{ benchmark: string }>;
          const trends = names.map(n => getBenchmarkTrends(stateDb, n.benchmark, params.days_back ?? 30));
          return { content: [{ type: 'text', text: JSON.stringify({ mode: 'trends', results: trends }, null, 2) }] };
        }
        const trend = getBenchmarkTrends(stateDb, params.benchmark, params.days_back ?? 30);
        return { content: [{ type: 'text', text: JSON.stringify({ mode: 'trends', results: [trend] }, null, 2) }] };
      }

      // mode === 'run'
      const results: Array<{
        benchmark: string;
        mean_ms: number;
        p50_ms?: number;
        p95_ms?: number;
        iterations: number;
      }> = [];

      // 1. search_latency — FTS5 search performance
      const ftsState = getFTS5State();
      if (ftsState.ready) {
        const times: number[] = [];
        const iterations = 5;
        for (let i = 0; i < iterations; i++) {
          const start = performance.now();
          searchFTS5(getVaultPath(), 'test', 10);
          times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        const mean = times.reduce((s, t) => s + t, 0) / times.length;
        const p50 = times[Math.floor(times.length * 0.5)];
        const p95 = times[Math.floor(times.length * 0.95)];
        const entry = { benchmark: 'search_latency', mean_ms: Math.round(mean * 100) / 100, p50_ms: Math.round(p50 * 100) / 100, p95_ms: Math.round(p95 * 100) / 100, iterations };
        results.push(entry);
        recordBenchmark(stateDb, { ...entry, version });
      }

      // 2. entity_lookup — time to read entity count from index
      {
        const start = performance.now();
        const index = getIndex();
        const _size = index.entities.size;
        const elapsed = performance.now() - start;
        const entry = { benchmark: 'entity_lookup', mean_ms: Math.round(elapsed * 100) / 100, iterations: 1 };
        results.push(entry);
        recordBenchmark(stateDb, { ...entry, version });
      }

      // 3. index_build_time — last recorded startup build duration
      {
        const row = stateDb.db.prepare(
          "SELECT duration_ms FROM index_events WHERE trigger = 'startup_build' ORDER BY timestamp DESC LIMIT 1"
        ).get() as { duration_ms: number } | undefined;
        if (row) {
          const entry = { benchmark: 'index_build_time', mean_ms: row.duration_ms, iterations: 1 };
          results.push(entry);
          recordBenchmark(stateDb, { ...entry, version });
        }
      }

      // 4. watcher_batch_time — last recorded watcher batch duration
      {
        const row = stateDb.db.prepare(
          "SELECT duration_ms FROM index_events WHERE trigger = 'watcher' ORDER BY timestamp DESC LIMIT 1"
        ).get() as { duration_ms: number } | undefined;
        if (row) {
          const entry = { benchmark: 'watcher_batch_time', mean_ms: row.duration_ms, iterations: 1 };
          results.push(entry);
          recordBenchmark(stateDb, { ...entry, version });
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ mode: 'run', version, results }, null, 2) }],
      };
    }
  );
}
