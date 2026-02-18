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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
import { exportHubScores } from './core/shared/hubExport.js';
import { initializeLogger as initializeReadLogger, getLogger } from './core/read/logging.js';

// Core imports - Write
import { initializeEntityIndex, setWriteStateDb } from './core/write/wikilinks.js';
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
import { openStateDb, scanVaultEntities, getSessionId, getAllEntitiesFromDb, type StateDb } from '@velvetmonkey/vault-core';

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

// Core imports - Metrics
import { computeMetrics, recordMetrics, purgeOldMetrics } from './core/shared/metrics.js';

// Core imports - Index Activity
import { recordIndexEvent, purgeOldIndexEvents, createStepTracker, computeEntityDiff } from './core/shared/indexActivity.js';

// Core imports - Tool Tracking
import { recordToolInvocation, purgeOldInvocations } from './core/shared/toolTracking.js';

// Core imports - Graph Snapshots
import { computeGraphMetrics, recordGraphSnapshot, purgeOldSnapshots } from './core/shared/graphSnapshots.js';

// Core imports - Server Activity Log
import { serverLog } from './core/shared/serverLog.js';

// Core imports - Wikilink Feedback
import { updateSuppressionList } from './core/write/wikilinkFeedback.js';

// Resources
import { registerVaultResources } from './resources/vault.js';


// ============================================================================
// Configuration
// ============================================================================

// Auto-detect vault root, with PROJECT_PATH as override
const vaultPath: string = process.env.PROJECT_PATH || process.env.VAULT_PATH || findVaultRoot();

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
  version: '2.0.0',
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
  (newConfig) => { flywheelConfig = newConfig; },
  () => stateDb
);
registerGraphTools(server, () => vaultIndex, () => vaultPath);
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
  (newConfig) => { flywheelConfig = newConfig; },
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
  serverLog('server', 'Starting Flywheel Memory server...');
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

/**
 * Scan vault for entities and save to StateDb
 */
async function updateEntitiesInStateDb(): Promise<void> {
  if (!stateDb) return;

  try {
    const entityIndex = await scanVaultEntities(vaultPath, {
      excludeFolders: [
        'daily-notes', 'daily', 'weekly', 'weekly-notes', 'monthly',
        'monthly-notes', 'quarterly', 'yearly-notes', 'periodic', 'journal',
        'inbox', 'templates', 'attachments', 'tmp',
        'clippings', 'readwise', 'articles', 'bookmarks', 'web-clips',
      ],
    });
    stateDb.replaceAllEntities(entityIndex);
    serverLog('index', `Updated ${entityIndex._metadata.total_entities} entities in StateDb`);
  } catch (e) {
    serverLog('index', `Failed to update entities in StateDb: ${e instanceof Error ? e.message : e}`, 'error');
  }
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
    serverLog('watcher', `File watcher enabled (debounce: ${config.debounceMs}ms)`);

    const watcher = createVaultWatcher({
      vaultPath,
      config,
      onBatch: async (batch) => {
        serverLog('watcher', `Processing ${batch.events.length} file changes`);
        const batchStart = Date.now();
        const changedPaths = batch.events.map(e => e.path);
        const tracker = createStepTracker();
        try {
          // Step 1: Index rebuild
          tracker.start('index_rebuild', { files_changed: batch.events.length, changed_paths: changedPaths });
          vaultIndex = await buildVaultIndex(vaultPath);
          setIndexState('ready');
          tracker.end({ note_count: vaultIndex.notes.size, entity_count: vaultIndex.entities.size, tag_count: vaultIndex.tags.size });
          serverLog('watcher', `Index rebuilt: ${vaultIndex.notes.size} notes, ${vaultIndex.entities.size} entities`);

          // Step 2: Entity scan (with diff tracking)
          const entitiesBefore = stateDb ? getAllEntitiesFromDb(stateDb) : [];
          tracker.start('entity_scan', { note_count: vaultIndex.notes.size });
          await updateEntitiesInStateDb();
          const entitiesAfter = stateDb ? getAllEntitiesFromDb(stateDb) : [];
          const entityDiff = computeEntityDiff(entitiesBefore, entitiesAfter);
          tracker.end({ entity_count: entitiesAfter.length, ...entityDiff });
          serverLog('watcher', `Entity scan: ${entitiesAfter.length} entities`);

          // Step 3: Hub scores
          tracker.start('hub_scores', { entity_count: entitiesAfter.length });
          const hubUpdated = await exportHubScores(vaultIndex, stateDb);
          tracker.end({ updated: hubUpdated ?? 0 });
          serverLog('watcher', `Hub scores: ${hubUpdated ?? 0} updated`);

          // Step 4: Note embeddings
          if (hasEmbeddingsIndex()) {
            tracker.start('note_embeddings', { files: batch.events.length });
            let embUpdated = 0;
            let embRemoved = 0;
            for (const event of batch.events) {
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

          // Step 5: Entity embeddings
          if (hasEntityEmbeddingsIndex() && stateDb) {
            tracker.start('entity_embeddings', { files: batch.events.length });
            let entEmbUpdated = 0;
            try {
              const allEntities = getAllEntitiesFromDb(stateDb);
              for (const event of batch.events) {
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
                }
              }
            } catch {
              // Don't let entity embedding errors affect watcher
            }
            tracker.end({ updated: entEmbUpdated });
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
          tracker.start('task_cache', { files: batch.events.length });
          let taskUpdated = 0;
          let taskRemoved = 0;
          for (const event of batch.events) {
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

          // Record event with all steps
          const duration = Date.now() - batchStart;
          if (stateDb) {
            recordIndexEvent(stateDb, {
              trigger: 'watcher',
              duration_ms: duration,
              note_count: vaultIndex.notes.size,
              files_changed: batch.events.length,
              changed_paths: changedPaths,
              steps: tracker.steps,
            });
          }
          serverLog('watcher', `Batch complete: ${batch.events.length} files, ${duration}ms, ${tracker.steps.length} steps`);
        } catch (err) {
          setIndexState('error');
          setIndexError(err instanceof Error ? err : new Error(String(err)));
          const duration = Date.now() - batchStart;
          if (stateDb) {
            recordIndexEvent(stateDb, {
              trigger: 'watcher',
              duration_ms: duration,
              success: false,
              files_changed: batch.events.length,
              changed_paths: changedPaths,
              error: err instanceof Error ? err.message : String(err),
              steps: tracker.steps,
            });
          }
          serverLog('watcher', `Failed to rebuild index: ${err instanceof Error ? err.message : err}`, 'error');
        }
      },
      onStateChange: (status) => {
        if (status.state === 'dirty') {
          serverLog('watcher', 'Index may be stale', 'warn');
        }
      },
      onError: (err) => {
        serverLog('watcher', `Watcher error: ${err.message}`, 'error');
      },
    });

    watcher.start();
    serverLog('watcher', 'File watcher started');
  }

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
