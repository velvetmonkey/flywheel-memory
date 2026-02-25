#!/usr/bin/env node
/**
 * Flywheel Memory - Unified local-first memory for AI agents
 *
 * 42 tools across 15 categories
 * - policy (unified: list, validate, preview, execute, author, revise)
 * - Temporal tools absorbed into search (modified_after/modified_before) + get_vault_stats (recent_activity)
 * - Dropped: policy_diff, policy_export, policy_import, get_contemporaneous_notes
 * - graph_analysis (unified: orphans, dead_ends, sources, hubs, stale)
 * - vault_schema (unified: frontmatter schema, conventions, incomplete, suggest_values)
 * - note_intelligence (unified: prose_patterns, suggest_frontmatter, wikilinks, cross_layer, compute)
 * - get_backlinks (absorbed find_bidirectional_links via include_bidirectional param)
 * - validate_links (absorbed find_broken_links via typos_only param)
 */

import * as path from 'path';
import { readFileSync, realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
// Core imports - Read
import type { VaultIndex } from './core/read/types.js';
import {
  buildVaultIndex,
  setIndexState,
  setIndexError,
  loadVaultIndexFromCache,
  saveVaultIndexToCache,
} from './core/read/graph.js';
import { scanVault } from './core/read/vault.js';
import { loadConfig, inferConfig, saveConfig, type FlywheelConfig } from './core/read/config.js';
import { findVaultRoot } from './core/read/vaultRoot.js';
import {
  createVaultWatcher,
  parseWatcherConfig,
} from './core/read/watch/index.js';
import { processBatch } from './core/read/watch/batchProcessor.js';
import { exportHubScores } from './core/shared/hubExport.js';
import { initializeLogger as initializeReadLogger, getLogger } from './core/read/logging.js';

// Core imports - Write
import { initializeEntityIndex, setWriteStateDb, setWikilinkConfig, setCooccurrenceIndex } from './core/write/wikilinks.js';
import { initializeLogger as initializeWriteLogger, flushLogs } from './core/write/logging.js';
import { setFTS5Database, buildFTS5Index, isIndexStale } from './core/read/fts5.js';
import {
  setEmbeddingsDatabase,
  updateEmbedding,
  removeEmbedding,
  buildEmbeddingsIndex,
  buildEntityEmbeddingsIndex,
  hasEmbeddingsIndex,
  setEmbeddingsBuilding,
  loadEntityEmbeddingsToMemory,
  updateEntityEmbedding,
  hasEntityEmbeddingsIndex,
} from './core/read/embeddings.js';
import {
  setTaskCacheDatabase,
  buildTaskCache,
  refreshIfStale,
  isTaskCacheStale,
  updateTaskCacheForFile,
  removeTaskCacheForFile,
} from './core/read/taskCache.js';

// Vault-core shared imports
import { openStateDb, scanVaultEntities, getSessionId, getAllEntitiesFromDb, findEntityMatches, getProtectedZones, rangeOverlapsProtectedZone, type StateDb } from '@velvetmonkey/vault-core';

// Read tool registrations
import { registerGraphTools } from './tools/read/graph.js';
import { registerWikilinkTools } from './tools/read/wikilinks.js';
import { registerHealthTools } from './tools/read/health.js';
import { registerQueryTools } from './tools/read/query.js';
import { registerSystemTools as registerReadSystemTools } from './tools/read/system.js';
import { registerPrimitiveTools } from './tools/read/primitives.js';
import { registerMigrationTools } from './tools/read/migrations.js';
import { registerGraphAnalysisTools } from './tools/read/graphAnalysis.js';
import { registerVaultSchemaTools } from './tools/read/vaultSchema.js';
import { registerNoteIntelligenceTools } from './tools/read/noteIntelligence.js';

// Write tool registrations
import { registerMutationTools } from './tools/write/mutations.js';
import { registerTaskTools } from './tools/write/tasks.js';
import { registerFrontmatterTools } from './tools/write/frontmatter.js';
import { registerNoteTools } from './tools/write/notes.js';
import { registerMoveNoteTools } from './tools/write/move-notes.js';
import { registerMergeTools as registerWriteMergeTools } from './tools/write/merge.js';
import { registerSystemTools as registerWriteSystemTools } from './tools/write/system.js';
import { registerPolicyTools } from './tools/write/policy.js';
import { registerTagTools } from './tools/write/tags.js';
import { registerWikilinkFeedbackTools } from './tools/write/wikilinkFeedback.js';
import { registerConfigTools } from './tools/write/config.js';

// Read tool registrations (additional)
import { registerMetricsTools } from './tools/read/metrics.js';
import { registerActivityTools } from './tools/read/activity.js';
import { registerSimilarityTools } from './tools/read/similarity.js';
import { registerSemanticTools } from './tools/read/semantic.js';
import { registerMergeTools as registerReadMergeTools } from './tools/read/merges.js';

// Core imports - Sweep
import { startSweepTimer } from './core/read/sweep.js';

// Core imports - Metrics
import { computeMetrics, recordMetrics, purgeOldMetrics } from './core/shared/metrics.js';

// Core imports - Index Activity
import { recordIndexEvent, purgeOldIndexEvents, createStepTracker, computeEntityDiff, getRecentPipelineEvent } from './core/shared/indexActivity.js';

// Core imports - Tool Tracking
import { recordToolInvocation, purgeOldInvocations } from './core/shared/toolTracking.js';

// Core imports - Graph Snapshots
import { computeGraphMetrics, recordGraphSnapshot, purgeOldSnapshots } from './core/shared/graphSnapshots.js';

// Core imports - Server Activity Log
import { serverLog } from './core/shared/serverLog.js';

// Core imports - Graph (forward links)
import { getForwardLinksForNote } from './core/read/graph.js';

// Core imports - Wikilink Feedback
import { updateSuppressionList, getTrackedApplications, processImplicitFeedback,
         getStoredNoteLinks, updateStoredNoteLinks, diffNoteLinks, recordFeedback,
         getStoredNoteTags, updateStoredNoteTags } from './core/write/wikilinkFeedback.js';

// Core imports - Recency
import { setRecencyStateDb, buildRecencyIndex, loadRecencyFromStateDb, saveRecencyToStateDb } from './core/shared/recency.js';

// Core imports - Co-occurrence
import { mineCooccurrences } from './core/shared/cooccurrence.js';

// Core imports - Edge Weights
import { setEdgeWeightStateDb, recomputeEdgeWeights } from './core/write/edgeWeights.js';

// Node builtins
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { CoalescedEvent, EventBatch, RenameEvent } from './core/read/watch/types.js';
import type { BatchHandler } from './core/read/watch/index.js';

// Resources
import { registerVaultResources } from './resources/vault.js';


// ============================================================================
// Configuration
// ============================================================================

// Auto-detect vault root, with PROJECT_PATH as override
const vaultPath: string = process.env.PROJECT_PATH || process.env.VAULT_PATH || findVaultRoot();
let resolvedVaultPath: string;
try { resolvedVaultPath = realpathSync(vaultPath).replace(/\\/g, '/'); } catch { resolvedVaultPath = vaultPath.replace(/\\/g, '/'); }

// State variables
let vaultIndex: VaultIndex;
let flywheelConfig: FlywheelConfig = {};
let stateDb: StateDb | null = null;

// ============================================================================
// Tool Presets & Composable Bundles
// ============================================================================
// FLYWHEEL_TOOLS env var controls which tools are loaded.
//
// Presets:
//   minimal  - Note-taking essentials: search, read, create, edit (13 tools)
//   full     - All tools (42 tools) [DEFAULT]
//
// Composable bundles (combine with minimal or each other):
//   graph    - Backlinks, orphans, hubs, paths (6 tools)
//   analysis - Schema intelligence, wikilink validation (8 tools)
//   tasks    - Task queries and mutations (3 tools)
//   health   - Vault diagnostics and index management (7 tools)
//   ops      - Git undo, policy automation (2 tools)
//
// Examples:
//   FLYWHEEL_TOOLS=minimal                    # 13 tools
//   FLYWHEEL_TOOLS=minimal,graph,tasks        # 22 tools
//   FLYWHEEL_TOOLS=minimal,graph,analysis     # 25 tools
//   FLYWHEEL_TOOLS=search,backlinks,append    # fine-grained categories
//
// Categories (15):
//   READ:  search, backlinks, orphans, hubs, paths,
//          schema, structure, tasks, health, wikilinks
//   WRITE: append, frontmatter, notes, git, policy
// ============================================================================

type ToolCategory =
  // Read
  | 'backlinks' | 'orphans' | 'hubs' | 'paths'
  | 'search'
  | 'schema' | 'structure' | 'tasks'
  | 'health' | 'wikilinks'
  // Write
  | 'append' | 'frontmatter' | 'notes'
  | 'git' | 'policy';

const PRESETS: Record<string, ToolCategory[]> = {
  // Presets
  minimal: ['search', 'structure', 'append', 'frontmatter', 'notes'],
  full: [
    'search', 'backlinks', 'orphans', 'hubs', 'paths',
    'schema', 'structure', 'tasks',
    'health', 'wikilinks',
    'append', 'frontmatter', 'notes',
    'git', 'policy',
  ],

  // Composable bundles
  graph: ['backlinks', 'orphans', 'hubs', 'paths'],
  analysis: ['schema', 'wikilinks'],
  tasks: ['tasks'],
  health: ['health'],
  ops: ['git', 'policy'],
};

const ALL_CATEGORIES: ToolCategory[] = [
  'backlinks', 'orphans', 'hubs', 'paths',
  'search',
  'schema', 'structure', 'tasks',
  'health', 'wikilinks',
  'append', 'frontmatter', 'notes',
  'git', 'policy',
];

const DEFAULT_PRESET = 'full';

/**
 * Parse FLYWHEEL_TOOLS env var into enabled categories
 */
function parseEnabledCategories(): Set<ToolCategory> {
  const envValue = process.env.FLYWHEEL_TOOLS?.trim();

  // No env var = use default preset
  if (!envValue) {
    return new Set(PRESETS[DEFAULT_PRESET]);
  }

  // Check if it's a preset name
  const lowerValue = envValue.toLowerCase();
  if (PRESETS[lowerValue]) {
    return new Set(PRESETS[lowerValue]);
  }

  // Parse comma-separated categories
  const categories = new Set<ToolCategory>();
  for (const item of envValue.split(',')) {
    const category = item.trim().toLowerCase() as ToolCategory;
    if (ALL_CATEGORIES.includes(category)) {
      categories.add(category);
    } else if (PRESETS[category]) {
      // Allow preset names in comma list
      for (const c of PRESETS[category]) {
        categories.add(c);
      }
    } else {
      serverLog('server', `Unknown tool category "${item}" — ignoring`, 'warn');
    }
  }

  // If nothing valid, fall back to default
  if (categories.size === 0) {
    serverLog('server', `No valid categories found, using default (${DEFAULT_PRESET})`, 'warn');
    return new Set(PRESETS[DEFAULT_PRESET]);
  }

  return categories;
}

const enabledCategories = parseEnabledCategories();

// Per-tool category mapping (tool name → category)
const TOOL_CATEGORY: Record<string, ToolCategory> = {
  // health (includes periodic detection in output)
  health_check: 'health',
  get_vault_stats: 'health',
  get_folder_structure: 'health',
  refresh_index: 'health',   // absorbed rebuild_search_index
  get_all_entities: 'health',
  list_entities: 'hubs',
  get_unlinked_mentions: 'health',

  // search (unified: metadata + content + entities)
  search: 'search',
  init_semantic: 'search',

  // backlinks
  get_backlinks: 'backlinks',
  get_forward_links: 'backlinks',

  // orphans (graph_analysis covers orphans, dead_ends, sources, hubs, stale)
  graph_analysis: 'orphans',
  get_connection_strength: 'hubs',

  // paths
  get_link_path: 'paths',
  get_common_neighbors: 'paths',

  // schema (vault_schema + note_intelligence cover all schema tools)
  vault_schema: 'schema',
  note_intelligence: 'schema',

  // structure (absorbed get_headings + vault_list_sections)
  get_note_structure: 'structure',
  get_section_content: 'structure',
  find_sections: 'structure',
  get_note_metadata: 'structure',

  // tasks (unified: all task queries + write)
  tasks: 'tasks',
  vault_toggle_task: 'tasks',
  vault_add_task: 'tasks',

  // wikilinks
  suggest_wikilinks: 'wikilinks',
  validate_links: 'wikilinks',

  // append (content mutations)
  vault_add_to_section: 'append',
  vault_remove_from_section: 'append',
  vault_replace_in_section: 'append',

  // frontmatter (absorbed vault_add_frontmatter_field via only_if_missing)
  vault_update_frontmatter: 'frontmatter',

  // notes (CRUD)
  vault_create_note: 'notes',
  vault_delete_note: 'notes',
  vault_move_note: 'notes',
  vault_rename_note: 'notes',

  // git
  vault_undo_last_mutation: 'git',

  // policy
  policy: 'policy',

  // schema (migrations + tag rename)
  rename_field: 'schema',
  migrate_field_values: 'schema',
  rename_tag: 'schema',

  // health (growth metrics)
  vault_growth: 'health',

  // wikilinks (feedback)
  wikilink_feedback: 'wikilinks',

  // health (activity tracking)
  vault_activity: 'health',

  // schema (content similarity)
  find_similar: 'schema',

  // health (config management)
  flywheel_config: 'health',

  // health (server activity log)
  server_log: 'health',

  // health (merge suggestions)
  suggest_entity_merges: 'health',
  dismiss_merge_suggestion: 'health',

  // notes (entity merge)
  merge_entities: 'notes',
};

// ============================================================================
// Server Setup
// ============================================================================

const server = new McpServer({
  name: 'flywheel-memory',
  version: pkg.version,
});

// Monkey-patch server.tool() and server.registerTool() to gate by per-tool category
let _registeredCount = 0;
let _skippedCount = 0;

function gateByCategory(name: string): boolean {
  const category = TOOL_CATEGORY[name];
  if (category && !enabledCategories.has(category)) {
    _skippedCount++;
    return false;
  }
  _registeredCount++;
  return true;
}

/**
 * Wrap a tool handler to record invocations in StateDb.
 * Extracts note paths from common parameters (path, paths, note_path).
 */
function wrapHandlerWithTracking(toolName: string, handler: (...args: any[]) => any): (...args: any[]) => any {
  return async (...args: any[]) => {
    const start = Date.now();
    let success = true;
    let notePaths: string[] | undefined;

    // Extract note paths from first arg (params object)
    const params = args[0];
    if (params && typeof params === 'object') {
      const paths: string[] = [];
      if (typeof params.path === 'string') paths.push(params.path);
      if (Array.isArray(params.paths)) paths.push(...params.paths.filter((p: unknown) => typeof p === 'string'));
      if (typeof params.note_path === 'string') paths.push(params.note_path);
      if (typeof params.source === 'string') paths.push(params.source);
      if (typeof params.target === 'string') paths.push(params.target);
      if (paths.length > 0) notePaths = paths;
    }

    try {
      return await handler(...args);
    } catch (err) {
      success = false;
      throw err;
    } finally {
      if (stateDb) {
        try {
          let sessionId: string | undefined;
          try { sessionId = getSessionId(); } catch { /* no session */ }
          recordToolInvocation(stateDb, {
            tool_name: toolName,
            session_id: sessionId,
            note_paths: notePaths,
            duration_ms: Date.now() - start,
            success,
          });
        } catch {
          // Never let tracking errors affect tool execution
        }
      }
    }
  };
}

const _originalTool = server.tool.bind(server) as (...args: unknown[]) => unknown;
(server as any).tool = (name: string, ...args: any[]) => {
  if (!gateByCategory(name)) return;
  // Wrap the handler (last arg) with tracking
  if (args.length > 0 && typeof args[args.length - 1] === 'function') {
    args[args.length - 1] = wrapHandlerWithTracking(name, args[args.length - 1]);
  }
  return _originalTool(name, ...args);
};

const _originalRegisterTool = (server as any).registerTool?.bind(server);
if (_originalRegisterTool) {
  (server as any).registerTool = (name: string, ...args: any[]) => {
    if (!gateByCategory(name)) return;
    // Wrap the handler (last arg) with tracking
    if (args.length > 0 && typeof args[args.length - 1] === 'function') {
      args[args.length - 1] = wrapHandlerWithTracking(name, args[args.length - 1]);
    }
    return _originalRegisterTool(name, ...args);
  };
}

// Log enabled categories
const categoryList = Array.from(enabledCategories).sort().join(', ');
serverLog('server', `Tool categories: ${categoryList}`);

// ============================================================================
// Register All Tools (per-tool filtering via patched server.tool())
// ============================================================================

// Read tools
registerHealthTools(server, () => vaultIndex, () => vaultPath, () => flywheelConfig, () => stateDb);
registerReadSystemTools(
  server,
  () => vaultIndex,
  (newIndex) => { vaultIndex = newIndex; },
  () => vaultPath,
  (newConfig) => { flywheelConfig = newConfig; setWikilinkConfig(newConfig); },
  () => stateDb
);
registerGraphTools(server, () => vaultIndex, () => vaultPath, () => stateDb);
registerWikilinkTools(server, () => vaultIndex, () => vaultPath);
registerQueryTools(server, () => vaultIndex, () => vaultPath, () => stateDb);
registerPrimitiveTools(server, () => vaultIndex, () => vaultPath, () => flywheelConfig);
registerGraphAnalysisTools(server, () => vaultIndex, () => vaultPath, () => stateDb, () => flywheelConfig);
registerVaultSchemaTools(server, () => vaultIndex, () => vaultPath);
registerNoteIntelligenceTools(server, () => vaultIndex, () => vaultPath, () => flywheelConfig);
registerMigrationTools(server, () => vaultIndex, () => vaultPath);

// Write tools
registerMutationTools(server, vaultPath, () => flywheelConfig);
registerTaskTools(server, vaultPath);
registerFrontmatterTools(server, vaultPath);
registerNoteTools(server, vaultPath, () => vaultIndex);
registerMoveNoteTools(server, vaultPath);
registerWriteMergeTools(server, vaultPath);
registerWriteSystemTools(server, vaultPath);
registerPolicyTools(server, vaultPath);
registerTagTools(server, () => vaultIndex, () => vaultPath);
registerWikilinkFeedbackTools(server, () => stateDb);
registerConfigTools(
  server,
  () => flywheelConfig,
  (newConfig) => { flywheelConfig = newConfig; setWikilinkConfig(newConfig); },
  () => stateDb
);

// Additional read tools
registerMetricsTools(server, () => vaultIndex, () => stateDb);
registerActivityTools(server, () => stateDb, () => { try { return getSessionId(); } catch { return null; } });
registerSimilarityTools(server, () => vaultIndex, () => vaultPath, () => stateDb);
registerSemanticTools(server, () => vaultPath, () => stateDb);
registerReadMergeTools(server, () => stateDb);

// Resources (always registered, not gated by tool presets)
registerVaultResources(server, () => vaultIndex ?? null);

serverLog('server', `Registered ${_registeredCount} tools, skipped ${_skippedCount}`);

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  serverLog('server', `Starting Flywheel Memory v${pkg.version}...`);
  serverLog('server', `Vault: ${vaultPath}`);

  const startTime = Date.now();

  // Initialize StateDb early
  try {
    stateDb = openStateDb(vaultPath);
    serverLog('statedb', 'StateDb initialized');

    // Inject StateDb handle for FTS5 content search (notes_fts table)
    setFTS5Database(stateDb.db);

    // Inject StateDb handle for embeddings (note_embeddings table)
    setEmbeddingsDatabase(stateDb.db);

    // Inject StateDb handle for task cache
    setTaskCacheDatabase(stateDb.db);

    serverLog('statedb', 'Injected FTS5, embeddings, task cache handles');

    // Load entity embeddings into memory (if previously built)
    loadEntityEmbeddingsToMemory();

    // Set StateDb for wikilinks (entity index loads lazily from StateDb on first write)
    setWriteStateDb(stateDb);

    // Set StateDb for recency tracking
    setRecencyStateDb(stateDb);

    // Set StateDb for edge weight computation
    setEdgeWeightStateDb(stateDb);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    serverLog('statedb', `StateDb initialization failed: ${msg}`, 'error');
    serverLog('server', 'Auto-wikilinks will be disabled for this session', 'warn');
  }

  // Connect MCP immediately so crank can talk to us while we build indexes
  const transport = new StdioServerTransport();
  await server.connect(transport);
  serverLog('server', 'MCP server connected');

  // Initialize logging
  initializeReadLogger(vaultPath).then(() => {
    const logger = getLogger();
    if (logger?.enabled) {
      serverLog('server', 'Unified logging enabled');
    }
  }).catch(() => {
    // Logging initialization failed, continue without it
  });

  initializeWriteLogger(vaultPath).catch(err => {
    serverLog('server', `Write logger initialization failed: ${err}`, 'error');
  });

  // Kick off FTS5 immediately (fire-and-forget, parallel with graph build)
  if (process.env.FLYWHEEL_SKIP_FTS5 !== 'true') {
    if (isIndexStale(vaultPath)) {
      buildFTS5Index(vaultPath).then(() => {
        serverLog('fts5', 'Search index ready');
      }).catch(err => {
        serverLog('fts5', `Build failed: ${err instanceof Error ? err.message : err}`, 'error');
      });
    } else {
      serverLog('fts5', 'Search index already fresh, skipping rebuild');
    }
  } else {
    serverLog('fts5', 'Skipping — FLYWHEEL_SKIP_FTS5');
  }

  // Try loading index from cache
  let cachedIndex: VaultIndex | null = null;
  if (stateDb) {
    try {
      const files = await scanVault(vaultPath);
      const noteCount = files.length;
      serverLog('index', `Found ${noteCount} markdown files`);
      cachedIndex = loadVaultIndexFromCache(stateDb, noteCount);
    } catch (err) {
      serverLog('index', `Cache check failed: ${err instanceof Error ? err.message : err}`, 'warn');
    }
  }

  if (cachedIndex) {
    // Cache hit
    vaultIndex = cachedIndex;
    setIndexState('ready');
    const duration = Date.now() - startTime;
    const cacheAge = cachedIndex.builtAt ? Math.round((Date.now() - cachedIndex.builtAt.getTime()) / 1000) : 0;
    serverLog('index', `Cache hit: ${cachedIndex.notes.size} notes, ${cacheAge}s old — loaded in ${duration}ms`);
    if (stateDb) {
      recordIndexEvent(stateDb, {
        trigger: 'startup_cache',
        duration_ms: duration,
        note_count: cachedIndex.notes.size,
      });
    }
    runPostIndexWork(vaultIndex);
  } else {
    // Cache miss - build index
    serverLog('index', 'Cache miss: building from scratch');

    try {
      vaultIndex = await buildVaultIndex(vaultPath);
      setIndexState('ready');
      const duration = Date.now() - startTime;
      serverLog('index', `Vault index ready in ${duration}ms — ${vaultIndex.notes.size} notes`);
      if (stateDb) {
        recordIndexEvent(stateDb, {
          trigger: 'startup_build',
          duration_ms: duration,
          note_count: vaultIndex.notes.size,
        });
      }

      // Save to cache
      if (stateDb) {
        try {
          saveVaultIndexToCache(stateDb, vaultIndex);
          serverLog('index', 'Index cache saved');
        } catch (err) {
          serverLog('index', `Failed to save index cache: ${err instanceof Error ? err.message : err}`, 'error');
        }
      }

      await runPostIndexWork(vaultIndex);
    } catch (err) {
      setIndexState('error');
      setIndexError(err instanceof Error ? err : new Error(String(err)));
      const duration = Date.now() - startTime;
      if (stateDb) {
        recordIndexEvent(stateDb, {
          trigger: 'startup_build',
          duration_ms: duration,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      serverLog('index', `Failed to build vault index: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }
}

const DEFAULT_ENTITY_EXCLUDE_FOLDERS = ['node_modules', 'templates', 'attachments', 'tmp'];

/** Timestamp of last co-occurrence index rebuild (epoch ms) */
let lastCooccurrenceRebuildAt = 0;

/** Timestamp of last edge weight recompute (epoch ms) */
let lastEdgeWeightRebuildAt = 0;

/**
 * Scan vault for entities and save to StateDb
 */
async function updateEntitiesInStateDb(): Promise<void> {
  if (!stateDb) return;

  try {
    const config = loadConfig(stateDb);
    const excludeFolders = config.exclude_entity_folders?.length
      ? config.exclude_entity_folders
      : DEFAULT_ENTITY_EXCLUDE_FOLDERS;

    const entityIndex = await scanVaultEntities(vaultPath, {
      excludeFolders,
    });
    stateDb.replaceAllEntities(entityIndex);
    serverLog('index', `Updated ${entityIndex._metadata.total_entities} entities in StateDb`);
  } catch (e) {
    serverLog('index', `Failed to update entities in StateDb: ${e instanceof Error ? e.message : e}`, 'error');
  }
}

/**
 * Returns CoalescedEvents for vault .md files modified after sinceMs.
 * Used on startup to catch up on edits made while the server was offline.
 */
async function buildStartupCatchupBatch(
  vaultPath: string,
  sinceMs: number
): Promise<CoalescedEvent[]> {
  const events: CoalescedEvent[] = [];

  async function scanDir(dir: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true }) as import('fs').Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        await scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const stat = await fs.stat(fullPath);
          if (stat.mtimeMs > sinceMs) {
            events.push({
              type: 'upsert',
              path: path.relative(vaultPath, fullPath),
              originalEvents: [],
            });
          }
        } catch { /* skip unreadable files */ }
      }
    }
  }

  await scanDir(vaultPath);
  return events;
}

/**
 * Post-index work: config inference, hub export, file watcher
 */
async function runPostIndexWork(index: VaultIndex) {
  const postStart = Date.now();

  // Scan and save entities to StateDb
  serverLog('index', 'Scanning entities...');
  await updateEntitiesInStateDb();

  // Initialize wikilink entity index from StateDb (now populated)
  await initializeEntityIndex(vaultPath);
  serverLog('index', 'Entity index initialized');

  // Export hub scores
  await exportHubScores(index, stateDb);
  serverLog('index', 'Hub scores exported');

  // Record growth metrics
  if (stateDb) {
    try {
      const metrics = computeMetrics(index, stateDb);
      recordMetrics(stateDb, metrics);
      purgeOldMetrics(stateDb, 90);
      purgeOldIndexEvents(stateDb, 90);
      purgeOldInvocations(stateDb, 90);
      serverLog('server', 'Growth metrics recorded');
    } catch (err) {
      serverLog('server', `Failed to record metrics: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }

  // Record graph topology snapshot
  if (stateDb) {
    try {
      const graphMetrics = computeGraphMetrics(index);
      recordGraphSnapshot(stateDb, graphMetrics);
      purgeOldSnapshots(stateDb, 90);
    } catch (err) {
      serverLog('server', `Failed to record graph snapshot: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }

  // Update wikilink suppression list
  if (stateDb) {
    try {
      updateSuppressionList(stateDb);
      serverLog('index', 'Suppression list updated');
    } catch (err) {
      serverLog('server', `Failed to update suppression list: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }

  // Load/infer config early so task cache can use exclude_task_tags
  const existing = loadConfig(stateDb);
  const inferred = inferConfig(index, vaultPath);
  if (stateDb) {
    saveConfig(stateDb, inferred, existing);
  }
  flywheelConfig = loadConfig(stateDb);
  setWikilinkConfig(flywheelConfig);
  const configKeys = Object.keys(flywheelConfig).filter(k => (flywheelConfig as Record<string, unknown>)[k] != null);
  serverLog('config', `Config inferred: ${configKeys.join(', ')}`);

  // Build task cache (skip rebuild if SQLite cache is already fresh)
  if (stateDb) {
    if (isTaskCacheStale()) {
      serverLog('tasks', 'Task cache stale, rebuilding...');
      refreshIfStale(vaultPath, index, flywheelConfig.exclude_task_tags);
    } else {
      serverLog('tasks', 'Task cache fresh, skipping rebuild');
    }
  }

  if (flywheelConfig.vault_name) {
    serverLog('config', `Vault: ${flywheelConfig.vault_name}`);
  }

  // Auto-build embeddings in background (fire-and-forget)
  // Skip if embeddings already populated (file watcher handles incremental updates)
  if (process.env.FLYWHEEL_SKIP_EMBEDDINGS !== 'true') {
    if (hasEmbeddingsIndex()) {
      serverLog('semantic', 'Embeddings already built, skipping full scan');
    } else {
      setEmbeddingsBuilding(true);
      buildEmbeddingsIndex(vaultPath, (p) => {
        if (p.current % 100 === 0 || p.current === p.total) {
          serverLog('semantic', `Embedding ${p.current}/${p.total} notes...`);
        }
      }).then(async () => {
        if (stateDb) {
          const entities = getAllEntitiesFromDb(stateDb);
          if (entities.length > 0) {
            const entityMap = new Map(entities.map(e => [e.name, {
              name: e.name,
              path: e.path,
              category: e.category,
              aliases: e.aliases,
            }]));
            await buildEntityEmbeddingsIndex(vaultPath, entityMap);
          }
        }
        loadEntityEmbeddingsToMemory();
        serverLog('semantic', 'Embeddings ready');
      }).catch(err => {
        serverLog('semantic', `Embeddings build failed: ${err instanceof Error ? err.message : err}`, 'error');
      });
    }
  } else {
    serverLog('semantic', 'Skipping — FLYWHEEL_SKIP_EMBEDDINGS');
  }

  // Setup file watcher
  if (process.env.FLYWHEEL_WATCH !== 'false') {
    const config = parseWatcherConfig();
    const lastContentHashes = new Map<string, string>();
    serverLog('watcher', `File watcher enabled (debounce: ${config.debounceMs}ms)`);

    // Define before createVaultWatcher so we can call it directly for catch-up
    const handleBatch: BatchHandler = async (batch) => {
        // Convert event paths from absolute to vault-relative
        // Handles symlink mismatches (e.g., WSL /mnt/c/ vs /home/user/ mounts)
        const vaultPrefixes = new Set([
          vaultPath.replace(/\\/g, '/'),
          resolvedVaultPath,
        ]);
        /** Normalize a single path from absolute to vault-relative */
        const normalizeEventPath = (rawPath: string): string => {
          const normalized = rawPath.replace(/\\/g, '/');
          for (const prefix of vaultPrefixes) {
            if (normalized.startsWith(prefix + '/')) {
              return normalized.slice(prefix.length + 1);
            }
          }
          // Try resolving the path itself (handles other symlink layouts)
          try {
            const resolved = realpathSync(rawPath).replace(/\\/g, '/');
            for (const prefix of vaultPrefixes) {
              if (resolved.startsWith(prefix + '/')) {
                return resolved.slice(prefix.length + 1);
              }
            }
          } catch { /* deleted file — try parent */
            try {
              const dir = path.dirname(rawPath);
              const base = path.basename(rawPath);
              const resolvedDir = realpathSync(dir).replace(/\\/g, '/');
              for (const prefix of vaultPrefixes) {
                if (resolvedDir.startsWith(prefix + '/') || resolvedDir === prefix) {
                  const relDir = resolvedDir === prefix ? '' : resolvedDir.slice(prefix.length + 1);
                  return relDir ? `${relDir}/${base}` : base;
                }
              }
            } catch { /* give up, return as-is */ }
          }
          return normalized;
        };

        for (const event of batch.events) {
          event.path = normalizeEventPath(event.path);
        }

        // Normalize rename paths too
        const batchRenames: RenameEvent[] = (batch.renames ?? []).map(r => ({
          ...r,
          oldPath: normalizeEventPath(r.oldPath),
          newPath: normalizeEventPath(r.newPath),
        }));

        // Content hash gate: skip files that haven't changed since last batch
        const filteredEvents: CoalescedEvent[] = [];
        for (const event of batch.events) {
          if (event.type === 'delete') {
            filteredEvents.push(event);
            lastContentHashes.delete(event.path);
            continue;
          }
          try {
            const content = await fs.readFile(path.join(vaultPath, event.path), 'utf-8');
            const hash = createHash('md5').update(content).digest('hex');
            if (lastContentHashes.get(event.path) === hash) {
              serverLog('watcher', `Hash unchanged, skipping: ${event.path}`);
              continue;
            }
            lastContentHashes.set(event.path, hash);
            filteredEvents.push(event);
          } catch {
            filteredEvents.push(event); // File may have been deleted mid-batch
          }
        }

        // Process rename events: record moves and update path references in DB
        if (batchRenames.length > 0 && stateDb) {
          try {
            const insertMove = stateDb.db.prepare(`
              INSERT INTO note_moves (old_path, new_path, old_folder, new_folder)
              VALUES (?, ?, ?, ?)
            `);
            const renameNoteLinks = stateDb.db.prepare(
              'UPDATE note_links SET note_path = ? WHERE note_path = ?'
            );
            const renameNoteTags = stateDb.db.prepare(
              'UPDATE note_tags SET note_path = ? WHERE note_path = ?'
            );
            const renameNoteLinkHistory = stateDb.db.prepare(
              'UPDATE note_link_history SET note_path = ? WHERE note_path = ?'
            );
            const renameWikilinkApplications = stateDb.db.prepare(
              'UPDATE wikilink_applications SET note_path = ? WHERE note_path = ?'
            );
            for (const rename of batchRenames) {
              const oldFolder = rename.oldPath.includes('/') ? rename.oldPath.split('/').slice(0, -1).join('/') : '';
              const newFolder = rename.newPath.includes('/') ? rename.newPath.split('/').slice(0, -1).join('/') : '';
              insertMove.run(rename.oldPath, rename.newPath, oldFolder || null, newFolder || null);
              renameNoteLinks.run(rename.newPath, rename.oldPath);
              renameNoteTags.run(rename.newPath, rename.oldPath);
              renameNoteLinkHistory.run(rename.newPath, rename.oldPath);
              renameWikilinkApplications.run(rename.newPath, rename.oldPath);
              // Also update the content hash map
              const oldHash = lastContentHashes.get(rename.oldPath);
              if (oldHash !== undefined) {
                lastContentHashes.set(rename.newPath, oldHash);
                lastContentHashes.delete(rename.oldPath);
              }
            }
            serverLog('watcher', `Renames: recorded ${batchRenames.length} move(s) in note_moves`);
          } catch (err) {
            serverLog('watcher', `Rename recording failed: ${err instanceof Error ? err.message : err}`, 'error');
          }
        }

        if (filteredEvents.length === 0) {
          if (batchRenames.length > 0) {
            serverLog('watcher', `Batch complete (renames only): ${batchRenames.length} rename(s)`);
          } else {
            serverLog('watcher', 'All files unchanged (hash gate), skipping batch');
          }
          return;
        }

        serverLog('watcher', `Processing ${filteredEvents.length} file changes`);
        const batchStart = Date.now();
        const changedPaths = filteredEvents.map(e => e.path);
        const tracker = createStepTracker();
        try {
          // Step 1: Index rebuild (incremental when possible)
          tracker.start('index_rebuild', { files_changed: filteredEvents.length, changed_paths: changedPaths });
          if (!vaultIndex) {
            // First run or null index: full build needed
            vaultIndex = await buildVaultIndex(vaultPath);
            serverLog('watcher', `Index rebuilt (full): ${vaultIndex.notes.size} notes, ${vaultIndex.entities.size} entities`);
          } else {
            // Incremental update: only process changed files
            // processBatch expects absolute paths (it calls getRelativePath internally),
            // but onBatch has already normalized event.path to vault-relative.
            // Reconstruct absolute paths for processBatch.
            const absoluteBatch = {
              ...batch,
              events: filteredEvents.map(e => ({
                ...e,
                path: path.join(vaultPath, e.path),
              })),
            };
            const batchResult = await processBatch(vaultIndex, vaultPath, absoluteBatch);
            serverLog('watcher', `Incremental: ${batchResult.successful}/${batchResult.total} files in ${batchResult.durationMs}ms`);
          }
          setIndexState('ready');
          tracker.end({ note_count: vaultIndex.notes.size, entity_count: vaultIndex.entities.size, tag_count: vaultIndex.tags.size });

          // Step 1.5: Note moves (rename pairs already recorded above; emit step for pipeline visibility)
          tracker.start('note_moves', { count: batchRenames.length });
          tracker.end({
            renames: batchRenames.map(r => ({ oldPath: r.oldPath, newPath: r.newPath })),
          });
          if (batchRenames.length > 0) {
            serverLog('watcher', `Note moves: ${batchRenames.length} rename(s) recorded`);
          }

          // Capture hub scores BEFORE entity scan resets them
          const hubBefore = new Map<string, number>();
          if (stateDb) {
            const rows = stateDb.db.prepare('SELECT name, hub_score FROM entities').all() as Array<{ name: string; hub_score: number }>;
            for (const r of rows) hubBefore.set(r.name, r.hub_score);
          }

          // Step 2: Entity scan (with diff tracking)
          const entitiesBefore = stateDb ? getAllEntitiesFromDb(stateDb) : [];
          tracker.start('entity_scan', { note_count: vaultIndex.notes.size });
          await updateEntitiesInStateDb();
          const entitiesAfter = stateDb ? getAllEntitiesFromDb(stateDb) : [];
          const entityDiff = computeEntityDiff(entitiesBefore, entitiesAfter);

          // Detect category changes and record in entity_changes audit log
          const categoryChanges: Array<{ entity: string; from: string; to: string }> = [];
          const descriptionChanges: Array<{ entity: string; from: string | null; to: string | null }> = [];
          if (stateDb) {
            const beforeMap = new Map(entitiesBefore.map(e => [e.name, e]));
            const insertChange = stateDb.db.prepare(
              'INSERT INTO entity_changes (entity, field, old_value, new_value) VALUES (?, ?, ?, ?)'
            );
            for (const after of entitiesAfter) {
              const before = beforeMap.get(after.name);
              if (before && before.category !== after.category) {
                insertChange.run(after.name, 'category', before.category, after.category);
                categoryChanges.push({ entity: after.name, from: before.category, to: after.category });
              }
              if (before) {
                const oldDesc = before.description ?? null;
                const newDesc = after.description ?? null;
                if (oldDesc !== newDesc) {
                  insertChange.run(after.name, 'description', oldDesc, newDesc);
                  descriptionChanges.push({ entity: after.name, from: oldDesc, to: newDesc });
                }
              }
            }
          }

          tracker.end({ entity_count: entitiesAfter.length, ...entityDiff, category_changes: categoryChanges, description_changes: descriptionChanges });
          serverLog('watcher', `Entity scan: ${entitiesAfter.length} entities`);

          // Step 3: Hub scores (with before/after diffs)
          tracker.start('hub_scores', { entity_count: entitiesAfter.length });
          const hubUpdated = await exportHubScores(vaultIndex, stateDb);
          const hubDiffs: Array<{ entity: string; before: number; after: number }> = [];
          if (stateDb) {
            const rows = stateDb.db.prepare('SELECT name, hub_score FROM entities').all() as Array<{ name: string; hub_score: number }>;
            for (const r of rows) {
              const prev = hubBefore.get(r.name) ?? 0;
              if (prev !== r.hub_score) hubDiffs.push({ entity: r.name, before: prev, after: r.hub_score });
            }
          }
          tracker.end({ updated: hubUpdated ?? 0, diffs: hubDiffs.slice(0, 10) });
          serverLog('watcher', `Hub scores: ${hubUpdated ?? 0} updated`);

          // Step 3.5: Recency index — rebuild if stale (> 1 hour)
          tracker.start('recency', { entity_count: entitiesAfter.length });
          try {
            const cachedRecency = loadRecencyFromStateDb();
            const cacheAgeMs = cachedRecency ? Date.now() - (cachedRecency.lastUpdated ?? 0) : Infinity;
            if (cacheAgeMs >= 60 * 60 * 1000) {
              const entities = entitiesAfter.map(e => ({ name: e.name, path: e.path, aliases: e.aliases }));
              const recencyIndex = await buildRecencyIndex(vaultPath, entities);
              saveRecencyToStateDb(recencyIndex);
              tracker.end({ rebuilt: true, entities: recencyIndex.lastMentioned.size });
              serverLog('watcher', `Recency: rebuilt ${recencyIndex.lastMentioned.size} entities`);
            } else {
              tracker.end({ rebuilt: false, cached_age_ms: cacheAgeMs });
              serverLog('watcher', `Recency: cache valid (${Math.round(cacheAgeMs / 1000)}s old)`);
            }
          } catch (e) {
            tracker.end({ error: String(e) });
            serverLog('watcher', `Recency: failed: ${e}`);
          }

          // Step 3.6: Co-occurrence index — rebuild if stale (> 1 hour)
          tracker.start('cooccurrence', { entity_count: entitiesAfter.length });
          try {
            const cooccurrenceAgeMs = lastCooccurrenceRebuildAt > 0
              ? Date.now() - lastCooccurrenceRebuildAt
              : Infinity;
            if (cooccurrenceAgeMs >= 60 * 60 * 1000) {
              const entityNames = entitiesAfter.map(e => e.name);
              const cooccurrenceIdx = await mineCooccurrences(vaultPath, entityNames);
              setCooccurrenceIndex(cooccurrenceIdx);
              lastCooccurrenceRebuildAt = Date.now();
              tracker.end({ rebuilt: true, associations: cooccurrenceIdx._metadata.total_associations });
              serverLog('watcher', `Co-occurrence: rebuilt ${cooccurrenceIdx._metadata.total_associations} associations`);
            } else {
              tracker.end({ rebuilt: false, age_ms: cooccurrenceAgeMs });
              serverLog('watcher', `Co-occurrence: cache valid (${Math.round(cooccurrenceAgeMs / 1000)}s old)`);
            }
          } catch (e) {
            tracker.end({ error: String(e) });
            serverLog('watcher', `Co-occurrence: failed: ${e}`);
          }

          // Step 3.7: Edge weights — recompute if stale (> 1 hour)
          if (stateDb) {
            tracker.start('edge_weights', {});
            try {
              const edgeWeightAgeMs = lastEdgeWeightRebuildAt > 0
                ? Date.now() - lastEdgeWeightRebuildAt
                : Infinity;
              if (edgeWeightAgeMs >= 60 * 60 * 1000) {
                const result = recomputeEdgeWeights(stateDb);
                lastEdgeWeightRebuildAt = Date.now();
                tracker.end({
                  rebuilt: true,
                  edges: result.edges_updated,
                  duration_ms: result.duration_ms,
                  total_weighted: result.total_weighted,
                  avg_weight: result.avg_weight,
                  strong_count: result.strong_count,
                  top_changes: result.top_changes,
                });
                serverLog('watcher', `Edge weights: ${result.edges_updated} edges in ${result.duration_ms}ms`);
              } else {
                tracker.end({ rebuilt: false, age_ms: edgeWeightAgeMs });
                serverLog('watcher', `Edge weights: cache valid (${Math.round(edgeWeightAgeMs / 1000)}s old)`);
              }
            } catch (e) {
              tracker.end({ error: String(e) });
              serverLog('watcher', `Edge weights: failed: ${e}`);
            }
          }

          // Step 4: Note embeddings (with updated paths)
          if (hasEmbeddingsIndex()) {
            tracker.start('note_embeddings', { files: filteredEvents.length });
            let embUpdated = 0;
            let embRemoved = 0;
            for (const event of filteredEvents) {
              try {
                if (event.type === 'delete') {
                  removeEmbedding(event.path);
                  embRemoved++;
                } else if (event.path.endsWith('.md')) {
                  const absPath = path.join(vaultPath, event.path);
                  await updateEmbedding(event.path, absPath);
                  embUpdated++;
                }
              } catch {
                // Don't let embedding errors affect watcher
              }
            }
            tracker.end({ updated: embUpdated, removed: embRemoved });
            serverLog('watcher', `Note embeddings: ${embUpdated} updated, ${embRemoved} removed`);
          } else {
            tracker.skip('note_embeddings', 'not built');
          }

          // Step 5: Entity embeddings (with entity names)
          if (hasEntityEmbeddingsIndex() && stateDb) {
            tracker.start('entity_embeddings', { files: filteredEvents.length });
            let entEmbUpdated = 0;
            const entEmbNames: string[] = [];
            try {
              const allEntities = getAllEntitiesFromDb(stateDb);
              for (const event of filteredEvents) {
                if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
                const matching = allEntities.filter(e => e.path === event.path);
                for (const entity of matching) {
                  await updateEntityEmbedding(entity.name, {
                    name: entity.name,
                    path: entity.path,
                    category: entity.category,
                    aliases: entity.aliases,
                  }, vaultPath);
                  entEmbUpdated++;
                  entEmbNames.push(entity.name);
                }
              }
            } catch {
              // Don't let entity embedding errors affect watcher
            }
            tracker.end({ updated: entEmbUpdated, updated_entities: entEmbNames.slice(0, 10) });
            serverLog('watcher', `Entity embeddings: ${entEmbUpdated} updated`);
          } else {
            tracker.skip('entity_embeddings', !stateDb ? 'no stateDb' : 'not built');
          }

          // Step 6: Index cache
          if (stateDb) {
            tracker.start('index_cache', { note_count: vaultIndex.notes.size });
            try {
              saveVaultIndexToCache(stateDb, vaultIndex);
              tracker.end({ saved: true });
              serverLog('watcher', 'Index cache saved');
            } catch (err) {
              tracker.end({ saved: false, error: err instanceof Error ? err.message : String(err) });
              serverLog('index', `Failed to update index cache: ${err instanceof Error ? err.message : err}`, 'error');
            }
          } else {
            tracker.skip('index_cache', 'no stateDb');
          }

          // Step 7: Task cache
          tracker.start('task_cache', { files: filteredEvents.length });
          let taskUpdated = 0;
          let taskRemoved = 0;
          for (const event of filteredEvents) {
            try {
              if (event.type === 'delete') {
                removeTaskCacheForFile(event.path);
                taskRemoved++;
              } else if (event.path.endsWith('.md')) {
                await updateTaskCacheForFile(vaultPath, event.path);
                taskUpdated++;
              }
            } catch {
              // Don't let task cache errors affect watcher
            }
          }
          tracker.end({ updated: taskUpdated, removed: taskRemoved });
          serverLog('watcher', `Task cache: ${taskUpdated} updated, ${taskRemoved} removed`);

          // Step 8: Forward link scan — all wikilinks in changed files
          tracker.start('forward_links', { files: filteredEvents.length });
          const eventTypeMap = new Map(filteredEvents.map(e => [e.path, e.type]));
          const forwardLinkResults: Array<{ file: string; resolved: string[]; dead: string[] }> = [];
          let totalResolved = 0;
          let totalDead = 0;
          for (const event of filteredEvents) {
            if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
            try {
              const links = getForwardLinksForNote(vaultIndex, event.path);
              const resolved: string[] = [];
              const dead: string[] = [];
              const seen = new Set<string>();
              for (const link of links) {
                const name = link.target;
                if (seen.has(name.toLowerCase())) continue;
                seen.add(name.toLowerCase());
                if (link.exists) resolved.push(name);
                else dead.push(name);
              }
              if (resolved.length > 0 || dead.length > 0) {
                forwardLinkResults.push({ file: event.path, resolved, dead });
              }
              totalResolved += resolved.length;
              totalDead += dead.length;
            } catch { /* ignore */ }
          }

          // Diff against stored links to detect additions/removals
          const linkDiffs: Array<{ file: string; added: string[]; removed: string[] }> = [];
          const survivedLinks: Array<{ entity: string; file: string; count: number }> = [];
          if (stateDb) {
            // Prepared statements for link survival tracking (T2)
            const upsertHistory = stateDb.db.prepare(`
              INSERT INTO note_link_history (note_path, target) VALUES (?, ?)
              ON CONFLICT(note_path, target) DO UPDATE SET edits_survived = edits_survived + 1
            `);
            const checkThreshold = stateDb.db.prepare(`
              SELECT target FROM note_link_history
              WHERE note_path = ? AND target = ? AND edits_survived >= 3 AND last_positive_at IS NULL
            `);
            const markPositive = stateDb.db.prepare(`
              UPDATE note_link_history SET last_positive_at = datetime('now') WHERE note_path = ? AND target = ?
            `);
            const getEdgeCount = stateDb.db.prepare(
              'SELECT edits_survived FROM note_link_history WHERE note_path=? AND target=?'
            );

            for (const entry of forwardLinkResults) {
              const currentSet = new Set([
                ...entry.resolved.map(n => n.toLowerCase()),
                ...entry.dead.map(n => n.toLowerCase()),
              ]);
              const previousSet = getStoredNoteLinks(stateDb, entry.file);
              // First-run mitigation: if no stored links, seed without reporting additions
              // (avoids flooding on first pipeline run after schema upgrade)
              if (previousSet.size === 0) {
                updateStoredNoteLinks(stateDb, entry.file, currentSet);
                continue;
              }
              const diff = diffNoteLinks(previousSet, currentSet);
              if (diff.added.length > 0 || diff.removed.length > 0) {
                linkDiffs.push({ file: entry.file, ...diff });
              }
              updateStoredNoteLinks(stateDb, entry.file, currentSet);

              // Track survival of persisted links and emit positive feedback at threshold.
              // Only when links were actually removed — removals mean the user was curating
              // links and chose to keep the remaining ones. Additions alone (especially from
              // engine wikilink insertions) are not evidence of deliberate retention.
              if (diff.removed.length === 0) continue;
              for (const link of currentSet) {
                if (!previousSet.has(link)) continue; // only persisted links
                upsertHistory.run(entry.file, link);
                const countRow = getEdgeCount.get(entry.file, link) as { edits_survived: number } | undefined;
                if (countRow) {
                  survivedLinks.push({ entity: link, file: entry.file, count: countRow.edits_survived });
                }
                const hit = checkThreshold.get(entry.file, link) as { target: string } | undefined;
                if (hit) {
                  const entity = entitiesAfter.find(
                    e => e.nameLower === link ||
                         (e.aliases ?? []).some((a: string) => a.toLowerCase() === link)
                  );
                  if (entity) {
                    recordFeedback(stateDb, entity.name, 'implicit:kept', entry.file, true);
                    markPositive.run(entry.file, link);
                  }
                }
              }
            }
            // Handle deleted files — clear their stored links and report removals
            for (const event of filteredEvents) {
              if (event.type === 'delete') {
                const previousSet = getStoredNoteLinks(stateDb, event.path);
                if (previousSet.size > 0) {
                  linkDiffs.push({ file: event.path, added: [], removed: [...previousSet] });
                  updateStoredNoteLinks(stateDb, event.path, new Set());
                }
              }
            }

            // Handle upserts where all wikilinks were removed (0 remaining links).
            // These were excluded from forwardLinkResults so their note_links
            // were never diffed. Check stored state and emit removals.
            const processedFiles = new Set(forwardLinkResults.map(r => r.file));
            for (const event of filteredEvents) {
              if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
              if (processedFiles.has(event.path)) continue;
              const previousSet = getStoredNoteLinks(stateDb, event.path);
              if (previousSet.size > 0) {
                linkDiffs.push({ file: event.path, added: [], removed: [...previousSet] });
                updateStoredNoteLinks(stateDb, event.path, new Set());
              }
            }
          }

          tracker.end({
            total_resolved: totalResolved,
            total_dead: totalDead,
            links: forwardLinkResults,
            link_diffs: linkDiffs,
            survived: survivedLinks,
          });
          serverLog('watcher', `Forward links: ${totalResolved} resolved, ${totalDead} dead`);

          // Step 9: Wikilink check — which tracked links exist in changed files
          tracker.start('wikilink_check', { files: filteredEvents.length });
          const trackedLinks: Array<{ file: string; entities: string[] }> = [];
          if (stateDb) {
            for (const event of filteredEvents) {
              if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
              try {
                const apps = getTrackedApplications(stateDb, event.path);
                if (apps.length > 0) trackedLinks.push({ file: event.path, entities: apps });
              } catch { /* ignore */ }
            }
          }

          // Also include manual wikilink additions from forward_links diff
          for (const diff of linkDiffs) {
            if (diff.added.length === 0) continue;
            const existing = trackedLinks.find(t => t.file === diff.file);
            if (existing) {
              const set = new Set(existing.entities.map(e => e.toLowerCase()));
              for (const a of diff.added) {
                if (!set.has(a)) {
                  existing.entities.push(a);
                  set.add(a);
                }
              }
            } else {
              trackedLinks.push({ file: diff.file, entities: diff.added });
            }
          }

          // Detect unwikified entity mentions in changed files
          const mentionResults: Array<{ file: string; entities: string[] }> = [];
          for (const event of filteredEvents) {
            if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
            try {
              const content = await fs.readFile(path.join(vaultPath, event.path), 'utf-8');
              const zones = getProtectedZones(content);
              // Already-wikified entities for this file (from step 8)
              const linked = new Set(
                (forwardLinkResults.find(r => r.file === event.path)?.resolved ?? [])
                  .map(n => n.toLowerCase())
              );
              const mentions: string[] = [];
              for (const entity of entitiesAfter) {
                if (linked.has(entity.nameLower)) continue; // already wikified
                // Check entity name
                const matches = findEntityMatches(content, entity.name, true);
                const valid = matches.some(m => !rangeOverlapsProtectedZone(m.start, m.end, zones));
                if (valid) {
                  mentions.push(entity.name);
                  continue;
                }
                // Check aliases
                for (const alias of (entity.aliases ?? [])) {
                  const aliasMatches = findEntityMatches(content, alias, true);
                  if (aliasMatches.some(m => !rangeOverlapsProtectedZone(m.start, m.end, zones))) {
                    mentions.push(entity.name);
                    break;
                  }
                }
              }
              if (mentions.length > 0) {
                mentionResults.push({ file: event.path, entities: mentions });
              }
            } catch { /* ignore */ }
          }

          tracker.end({ tracked: trackedLinks, mentions: mentionResults });
          serverLog('watcher', `Wikilink check: ${trackedLinks.reduce((s, t) => s + t.entities.length, 0)} tracked links in ${trackedLinks.length} files, ${mentionResults.reduce((s, m) => s + m.entities.length, 0)} unwikified mentions`);

          // Step 10: Implicit feedback — which entities had links removed
          tracker.start('implicit_feedback', { files: filteredEvents.length });
          const feedbackResults: Array<{ entity: string; file: string }> = [];
          if (stateDb) {
            for (const event of filteredEvents) {
              if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
              try {
                const content = await fs.readFile(path.join(vaultPath, event.path), 'utf-8');
                const removed = processImplicitFeedback(stateDb, event.path, content);
                for (const entity of removed) feedbackResults.push({ entity, file: event.path });
              } catch { /* ignore */ }
            }
          }

          // Also detect manual wikilink removals via forward_links diff
          if (stateDb && linkDiffs.length > 0) {
            for (const diff of linkDiffs) {
              for (const target of diff.removed) {
                // Avoid duplicates with processImplicitFeedback results
                if (feedbackResults.some(r => r.entity === target && r.file === diff.file)) continue;
                // Only record feedback for known entities (not arbitrary dead-link text)
                const entity = entitiesAfter.find(
                  e => e.nameLower === target ||
                    (e.aliases ?? []).some((a: string) => a.toLowerCase() === target)
                );
                if (entity) {
                  recordFeedback(stateDb, entity.name, 'implicit:removed', diff.file, false);
                  feedbackResults.push({ entity: entity.name, file: diff.file });
                }
              }
            }
          }

          tracker.end({ removals: feedbackResults });
          if (feedbackResults.length > 0) {
            serverLog('watcher', `Implicit feedback: ${feedbackResults.length} removals detected`);
          }

          // Step 11: Tag scan — detect tag additions/removals per changed note
          tracker.start('tag_scan', { files: filteredEvents.length });
          const tagDiffs: Array<{ file: string; added: string[]; removed: string[] }> = [];
          if (stateDb) {
            // Build forward lookup: note path → tags (from VaultIndex inverted index)
            const noteTagsForward = new Map<string, Set<string>>();
            for (const [tag, paths] of vaultIndex.tags) {
              for (const notePath of paths) {
                if (!noteTagsForward.has(notePath)) noteTagsForward.set(notePath, new Set());
                noteTagsForward.get(notePath)!.add(tag);
              }
            }

            for (const event of filteredEvents) {
              if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
              const currentSet = noteTagsForward.get(event.path) ?? new Set<string>();
              const previousSet = getStoredNoteTags(stateDb, event.path);
              // First-run mitigation: seed without reporting additions
              if (previousSet.size === 0 && currentSet.size > 0) {
                updateStoredNoteTags(stateDb, event.path, currentSet);
                continue;
              }
              const added = [...currentSet].filter(t => !previousSet.has(t));
              const removed = [...previousSet].filter(t => !currentSet.has(t));
              if (added.length > 0 || removed.length > 0) {
                tagDiffs.push({ file: event.path, added, removed });
              }
              updateStoredNoteTags(stateDb, event.path, currentSet);
            }

            // Handle deleted files — clear stored tags and report removals
            for (const event of filteredEvents) {
              if (event.type === 'delete') {
                const previousSet = getStoredNoteTags(stateDb, event.path);
                if (previousSet.size > 0) {
                  tagDiffs.push({ file: event.path, added: [], removed: [...previousSet] });
                  updateStoredNoteTags(stateDb, event.path, new Set());
                }
              }
            }
          }
          const totalTagsAdded = tagDiffs.reduce((s, d) => s + d.added.length, 0);
          const totalTagsRemoved = tagDiffs.reduce((s, d) => s + d.removed.length, 0);
          tracker.end({ total_added: totalTagsAdded, total_removed: totalTagsRemoved, tag_diffs: tagDiffs });
          if (tagDiffs.length > 0) {
            serverLog('watcher', `Tag scan: ${totalTagsAdded} added, ${totalTagsRemoved} removed across ${tagDiffs.length} files`);
          }

          // Record event with all steps
          const duration = Date.now() - batchStart;
          if (stateDb) {
            recordIndexEvent(stateDb, {
              trigger: 'watcher',
              duration_ms: duration,
              note_count: vaultIndex.notes.size,
              files_changed: filteredEvents.length,
              changed_paths: changedPaths,
              steps: tracker.steps,
            });
          }
          serverLog('watcher', `Batch complete: ${filteredEvents.length} files, ${duration}ms, ${tracker.steps.length} steps`);
        } catch (err) {
          setIndexState('error');
          setIndexError(err instanceof Error ? err : new Error(String(err)));
          const duration = Date.now() - batchStart;
          if (stateDb) {
            recordIndexEvent(stateDb, {
              trigger: 'watcher',
              duration_ms: duration,
              success: false,
              files_changed: filteredEvents.length,
              changed_paths: changedPaths,
              error: err instanceof Error ? err.message : String(err),
              steps: tracker.steps,
            });
          }
          serverLog('watcher', `Failed to rebuild index: ${err instanceof Error ? err.message : err}`, 'error');
        }
    };

    const watcher = createVaultWatcher({
      vaultPath,
      config,
      onBatch: handleBatch,
      onStateChange: (status) => {
        if (status.state === 'dirty') {
          serverLog('watcher', 'Index may be stale', 'warn');
        }
      },
      onError: (err) => {
        serverLog('watcher', `Watcher error: ${err.message}`, 'error');
      },
    });

    // Startup catch-up: process files that were modified while the server was offline.
    // getRecentPipelineEvent returns the last event with steps (i.e. last watcher run).
    // Files with mtime > that timestamp were not seen by the watcher last session.
    if (stateDb) {
      const lastPipelineEvent = getRecentPipelineEvent(stateDb);
      if (lastPipelineEvent) {
        const catchupEvents = await buildStartupCatchupBatch(vaultPath, lastPipelineEvent.timestamp);
        if (catchupEvents.length > 0) {
          // eslint-disable-next-line no-console
          console.error(`[Flywheel] Startup catch-up: ${catchupEvents.length} file(s) modified while offline`);
          await handleBatch({ events: catchupEvents, renames: [], timestamp: Date.now() });
        }
      }
    }

    watcher.start();
    serverLog('watcher', 'File watcher started');
  }

  // Start periodic sweep for graph hygiene metrics
  startSweepTimer(() => vaultIndex);
  serverLog('server', 'Sweep timer started (5 min interval)');

  const postDuration = Date.now() - postStart;
  serverLog('server', `Post-index work complete in ${postDuration}ms`);
}

// ============================================================================
// CLI: --init-semantic pre-warm command
// ============================================================================

if (process.argv.includes('--init-semantic')) {
  (async () => {
    console.error('[Semantic] Pre-warming semantic search...');
    console.error(`[Semantic] Vault: ${vaultPath}`);

    try {
      const db = openStateDb(vaultPath);
      setEmbeddingsDatabase(db.db);

      const progress = await buildEmbeddingsIndex(vaultPath, (p) => {
        if (p.current % 50 === 0 || p.current === p.total) {
          console.error(`[Semantic] Embedding ${p.current}/${p.total} notes (${p.skipped} skipped)...`);
        }
      });

      console.error(`[Semantic] Done. Embedded ${progress.total - progress.skipped} notes, skipped ${progress.skipped}.`);
      db.close();
      process.exit(0);
    } catch (err) {
      console.error('[Semantic] Failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  })();
} else {
  main().catch((error) => {
    console.error('[Memory] Fatal error:', error);
    process.exit(1);
  });
}

// Flush logs on exit
process.on('beforeExit', async () => {
  await flushLogs();
});
