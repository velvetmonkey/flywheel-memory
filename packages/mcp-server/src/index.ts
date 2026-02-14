#!/usr/bin/env node
/**
 * Flywheel Memory - Unified local-first memory for AI agents
 *
 * Combines:
 * - 51 read tools from Flywheel (search, backlinks, graph)
 * - 22 write tools from Flywheel-Crank (mutations, tasks, notes)
 *
 * Total: 73 tools
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

// Vault-core shared imports
import { openStateDb, scanVaultEntities, type StateDb } from '@velvetmonkey/vault-core';

// Read tool registrations
import { registerGraphTools } from './tools/read/graph.js';
import { registerWikilinkTools } from './tools/read/wikilinks.js';
import { registerHealthTools } from './tools/read/health.js';
import { registerQueryTools } from './tools/read/query.js';
import { registerSystemTools as registerReadSystemTools } from './tools/read/system.js';
import { registerPrimitiveTools } from './tools/read/primitives.js';
import { registerPeriodicTools } from './tools/read/periodic.js';
import { registerBidirectionalTools } from './tools/read/bidirectional.js';
import { registerSchemaTools } from './tools/read/schema.js';
import { registerComputedTools } from './tools/read/computed.js';
import { registerMigrationTools } from './tools/read/migrations.js';

// Write tool registrations
import { registerMutationTools } from './tools/write/mutations.js';
import { registerTaskTools } from './tools/write/tasks.js';
import { registerFrontmatterTools } from './tools/write/frontmatter.js';
import { registerNoteTools } from './tools/write/notes.js';
import { registerMoveNoteTools } from './tools/write/move-notes.js';
import { registerSystemTools as registerWriteSystemTools } from './tools/write/system.js';
import { registerPolicyTools } from './tools/write/policy.js';
import { registerMemoryTools } from './tools/write/memory.js';

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
// Extended Tool Category System
// ============================================================================
// FLYWHEEL_TOOLS env var controls which tool categories are loaded.
// This reduces context window usage by only exposing tools you need.
//
// Fine-Grained Categories (~20):
//   === READ TOOLS ===
//   backlinks      - get_backlinks, find_bidirectional_links
//   orphans        - find_orphan_notes, find_dead_ends
//   hubs           - find_hub_notes, get_connection_strength
//   paths          - get_link_path, get_common_neighbors
//   search         - search_notes, search_entities
//   temporal       - get_recent_notes, get_stale_notes, get_notes_in_range
//   periodic       - detect_periodic_notes
//   schema         - get_frontmatter_schema, validate_frontmatter
//   structure      - get_note_structure, get_headings, get_section_content
//   tasks          - get_all_tasks, get_tasks_with_due_dates
//   health         - get_vault_stats, health_check, get_folder_structure
//   wikilinks      - suggest_wikilinks, validate_links, find_broken_links
//
//   === WRITE TOOLS ===
//   append         - vault_append, vault_add_to_section
//   frontmatter    - vault_set_frontmatter, vault_update_frontmatter
//   sections       - vault_replace_section, vault_delete_section
//   notes          - vault_create_note, vault_rename_note, vault_move_note
//   auto-wikilink  - vault_apply_wikilinks, vault_resolve_aliases
//   git            - vault_commit, vault_undo
//   policy         - policy_execute, policy_validate
//   memory         - log_interaction, query_interactions
//
// Preset Bundles:
//   minimal        - search, backlinks (safe exploration)
//   research       - search, backlinks, hubs, paths, temporal
//   explore        - search, backlinks, orphans, health, structure
//   audit          - schema, wikilinks, health, orphans
//   daily-notes    - append, tasks, periodic, auto-wikilink
//   journaling     - append, frontmatter, temporal, search
//   refactoring    - schema, wikilinks, notes, auto-wikilink, git
//   standard       - search, backlinks, tasks, append, frontmatter, auto-wikilink
//   full           - all categories
//   agent          - search, backlinks, append, memory, auto-wikilink
//
// Examples:
//   FLYWHEEL_TOOLS=minimal           # Just search and backlinks
//   FLYWHEEL_TOOLS=standard          # Default set (most common use cases)
//   FLYWHEEL_TOOLS=full              # Everything
//   FLYWHEEL_TOOLS=research,git      # Preset + additions
// ============================================================================

type ToolCategory =
  // Read categories
  | 'backlinks' | 'orphans' | 'hubs' | 'paths'
  | 'search' | 'temporal' | 'periodic'
  | 'schema' | 'structure' | 'tasks'
  | 'health' | 'wikilinks'
  // Write categories
  | 'append' | 'frontmatter' | 'sections' | 'notes'
  | 'auto-wikilink' | 'git' | 'policy' | 'memory'
  // Legacy categories (for backward compatibility)
  | 'core' | 'graph' | 'advanced';

// Preset definitions
const PRESETS: Record<string, ToolCategory[]> = {
  // Minimal (safe exploration)
  minimal: ['search', 'backlinks'],

  // Read-only workflows
  research: ['search', 'backlinks', 'hubs', 'paths', 'temporal'],
  explore: ['search', 'backlinks', 'orphans', 'health', 'structure'],
  audit: ['schema', 'wikilinks', 'health', 'orphans'],

  // Write workflows
  'daily-notes': ['append', 'tasks', 'periodic', 'auto-wikilink'],
  journaling: ['append', 'frontmatter', 'temporal', 'search'],
  refactoring: ['schema', 'wikilinks', 'notes', 'auto-wikilink', 'git'],

  // Combined
  standard: ['search', 'backlinks', 'tasks', 'append', 'frontmatter', 'auto-wikilink', 'health'],

  // Full access
  full: [
    'backlinks', 'orphans', 'hubs', 'paths',
    'search', 'temporal', 'periodic',
    'schema', 'structure', 'tasks',
    'health', 'wikilinks',
    'append', 'frontmatter', 'sections', 'notes',
    'auto-wikilink', 'git', 'policy', 'memory',
  ],

  // Agent-optimized
  agent: ['search', 'backlinks', 'append', 'memory', 'auto-wikilink'],

  // Legacy presets (backward compatibility)
  'core': ['health', 'structure'],
  'graph': ['backlinks', 'orphans', 'hubs', 'paths', 'wikilinks'],
  'advanced': ['schema', 'periodic', 'sections', 'notes', 'policy'],
};

const ALL_CATEGORIES: ToolCategory[] = [
  'backlinks', 'orphans', 'hubs', 'paths',
  'search', 'temporal', 'periodic',
  'schema', 'structure', 'tasks',
  'health', 'wikilinks',
  'append', 'frontmatter', 'sections', 'notes',
  'auto-wikilink', 'git', 'policy', 'memory',
  'core', 'graph', 'advanced',
];

const DEFAULT_PRESET = 'standard';

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

// Track which registration functions have been called
const registeredModules = new Set<string>();

function shouldRegister(module: string, categories: ToolCategory[]): boolean {
  if (registeredModules.has(module)) return false;
  const shouldReg = categories.some(cat => enabledCategories.has(cat));
  if (shouldReg) registeredModules.add(module);
  return shouldReg;
}

// ============================================================================
// Server Setup
// ============================================================================

const server = new McpServer({
  name: 'flywheel-memory',
  version: '2.0.0',
});

// Log enabled categories
const categoryList = Array.from(enabledCategories).sort().join(', ');
console.error(`[Memory] Tool categories: ${categoryList}`);

// ============================================================================
// Register Read Tools
// ============================================================================

// Health & system (core)
if (shouldRegister('health', ['health', 'core'])) {
  registerHealthTools(server, () => vaultIndex, () => vaultPath);
}

if (shouldRegister('read-system', ['health', 'core', 'structure'])) {
  registerReadSystemTools(
    server,
    () => vaultIndex,
    (newIndex) => { vaultIndex = newIndex; },
    () => vaultPath,
    (newConfig) => { flywheelConfig = newConfig; },
    () => stateDb
  );
}

// Graph tools
if (shouldRegister('graph-tools', ['backlinks', 'orphans', 'hubs', 'paths', 'graph'])) {
  registerGraphTools(server, () => vaultIndex, () => vaultPath);
}

if (shouldRegister('wikilink-read', ['wikilinks', 'graph'])) {
  registerWikilinkTools(server, () => vaultIndex, () => vaultPath);
}

// Search tools
if (shouldRegister('query', ['search'])) {
  registerQueryTools(server, () => vaultIndex, () => vaultPath, () => stateDb);
}

// Primitives (shared across tasks, structure, temporal, schema, advanced)
if (shouldRegister('primitives', ['tasks', 'structure', 'temporal', 'schema', 'advanced', 'periodic'])) {
  registerPrimitiveTools(server, () => vaultIndex, () => vaultPath, () => flywheelConfig);
}

// Temporal: Periodic note detection
if (shouldRegister('periodic', ['temporal', 'periodic'])) {
  registerPeriodicTools(server, () => vaultIndex);
}

// Schema tools
if (shouldRegister('schema-tools', ['schema', 'advanced'])) {
  registerSchemaTools(server, () => vaultIndex, () => vaultPath);
}

// Advanced tools
if (shouldRegister('bidirectional', ['advanced', 'wikilinks'])) {
  registerBidirectionalTools(server, () => vaultIndex, () => vaultPath);
}

if (shouldRegister('computed', ['advanced', 'schema'])) {
  registerComputedTools(server, () => vaultIndex, () => vaultPath);
}

if (shouldRegister('migrations', ['advanced'])) {
  registerMigrationTools(server, () => vaultIndex, () => vaultPath);
}

// ============================================================================
// Register Write Tools
// ============================================================================

// Mutation tools
if (shouldRegister('mutations', ['append', 'sections'])) {
  registerMutationTools(server, vaultPath);
}

// Task tools
if (shouldRegister('tasks-write', ['tasks', 'append'])) {
  registerTaskTools(server, vaultPath);
}

// Frontmatter tools
if (shouldRegister('frontmatter-write', ['frontmatter'])) {
  registerFrontmatterTools(server, vaultPath);
}

// Note management tools
if (shouldRegister('notes', ['notes'])) {
  registerNoteTools(server, vaultPath);
}

if (shouldRegister('move-notes', ['notes'])) {
  registerMoveNoteTools(server, vaultPath);
}

// System tools (write)
if (shouldRegister('write-system', ['git', 'sections'])) {
  registerWriteSystemTools(server, vaultPath);
}

// Policy tools
if (shouldRegister('policy-tools', ['policy'])) {
  registerPolicyTools(server, vaultPath);
}

// Memory tools
if (shouldRegister('memory-tools', ['memory'])) {
  registerMemoryTools(server, vaultPath);
}

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
