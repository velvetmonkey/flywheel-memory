#!/usr/bin/env node
/**
 * Flywheel Memory - MCP tools that search, write, and auto-link your Obsidian vault — and learn from your edits.
 *
 * 75 tools across 12 categories
 * - policy (unified: list, validate, preview, execute, author, revise)
 * - Temporal tools absorbed into search (modified_after/modified_before) + get_vault_stats (recent_activity)
 * - Dropped: policy_diff, policy_export, policy_import, get_contemporaneous_notes
 * - graph_analysis (7 modes: orphans, dead_ends, sources, hubs, stale, immature, emerging_hubs)
 * - semantic_analysis (extracted: clusters, bridges)
 * - vault_schema (4 modes: overview, field_values, inconsistencies, contradictions)
 * - schema_conventions (extracted: conventions, incomplete, suggest_values)
 * - schema_validate (extracted: validate, missing)
 * - note_intelligence (unified: prose_patterns, suggest_frontmatter, wikilinks, compute, semantic_links)
 * - get_backlinks (absorbed find_bidirectional_links via include_bidirectional param)
 * - validate_links (absorbed find_broken_links via typos_only param)
 */

import * as path from 'path';
import { readFileSync, realpathSync, existsSync } from 'fs';
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
  type IndexState,
} from './core/read/graph.js';
import { scanVault } from './core/read/vault.js';
import { loadConfig, inferConfig, saveConfig, DEFAULT_ENTITY_EXCLUDE_FOLDERS, getExcludeTags, type FlywheelConfig } from './core/read/config.js';
import { findVaultRoot } from './core/read/vaultRoot.js';
import {
  createVaultWatcher,
  parseWatcherConfig,
  type VaultWatcher,
  type WatcherStatus,
} from './core/read/watch/index.js';
import { PipelineRunner } from './core/read/watch/pipeline.js';
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
  setEmbeddingsBuildState,
  loadEntityEmbeddingsToMemory,
  updateEntityEmbedding,
  hasEntityEmbeddingsIndex,
  getStoredEmbeddingModel,
  getActiveModelId,
  getEntityEmbeddingsMap,
  getStoredTextVersion,
  clearEmbeddingsForRebuild,
  EMBEDDING_TEXT_VERSION,
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
import { openStateDb, scanVaultEntities, getAllEntitiesFromDb, loadContentHashes, saveContentHashBatch, renameContentHash, checkDbIntegrity, safeBackupAsync, preserveCorruptedDb, deleteStateDbFiles, attemptSalvage, type StateDb } from '@velvetmonkey/vault-core';

// Memory lifecycle (used directly in index.ts for periodic maintenance)
import { sweepExpiredMemories, decayMemoryConfidence, pruneSupersededMemories } from './core/write/memory.js';

// Core imports - Sweep
import { startSweepTimer, stopSweepTimer } from './core/read/sweep.js';

// Core imports - Metrics
import { computeMetrics, recordMetrics, purgeOldMetrics } from './core/shared/metrics.js';
import { purgeOldBenchmarks } from './core/shared/benchmarks.js';

// Core imports - Index Activity
import { recordIndexEvent, purgeOldIndexEvents, purgeOldSuggestionEvents, purgeOldNoteLinkHistory, getRecentPipelineEvent } from './core/shared/indexActivity.js';

// Core imports - Tool Tracking
import { purgeOldInvocations } from './core/shared/toolTracking.js';

// Core imports - Graph Snapshots
import { computeGraphMetrics, recordGraphSnapshot, purgeOldSnapshots } from './core/shared/graphSnapshots.js';

// Core imports - Server Activity Log
import { serverLog } from './core/shared/serverLog.js';

// Core imports - Wikilink Feedback
import { updateSuppressionList } from './core/write/wikilinkFeedback.js';

// Core imports - Recency
import { setRecencyStateDb } from './core/shared/recency.js';

// Core imports - Co-occurrence
import { loadCooccurrenceFromStateDb } from './core/shared/cooccurrence.js';
import { pruneStaleRetrievalCooccurrence } from './core/shared/retrievalCooccurrence.js';

// Node builtins
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { CoalescedEvent, RenameEvent } from './core/read/watch/types.js';
import type { BatchHandler } from './core/read/watch/index.js';

// Multi-vault
import { VaultRegistry, parseVaultConfig, type VaultContext } from './vault-registry.js';
import { setActiveScope, getActiveScopeOrNull, type VaultScope } from './vault-scope.js';

// Config (tool categories, presets, instructions)
import {
  parseEnabledCategories,
  generateInstructions,
} from './config.js';

// Tool registration and gating
import {
  applyToolGating,
  registerAllTools,
  type ToolRegistryContext,
  type VaultActivationCallbacks,
} from './tool-registry.js';


// ============================================================================
// Configuration
// ============================================================================

// Auto-detect vault root, with PROJECT_PATH as override
const vaultPath: string = process.env.PROJECT_PATH || process.env.VAULT_PATH || findVaultRoot();
let resolvedVaultPath: string;
try { resolvedVaultPath = realpathSync(vaultPath).replace(/\\/g, '/'); } catch { resolvedVaultPath = vaultPath.replace(/\\/g, '/'); }

// Validate vault path exists
if (!existsSync(resolvedVaultPath)) {
  console.error(`[flywheel] Fatal: vault path does not exist: ${resolvedVaultPath}`);
  console.error(`[flywheel] Set PROJECT_PATH or VAULT_PATH to a valid Obsidian vault directory.`);
  process.exit(1);
}

// State variables (module-level singletons — swapped by activateVault for multi-vault)
let vaultIndex: VaultIndex;
let flywheelConfig: FlywheelConfig = {};
let stateDb: StateDb | null = null;
let watcherInstance: VaultWatcher | null = null;

// Multi-vault registry (populated in main())
let vaultRegistry: VaultRegistry | null = null;

/** Current watcher status (live — reads state at call time, not a stale snapshot). */
export function getWatcherStatus(): WatcherStatus | null {
  if (vaultRegistry) {
    const name = (globalThis as any).__flywheel_active_vault;
    if (name) {
      try { return vaultRegistry.getContext(name).watcher?.status ?? null; } catch { /* fall through */ }
    }
  }
  return watcherInstance?.status ?? null;
}

const enabledCategories = parseEnabledCategories();

// ============================================================================
// Tool Registration Helpers
// ============================================================================

/** Build the ToolRegistryContext from module-level singletons (scope-aware getters). */
function buildRegistryContext(): ToolRegistryContext {
  return {
    getVaultPath: () => getActiveScopeOrNull()?.vaultPath ?? vaultPath,
    getVaultIndex: () => getActiveScopeOrNull()?.vaultIndex ?? vaultIndex,
    getStateDb: () => getActiveScopeOrNull()?.stateDb ?? stateDb,
    getFlywheelConfig: () => getActiveScopeOrNull()?.flywheelConfig ?? flywheelConfig,
    getWatcherStatus,
    updateVaultIndex,
    updateFlywheelConfig,
  };
}

/** Build vault activation callbacks for multi-vault gating. */
function buildVaultCallbacks(): VaultActivationCallbacks {
  return { activateVault, buildVaultScope };
}

/**
 * Create a fully configured McpServer with tool gating and all tools registered.
 * Used by HTTP transport to create per-request servers.
 */
function createConfiguredServer(): McpServer {
  const s = new McpServer(
    { name: 'flywheel-memory', version: pkg.version },
    { instructions: generateInstructions(enabledCategories, vaultRegistry) },
  );
  const ctx = buildRegistryContext();
  applyToolGating(s, enabledCategories, ctx.getStateDb, vaultRegistry, ctx.getVaultPath, buildVaultCallbacks());
  registerAllTools(s, ctx);
  return s;
}

// ============================================================================
// Primary Server Instance (stdio transport)
// ============================================================================

const server = new McpServer(
  { name: 'flywheel-memory', version: pkg.version },
  { instructions: generateInstructions(enabledCategories, vaultRegistry) },
);

const _registryCtx = buildRegistryContext();
const _gatingResult = applyToolGating(server, enabledCategories, _registryCtx.getStateDb, vaultRegistry, _registryCtx.getVaultPath, buildVaultCallbacks());
registerAllTools(server, _registryCtx);

const categoryList = Array.from(enabledCategories).sort().join(', ');
serverLog('server', `Tool categories: ${categoryList}`);
serverLog('server', `Registered ${_gatingResult.registered} tools, skipped ${_gatingResult.skipped}`);

// ============================================================================
// Multi-Vault Initialization (MV.2 + MV.3)
// ============================================================================

/** Load cached co-occurrence index for a single vault context. */
function loadVaultCooccurrence(ctx: VaultContext): void {
  if (!ctx.stateDb) return;
  const cachedCooc = loadCooccurrenceFromStateDb(ctx.stateDb);
  if (cachedCooc) {
    ctx.cooccurrenceIndex = cachedCooc.index;
    ctx.lastCooccurrenceRebuildAt = cachedCooc.builtAt;
    serverLog('index', `[${ctx.name}] Co-occurrence: loaded from cache (${Object.keys(cachedCooc.index.associations).length} entities, ${cachedCooc.index._metadata.total_associations} associations)`);
  }
}

/**
 * Initialize a vault: open StateDb, run integrity check.
 * Returns a VaultContext with StateDb ready. Does NOT build indexes.
 */
async function initializeVault(name: string, vaultPathArg: string): Promise<VaultContext> {
  const ctx: VaultContext = {
    name,
    vaultPath: vaultPathArg,
    stateDb: null,
    vaultIndex: undefined as unknown as VaultIndex,
    flywheelConfig: {},
    watcher: null,
    cooccurrenceIndex: null,
    embeddingsBuilding: false,
    indexState: 'building',
    indexError: null,
    lastCooccurrenceRebuildAt: 0,
    lastEdgeWeightRebuildAt: 0,
    lastEntityScanAt: 0,
    lastHubScoreRebuildAt: 0,
    lastIndexCacheSaveAt: 0,
  };

  try {
    ctx.stateDb = openStateDb(vaultPathArg);
    serverLog('statedb', `[${name}] StateDb initialized`);

    // Post-open integrity check
    const integrity = checkDbIntegrity(ctx.stateDb.db);
    if (integrity.ok) {
      // DB is healthy — create a safe rotated backup (non-blocking)
      safeBackupAsync(ctx.stateDb.db, ctx.stateDb.dbPath).catch((err: unknown) => {
        serverLog('backup', `[${name}] Safe backup failed: ${err}`, 'error');
      });
    } else {
      // DB opened but has page-level corruption — nuke and rebuild
      serverLog('statedb', `[${name}] Integrity check failed: ${integrity.detail} — recreating`, 'error');
      const dbPath = ctx.stateDb.dbPath;
      preserveCorruptedDb(dbPath);
      ctx.stateDb.close();
      deleteStateDbFiles(dbPath);
      ctx.stateDb = openStateDb(vaultPathArg);
      attemptSalvage(ctx.stateDb.db, dbPath);
    }

    // Nudge if vault_init has never been run
    const vaultInitRow = ctx.stateDb.getMetadataValue.get('vault_init_last_run_at') as { value: string } | undefined;
    if (!vaultInitRow) {
      serverLog('server', `[${name}] Vault not initialized — call vault_init to enrich legacy notes`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    serverLog('statedb', `[${name}] StateDb initialization failed: ${msg}`, 'error');
    serverLog('server', `[${name}] Auto-wikilinks will be disabled for this session`, 'warn');
  }

  return ctx;
}

/** Build a VaultScope snapshot from a VaultContext (for runInVaultScope). */
function buildVaultScope(ctx: VaultContext): VaultScope {
  return {
    name: ctx.name,
    vaultPath: ctx.vaultPath,
    stateDb: ctx.stateDb,
    flywheelConfig: ctx.flywheelConfig,
    vaultIndex: ctx.vaultIndex,
    cooccurrenceIndex: ctx.cooccurrenceIndex,
    indexState: ctx.indexState,
    indexError: ctx.indexError,
    embeddingsBuilding: ctx.embeddingsBuilding,
    entityEmbeddingsMap: getEntityEmbeddingsMap(),
  };
}

/**
 * Activate a vault context by swapping all module-level singletons.
 * Also sets the fallback VaultScope for code outside ALS context.
 * Tool handlers additionally run inside runInVaultScope() for per-request isolation.
 */
function activateVault(ctx: VaultContext): void {
  // Update module-level state
  (globalThis as any).__flywheel_active_vault = ctx.name;

  if (ctx.stateDb) {
    setWriteStateDb(ctx.stateDb);
    setFTS5Database(ctx.stateDb.db);
    setRecencyStateDb(ctx.stateDb);
    setTaskCacheDatabase(ctx.stateDb.db);
    setEmbeddingsDatabase(ctx.stateDb.db);
    loadEntityEmbeddingsToMemory();
  }

  // Swap state that was previously not per-vault
  setWikilinkConfig(ctx.flywheelConfig);
  setCooccurrenceIndex(ctx.cooccurrenceIndex);
  setIndexState(ctx.indexState);
  setIndexError(ctx.indexError);
  setEmbeddingsBuilding(ctx.embeddingsBuilding);

  // Set the fallback VaultScope (for code outside ALS context: startup, watcher)
  setActiveScope(buildVaultScope(ctx));
}

/**
 * Get the currently active VaultContext (by __flywheel_active_vault name).
 * Used to mirror module-level state changes back to the context.
 */
function getActiveVaultContext(): VaultContext | null {
  if (!vaultRegistry) return null;
  const name = (globalThis as any).__flywheel_active_vault;
  if (!name) return null;
  try { return vaultRegistry.getContext(name); } catch { return null; }
}

/** Update index state on both module-level singleton and active VaultContext */
function updateIndexState(state: IndexState, error?: Error | null): void {
  setIndexState(state);
  if (error !== undefined) setIndexError(error);
  const ctx = getActiveVaultContext();
  if (ctx) {
    ctx.indexState = state;
    if (error !== undefined) ctx.indexError = error;
  }
}

/** Update vaultIndex on both module-level singleton and active VaultContext */
function updateVaultIndex(index: VaultIndex): void {
  vaultIndex = index;
  const ctx = getActiveVaultContext();
  if (ctx) ctx.vaultIndex = index;
}

/** Update flywheelConfig on both module-level singleton and active VaultContext */
function updateFlywheelConfig(config: FlywheelConfig): void {
  flywheelConfig = config;
  setWikilinkConfig(config);
  const ctx = getActiveVaultContext();
  if (ctx) {
    ctx.flywheelConfig = config;
    // Rebuild fallback scope so scope-aware getters see the update
    setActiveScope(buildVaultScope(ctx));
  }
}

/**
 * Boot a single vault: logging, FTS5, index build, post-index work.
 * Called once per vault in the registry (sequentially — module-level state is correct).
 */
async function bootVault(ctx: VaultContext, startTime: number): Promise<void> {
  const vp = ctx.vaultPath;
  const sd = ctx.stateDb;

  // Initialize logging
  initializeReadLogger(vp).then(() => {
    const logger = getLogger();
    if (logger?.enabled) {
      serverLog('server', `[${ctx.name}] Unified logging enabled`);
    }
  }).catch(() => {});

  initializeWriteLogger(vp).catch(err => {
    serverLog('server', `[${ctx.name}] Write logger initialization failed: ${err}`, 'error');
  });

  // Kick off FTS5 immediately (fire-and-forget, parallel with graph build)
  if (process.env.FLYWHEEL_SKIP_FTS5 !== 'true') {
    if (isIndexStale(vp)) {
      buildFTS5Index(vp).then(() => {
        serverLog('fts5', `[${ctx.name}] Search index ready`);
      }).catch(err => {
        serverLog('fts5', `[${ctx.name}] Build failed: ${err instanceof Error ? err.message : err}`, 'error');
      });
    } else {
      serverLog('fts5', `[${ctx.name}] Search index already fresh, skipping rebuild`);
    }
  } else {
    serverLog('fts5', 'Skipping — FLYWHEEL_SKIP_FTS5');
  }

  // Try loading index from cache
  let cachedIndex: VaultIndex | null = null;
  if (sd) {
    try {
      const files = await scanVault(vp);
      const noteCount = files.length;
      serverLog('index', `[${ctx.name}] Found ${noteCount} markdown files`);
      const newestMtime = files.reduce((max, f) => f.modified > max ? f.modified : max, new Date(0));
      cachedIndex = loadVaultIndexFromCache(sd, noteCount, undefined, undefined, newestMtime);
    } catch (err) {
      serverLog('index', `[${ctx.name}] Cache check failed: ${err instanceof Error ? err.message : err}`, 'warn');
    }
  }

  if (cachedIndex) {
    updateVaultIndex(cachedIndex);
    updateIndexState('ready');
    const duration = Date.now() - startTime;
    const cacheAge = cachedIndex.builtAt ? Math.round((Date.now() - cachedIndex.builtAt.getTime()) / 1000) : 0;
    serverLog('index', `[${ctx.name}] Cache hit: ${cachedIndex.notes.size} notes, ${cacheAge}s old — loaded in ${duration}ms`);
    if (sd) {
      recordIndexEvent(sd, {
        trigger: 'startup_cache',
        duration_ms: duration,
        note_count: cachedIndex.notes.size,
      });
    }
    await runPostIndexWork(ctx);
  } else {
    serverLog('index', `[${ctx.name}] Cache miss: building from scratch`);
    try {
      const built = await buildVaultIndex(vp);
      updateVaultIndex(built);
      updateIndexState('ready');
      const duration = Date.now() - startTime;
      serverLog('index', `[${ctx.name}] Vault index ready in ${duration}ms — ${vaultIndex.notes.size} notes`);
      if (sd) {
        recordIndexEvent(sd, {
          trigger: 'startup_build',
          duration_ms: duration,
          note_count: vaultIndex.notes.size,
        });
      }
      if (sd) {
        try {
          saveVaultIndexToCache(sd, vaultIndex);
          serverLog('index', `[${ctx.name}] Index cache saved`);
        } catch (err) {
          serverLog('index', `[${ctx.name}] Failed to save index cache: ${err instanceof Error ? err.message : err}`, 'error');
        }
      }
      await runPostIndexWork(ctx);
    } catch (err) {
      updateIndexState('error', err instanceof Error ? err : new Error(String(err)));
      const duration = Date.now() - startTime;
      if (sd) {
        recordIndexEvent(sd, {
          trigger: 'startup_build',
          duration_ms: duration,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      serverLog('index', `[${ctx.name}] Failed to build vault index: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  serverLog('server', `Starting Flywheel Memory v${pkg.version}...`);
  serverLog('server', `Vault: ${vaultPath}`);

  const startTime = Date.now();

  // Parse multi-vault config
  const vaultConfigs = parseVaultConfig();

  // ── Phase 1: Initialize primary vault (StateDb only — fast) ──
  if (vaultConfigs) {
    vaultRegistry = new VaultRegistry(vaultConfigs[0].name);
    serverLog('server', `Multi-vault mode: ${vaultConfigs.map(v => v.name).join(', ')}`);

    // Initialize primary vault first (just StateDb open + integrity check)
    const primaryCtx = await initializeVault(vaultConfigs[0].name, vaultConfigs[0].path);
    vaultRegistry.addContext(primaryCtx);
    stateDb = primaryCtx.stateDb;
    activateVault(primaryCtx);
  } else {
    vaultRegistry = new VaultRegistry('default');
    const ctx = await initializeVault('default', vaultPath);
    vaultRegistry.addContext(ctx);
    stateDb = ctx.stateDb;
    activateVault(ctx);
  }

  // ── Phase 2: Connect transports BEFORE heavy work ──
  // Tools use lazy getters — they'll return "StateDb not available" until boot
  // completes, but the MCP handshake completes in <1s instead of 60s+.
  const transportMode = (process.env.FLYWHEEL_TRANSPORT ?? 'stdio').toLowerCase();

  if (transportMode === 'stdio' || transportMode === 'both') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    serverLog('server', `MCP server connected (stdio) in ${Date.now() - startTime}ms`);
  }

  if (transportMode === 'http' || transportMode === 'both') {
    const { createMcpExpressApp } = await import('@modelcontextprotocol/sdk/server/express.js');
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');

    const httpPort = parseInt(process.env.FLYWHEEL_HTTP_PORT ?? '3111', 10);
    if (!Number.isFinite(httpPort) || httpPort < 1 || httpPort > 65535) {
      console.error(`[flywheel] Fatal: invalid FLYWHEEL_HTTP_PORT: ${process.env.FLYWHEEL_HTTP_PORT} (must be 1-65535)`);
      process.exit(1);
    }
    const httpHost = process.env.FLYWHEEL_HTTP_HOST ?? '127.0.0.1';

    const app = createMcpExpressApp({ host: httpHost });

    // Stateless HTTP — per-request McpServer + StreamableHTTPServerTransport
    app.post('/mcp', async (req: any, res: any) => {
      const httpServer = createConfiguredServer();
      const httpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await httpServer.connect(httpTransport);
      await httpTransport.handleRequest(req, res, req.body);
      res.on('close', () => { httpTransport.close(); httpServer.close(); });
    });

    app.get('/health', (_req: any, res: any) => {
      const health: Record<string, unknown> = { status: 'ok', version: pkg.version, vault: vaultPath };
      if (vaultRegistry?.isMultiVault) {
        health.vaults = vaultRegistry.getVaultNames();
      }
      res.json(health);
    });

    app.listen(httpPort, httpHost, () => {
      serverLog('server', `HTTP transport on ${httpHost}:${httpPort}`);
    });
  }

  // ── Phase 3: Load co-occurrence + boot primary vault ──
  const primaryCtx = vaultRegistry.getContext();
  loadVaultCooccurrence(primaryCtx);
  activateVault(primaryCtx);
  await bootVault(primaryCtx, startTime);
  // Re-activate after boot so fallback scope reflects post-boot state (config, index, etc.)
  activateVault(primaryCtx);

  // ── Phase 4: Initialize + boot secondary vaults (background) ──
  if (vaultConfigs && vaultConfigs.length > 1) {
    const secondaryConfigs = vaultConfigs.slice(1);
    // Don't await — secondary vaults boot in background
    (async () => {
      for (const vc of secondaryConfigs) {
        try {
          const ctx = await initializeVault(vc.name, vc.path);
          vaultRegistry!.addContext(ctx);
          loadVaultCooccurrence(ctx);
          activateVault(ctx);
          await bootVault(ctx, startTime);
          serverLog('server', `[${vc.name}] Secondary vault ready`);
        } catch (err) {
          serverLog('server', `[${vc.name}] Secondary vault boot failed: ${err}`, 'error');
        }
      }
      // Re-activate primary after all secondaries are booted
      activateVault(vaultRegistry!.getContext());
    })();
  }
}

// DEFAULT_ENTITY_EXCLUDE_FOLDERS imported from ./core/read/config.js

/** Timestamp of last co-occurrence index rebuild (epoch ms) */
let lastCooccurrenceRebuildAt = 0;

/** Timestamp of last edge weight recompute (epoch ms) */
let lastEdgeWeightRebuildAt = 0;

/**
 * Scan vault for entities and save to StateDb
 */
async function updateEntitiesInStateDb(vp?: string, sd?: StateDb | null): Promise<void> {
  const db = sd ?? stateDb;
  const vault = vp ?? vaultPath;
  if (!db) return;

  try {
    const config = loadConfig(db);
    const excludeFolders = config.exclude_entity_folders?.length
      ? config.exclude_entity_folders
      : DEFAULT_ENTITY_EXCLUDE_FOLDERS;

    const entityIndex = await scanVaultEntities(vault, {
      excludeFolders,
      customCategories: config.custom_categories,
    });
    db.replaceAllEntities(entityIndex);
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

// ============================================================================
// Periodic Maintenance (runs on sweep timer — every 5 min)
// ============================================================================

/** Track when purges last ran (startup purges count as the first run) */
let lastPurgeAt = Date.now();

/**
 * Periodic maintenance callback for the sweep timer.
 * Memory lifecycle runs every call (cheap SQL on small tables).
 * Purges run once per day (not urgent, just prevent unbounded growth).
 */
function runPeriodicMaintenance(db: StateDb): void {
  // Memory lifecycle — cheap, run every sweep (5 min)
  sweepExpiredMemories(db);
  decayMemoryConfidence(db);
  pruneSupersededMemories(db, 90);

  // Purges — run once per day
  const now = Date.now();
  if (now - lastPurgeAt > 24 * 60 * 60 * 1000) {
    purgeOldMetrics(db, 90);
    purgeOldBenchmarks(db, 90);
    purgeOldIndexEvents(db, 90);
    purgeOldInvocations(db, 90);
    purgeOldSuggestionEvents(db, 30);
    purgeOldNoteLinkHistory(db, 90);
    purgeOldSnapshots(db, 90);
    pruneStaleRetrievalCooccurrence(db, 30);
    lastPurgeAt = now;
    serverLog('server', 'Daily purge complete');
  }
}

/**
 * Post-index work: config inference, hub export, file watcher.
 * Accepts VaultContext so all state is scoped per-vault (multi-vault safe).
 */
async function runPostIndexWork(ctx: VaultContext) {
  const index = ctx.vaultIndex;
  const vp = ctx.vaultPath;
  const sd = ctx.stateDb;
  let rvp: string;
  try { rvp = realpathSync(vp).replace(/\\/g, '/'); } catch { rvp = vp.replace(/\\/g, '/'); }
  const postStart = Date.now();

  // Scan and save entities to StateDb
  serverLog('index', 'Scanning entities...');
  await updateEntitiesInStateDb(vp, sd);

  // Initialize wikilink entity index from StateDb (now populated)
  await initializeEntityIndex(vp);
  serverLog('index', 'Entity index initialized');

  // Export hub scores
  await exportHubScores(index, sd);
  serverLog('index', 'Hub scores exported');

  // Record growth metrics
  if (sd) {
    try {
      const metrics = computeMetrics(index, sd);
      recordMetrics(sd, metrics);
      purgeOldMetrics(sd, 90);
      purgeOldIndexEvents(sd, 90);
      purgeOldInvocations(sd, 90);
      purgeOldSuggestionEvents(sd, 30);
      purgeOldNoteLinkHistory(sd, 90);
      // Memory lifecycle maintenance
      sweepExpiredMemories(sd);
      decayMemoryConfidence(sd);
      pruneSupersededMemories(sd, 90);
      serverLog('server', 'Growth metrics recorded');
    } catch (err) {
      serverLog('server', `Failed to record metrics: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }

  // Record graph topology snapshot
  if (sd) {
    try {
      const graphMetrics = computeGraphMetrics(index);
      recordGraphSnapshot(sd, graphMetrics);
      purgeOldSnapshots(sd, 90);
    } catch (err) {
      serverLog('server', `Failed to record graph snapshot: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }

  // Update wikilink suppression list
  if (sd) {
    try {
      updateSuppressionList(sd);
      serverLog('index', 'Suppression list updated');
    } catch (err) {
      serverLog('server', `Failed to update suppression list: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }

  // Load/infer config early so task cache can use exclude tags
  const existing = loadConfig(sd);
  const inferred = inferConfig(index, vp);
  if (sd) {
    saveConfig(sd, inferred, existing);
  }
  updateFlywheelConfig(loadConfig(sd));
  const configKeys = Object.keys(flywheelConfig).filter(k => (flywheelConfig as Record<string, unknown>)[k] != null);
  serverLog('config', `Config inferred: ${configKeys.join(', ')}`);

  // Build task cache (skip rebuild if SQLite cache is already fresh)
  if (sd) {
    if (isTaskCacheStale()) {
      serverLog('tasks', 'Task cache stale, rebuilding...');
      refreshIfStale(vp, index, getExcludeTags(flywheelConfig));
    } else {
      serverLog('tasks', 'Task cache fresh, skipping rebuild');
    }
  }

  if (flywheelConfig.vault_name) {
    serverLog('config', `Vault: ${flywheelConfig.vault_name}`);
  }

  // Auto-build embeddings in background (fire-and-forget)
  // Fast pre-check avoids model loading when embeddings are already current
  if (process.env.FLYWHEEL_SKIP_EMBEDDINGS !== 'true') {
    const hasIndex = hasEmbeddingsIndex();
    const storedModel = getStoredEmbeddingModel();
    const storedVersion = getStoredTextVersion();
    const modelChanged = storedModel !== null && storedModel !== getActiveModelId();
    const versionChanged = storedVersion !== null && storedVersion !== EMBEDDING_TEXT_VERSION;

    if (hasIndex && !modelChanged && !versionChanged) {
      // Everything current — skip model load, just load entity embeddings to memory
      serverLog('semantic', 'Embeddings up-to-date, skipping build');
      loadEntityEmbeddingsToMemory();
    } else {
      // Something needs updating — model load required
      if (modelChanged) {
        serverLog('semantic', `Model changed ${storedModel} → ${getActiveModelId()}, clearing`);
        clearEmbeddingsForRebuild();
      } else if (versionChanged) {
        serverLog('semantic', `Text version changed v${storedVersion} → v${EMBEDDING_TEXT_VERSION}`);
      } else if (!hasIndex) {
        serverLog('semantic', 'No embeddings found, building');
      } else {
        // storedVersion is null — migration from pre-version-tracking
        serverLog('semantic', 'No stored version, running build to verify/update');
      }

      const MAX_BUILD_RETRIES = 2;

      const attemptBuild = async (attempt: number): Promise<void> => {
        // Re-activate this vault's context before each attempt — in multi-vault mode,
        // another vault's boot may have swapped the module-level DB handles since this
        // fire-and-forget build was launched.
        activateVault(ctx);
        setEmbeddingsBuilding(true);
        ctx.embeddingsBuilding = true;
        try {
          await buildEmbeddingsIndex(vp, (p) => {
            if (p.current % 100 === 0 || p.current === p.total) {
              serverLog('semantic', `Embedding ${p.current}/${p.total} notes...`);
            }
          });
          if (sd) {
            const entities = getAllEntitiesFromDb(sd);
            if (entities.length > 0) {
              const entityMap = new Map(entities.map(e => [e.name, {
                name: e.name,
                path: e.path,
                category: e.category,
                aliases: e.aliases,
              }]));
              // Re-activate before entity embeddings (may have been swapped during note build)
              activateVault(ctx);
              await buildEntityEmbeddingsIndex(vp, entityMap);
            }
          }
          activateVault(ctx);
          loadEntityEmbeddingsToMemory();
          setEmbeddingsBuildState('complete');
          serverLog('semantic', 'Embeddings ready — searches now use hybrid ranking');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < MAX_BUILD_RETRIES) {
            const delay = 10_000;
            serverLog('semantic', `Build failed (attempt ${attempt}/${MAX_BUILD_RETRIES}): ${msg}. Retrying in ${delay / 1000}s...`, 'error');
            await new Promise(resolve => setTimeout(resolve, delay));
            return attemptBuild(attempt + 1);
          }
          serverLog('semantic', `Embeddings build failed after ${MAX_BUILD_RETRIES} attempts: ${msg}`, 'error');
          serverLog('semantic', 'Keyword search (BM25) remains fully available', 'error');
        } finally {
          activateVault(ctx);
          setEmbeddingsBuilding(false);
          ctx.embeddingsBuilding = false;
        }
      };

      attemptBuild(1);
    }
  } else {
    serverLog('semantic', 'Skipping — FLYWHEEL_SKIP_EMBEDDINGS');
  }

  // Setup file watcher
  if (process.env.FLYWHEEL_WATCH !== 'false') {
    const config = parseWatcherConfig();
    const lastContentHashes = new Map<string, string>();
    if (sd) {
      const persisted = loadContentHashes(sd);
      for (const [p, h] of persisted) lastContentHashes.set(p, h);
      if (persisted.size > 0) {
        serverLog('watcher', `Loaded ${persisted.size} persisted content hashes`);
      }
    }
    serverLog('watcher', `File watcher enabled (debounce: ${config.debounceMs}ms)`);

    // Define before createVaultWatcher so we can call it directly for catch-up
    const handleBatch: BatchHandler = async (batch) => {
        // Convert event paths from absolute to vault-relative
        // Handles symlink mismatches (e.g., WSL /mnt/c/ vs /home/user/ mounts)
        const vaultPrefixes = new Set([
          vp.replace(/\\/g, '/'),
          rvp,
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
        const hashUpserts: Array<{ path: string; hash: string }> = [];
        const hashDeletes: string[] = [];
        for (const event of batch.events) {
          if (event.type === 'delete') {
            filteredEvents.push(event);
            lastContentHashes.delete(event.path);
            hashDeletes.push(event.path);
            continue;
          }
          try {
            const content = await fs.readFile(path.join(vp, event.path), 'utf-8');
            const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
            if (lastContentHashes.get(event.path) === hash) {
              serverLog('watcher', `Hash unchanged, skipping: ${event.path}`);
              continue;
            }
            lastContentHashes.set(event.path, hash);
            hashUpserts.push({ path: event.path, hash });
            filteredEvents.push(event);
          } catch {
            filteredEvents.push(event); // File may have been deleted mid-batch
          }
        }
        if (sd && (hashUpserts.length || hashDeletes.length)) {
          saveContentHashBatch(sd, hashUpserts, hashDeletes);
        }

        // Process rename events: record moves and update path references in DB
        if (batchRenames.length > 0 && sd) {
          try {
            const insertMove = sd.db.prepare(`
              INSERT INTO note_moves (old_path, new_path, old_folder, new_folder)
              VALUES (?, ?, ?, ?)
            `);
            const renameNoteLinks = sd.db.prepare(
              'UPDATE note_links SET note_path = ? WHERE note_path = ?'
            );
            const renameNoteTags = sd.db.prepare(
              'UPDATE note_tags SET note_path = ? WHERE note_path = ?'
            );
            const renameNoteLinkHistory = sd.db.prepare(
              'UPDATE note_link_history SET note_path = ? WHERE note_path = ?'
            );
            const renameWikilinkApplications = sd.db.prepare(
              'UPDATE wikilink_applications SET note_path = ? WHERE note_path = ?'
            );
            const renameProactiveQueue = sd.db.prepare(
              'UPDATE proactive_queue SET note_path = ? WHERE note_path = ? AND status = \'pending\''
            );
            for (const rename of batchRenames) {
              const oldFolder = rename.oldPath.includes('/') ? rename.oldPath.split('/').slice(0, -1).join('/') : '';
              const newFolder = rename.newPath.includes('/') ? rename.newPath.split('/').slice(0, -1).join('/') : '';
              insertMove.run(rename.oldPath, rename.newPath, oldFolder || null, newFolder || null);
              renameNoteLinks.run(rename.newPath, rename.oldPath);
              renameNoteTags.run(rename.newPath, rename.oldPath);
              renameNoteLinkHistory.run(rename.newPath, rename.oldPath);
              renameWikilinkApplications.run(rename.newPath, rename.oldPath);
              renameProactiveQueue.run(rename.newPath, rename.oldPath);
              // Also update the content hash map (in-memory + persisted)
              const oldHash = lastContentHashes.get(rename.oldPath);
              if (oldHash !== undefined) {
                lastContentHashes.set(rename.newPath, oldHash);
                lastContentHashes.delete(rename.oldPath);
                renameContentHash(sd, rename.oldPath, rename.newPath);
              }
            }
            serverLog('watcher', `Renames: recorded ${batchRenames.length} move(s) in note_moves`);
          } catch (err) {
            serverLog('watcher', `Rename recording failed: ${err instanceof Error ? err.message : err}`, 'error');
          }
        }

        if (filteredEvents.length === 0 && batchRenames.length === 0) {
          serverLog('watcher', 'All files unchanged (hash gate), skipping batch');
          return;
        }

        // Synthesize upsert events for renamed files so the full pipeline refreshes in-memory state
        if (filteredEvents.length === 0 && batchRenames.length > 0) {
          for (const rename of batchRenames) {
            filteredEvents.push({
              type: 'upsert' as const,
              path: rename.newPath,
              originalEvents: [],
            });
          }
        }

        serverLog('watcher', `Processing ${filteredEvents.length} file changes`);
        const changedPaths = filteredEvents.map(e => e.path);

        // Delegate to PipelineRunner (extracted step logic)
        const runner = new PipelineRunner({
          vp,
          sd,
          ctx,
          events: filteredEvents,
          renames: batchRenames,
          batch,
          changedPaths,
          flywheelConfig,
          updateIndexState,
          updateVaultIndex,
          updateEntitiesInStateDb,
          getVaultIndex: () => vaultIndex,
          buildVaultIndex,
        });
        await runner.run();
    };

    const watcher = createVaultWatcher({
      vaultPath: vp,
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
    ctx.watcher = watcher;
    watcherInstance = watcher;

    // Startup catch-up: process files that were modified while the server was offline.
    // getRecentPipelineEvent returns the last event with steps (i.e. last watcher run).
    // Files with mtime > that timestamp were not seen by the watcher last session.
    if (sd) {
      const lastPipelineEvent = getRecentPipelineEvent(sd);
      if (lastPipelineEvent) {
        const catchupEvents = await buildStartupCatchupBatch(vp, lastPipelineEvent.timestamp);
        if (catchupEvents.length > 0) {
          // eslint-disable-next-line no-console
          console.error(`[Flywheel] Startup catch-up: ${catchupEvents.length} file(s) modified while offline`);
          await handleBatch({ events: catchupEvents, renames: [], timestamp: Date.now() });
        }
      }
    }

    // Expire stale proactive queue entries from previous session
    if (sd) {
      try {
        const { expireStaleEntries } = await import('./core/write/proactiveQueue.js');
        const expired = expireStaleEntries(sd);
        if (expired > 0) {
          serverLog('watcher', `Startup: expired ${expired} stale proactive queue entries`);
        }
      } catch { /* non-critical */ }
    }

    watcher.start();
    serverLog('watcher', 'File watcher started');
  }

  // Start periodic sweep for graph hygiene metrics (only when watcher is active)
  if (process.env.FLYWHEEL_WATCH !== 'false') {
    startSweepTimer(() => ctx.vaultIndex, undefined, () => {
      if (sd) runPeriodicMaintenance(sd);
    });
    serverLog('server', 'Sweep timer started (5 min interval)');
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

      // Model change → full clear
      const storedModel = getStoredEmbeddingModel();
      if (storedModel && storedModel !== getActiveModelId()) {
        console.error(`[Semantic] Model changed ${storedModel} → ${getActiveModelId()}, clearing`);
        clearEmbeddingsForRebuild();
      }

      const progress = await buildEmbeddingsIndex(vaultPath, (p) => {
        if (p.current % 50 === 0 || p.current === p.total) {
          console.error(`[Semantic] Embedding ${p.current}/${p.total} notes (${p.skipped} skipped)...`);
        }
      });

      console.error(`[Semantic] Done. Embedded ${progress.total - progress.skipped} notes, skipped ${progress.skipped}.`);
      setEmbeddingsBuildState('complete');
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

// Cleanup on exit
process.on('beforeExit', async () => {
  stopSweepTimer();
  await flushLogs();
});
