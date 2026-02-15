#!/usr/bin/env node
/**
 * Flywheel Memory - Unified local-first memory for AI agents
 *
 * 36 tools across 15 categories
 * - policy (unified: list, validate, preview, execute, author, revise)
 * - Temporal tools absorbed into search (modified_after/modified_before) + get_vault_stats (recent_activity)
 * - Dropped: policy_diff, policy_export, policy_import, get_contemporaneous_notes
 * - graph_analysis (unified: orphans, dead_ends, sources, hubs, stale)
 * - vault_schema (unified: frontmatter schema, conventions, incomplete, suggest_values)
 * - note_intelligence (unified: prose_patterns, suggest_frontmatter, wikilinks, cross_layer, compute)
 * - get_backlinks (absorbed find_bidirectional_links via include_bidirectional param)
 * - validate_links (absorbed find_broken_links via typos_only param)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import chokidar from 'chokidar';

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
import { initializeEntityIndex, setCrankStateDb } from './core/write/wikilinks.js';
import { initializeLogger as initializeWriteLogger, flushLogs } from './core/write/logging.js';
import { setFTS5Database } from './core/read/fts5.js';

// Vault-core shared imports
import { openStateDb, scanVaultEntities, type StateDb } from '@velvetmonkey/vault-core';

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
import { registerSystemTools as registerWriteSystemTools } from './tools/write/system.js';
import { registerPolicyTools } from './tools/write/policy.js';


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
// Tool Presets
// ============================================================================
// FLYWHEEL_TOOLS env var controls which tools are loaded.
//
// Presets:
//   minimal  - Core tools for search, navigate, create, edit (~19 tools)
//   full     - All tools (~36 tools) [DEFAULT]
//
// Fine-grained: use comma-separated category names for custom sets.
//   FLYWHEEL_TOOLS=search,backlinks,append
//
// Categories:
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
  // Core tools: search, navigate, create, edit
  minimal: ['search', 'backlinks', 'health', 'tasks', 'append', 'frontmatter', 'notes', 'structure'],

  // All tools (default)
  full: [
    'search', 'backlinks', 'orphans', 'hubs', 'paths',
    'schema', 'structure', 'tasks',
    'health', 'wikilinks',
    'append', 'frontmatter', 'notes',
    'git', 'policy',
  ],
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
      console.error(`[Memory] Warning: Unknown tool category "${item}" - ignoring`);
    }
  }

  // If nothing valid, fall back to default
  if (categories.size === 0) {
    console.error(`[Memory] No valid categories found, using default (${DEFAULT_PRESET})`);
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
  get_note_metadata: 'health',
  get_all_entities: 'health',
  get_unlinked_mentions: 'health',

  // search (unified: metadata + content + entities)
  search: 'search',

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

  // schema (migrations)
  rename_field: 'schema',
  migrate_field_values: 'schema',
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

const _originalTool = server.tool.bind(server) as (...args: unknown[]) => unknown;
(server as any).tool = (name: string, ...args: any[]) => {
  if (!gateByCategory(name)) return;
  return _originalTool(name, ...args);
};

const _originalRegisterTool = (server as any).registerTool?.bind(server);
if (_originalRegisterTool) {
  (server as any).registerTool = (name: string, ...args: any[]) => {
    if (!gateByCategory(name)) return;
    return _originalRegisterTool(name, ...args);
  };
}

// Log enabled categories
const categoryList = Array.from(enabledCategories).sort().join(', ');
console.error(`[Memory] Tool categories: ${categoryList}`);

// ============================================================================
// Register All Tools (per-tool filtering via patched server.tool())
// ============================================================================

// Read tools
registerHealthTools(server, () => vaultIndex, () => vaultPath, () => flywheelConfig);
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
registerGraphAnalysisTools(server, () => vaultIndex, () => vaultPath);
registerVaultSchemaTools(server, () => vaultIndex, () => vaultPath);
registerNoteIntelligenceTools(server, () => vaultIndex, () => vaultPath);
registerMigrationTools(server, () => vaultIndex, () => vaultPath);

// Write tools
registerMutationTools(server, vaultPath, () => flywheelConfig);
registerTaskTools(server, vaultPath);
registerFrontmatterTools(server, vaultPath);
registerNoteTools(server, vaultPath, () => vaultIndex);
registerMoveNoteTools(server, vaultPath);
registerWriteSystemTools(server, vaultPath);
registerPolicyTools(server, vaultPath);

console.error(`[Memory] Registered ${_registeredCount} tools, skipped ${_skippedCount}`);

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  console.error(`[Memory] Starting Flywheel Memory server...`);
  console.error(`[Memory] Vault: ${vaultPath}`);

  const startTime = Date.now();

  // Initialize StateDb early
  try {
    stateDb = openStateDb(vaultPath);
    console.error('[Memory] StateDb initialized');

    // Inject StateDb handle for FTS5 content search (notes_fts table)
    setFTS5Database(stateDb.db);

    // Initialize entity index for wikilinks (used by write tools)
    setCrankStateDb(stateDb);
    await initializeEntityIndex(vaultPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Memory] StateDb initialization failed: ${msg}`);
    console.error('[Memory] Auto-wikilinks will be disabled for this session');
  }

  // Start the MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Memory] MCP server connected');

  // Initialize logging
  initializeReadLogger(vaultPath).then(() => {
    const logger = getLogger();
    if (logger?.enabled) {
      console.error(`[Memory] Unified logging enabled`);
    }
  }).catch(() => {
    // Logging initialization failed, continue without it
  });

  initializeWriteLogger(vaultPath).catch(err => {
    console.error(`[Memory] Write logger initialization failed: ${err}`);
  });

  // Try loading index from cache
  let cachedIndex: VaultIndex | null = null;
  if (stateDb) {
    try {
      const files = await scanVault(vaultPath);
      const noteCount = files.length;
      console.error(`[Memory] Found ${noteCount} markdown files`);
      cachedIndex = loadVaultIndexFromCache(stateDb, noteCount);
    } catch (err) {
      console.error('[Memory] Cache check failed:', err);
    }
  }

  if (cachedIndex) {
    // Cache hit
    vaultIndex = cachedIndex;
    setIndexState('ready');
    const duration = Date.now() - startTime;
    console.error(`[Memory] Index loaded from cache in ${duration}ms`);
    runPostIndexWork(vaultIndex);
  } else {
    // Cache miss - build index
    console.error('[Memory] Building vault index...');

    try {
      vaultIndex = await buildVaultIndex(vaultPath);
      setIndexState('ready');
      const duration = Date.now() - startTime;
      console.error(`[Memory] Vault index ready in ${duration}ms`);

      // Save to cache
      if (stateDb) {
        try {
          saveVaultIndexToCache(stateDb, vaultIndex);
          console.error('[Memory] Index cache saved');
        } catch (err) {
          console.error('[Memory] Failed to save index cache:', err);
        }
      }

      await runPostIndexWork(vaultIndex);
    } catch (err) {
      setIndexState('error');
      setIndexError(err instanceof Error ? err : new Error(String(err)));
      console.error('[Memory] Failed to build vault index:', err);
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
    console.error(`[Memory] Updated ${entityIndex._metadata.total_entities} entities in StateDb`);
  } catch (e) {
    console.error('[Memory] Failed to update entities in StateDb:', e);
  }
}

/**
 * Post-index work: config inference, hub export, file watcher
 */
async function runPostIndexWork(index: VaultIndex) {
  // Scan and save entities to StateDb
  await updateEntitiesInStateDb();

  // Export hub scores
  await exportHubScores(index, stateDb);

  // Load/infer config
  const existing = loadConfig(stateDb);
  const inferred = inferConfig(index, vaultPath);
  if (stateDb) {
    saveConfig(stateDb, inferred, existing);
  }
  flywheelConfig = loadConfig(stateDb);

  if (flywheelConfig.vault_name) {
    console.error(`[Memory] Vault: ${flywheelConfig.vault_name}`);
  }

  // Setup file watcher
  if (process.env.FLYWHEEL_WATCH !== 'false') {
    const useV2Watcher = process.env.FLYWHEEL_WATCH_V2 === 'true' ||
                         process.env.FLYWHEEL_WATCH_POLL === 'true';

    if (useV2Watcher) {
      const config = parseWatcherConfig();
      console.error(`[Memory] File watcher v2 enabled (debounce: ${config.debounceMs}ms)`);

      const watcher = createVaultWatcher({
        vaultPath,
        config,
        onBatch: async (batch) => {
          console.error(`[Memory] Processing ${batch.events.length} file changes`);
          const startTime = Date.now();
          try {
            vaultIndex = await buildVaultIndex(vaultPath);
            setIndexState('ready');
            console.error(`[Memory] Index rebuilt in ${Date.now() - startTime}ms`);
            await updateEntitiesInStateDb();
            await exportHubScores(vaultIndex, stateDb);
            if (stateDb) {
              try {
                saveVaultIndexToCache(stateDb, vaultIndex);
              } catch (err) {
                console.error('[Memory] Failed to update index cache:', err);
              }
            }
          } catch (err) {
            setIndexState('error');
            setIndexError(err instanceof Error ? err : new Error(String(err)));
            console.error('[Memory] Failed to rebuild index:', err);
          }
        },
        onStateChange: (status) => {
          if (status.state === 'dirty') {
            console.error('[Memory] Warning: Index may be stale');
          }
        },
        onError: (err) => {
          console.error('[Memory] Watcher error:', err.message);
        },
      });

      watcher.start();
    } else {
      // Legacy watcher
      const debounceMs = parseInt(process.env.FLYWHEEL_DEBOUNCE_MS || '60000');
      console.error(`[Memory] File watcher v1 enabled (debounce: ${debounceMs}ms)`);

      const legacyWatcher = chokidar.watch(vaultPath, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        }
      });

      let rebuildTimer: NodeJS.Timeout;
      legacyWatcher.on('all', (event, path) => {
        if (!path.endsWith('.md')) return;
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(() => {
          console.error('[Memory] Rebuilding index (file changed)');
          buildVaultIndex(vaultPath)
            .then(async (newIndex) => {
              vaultIndex = newIndex;
              setIndexState('ready');
              console.error('[Memory] Index rebuilt successfully');
              await updateEntitiesInStateDb();
              await exportHubScores(newIndex, stateDb);
              if (stateDb) {
                try {
                  saveVaultIndexToCache(stateDb, newIndex);
                } catch (err) {
                  console.error('[Memory] Failed to update index cache:', err);
                }
              }
            })
            .catch((err) => {
              setIndexState('error');
              setIndexError(err instanceof Error ? err : new Error(String(err)));
              console.error('[Memory] Failed to rebuild index:', err);
            });
        }, debounceMs);
      });
    }
  }
}

main().catch((error) => {
  console.error('[Memory] Fatal error:', error);
  process.exit(1);
});

// Flush logs on exit
process.on('beforeExit', async () => {
  await flushLogs();
});
