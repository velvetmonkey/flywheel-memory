#!/usr/bin/env node
/**
 * Flywheel Memory - Unified local-first memory for AI agents
 *
 * 67 tools across 11 categories
 * - policy (unified: list, validate, preview, execute, author, revise)
 * - Temporal tools absorbed into search (modified_after/modified_before) + get_vault_stats (recent_activity)
 * - Dropped: policy_diff, policy_export, policy_import, get_contemporaneous_notes
 * - graph_analysis (7 modes: orphans, dead_ends, sources, hubs, stale, immature, emerging_hubs)
 * - semantic_analysis (extracted: clusters, bridges)
 * - vault_schema (4 modes: overview, field_values, inconsistencies, contradictions)
 * - schema_conventions (extracted: conventions, incomplete, suggest_values)
 * - schema_validate (extracted: validate, missing)
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
import { z } from 'zod';

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
  type VaultWatcher,
  type WatcherStatus,
} from './core/read/watch/index.js';
import { processBatch } from './core/read/watch/batchProcessor.js';
import { exportHubScores } from './core/shared/hubExport.js';
import { initializeLogger as initializeReadLogger, getLogger } from './core/read/logging.js';

// Core imports - Write
import { initializeEntityIndex, setWriteStateDb, setWikilinkConfig, setCooccurrenceIndex, suggestRelatedLinks } from './core/write/wikilinks.js';
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
  needsEmbeddingRebuild,
  getStoredEmbeddingModel,
  getActiveModelId,
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
import { openStateDb, scanVaultEntities, getSessionId, getAllEntitiesFromDb, findEntityMatches, getProtectedZones, rangeOverlapsProtectedZone, detectImplicitEntities, loadContentHashes, saveContentHashBatch, renameContentHash, type StateDb } from '@velvetmonkey/vault-core';

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
import { registerSemanticAnalysisTools } from './tools/read/semanticAnalysis.js';
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
import { registerCorrectionTools } from './tools/write/corrections.js';
import { registerMemoryTools } from './tools/write/memory.js';
import { sweepExpiredMemories, decayMemoryConfidence, pruneSupersededMemories } from './core/write/memory.js';
import { registerRecallTools } from './tools/read/recall.js';
import { registerBriefTools } from './tools/read/brief.js';
import { registerConfigTools } from './tools/write/config.js';
import { registerInitTools } from './tools/write/enrich.js';

// Read tool registrations (additional)
import { registerMetricsTools } from './tools/read/metrics.js';
import { registerActivityTools } from './tools/read/activity.js';
import { registerSimilarityTools } from './tools/read/similarity.js';
import { registerSemanticTools } from './tools/read/semantic.js';
import { registerMergeTools as registerReadMergeTools } from './tools/read/merges.js';
import { registerTemporalAnalysisTools } from './tools/read/temporalAnalysis.js';

// Core imports - Sweep
import { startSweepTimer, stopSweepTimer } from './core/read/sweep.js';

// Core imports - Metrics
import { computeMetrics, recordMetrics, purgeOldMetrics } from './core/shared/metrics.js';

// Core imports - Index Activity
import { recordIndexEvent, purgeOldIndexEvents, purgeOldSuggestionEvents, purgeOldNoteLinkHistory, createStepTracker, computeEntityDiff, getRecentPipelineEvent } from './core/shared/indexActivity.js';

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
         getStoredNoteTags, updateStoredNoteTags, isSuppressed,
         getAllSuppressionPenalties } from './core/write/wikilinkFeedback.js';

// Core imports - Recency
import { setRecencyStateDb, buildRecencyIndex, loadRecencyFromStateDb, saveRecencyToStateDb } from './core/shared/recency.js';

// Core imports - Co-occurrence
import { mineCooccurrences, saveCooccurrenceToStateDb, loadCooccurrenceFromStateDb } from './core/shared/cooccurrence.js';

// Core imports - Corrections
import { processPendingCorrections } from './core/write/corrections.js';

// Core imports - Edge Weights
import { setEdgeWeightStateDb, recomputeEdgeWeights } from './core/write/edgeWeights.js';

// Node builtins
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { CoalescedEvent, EventBatch, RenameEvent } from './core/read/watch/types.js';
import type { BatchHandler } from './core/read/watch/index.js';

// Resources
import { registerVaultResources } from './resources/vault.js';

// Multi-vault
import { VaultRegistry, parseVaultConfig, type VaultContext } from './vault-registry.js';


// ============================================================================
// Configuration
// ============================================================================

// Auto-detect vault root, with PROJECT_PATH as override
const vaultPath: string = process.env.PROJECT_PATH || process.env.VAULT_PATH || findVaultRoot();
let resolvedVaultPath: string;
try { resolvedVaultPath = realpathSync(vaultPath).replace(/\\/g, '/'); } catch { resolvedVaultPath = vaultPath.replace(/\\/g, '/'); }

// State variables (module-level singletons — swapped by activateVault for multi-vault)
let vaultIndex: VaultIndex;
let flywheelConfig: FlywheelConfig = {};
let stateDb: StateDb | null = null;
let watcherInstance: VaultWatcher | null = null;

// Multi-vault registry (populated in main())
let vaultRegistry: VaultRegistry | null = null;

/** Current watcher status (live — reads state at call time, not a stale snapshot). */
export function getWatcherStatus(): WatcherStatus | null { return watcherInstance?.status ?? null; }

// ============================================================================
// Tool Presets & Composable Bundles
// ============================================================================
// FLYWHEEL_TOOLS / FLYWHEEL_PRESET env var controls which tools are loaded.
//
// Presets:
//   default    - Note-taking essentials: search, read, write, tasks (19 tools)
//   agent      - Autonomous AI agents: search, read, write, memory (19 tools)
//   full       - All tools except agent memory (64 tools). Add ",memory" to include.
//
// Composable bundles (combine with presets or each other):
//   graph       - Structural analysis + link detail + semantic: backlinks, forward links, graph_analysis, semantic_analysis, paths, hubs, connections (10 tools)
//   schema      - Schema intelligence + migrations: vault_schema, schema_conventions, schema_validate, note_intelligence, rename_field, migrate_field_values, rename_tag (7 tools)
//   wikilinks   - Wikilink suggestions, validation, discovery (7 tools)
//   corrections - Correction recording + resolution (4 tools)
//   tasks       - Task queries and mutations (3 tools)
//   memory      - Agent working memory + recall + brief (3 tools)
//   note-ops    - File management: delete, move, rename, merge (4 tools)
//   diagnostics - Vault health, stats, config, activity (13 tools)
//
// Examples:
//   FLYWHEEL_TOOLS=default                    # 19 tools
//   FLYWHEEL_TOOLS=agent                      # 19 tools
//   FLYWHEEL_TOOLS=default,graph              # 28 tools
//   FLYWHEEL_TOOLS=agent,tasks                # 22 tools
//   FLYWHEEL_TOOLS=search,read,graph          # fine-grained categories
//
// Categories (11):
//   search, read, write, graph, schema, wikilinks,
//   corrections, tasks, memory, note-ops, diagnostics
// ============================================================================

type ToolCategory =
  | 'search' | 'read' | 'write'
  | 'graph' | 'schema' | 'wikilinks' | 'corrections'
  | 'tasks' | 'memory' | 'note-ops'
  | 'diagnostics';

const ALL_CATEGORIES: ToolCategory[] = [
  'search', 'read', 'write',
  'graph', 'schema', 'wikilinks', 'corrections',
  'tasks', 'memory', 'note-ops',
  'diagnostics',
];

const PRESETS: Record<string, ToolCategory[]> = {
  // Presets
  default: ['search', 'read', 'write', 'tasks'],
  agent: ['search', 'read', 'write', 'memory'],
  full: ALL_CATEGORIES.filter(c => c !== 'memory'),

  // Composable bundles (one per category)
  graph: ['graph'],
  schema: ['schema'],
  wikilinks: ['wikilinks'],
  corrections: ['corrections'],
  tasks: ['tasks'],
  memory: ['memory'],
  'note-ops': ['note-ops'],
  diagnostics: ['diagnostics'],
};

const DEFAULT_PRESET = 'default';

// Deprecated aliases — old names → new category/preset names
const DEPRECATED_ALIASES: Record<string, string> = {
  minimal: 'default',
  writer: 'default',     // writer was default+tasks, now default includes tasks
  researcher: 'default', // use default,graph for graph exploration
  backlinks: 'graph',     // get_backlinks moved to graph
  structure: 'read',
  append: 'write',
  frontmatter: 'write',
  notes: 'write',
  orphans: 'graph',
  hubs: 'graph',
  paths: 'graph',
  health: 'diagnostics',
  analysis: 'wikilinks',
  git: 'write',
  ops: 'write',
  policy: 'write',
};

/**
 * Parse FLYWHEEL_TOOLS env var into enabled categories
 */
function parseEnabledCategories(): Set<ToolCategory> {
  const envValue = (process.env.FLYWHEEL_TOOLS ?? process.env.FLYWHEEL_PRESET)?.trim();

  // No env var = use default preset
  if (!envValue) {
    return new Set(PRESETS[DEFAULT_PRESET]);
  }

  // Check if it's a preset name (direct match)
  const lowerValue = envValue.toLowerCase();
  if (PRESETS[lowerValue]) {
    return new Set(PRESETS[lowerValue]);
  }

  // Check deprecated alias (single value)
  if (DEPRECATED_ALIASES[lowerValue]) {
    const resolved = DEPRECATED_ALIASES[lowerValue];
    serverLog('server', `Preset "${lowerValue}" is deprecated — use "${resolved}" instead`, 'warn');
    if (PRESETS[resolved]) {
      return new Set(PRESETS[resolved]);
    }
    return new Set([resolved as ToolCategory]);
  }

  // Parse comma-separated categories
  const categories = new Set<ToolCategory>();
  for (const item of envValue.split(',')) {
    const raw = item.trim().toLowerCase();

    // Check deprecated alias
    const resolved = DEPRECATED_ALIASES[raw] ?? raw;
    if (resolved !== raw) {
      serverLog('server', `Category "${raw}" is deprecated — use "${resolved}" instead`, 'warn');
    }

    if (ALL_CATEGORIES.includes(resolved as ToolCategory)) {
      categories.add(resolved as ToolCategory);
    } else if (PRESETS[resolved]) {
      // Allow preset names in comma list
      for (const c of PRESETS[resolved]) {
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
// Every tool MUST have an entry — tools without entries bypass gating entirely.
const TOOL_CATEGORY: Record<string, ToolCategory> = {
  // search (6 tools)
  search: 'search',
  init_semantic: 'search',
  find_similar: 'search',

  // read (3 tools) — note reading
  get_note_structure: 'read',
  get_section_content: 'read',
  find_sections: 'read',

  // write (7 tools) — content mutations + frontmatter + note creation + undo + policy
  vault_add_to_section: 'write',
  vault_remove_from_section: 'write',
  vault_replace_in_section: 'write',
  vault_update_frontmatter: 'write',
  vault_create_note: 'write',
  vault_undo_last_mutation: 'write',
  policy: 'write',

  // graph (10 tools) — structural analysis + link detail
  graph_analysis: 'graph',
  semantic_analysis: 'graph',
  get_backlinks: 'graph',
  get_forward_links: 'graph',
  get_connection_strength: 'graph',
  list_entities: 'graph',
  get_link_path: 'graph',
  get_common_neighbors: 'graph',
  get_weighted_links: 'graph',
  get_strong_connections: 'graph',

  // schema (7 tools) — schema intelligence + migrations
  vault_schema: 'schema',
  schema_conventions: 'schema',
  schema_validate: 'schema',
  note_intelligence: 'schema',
  rename_field: 'schema',
  migrate_field_values: 'schema',
  rename_tag: 'schema',

  // wikilinks (7 tools) — suggestions, validation, discovery
  suggest_wikilinks: 'wikilinks',
  validate_links: 'wikilinks',
  wikilink_feedback: 'wikilinks',
  discover_stub_candidates: 'wikilinks',
  discover_cooccurrence_gaps: 'wikilinks',
  suggest_entity_aliases: 'wikilinks',
  unlinked_mentions_report: 'wikilinks',

  // corrections (4 tools)
  vault_record_correction: 'corrections',
  vault_list_corrections: 'corrections',
  vault_resolve_correction: 'corrections',
  absorb_as_alias: 'corrections',

  // tasks (3 tools)
  tasks: 'tasks',
  vault_toggle_task: 'tasks',
  vault_add_task: 'tasks',

  // memory (3 tools) — agent working memory
  memory: 'memory',
  recall: 'memory',
  brief: 'memory',

  // note-ops (4 tools) — file management
  vault_delete_note: 'note-ops',
  vault_move_note: 'note-ops',
  vault_rename_note: 'note-ops',
  merge_entities: 'note-ops',

  // temporal (3 tools) — time-based vault intelligence
  get_context_around_date: 'search',
  predict_stale_notes: 'search',
  track_concept_evolution: 'search',

  // diagnostics (13 tools) — vault health, stats, config, activity
  health_check: 'diagnostics',
  get_vault_stats: 'diagnostics',
  get_folder_structure: 'diagnostics',
  refresh_index: 'diagnostics',
  get_all_entities: 'diagnostics',
  get_unlinked_mentions: 'diagnostics',
  vault_growth: 'diagnostics',
  vault_activity: 'diagnostics',
  flywheel_config: 'diagnostics',
  server_log: 'diagnostics',
  suggest_entity_merges: 'diagnostics',
  dismiss_merge_suggestion: 'diagnostics',
  vault_init: 'diagnostics',

};

// ============================================================================
// Server Instructions (dynamic, based on enabled categories)
// ============================================================================

function generateInstructions(categories: Set<ToolCategory>, registry?: VaultRegistry | null): string {
  const parts: string[] = [];

  // Base instruction (always present)
  parts.push(`Flywheel provides tools to search, read, and write an Obsidian vault's knowledge graph.

Tool selection:
  1. "search" is the primary tool. Each result includes: frontmatter, tags, aliases,
     backlinks (with line numbers), outlinks (with line numbers and existence check),
     headings, content snippet or preview, entity category, hub score, and timestamps.
     This is usually enough to answer without reading any files.
  2. Escalate to "get_note_structure" only when you need the full markdown content
     or word count. Use "get_section_content" to read one section by heading name.
  3. Use vault write tools instead of raw file writes — they auto-link entities
     and commit changes.
  4. Start with a broad search: just query text, no filters. Only add folder, tag,
     or frontmatter filters to narrow a second search if needed.`);

  // Multi-vault instructions (when registry has multiple vaults)
  if (registry?.isMultiVault) {
    parts.push(`
## Multi-Vault

This server manages multiple vaults. Every tool has an optional "vault" parameter.
- "search" without vault searches ALL vaults and merges results (each result has a "vault" field).
- All other tools default to the primary vault when "vault" is omitted.
- Available vaults: ${registry.getVaultNames().join(', ')}`);
  }

  // Read category instructions
  if (categories.has('read')) {
    parts.push(`
## Read

Escalation: "search" (enriched metadata + content preview) → "get_note_structure"
(full content + word count) → "get_section_content" (single section).
"find_sections" finds headings across the vault by pattern.`);
  }

  // Write category instructions
  if (categories.has('write')) {
    parts.push(`
## Write

Write to existing notes with "vault_add_to_section". Create new notes with "vault_create_note".
Update metadata with "vault_update_frontmatter". All writes auto-link entities — no manual [[wikilinks]] needed.
Use "vault_undo_last_mutation" to reverse the last write.

**Frontmatter matters more than content** for Flywheel's intelligence. When creating or updating notes, always set:
  - \`type:\` — drives entity categorization (person, project, technology). Without it, the category is guessed from the name alone.
  - \`aliases:\` — alternative names so the entity is found when referred to differently.
  - \`description:\` — one-line summary shown in search results and used by recall.
  - Tags — used for filtering, suggestion scoring, and schema analysis.
Good frontmatter is the highest-leverage action for improving suggestions, recall, and link quality.

### Policies

Use "policy" to build deterministic, repeatable vault workflows. Describe what you want in plain
language — Claude authors the YAML, saves it, and can execute it on demand. No YAML knowledge needed.

Policies chain vault tools (add/remove/replace sections, create notes, update frontmatter, toggle
tasks) into atomic operations — all steps succeed or all roll back, committed as a single git commit.

Actions: "author" a policy from a description, "validate" the YAML, "preview" (dry-run),
"execute" with variables, "list" saved policies, "revise" to modify.

Key capabilities:
  - **Variables** — parameterize policies (string, number, boolean, array, enum with defaults).
  - **Conditions** — branch on file/section/frontmatter state (skip steps, don't abort).
  - **Templates** — interpolate variables, builtins ({{today}}, {{now}}), and prior step outputs.
  - **Atomicity** — failure at any step rolls back all changes. One policy = one git commit.

Example: ask "create a policy that generates a weekly review note, pulls open tasks, and updates
project frontmatter" — Claude authors the YAML, saves it to .claude/policies/, and runs it whenever
you say "run the weekly review for this week".`);
  }

  // Memory category instructions (agent workflow)
  if (categories.has('memory')) {
    parts.push(`
## Memory

Session workflow: call "brief" at conversation start for vault context (recent sessions, active entities, stored memories). Use "recall" before answering questions — it searches entities, notes, and memories with graph-boosted ranking. Use "memory" to store observations that should persist across sessions.`);
  }

  // Graph category instructions
  if (categories.has('graph')) {
    parts.push(`
## Graph

Use "get_backlinks" for per-backlink surrounding text (reads source files).
Use "get_forward_links" for resolved file paths and alias text.
Use "graph_analysis" for structural queries (hubs, orphans, dead ends).
Use "get_connection_strength" to measure link strength between notes.
Use "get_link_path" to find shortest paths.`);
  }

  // Tasks category instructions
  if (categories.has('tasks')) {
    parts.push(`
## Tasks

Use "tasks" to query tasks across the vault (filter by status, due date, path). Use "vault_add_task" to create tasks and "vault_toggle_task" to complete them.`);
  }

  // Schema category instructions
  if (categories.has('schema')) {
    parts.push(`
## Schema

Use "vault_schema" before bulk operations to understand field conventions, inconsistencies, and note types. Use "note_intelligence" for per-note analysis.`);
  }

  return parts.join('\n');
}

// ============================================================================
// Tool Registration Helpers (reusable for HTTP transport)
// ============================================================================

/**
 * Apply tool gating to a McpServer instance.
 * Monkey-patches server.tool() and server.registerTool() to filter by category,
 * wrap handlers with invocation tracking, and optionally inject a `vault` parameter
 * for multi-vault support.
 *
 * When registry is multi-vault, every tool gets an optional `vault` parameter.
 * Before each handler runs, `activateVault(registry.getContext(vault))` is called
 * to swap module-level singletons to the correct vault.
 */
function applyToolGating(
  targetServer: McpServer,
  categories: Set<ToolCategory>,
  getDb: () => StateDb | null,
  registry?: VaultRegistry | null,
): { registered: number; skipped: number } {
  let _registered = 0;
  let _skipped = 0;

  function gate(name: string): boolean {
    const category = TOOL_CATEGORY[name];
    if (category && !categories.has(category)) {
      _skipped++;
      return false;
    }
    _registered++;
    return true;
  }

  function wrapWithTracking(toolName: string, handler: (...args: any[]) => any): (...args: any[]) => any {
    return async (...args: any[]) => {
      const start = Date.now();
      let success = true;
      let notePaths: string[] | undefined;
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
        const db = getDb();
        if (db) {
          try {
            let sessionId: string | undefined;
            try { sessionId = getSessionId(); } catch { /* no session */ }
            recordToolInvocation(db, {
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

  const isMultiVault = registry?.isMultiVault ?? false;

  /**
   * Wrap a handler to activate the correct vault before execution (multi-vault).
   * Extracts the `vault` param, calls activateVault(), then forwards to the original handler.
   * For `search` with no explicit vault, iterates all vaults and merges results.
   */
  function wrapWithVaultActivation(toolName: string, handler: (...args: any[]) => any): (...args: any[]) => any {
    if (!isMultiVault || !registry) return handler;
    return async (...args: any[]) => {
      const params = args[0];
      const vaultName = params?.vault;
      // Remove vault from params before forwarding (tools don't expect it)
      if (params && 'vault' in params) {
        delete params.vault;
      }
      // Cross-vault search: when no vault specified, search all vaults and merge
      if (toolName === 'search' && !vaultName) {
        return crossVaultSearch(registry!, handler, args);
      }
      const ctx = registry.getContext(vaultName);
      activateVault(ctx);
      // Update module-level state references so closures see the right vault
      stateDb = ctx.stateDb;
      vaultIndex = ctx.vaultIndex;
      flywheelConfig = ctx.flywheelConfig;
      return handler(...args);
    };
  }

  /**
   * Cross-vault search: run search handler in each vault context, merge results.
   * Each vault's results are tagged with a `vault` field.
   */
  async function crossVaultSearch(
    reg: VaultRegistry,
    handler: (...args: any[]) => any,
    args: any[]
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const perVault: Array<{ vault: string; data: any }> = [];

    for (const ctx of reg.getAllContexts()) {
      activateVault(ctx);
      stateDb = ctx.stateDb;
      vaultIndex = ctx.vaultIndex;
      flywheelConfig = ctx.flywheelConfig;
      try {
        const result = await handler(...args);
        const text = result?.content?.[0]?.text;
        if (text) {
          perVault.push({ vault: ctx.name, data: JSON.parse(text) });
        }
      } catch {
        // Skip vaults that error during search
      }
    }

    // Merge result items across vaults
    const merged: any[] = [];
    const vaultsSearched: string[] = [];
    let query: string | undefined;

    for (const { vault, data } of perVault) {
      vaultsSearched.push(vault);
      if (data.query) query = data.query;
      if (data.error || data.building) continue;
      const items = data.results || data.notes || data.entities || [];
      for (const item of items) {
        merged.push({ vault, ...item });
      }
    }

    // Sort by rrf_score when available (hybrid/fts5), otherwise preserve order
    if (merged.some((r: any) => r.rrf_score != null)) {
      merged.sort((a: any, b: any) => (b.rrf_score ?? 0) - (a.rrf_score ?? 0));
    }

    const limit = args[0]?.limit ?? 10;
    const truncated = merged.slice(0, limit);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          method: 'cross_vault',
          query,
          vaults_searched: vaultsSearched,
          total_results: merged.length,
          returned: truncated.length,
          results: truncated,
        }, null, 2),
      }],
    };
  }

  /**
   * Inject `vault` parameter into a tool's schema (multi-vault only).
   * server.tool() is called as: (name, description, schema, handler) or (name, schema, handler)
   */
  function injectVaultParam(args: any[]): void {
    if (!isMultiVault || !registry) return;
    // Find the schema object (the arg before the handler function)
    const handlerIdx = args.findIndex((a: any) => typeof a === 'function');
    if (handlerIdx <= 0) return;
    const schemaIdx = handlerIdx - 1;
    const schema = args[schemaIdx];
    if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
      schema.vault = z.string().optional().describe(
        `Vault name for multi-vault mode. Available: ${registry.getVaultNames().join(', ')}. Default: ${registry.primaryName}`
      );
    }
  }

  const origTool = targetServer.tool.bind(targetServer) as (...args: unknown[]) => unknown;
  (targetServer as any).tool = (name: string, ...args: any[]) => {
    if (!gate(name)) return;
    // Inject vault param into schema (multi-vault)
    injectVaultParam(args);
    // Wrap handler with tracking + vault activation
    if (args.length > 0 && typeof args[args.length - 1] === 'function') {
      let handler = args[args.length - 1];
      handler = wrapWithVaultActivation(name, handler);
      args[args.length - 1] = wrapWithTracking(name, handler);
    }
    return origTool(name, ...args);
  };

  const origRegisterTool = (targetServer as any).registerTool?.bind(targetServer);
  if (origRegisterTool) {
    (targetServer as any).registerTool = (name: string, ...args: any[]) => {
      if (!gate(name)) return;
      injectVaultParam(args);
      if (args.length > 0 && typeof args[args.length - 1] === 'function') {
        let handler = args[args.length - 1];
        handler = wrapWithVaultActivation(name, handler);
        args[args.length - 1] = wrapWithTracking(name, handler);
      }
      return origRegisterTool(name, ...args);
    };
  }

  return { get registered() { return _registered; }, get skipped() { return _skipped; } };
}

/**
 * Register all tools on a McpServer instance.
 * Closes over module-level state (vaultPath, vaultIndex, flywheelConfig, stateDb).
 * Safe because JS is single-threaded and state is read-mostly (watcher updates, tools read).
 */
function registerAllTools(targetServer: McpServer): void {
  // Read tools
  registerHealthTools(targetServer, () => vaultIndex, () => vaultPath, () => flywheelConfig, () => stateDb, getWatcherStatus);
  registerReadSystemTools(
    targetServer,
    () => vaultIndex,
    (newIndex) => { vaultIndex = newIndex; },
    () => vaultPath,
    (newConfig) => { flywheelConfig = newConfig; setWikilinkConfig(newConfig); },
    () => stateDb
  );
  registerGraphTools(targetServer, () => vaultIndex, () => vaultPath, () => stateDb);
  registerWikilinkTools(targetServer, () => vaultIndex, () => vaultPath);
  registerQueryTools(targetServer, () => vaultIndex, () => vaultPath, () => stateDb);
  registerPrimitiveTools(targetServer, () => vaultIndex, () => vaultPath, () => flywheelConfig, () => stateDb);
  registerGraphAnalysisTools(targetServer, () => vaultIndex, () => vaultPath, () => stateDb, () => flywheelConfig);
  registerSemanticAnalysisTools(targetServer, () => vaultIndex, () => vaultPath);
  registerVaultSchemaTools(targetServer, () => vaultIndex, () => vaultPath);
  registerNoteIntelligenceTools(targetServer, () => vaultIndex, () => vaultPath, () => flywheelConfig);
  registerMigrationTools(targetServer, () => vaultIndex, () => vaultPath);

  // Write tools
  registerMutationTools(targetServer, () => vaultPath, () => flywheelConfig);
  registerTaskTools(targetServer, () => vaultPath);
  registerFrontmatterTools(targetServer, () => vaultPath);
  registerNoteTools(targetServer, () => vaultPath, () => vaultIndex);
  registerMoveNoteTools(targetServer, () => vaultPath);
  registerWriteMergeTools(targetServer, () => vaultPath);
  registerWriteSystemTools(targetServer, () => vaultPath);
  registerPolicyTools(targetServer, () => vaultPath);
  registerTagTools(targetServer, () => vaultIndex, () => vaultPath);
  registerWikilinkFeedbackTools(targetServer, () => stateDb);
  registerCorrectionTools(targetServer, () => stateDb);
  registerInitTools(targetServer, () => vaultPath, () => stateDb);
  registerConfigTools(
    targetServer,
    () => flywheelConfig,
    (newConfig) => { flywheelConfig = newConfig; setWikilinkConfig(newConfig); },
    () => stateDb
  );

  // Additional read tools
  registerMetricsTools(targetServer, () => vaultIndex, () => stateDb);
  registerActivityTools(targetServer, () => stateDb, () => { try { return getSessionId(); } catch { return null; } });
  registerSimilarityTools(targetServer, () => vaultIndex, () => vaultPath, () => stateDb);
  registerSemanticTools(targetServer, () => vaultPath, () => stateDb);
  registerReadMergeTools(targetServer, () => stateDb);
  registerTemporalAnalysisTools(targetServer, () => vaultIndex, () => vaultPath, () => stateDb);

  // Memory tools
  registerMemoryTools(targetServer, () => stateDb);
  registerRecallTools(targetServer, () => stateDb, () => vaultPath, () => vaultIndex ?? null);
  registerBriefTools(targetServer, () => stateDb);

  // Resources (always registered, not gated by tool presets)
  registerVaultResources(targetServer, () => vaultIndex ?? null);
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
  applyToolGating(s, enabledCategories, () => stateDb, vaultRegistry);
  registerAllTools(s);
  return s;
}

// ============================================================================
// Primary Server Instance (stdio transport)
// ============================================================================

const server = new McpServer(
  { name: 'flywheel-memory', version: pkg.version },
  { instructions: generateInstructions(enabledCategories, vaultRegistry) },
);

const _gatingResult = applyToolGating(server, enabledCategories, () => stateDb, vaultRegistry);
registerAllTools(server);

const categoryList = Array.from(enabledCategories).sort().join(', ');
serverLog('server', `Tool categories: ${categoryList}`);
serverLog('server', `Registered ${_gatingResult.registered} tools, skipped ${_gatingResult.skipped}`);

// ============================================================================
// Multi-Vault Initialization (MV.2 + MV.3)
// ============================================================================

/**
 * Initialize a vault: open StateDb, inject singleton handles, load caches.
 * Returns a VaultContext with all state initialized.
 */
async function initializeVault(name: string, vaultPathArg: string): Promise<VaultContext> {
  const ctx: VaultContext = {
    name,
    vaultPath: vaultPathArg,
    stateDb: null,
    vaultIndex: undefined as unknown as VaultIndex,
    flywheelConfig: {},
    watcher: null,
  };

  try {
    ctx.stateDb = openStateDb(vaultPathArg);
    serverLog('statedb', `[${name}] StateDb initialized`);

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

/**
 * Activate a vault context by swapping all module-level singletons.
 * Safe because MCP processes requests sequentially per transport (JS is single-threaded).
 * Stateless HTTP runs one request to completion per McpServer instance.
 */
function activateVault(ctx: VaultContext): void {
  // Update module-level state
  (globalThis as any).__flywheel_active_vault = ctx.name;

  if (ctx.stateDb) {
    setWriteStateDb(ctx.stateDb);
    setFTS5Database(ctx.stateDb.db);
    setRecencyStateDb(ctx.stateDb);
    setEdgeWeightStateDb(ctx.stateDb);
    setTaskCacheDatabase(ctx.stateDb.db);
    setEmbeddingsDatabase(ctx.stateDb.db);
    loadEntityEmbeddingsToMemory();
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

  if (vaultConfigs) {
    // Multi-vault mode
    vaultRegistry = new VaultRegistry(vaultConfigs[0].name);
    serverLog('server', `Multi-vault mode: ${vaultConfigs.map(v => v.name).join(', ')}`);

    for (const vc of vaultConfigs) {
      const ctx = await initializeVault(vc.name, vc.path);
      vaultRegistry.addContext(ctx);
    }

    // Activate primary vault
    const primary = vaultRegistry.getContext();
    stateDb = primary.stateDb;
    activateVault(primary);
  } else {
    // Single-vault mode (backward compatible)
    vaultRegistry = new VaultRegistry('default');
    const ctx = await initializeVault('default', vaultPath);
    vaultRegistry.addContext(ctx);
    stateDb = ctx.stateDb;
    activateVault(ctx);
  }

  // Load cached co-occurrence index (primary vault)
  if (stateDb) {
    const cachedCooc = loadCooccurrenceFromStateDb(stateDb);
    if (cachedCooc) {
      setCooccurrenceIndex(cachedCooc.index);
      lastCooccurrenceRebuildAt = cachedCooc.builtAt;
      serverLog('index', `Co-occurrence: loaded from cache (${Object.keys(cachedCooc.index.associations).length} entities, ${cachedCooc.index._metadata.total_associations} associations)`);
    }
  }

  // Connect transports
  const transportMode = (process.env.FLYWHEEL_TRANSPORT ?? 'stdio').toLowerCase();

  if (transportMode === 'stdio' || transportMode === 'both') {
    // Connect stdio immediately so crank can talk to us while we build indexes
    const transport = new StdioServerTransport();
    await server.connect(transport);
    serverLog('server', 'MCP server connected (stdio)');
  }

  if (transportMode === 'http' || transportMode === 'both') {
    const { createMcpExpressApp } = await import('@modelcontextprotocol/sdk/server/express.js');
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');

    const httpPort = parseInt(process.env.FLYWHEEL_HTTP_PORT ?? '3111', 10);
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
      // Find newest file mtime to invalidate cache if files changed since last build
      const newestMtime = files.reduce((max, f) => f.modified > max ? f.modified : max, new Date(0));
      cachedIndex = loadVaultIndexFromCache(stateDb, noteCount, undefined, undefined, newestMtime);
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
    purgeOldIndexEvents(db, 90);
    purgeOldInvocations(db, 90);
    purgeOldSuggestionEvents(db, 30);
    purgeOldNoteLinkHistory(db, 90);
    purgeOldSnapshots(db, 90);
    lastPurgeAt = now;
    serverLog('server', 'Daily purge complete');
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
      purgeOldSuggestionEvents(stateDb, 30);
      purgeOldNoteLinkHistory(stateDb, 90);
      // Memory lifecycle maintenance
      sweepExpiredMemories(stateDb);
      decayMemoryConfidence(stateDb);
      pruneSupersededMemories(stateDb, 90);
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
    // Check for model change — clear and rebuild if model switched
    let modelChanged = false;
    if (hasEmbeddingsIndex() && needsEmbeddingRebuild()) {
      const oldModel = getStoredEmbeddingModel();
      serverLog('semantic', `Embedding model changed from ${oldModel} to ${getActiveModelId()}, rebuilding`);
      if (stateDb) {
        stateDb.db.exec('DELETE FROM note_embeddings');
        stateDb.db.exec('DELETE FROM entity_embeddings');
      }
      setEmbeddingsBuildState('none');
      modelChanged = true;
    }

    if (hasEmbeddingsIndex() && !modelChanged) {
      serverLog('semantic', 'Embeddings already built, skipping full scan');
    } else {
      const MAX_BUILD_RETRIES = 2;

      const attemptBuild = async (attempt: number): Promise<void> => {
        setEmbeddingsBuilding(true);
        try {
          await buildEmbeddingsIndex(vaultPath, (p) => {
            if (p.current % 100 === 0 || p.current === p.total) {
              serverLog('semantic', `Embedding ${p.current}/${p.total} notes...`);
            }
          });
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
          setEmbeddingsBuilding(false);
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
    if (stateDb) {
      const persisted = loadContentHashes(stateDb);
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
            const content = await fs.readFile(path.join(vaultPath, event.path), 'utf-8');
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
        if (stateDb && (hashUpserts.length || hashDeletes.length)) {
          saveContentHashBatch(stateDb, hashUpserts, hashDeletes);
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
              // Also update the content hash map (in-memory + persisted)
              const oldHash = lastContentHashes.get(rename.oldPath);
              if (oldHash !== undefined) {
                lastContentHashes.set(rename.newPath, oldHash);
                lastContentHashes.delete(rename.oldPath);
                renameContentHash(stateDb, rename.oldPath, rename.newPath);
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

          // Step 3: Hub scores (with before/after diffs) [non-critical]
          tracker.start('hub_scores', { entity_count: entitiesAfter.length });
          try {
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
          } catch (e) {
            tracker.end({ error: String(e) });
            serverLog('watcher', `Hub scores: failed: ${e}`, 'error');
          }

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
              if (stateDb) {
                saveCooccurrenceToStateDb(stateDb, cooccurrenceIdx);
              }
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

          // Step 8: Forward link scan — all wikilinks in changed files [non-critical]
          const forwardLinkResults: Array<{ file: string; resolved: string[]; dead: string[] }> = [];
          let totalResolved = 0;
          let totalDead = 0;
          const linkDiffs: Array<{ file: string; added: string[]; removed: string[] }> = [];
          const survivedLinks: Array<{ entity: string; file: string; count: number }> = [];
          tracker.start('forward_links', { files: filteredEvents.length });
          try {
          const eventTypeMap = new Map(filteredEvents.map(e => [e.path, e.type]));
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
                    recordFeedback(stateDb, entity.name, 'implicit:kept', entry.file, true, 0.8);
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

          // T7: Highlight new dead links from link diffs
          const newDeadLinks: Array<{ file: string; targets: string[] }> = [];
          for (const diff of linkDiffs) {
            const newDead = diff.added.filter(target => !vaultIndex.entities.has(target.toLowerCase()));
            if (newDead.length > 0) {
              newDeadLinks.push({ file: diff.file, targets: newDead });
            }
          }

          tracker.end({
            total_resolved: totalResolved,
            total_dead: totalDead,
            links: forwardLinkResults,
            link_diffs: linkDiffs,
            survived: survivedLinks,
            new_dead_links: newDeadLinks,
          });
          serverLog('watcher', `Forward links: ${totalResolved} resolved, ${totalDead} dead${newDeadLinks.length > 0 ? `, ${newDeadLinks.reduce((s, d) => s + d.targets.length, 0)} new dead` : ''}`);
          } catch (e) {
            tracker.end({ error: String(e) });
            serverLog('watcher', `Forward links: failed: ${e}`, 'error');
          }

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
                if (stateDb && isSuppressed(stateDb, entity.name)) continue; // suppressed
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

          // Build set of deleted file paths to skip their link diffs from feedback
          const deletedFiles = new Set(
            filteredEvents.filter(e => e.type === 'delete').map(e => e.path)
          );

          // T6: Capture pre-feedback suppression state for threshold crossing detection
          const preSuppressed = stateDb ? new Set(getAllSuppressionPenalties(stateDb).keys()) : new Set<string>();

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
              if (deletedFiles.has(diff.file)) continue; // Skip deleted files — not deliberate removals
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

          // Detect manual wikilink additions via forward_links diff
          const additionResults: Array<{ entity: string; file: string }> = [];
          if (stateDb && linkDiffs.length > 0) {
            const checkApplication = stateDb.db.prepare(
              `SELECT 1 FROM wikilink_applications WHERE LOWER(entity) = LOWER(?) AND note_path = ? AND status = 'applied'`
            );
            for (const diff of linkDiffs) {
              if (deletedFiles.has(diff.file)) continue; // Skip deleted files
              for (const target of diff.added) {
                // Skip engine-applied links (they get feedback via survival mechanism)
                if (checkApplication.get(target, diff.file)) continue;
                // Only record feedback for known entities
                const entity = entitiesAfter.find(
                  e => e.nameLower === target ||
                    (e.aliases ?? []).some((a: string) => a.toLowerCase() === target)
                );
                if (entity) {
                  recordFeedback(stateDb, entity.name, 'implicit:manual_added', diff.file, true);
                  additionResults.push({ entity: entity.name, file: diff.file });
                }
              }
            }
          }

          // T6: Detect newly suppressed entities (crossed threshold this pipeline)
          const newlySuppressed: string[] = [];
          if (stateDb) {
            const postSuppressed = getAllSuppressionPenalties(stateDb);
            for (const entity of postSuppressed.keys()) {
              if (!preSuppressed.has(entity)) {
                newlySuppressed.push(entity);
              }
            }
          }

          tracker.end({ removals: feedbackResults, additions: additionResults, newly_suppressed: newlySuppressed });
          if (feedbackResults.length > 0 || additionResults.length > 0) {
            serverLog('watcher', `Implicit feedback: ${feedbackResults.length} removals, ${additionResults.length} manual additions detected`);
          }
          if (newlySuppressed.length > 0) {
            serverLog('watcher', `Suppression: ${newlySuppressed.length} entities newly suppressed: ${newlySuppressed.join(', ')}`);
          }

          // Step 10.5: Process pending corrections [non-critical]
          tracker.start('corrections', {});
          try {
            if (stateDb) {
              const corrProcessed = processPendingCorrections(stateDb);
              if (corrProcessed > 0) {
                updateSuppressionList(stateDb);
              }
              tracker.end({ processed: corrProcessed });
              if (corrProcessed > 0) {
                serverLog('watcher', `Corrections: ${corrProcessed} processed`);
              }
            } else {
              tracker.end({ skipped: true });
            }
          } catch (e) {
            tracker.end({ error: String(e) });
            serverLog('watcher', `Corrections: failed: ${e}`, 'error');
          }

          // Step 11: Prospect scan — detect implicit entities and dead link target mentions
          tracker.start('prospect_scan', { files: filteredEvents.length });
          const prospectResults: Array<{
            file: string;
            implicit: string[];       // pattern-detected entities
            deadLinkMatches: string[]; // dead link targets found as plain text
          }> = [];

          for (const event of filteredEvents) {
            if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
            try {
              const content = await fs.readFile(path.join(vaultPath, event.path), 'utf-8');
              const zones = getProtectedZones(content);
              const linkedSet = new Set(
                (forwardLinkResults.find(r => r.file === event.path)?.resolved ?? [])
                  .concat(forwardLinkResults.find(r => r.file === event.path)?.dead ?? [])
                  .map(n => n.toLowerCase())
              );
              const knownEntitySet = new Set(entitiesAfter.map(e => e.nameLower));

              // 1. Implicit entity detection
              const implicitMatches = detectImplicitEntities(content);
              const implicitNames = implicitMatches
                .filter(imp => !linkedSet.has(imp.text.toLowerCase()) && !knownEntitySet.has(imp.text.toLowerCase()))
                .map(imp => imp.text);

              // 2. Dead link target mentions (plain text matches for targets with >= 2 backlinks)
              const deadLinkMatches: string[] = [];
              for (const [key, links] of vaultIndex.backlinks) {
                if (links.length < 2 || vaultIndex.entities.has(key) || linkedSet.has(key)) continue;
                const matches = findEntityMatches(content, key, true);
                if (matches.some(m => !rangeOverlapsProtectedZone(m.start, m.end, zones))) {
                  deadLinkMatches.push(key);
                }
              }

              if (implicitNames.length > 0 || deadLinkMatches.length > 0) {
                prospectResults.push({ file: event.path, implicit: implicitNames, deadLinkMatches });
              }
            } catch { /* ignore */ }
          }
          tracker.end({ prospects: prospectResults });
          if (prospectResults.length > 0) {
            const implicitCount = prospectResults.reduce((s, p) => s + p.implicit.length, 0);
            const deadCount = prospectResults.reduce((s, p) => s + p.deadLinkMatches.length, 0);
            serverLog('watcher', `Prospect scan: ${implicitCount} implicit entities, ${deadCount} dead link matches across ${prospectResults.length} files`);
          }

          // Step 12: Suggestion scoring — proactive per-file scoring
          tracker.start('suggestion_scoring', { files: filteredEvents.length });
          const suggestionResults: Array<{ file: string; top: Array<{ entity: string; score: number; confidence: string }> }> = [];
          for (const event of filteredEvents) {
            if (event.type === 'delete' || !event.path.endsWith('.md')) continue;
            try {
              const content = await fs.readFile(path.join(vaultPath, event.path), 'utf-8');
              const result = await suggestRelatedLinks(content, {
                maxSuggestions: 5,
                strictness: 'balanced',
                notePath: event.path,
                detail: true,
              });
              if (result.detailed && result.detailed.length > 0) {
                suggestionResults.push({
                  file: event.path,
                  top: result.detailed.slice(0, 5).map(s => ({
                    entity: s.entity,
                    score: s.totalScore,
                    confidence: s.confidence,
                  })),
                });
              }
            } catch { /* ignore */ }
          }
          tracker.end({ scored_files: suggestionResults.length, suggestions: suggestionResults });
          if (suggestionResults.length > 0) {
            serverLog('watcher', `Suggestion scoring: ${suggestionResults.length} files scored`);
          }

          // Step 13: Tag scan — detect tag additions/removals per changed note [non-critical]
          tracker.start('tag_scan', { files: filteredEvents.length });
          try {
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
          } catch (e) {
            tracker.end({ error: String(e) });
            serverLog('watcher', `Tag scan: failed: ${e}`, 'error');
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
    watcherInstance = watcher;

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

  // Start periodic sweep for graph hygiene metrics (only when watcher is active)
  if (process.env.FLYWHEEL_WATCH !== 'false') {
    startSweepTimer(() => vaultIndex, undefined, () => {
      if (stateDb) runPeriodicMaintenance(stateDb);
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

// Cleanup on exit
process.on('beforeExit', async () => {
  stopSweepTimer();
  await flushLogs();
});
