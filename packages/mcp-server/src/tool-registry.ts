/**
 * Tool registration and gating.
 *
 * applyToolGating() — monkey-patches server.tool() to filter by category,
 *   track invocations, and inject multi-vault support.
 *
 * registerAllTools() — calls all tool registration functions with
 *   scope-aware getters for vault state.
 */

import * as path from 'path';
import { dirname, join } from 'path';
import { statSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

const __trFilename = fileURLToPath(import.meta.url);
const __trDirname = dirname(__trFilename);
const trPkg = JSON.parse(readFileSync(join(__trDirname, '../package.json'), 'utf-8'));

import type { VaultIndex } from './core/read/types.js';
import type { FlywheelConfig } from './core/read/config.js';
import type { WatcherStatus } from './core/read/watch/index.js';
import type { PipelineActivity } from './core/read/watch/pipeline.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { getSessionId } from '@velvetmonkey/vault-core';

import { PRESETS, TOOL_CATEGORY, TOOL_TIER, type ToolCategory, type ToolTier, type ToolTierOverride } from './config.js';
import { getSemanticActivations, getToolRoutingMode, hasToolRouting, type SemanticActivation } from './core/read/toolRouting.js';
import { applySandwichOrdering } from './tools/read/query.js';
import { VaultRegistry, type VaultContext } from './vault-registry.js';
import { runInVaultScope, getActiveScopeOrNull, type VaultScope } from './vault-scope.js';

// Core imports - Tool Tracking
import { recordToolInvocation } from './core/shared/toolTracking.js';

// Read tool registrations
import { registerGraphTools } from './tools/read/graph.js';
// graphExport.ts retired — export_graph removed
import { registerWikilinkTools } from './tools/read/wikilinks.js';
import { registerHealthTools } from './tools/read/health.js';
import { registerQueryTools } from './tools/read/query.js';
import { registerFindNotesTools } from './tools/read/find_notes.js';
import { registerSystemTools as registerReadSystemTools } from './tools/read/system.js';
import { registerPrimitiveTools } from './tools/read/primitives.js';
import { registerMigrationTools } from './tools/read/migrations.js';
import { registerGraphAnalysisTools } from './tools/read/graphAnalysis.js';
import { registerVaultSchemaTools } from './tools/read/vaultSchema.js';
import { registerSemanticAnalysisTools } from './tools/read/semanticAnalysis.js';
import { registerNoteIntelligenceTools } from './tools/read/noteIntelligence.js';
import { registerSchemaTools } from './tools/read/schemaTools.js';
import { registerGraphTools2 } from './tools/read/graphTools.js';
import { registerInsightsTools } from './tools/read/insightsTools.js';

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
import { registerToolSelectionFeedbackTools } from './tools/write/toolSelectionFeedback.js';
import { registerCorrectTool } from './tools/write/correct.js';
import { registerEntityTool } from './tools/write/entity.js';
import { registerLinkTool } from './tools/write/link.js';
import { registerNoteTool } from './tools/write/note.js';
import { detectMisroute, recordHeuristicMisroute } from './core/shared/misrouteDetection.js';
import { registerCorrectionTools } from './tools/write/corrections.js';
import { registerMemoryTools } from './tools/write/memory.js';
// recall removed — entity/memory search merged into search (uber search)
// import { registerRecallTools } from './tools/read/recall.js';
import { registerBriefTools } from './tools/read/brief.js';
import { registerConfigTools } from './tools/write/config.js';
import { registerInitTools } from './tools/write/enrich.js';

// Additional read tool registrations
import { registerMetricsTools } from './tools/read/metrics.js';
// activity.ts retired — vault_activity modes folded into vault_session_history
import { registerSimilarityTools } from './tools/read/similarity.js';
import { registerSemanticTools } from './tools/read/semantic.js';
// registerReadMergeTools retired (T43) — suggest_entity_merges/dismiss_merge_suggestion absorbed into entity tool
import { registerTemporalAnalysisTools } from './tools/read/temporalAnalysis.js';
import { registerSessionHistoryTools } from './tools/read/sessionHistory.js';
import { registerEntityHistoryTools } from './tools/read/entityHistory.js';
import { registerLearningReportTools } from './tools/read/learningReport.js';
import { registerCalibrationExportTools } from './tools/read/calibrationExport.js';
import { registerDiscoveryTools } from './tools/read/discovery.js';

// Resources
import { registerVaultResources } from './resources/vault.js';

// ============================================================================
// Types
// ============================================================================

/** Callbacks and getters injected from index.ts (owns the singletons) */
export interface ToolRegistryContext {
  getVaultPath: () => string;
  getVaultIndex: () => VaultIndex;
  getStateDb: () => StateDb | null;
  getFlywheelConfig: () => FlywheelConfig;
  getWatcherStatus: () => WatcherStatus | null;
  getPipelineActivity: () => Readonly<PipelineActivity> | null;
  getVaultRuntimeState: () => {
    bootState: string;
    integrityState: string;
    integrityCheckInProgress: boolean;
    integrityStartedAt: number | null;
    integritySource: string | null;
    lastIntegrityCheckedAt: number | null;
    lastIntegrityDurationMs: number | null;
    lastIntegrityDetail: string | null;
    lastBackupAt: number | null;
  };
  updateVaultIndex: (index: VaultIndex) => void;
  updateFlywheelConfig: (config: FlywheelConfig) => void;
}

/** Vault activation callbacks for multi-vault gating */
export interface VaultActivationCallbacks {
  activateVault: (ctx: VaultContext) => void;
  buildVaultScope: (ctx: VaultContext) => VaultScope;
}

export type ToolTierMode = 'off' | 'tiered';
// ToolTierOverride re-exported from config.ts (side-effect-free for testing)
export type { ToolTierOverride } from './config.js';

export interface ToolTierController {
  readonly mode: ToolTierMode;
  readonly registered: number;
  readonly skipped: number;
  readonly activeCategories: Set<ToolCategory>;
  getOverride(): ToolTierOverride;
  finalizeRegistration(): void;
  activateCategory(category: ToolCategory, tier?: ToolTier): void;
  enableTierCategory(category: ToolCategory): void;
  enableAllTiers(): void;
  setOverride(override: ToolTierOverride): void;
  getActivatedCategoryTiers(): ReadonlyMap<ToolCategory, ToolTier>;
  getRegisteredTools(): ReadonlyMap<string, RegisteredTool>;
}

const ACTIVATION_PATTERNS: Array<{ category: ToolCategory; tier: ToolTier; patterns: RegExp[] }> = [
  {
    category: 'memory',
    tier: 1,
    patterns: [/\b(remember|recall|forget|memory|memories|preference|setting|store|stored|brief(ing)?|session context|note to self|what do you know)\b/i],
  },
  {
    category: 'graph',
    tier: 2,
    patterns: [/\b(backlinks?|forward links?|connections?|link path|paths?|hubs?|orphans?|dead ends?|clusters?|bridges?)\b/i],
  },
  {
    category: 'wikilinks',
    tier: 2,
    patterns: [/\b(wikilinks?|link suggestions?|stubs?|unlinked mentions?|aliases?)\b/i],
  },
  {
    category: 'corrections',
    tier: 2,
    patterns: [/\b(corrections?|wrong links?|bad links?|mistakes?|fix(es|ing)?|errors?)\b/i],
  },
  {
    category: 'temporal',
    tier: 2,
    patterns: [/\b(history|timeline|timelines|evolution|stale notes?|around date|weekly review|monthly review|quarterly review)\b/i],
  },
  {
    category: 'diagnostics',
    tier: 2,
    patterns: [/\b(health|doctor|diagnostics?|status|config|configuration|pipeline|refresh index|reindex|logs?|insights?|intelligence|analyze note|quality score|audit|staleness|growth trends?)\b/i],
  },
  {
    category: 'schema',
    tier: 3,
    patterns: [/\b(schema|schemas|frontmatter|metadata|conventions?|rename field|rename tag|migrate|folder structure|folder tree|note counts)\b/i],
  },
  {
    category: 'note-ops',
    tier: 3,
    patterns: [/\b(create note|delete note|move note|rename note|merge entit(y|ies)|merge notes?|deduplicate|also known as|aka|nickname)\b/i],
  },
];

const MUTATING_TOOL_NAMES = new Set([
  'vault_add_to_section',
  'vault_remove_from_section',
  'vault_replace_in_section',
  'vault_add_task',
  'vault_toggle_task',
  'vault_update_frontmatter',
  'vault_create_note',
  'vault_delete_note',
  'vault_move_note',
  'vault_rename_note',
  'merge_entities',
  'absorb_as_alias',
  'vault_undo_last_mutation',
  'policy',
  'rename_tag',
  'wikilink_feedback',
  'tool_selection_feedback',
  'vault_record_correction',
  'vault_resolve_correction',
  'memory',
  'flywheel_config',
  'vault_init',
  'rename_field',
  'migrate_field_values',
  'refresh_index',
  'init_semantic',
]);

export function getPatternSignals(raw: string): Array<{ category: ToolCategory; tier: ToolTier }> {
  if (!raw) return [];
  return ACTIVATION_PATTERNS
    .filter(({ patterns }) => patterns.some((pattern) => pattern.test(raw)))
    .map(({ category, tier }) => ({ category, tier }));
}

/** Deduplicate activation signals by category, keeping the highest tier per category. */
export function unionSignalsByCategory(
  signals: Array<{ category: ToolCategory; tier: ToolTier }>,
): Array<{ category: ToolCategory; tier: ToolTier }> {
  const best = new Map<ToolCategory, ToolTier>();
  for (const { category, tier } of signals) {
    const existing = best.get(category);
    if (!existing || tier > existing) best.set(category, tier);
  }
  return Array.from(best.entries()).map(([category, tier]) => ({ category, tier }));
}

async function getActivationSignals(
  toolName: string,
  params: unknown,
  searchMethod?: string,
  isFullToolset: boolean = false,
): Promise<Array<{ category: ToolCategory; tier: ToolTier }>> {
  if (toolName !== 'search' && toolName !== 'brief') return [];
  if (!params || typeof params !== 'object') return [];

  const raw = [
    typeof (params as Record<string, unknown>).query === 'string' ? (params as Record<string, string>).query : '',
    typeof (params as Record<string, unknown>).focus === 'string' ? (params as Record<string, string>).focus : '',
  ].filter(Boolean).join(' ');

  if (!raw) return [];

  const routingMode = getToolRoutingMode(isFullToolset);

  // Pattern-based signals (T13 regex activation)
  const patternSignals = routingMode !== 'semantic' ? getPatternSignals(raw) : [];

  // Semantic signals (T14 embedding-based activation)
  let semanticSignals: SemanticActivation[] = [];
  if (
    routingMode !== 'pattern' &&
    searchMethod === 'hybrid' &&
    hasToolRouting()
  ) {
    semanticSignals = await getSemanticActivations(raw);
  }

  // In 'semantic' mode with non-hybrid search, fall back to pattern signals
  if (routingMode === 'semantic' && searchMethod !== 'hybrid') {
    return getPatternSignals(raw);
  }

  return unionSignalsByCategory([...patternSignals, ...semanticSignals]);
}

/**
 * Extract the search method from an MCP tool result payload.
 * The search tool returns JSON with a 'method' field ('hybrid', 'fts5', 'cross_vault', etc.).
 */
function extractSearchMethod(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const content = (result as { content?: unknown[] }).content;
  if (!Array.isArray(content) || content.length === 0) return undefined;
  const first = content[0] as { type?: string; text?: string };
  if (first?.type !== 'text' || typeof first.text !== 'string') return undefined;
  try {
    const parsed = JSON.parse(first.text);
    if (typeof parsed.method === 'string') return parsed.method;
  } catch { /* not JSON or no method field */ }
  return undefined;
}

// ============================================================================
// Tool Gating
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
export function applyToolGating(
  targetServer: McpServer,
  categories: Set<ToolCategory>,
  getDb: () => StateDb | null,
  registry?: VaultRegistry | null,
  getVaultPath?: () => string,
  vaultCallbacks?: VaultActivationCallbacks,
  tierMode: ToolTierMode = 'off',
  onTierStateChange?: (controller: ToolTierController) => void,
  isFullToolset: boolean = false,
  onToolCall?: () => void,
): ToolTierController {
  let _registered = 0;
  let _skipped = 0;
  let tierOverride: ToolTierOverride = 'auto';
  const toolHandles = new Map<string, RegisteredTool>();
  const activatedCategoryTiers = new Map<ToolCategory, ToolTier>();
  let controllerRef: ToolTierController | null = null;

  function gate(name: string): boolean {
    const category = TOOL_CATEGORY[name];
    if (!category) {
      throw new Error(
        `Tool "${name}" has no entry in TOOL_CATEGORY (config.ts). ` +
        `Every tool must be assigned a category for gating to work.`
      );
    }
    if (!categories.has(category)) {
      _skipped++;
      return false;
    }
    _registered++;
    return true;
  }

  function enableCategory(category: ToolCategory, tier: ToolTier): string[] {
    if (!categories.has(category)) return [];
    const previousTier = activatedCategoryTiers.get(category) ?? 0;
    if (tier > previousTier) {
      activatedCategoryTiers.set(category, tier);
    }
    return refreshToolVisibility();
  }

  function shouldEnableTool(toolName: string): boolean {
    const tier = TOOL_TIER[toolName];
    const category = TOOL_CATEGORY[toolName];
    if (!tier || !category) return true;
    if (!categories.has(category)) return false;
    if (tierMode === 'off') return true;
    if (tierOverride === 'full') return true;
    if (tier === 1) return true;
    if (tierOverride === 'minimal') return false;
    const activatedTier = activatedCategoryTiers.get(category) ?? 0;
    return activatedTier >= tier;
  }

  /** Returns names of tools that were newly enabled (empty if no change). */
  function refreshToolVisibility(): string[] {
    const newlyEnabled: string[] = [];
    for (const [name, handle] of toolHandles) {
      const enabled = shouldEnableTool(name);
      if (enabled !== handle.enabled) {
        // Set directly instead of enable()/disable() to avoid per-tool
        // sendToolListChanged() notifications — we send one batch notification below.
        // `enabled` is a public mutable property on RegisteredTool (SDK >=1.26.0).
        handle.enabled = enabled;
        if (enabled) newlyEnabled.push(name);
      }
    }
    if (newlyEnabled.length > 0) {
      targetServer.sendToolListChanged();
    }
    // Always fire callback — override state may have changed even if no tools flipped
    if (controllerRef) {
      onTierStateChange?.(controllerRef);
    }
    return newlyEnabled;
  }

  /** Returns names of tools newly activated (empty if none). */
  async function maybeActivateFromContext(toolName: string, params: unknown, searchMethod?: string): Promise<string[]> {
    if (tierMode !== 'tiered' || tierOverride === 'full') return [];
    const newlyEnabled: string[] = [];
    for (const { category, tier } of await getActivationSignals(toolName, params, searchMethod, isFullToolset)) {
      newlyEnabled.push(...enableCategory(category, tier));
    }
    return newlyEnabled;
  }

  function ensureToolEnabledForDirectCall(toolName: string): void {
    if (tierMode !== 'tiered') return;
    const handle = toolHandles.get(toolName);
    if (!handle || handle.enabled) return;
    const category = TOOL_CATEGORY[toolName];
    const tier = TOOL_TIER[toolName];
    if (!category || !tier) return;
    enableCategory(category, tier);
  }


  /** Max length for stored query context */
  const MAX_QUERY_CONTEXT_LENGTH = 500;

  /** Strict allowlist of intent-bearing param fields */
  const QUERY_CONTEXT_FIELDS = ['query', 'focus', 'analysis', 'entity', 'heading', 'field', 'date', 'concept'] as const;

  /**
   * Extract user-intent query context from tool params.
   * Strict allowlist — excludes content, description, frontmatter, yaml, policy, key, value, mode.
   */
  function extractQueryContext(params: unknown): string | undefined {
    if (!params || typeof params !== 'object') return undefined;
    const p = params as Record<string, unknown>;
    const parts: string[] = [];
    for (const field of QUERY_CONTEXT_FIELDS) {
      const val = p[field];
      if (typeof val === 'string' && val.trim()) {
        parts.push(val.trim());
      }
    }
    if (parts.length === 0) return undefined;
    const joined = parts.join(' | ').replace(/\s+/g, ' ');
    return joined.length > MAX_QUERY_CONTEXT_LENGTH
      ? joined.slice(0, MAX_QUERY_CONTEXT_LENGTH)
      : joined;
  }

  function wrapWithTracking(toolName: string, handler: (...args: any[]) => any): (...args: any[]) => any {
    return async (...args: any[]) => {
      onToolCall?.();
      const start = Date.now();
      let success = true;
      let notePaths: string[] | undefined;
      let result: any;
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
        result = await handler(...args);
        // Extract search method from result for semantic routing gating
        const searchMethod = extractSearchMethod(result);
        const newlyActivated = await maybeActivateFromContext(toolName, params, searchMethod);
        // Append activation notice to response so HTTP clients learn about new tools
        // (sendToolListChanged notifications are lost over stateless HTTP transport)
        if (newlyActivated.length > 0 && result?.content && Array.isArray(result.content)) {
          result.content.push({
            type: 'text' as const,
            text: `\n[Progressive disclosure: ${newlyActivated.length} new tools activated: ${newlyActivated.join(', ')}. Call tools/list to refresh.]`,
          });
        }
        return result;
      } catch (err) {
        success = false;
        throw err;
      } finally {
        const db = getDb();
        if (db) {
          try {
            let sessionId: string | undefined;
            try { sessionId = getSessionId(); } catch { /* no session */ }

            // Estimate response tokens from MCP response
            let responseTokens: number | undefined;
            if (result?.content) {
              let totalChars = 0;
              for (const block of result.content) {
                if (block?.type === 'text' && typeof block.text === 'string') {
                  totalChars += block.text.length;
                }
              }
              if (totalChars > 0) responseTokens = Math.ceil(totalChars / 4);
            }

            // Estimate baseline tokens (raw file read cost)
            let baselineTokens: number | undefined;
            if (notePaths && notePaths.length > 0 && getVaultPath) {
              const vp = getVaultPath();
              let totalBytes = 0;
              for (const p of notePaths) {
                try {
                  totalBytes += statSync(path.join(vp, p)).size;
                } catch { /* file may not exist */ }
              }
              if (totalBytes > 0) baselineTokens = Math.ceil(totalBytes / 4);
            }

            const queryContext = extractQueryContext(params);
            const invocationId = recordToolInvocation(db, {
              tool_name: toolName,
              session_id: sessionId,
              note_paths: notePaths,
              duration_ms: Date.now() - start,
              success,
              response_tokens: responseTokens,
              baseline_tokens: baselineTokens,
              query_context: queryContext,
            });

            // Heuristic misroute detection (T15b)
            if (queryContext) {
              try {
                const misroute = detectMisroute(toolName, queryContext);
                if (misroute) {
                  recordHeuristicMisroute(db, invocationId, misroute);
                }
              } catch { /* never let heuristic errors affect tool execution */ }
            }
          } catch {
            // Never let tracking errors affect tool execution
          }
        }
      }
    };
  }

  const isMultiVault = registry?.isMultiVault ?? false;

  function getTargetVaultContext(params: Record<string, unknown> | undefined): VaultContext | null {
    if (!registry) return null;
    if (isMultiVault) {
      const vaultName = typeof params?.vault === 'string' ? params.vault : undefined;
      return registry.getContext(vaultName);
    }
    return registry.getContext();
  }

  function wrapWithIntegrityGate(toolName: string, handler: (...args: any[]) => any): (...args: any[]) => any {
    if (!MUTATING_TOOL_NAMES.has(toolName)) return handler;
    return async (...args: any[]) => {
      const params = (args[0] && typeof args[0] === 'object') ? args[0] as Record<string, unknown> : undefined;
      const vaultCtx = getTargetVaultContext(params);
      const integrityState = vaultCtx?.integrityState ?? getActiveScopeOrNull()?.integrityState;
      if (integrityState === 'failed') {
        throw new Error('StateDb integrity failed; write operations are disabled until recovery/restart.');
      }
      return handler(...args);
    };
  }

  /**
   * Wrap a handler to activate the correct vault before execution (multi-vault).
   * Extracts the `vault` param, calls activateVault(), then forwards to the original handler.
   * For `search` with no explicit vault, iterates all vaults and merges results.
   */
  function wrapWithVaultActivation(toolName: string, handler: (...args: any[]) => any): (...args: any[]) => any {
    if (!isMultiVault || !registry || !vaultCallbacks) return handler;
    return async (...args: any[]) => {
      const params = args[0];
      const vaultName = params?.vault;
      // Remove vault from params before forwarding (tools don't expect it)
      if (params && 'vault' in params) {
        delete params.vault;
      }
      // Cross-vault search/find: when no vault specified, query all vaults and merge
      if ((toolName === 'search' || toolName === 'find_notes') && !vaultName) {
        return crossVaultSearch(registry!, vaultCallbacks!, handler, args);
      }
      const ctx = registry.getContext(vaultName);
      // Set fallback scope + module-level state (for watcher/startup code paths)
      vaultCallbacks!.activateVault(ctx);
      // Run handler inside ALS context for per-request isolation
      return runInVaultScope(vaultCallbacks!.buildVaultScope(ctx), () => handler(...args));
    };
  }

  /**
   * Cross-vault search: run search handler in each vault context, merge results.
   * Each vault's results are tagged with a `vault` field.
   */
  async function crossVaultSearch(
    reg: VaultRegistry,
    callbacks: VaultActivationCallbacks,
    handler: (...args: any[]) => any,
    args: any[]
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const perVault: Array<{ vault: string; data: any }> = [];
    // Preserve the caller's consumer preference; force 'human' for per-vault calls
    // so rrf_score survives for cross-vault merge-sort, then apply LLM post-processing after
    const callerConsumer: string = args[0]?.consumer ?? 'llm';
    const crossArgs = [{ ...args[0], consumer: 'human' }, ...args.slice(1)];

    for (const ctx of reg.getAllContexts()) {
      callbacks.activateVault(ctx);
      try {
        // Run each vault's search inside its own ALS context
        const result = await runInVaultScope(callbacks.buildVaultScope(ctx), () => handler(...crossArgs));
        const text = result?.content?.[0]?.text;
        if (text) {
          perVault.push({ vault: ctx.name, data: JSON.parse(text) });
        }
      } catch {
        // Skip vaults that error during search
      }
    }

    // Merge result items across vaults (notes, entities, memories separately)
    const mergedResults: any[] = [];
    const mergedEntities: any[] = [];
    const mergedMemories: any[] = [];
    const vaultsSearched: string[] = [];
    let query: string | undefined;

    for (const { vault, data } of perVault) {
      vaultsSearched.push(vault);
      if (data.query) query = data.query;
      if (data.error || data.building) continue;

      // Note results
      const items = data.results || data.notes || [];
      for (const item of items) {
        mergedResults.push({ vault, ...item });
      }

      // Entity results
      if (Array.isArray(data.entities)) {
        for (const item of data.entities) {
          mergedEntities.push({ vault, ...item });
        }
      }

      // Memory results
      if (Array.isArray(data.memories)) {
        for (const item of data.memories) {
          mergedMemories.push({ vault, ...item });
        }
      }
    }

    // Sort note results by rrf_score when available (hybrid/fts5), otherwise preserve order
    if (mergedResults.some((r: any) => r.rrf_score != null)) {
      mergedResults.sort((a: any, b: any) => (b.rrf_score ?? 0) - (a.rrf_score ?? 0));
    }

    // Deduplicate entities across vaults (same name = keep first)
    const seenEntities = new Set<string>();
    const dedupedEntities = mergedEntities.filter((e: any) => {
      const key = (e.name || '').toLowerCase();
      if (seenEntities.has(key)) return false;
      seenEntities.add(key);
      return true;
    });

    // Deduplicate memories across vaults (same key = keep first)
    const seenMemories = new Set<string>();
    const dedupedMemories = mergedMemories.filter((m: any) => {
      if (seenMemories.has(m.key)) return false;
      seenMemories.add(m.key);
      return true;
    });

    const limit = args[0]?.limit ?? 10;
    const truncated = mergedResults.slice(0, limit);

    // Apply LLM context engineering on merged results when caller is LLM
    if (callerConsumer === 'llm') {
      applySandwichOrdering(truncated);
      const INTERNAL = ['rrf_score', 'in_fts5', 'in_semantic', 'in_entity', 'graph_boost', '_combined_score'];
      for (const r of truncated) {
        for (const key of INTERNAL) delete r[key];
      }
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          method: 'cross_vault',
          query,
          vaults_searched: vaultsSearched,
          total_results: mergedResults.length,
          returned: truncated.length,
          results: truncated,
          ...(dedupedEntities.length > 0 ? { entities: dedupedEntities.slice(0, limit) } : {}),
          ...(dedupedMemories.length > 0 ? { memories: dedupedMemories.slice(0, limit) } : {}),
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
      handler = wrapWithIntegrityGate(name, handler);
      args[args.length - 1] = wrapWithTracking(name, handler);
    }
    const registered = origTool(name, ...args) as RegisteredTool;
    toolHandles.set(name, registered);
    return registered;
  };

  const origRegisterTool = (targetServer as any).registerTool?.bind(targetServer);
  if (origRegisterTool) {
    (targetServer as any).registerTool = (name: string, ...args: any[]) => {
      if (!gate(name)) return;
      injectVaultParam(args);
      if (args.length > 0 && typeof args[args.length - 1] === 'function') {
        let handler = args[args.length - 1];
        handler = wrapWithVaultActivation(name, handler);
        handler = wrapWithIntegrityGate(name, handler);
        args[args.length - 1] = wrapWithTracking(name, handler);
      }
      const registered = origRegisterTool(name, ...args) as RegisteredTool;
      toolHandles.set(name, registered);
      return registered;
    };
  }

  /**
   * Install a custom CallTool handler that adds auto-promotion for tiered tools.
   *
   * When a client calls a disabled tier-2 tool directly, this handler auto-promotes
   * the tool's category before the SDK rejects the call. This can't be done via
   * handler wrappers because the SDK checks `tool.enabled` before calling handlers.
   *
   * SDK internal access (documented for version audits):
   *   - serverAny.server.setRequestHandler — replaces the tool call handler
   *   - serverAny.validateToolInput — input schema validation
   *   - serverAny.executeToolHandler — handler invocation
   *   - serverAny.validateToolOutput — output schema validation
   *   - serverAny.createToolError — error response construction
   *   - serverAny.handleAutomaticTaskPolling — task support (optional mode)
   *
   * These are stable across SDK 1.25–1.26 but not part of the public API.
   * TODO: Upstream a pre-call hook or middleware API to eliminate this coupling.
   */
  function installTieredCallHandler(): void {
    if (tierMode !== 'tiered') return;
    const serverAny = targetServer as any;
    serverAny.server.setRequestHandler(CallToolRequestSchema, async (request: any, extra: any) => {
      try {
        const tool = toolHandles.get(request.params.name);
        if (!tool) {
          throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
        }
        if (!tool.enabled) {
          ensureToolEnabledForDirectCall(request.params.name);
        }
        if (!tool.enabled) {
          throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} disabled`);
        }
        const isTaskRequest = !!request.params.task;
        const taskSupport = tool.execution?.taskSupport;
        const isTaskHandler = 'createTask' in tool.handler;
        if ((taskSupport === 'required' || taskSupport === 'optional') && !isTaskHandler) {
          throw new McpError(ErrorCode.InternalError, `Tool ${request.params.name} has taskSupport '${taskSupport}' but was not registered with registerToolTask`);
        }
        if (taskSupport === 'required' && !isTaskRequest) {
          throw new McpError(ErrorCode.MethodNotFound, `Tool ${request.params.name} requires task augmentation (taskSupport: 'required')`);
        }
        if (taskSupport === 'optional' && !isTaskRequest && isTaskHandler) {
          return await serverAny.handleAutomaticTaskPolling(tool, request, extra);
        }
        const args = await serverAny.validateToolInput(tool, request.params.arguments, request.params.name);
        const result = await serverAny.executeToolHandler(tool, args, extra);
        if (isTaskRequest) {
          return result;
        }
        await serverAny.validateToolOutput(tool, result, request.params.name);
        return result;
      } catch (error) {
        if (error instanceof McpError && error.code === ErrorCode.UrlElicitationRequired) {
          throw error;
        }
        return serverAny.createToolError(error instanceof Error ? error.message : String(error));
      }
    });
  }

  const controller: ToolTierController = {
    mode: tierMode,
    get registered() {
      return _registered;
    },
    get skipped() {
      return _skipped;
    },
    get activeCategories() {
      return new Set(activatedCategoryTiers.keys());
    },
    getOverride() {
      return tierOverride;
    },
    finalizeRegistration() {
      refreshToolVisibility();
      installTieredCallHandler();
    },
    activateCategory(category: ToolCategory, tier: ToolTier = 2) {
      enableCategory(category, tier);
    },
    enableTierCategory(category: ToolCategory) {
      enableCategory(category, 2);
    },
    enableAllTiers() {
      tierOverride = 'full';
      refreshToolVisibility();
    },
    setOverride(override: ToolTierOverride) {
      tierOverride = override;
      refreshToolVisibility();
    },
    getActivatedCategoryTiers() {
      return new Map(activatedCategoryTiers);
    },
    getRegisteredTools() {
      return toolHandles;
    },
  };

  controllerRef = controller;

  return controller;
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Register all tools on a McpServer instance.
 * Uses scope-aware getters that read from ALS VaultScope first,
 * falling back to module-level singletons via the injected context.
 */
export interface RegisterAllToolsOptions {
  /**
   * When true (default), the Claude Code client fingerprint (CLAUDECODE=1)
   * causes the `memory` tool to be skipped because Claude Code intercepts
   * memory verbs onto its own native memory plane. Set to false in test
   * catalog collection so the manifest always reflects the complete surface.
   */
  applyClientSuppressions?: boolean;
}

export function registerAllTools(
  targetServer: McpServer,
  ctx: ToolRegistryContext,
  controller?: ToolTierController | null,
  options: RegisterAllToolsOptions = {},
): void {
  const { applyClientSuppressions = true } = options;
  const { getVaultPath: gvp, getVaultIndex: gvi, getStateDb: gsd, getFlywheelConfig: gcf } = ctx;

  // Read tools
  registerHealthTools(targetServer, gvi, gvp, gcf, gsd, ctx.getWatcherStatus, () => trPkg.version, ctx.getPipelineActivity, ctx.getVaultRuntimeState);
  registerReadSystemTools(
    targetServer,
    gvi,
    (newIndex) => { ctx.updateVaultIndex(newIndex); },
    gvp,
    (newConfig) => { ctx.updateFlywheelConfig(newConfig); },
    gsd
  );
  // graph.ts + graphExport.ts retired (8 tools removed)
  registerWikilinkTools(targetServer, gvi, gvp, gsd);
  registerQueryTools(targetServer, gvi, gvp, gsd);
  registerFindNotesTools(targetServer, gvi, gsd);
  registerPrimitiveTools(targetServer, gvi, gvp, gcf, gsd);
  registerGraphTools(targetServer, gvi, gvp, gsd);
  registerGraphAnalysisTools(targetServer, gvi, gvp, gsd, gcf);
  // registerSemanticAnalysisTools retired (T43) — semantic_analysis removed from surface
  registerVaultSchemaTools(targetServer, gvi, gvp);
  registerNoteIntelligenceTools(targetServer, gvi, gvp, gcf);
  registerMigrationTools(targetServer, gvi, gvp);
  registerSchemaTools(targetServer, gvi, gvp);
  registerGraphTools2(targetServer, gvi, gvp, gsd);
  registerInsightsTools(targetServer, gvi, gvp, gsd, gcf);

  // Write tools
  registerMutationTools(targetServer, gvp, gcf);
  registerTaskTools(targetServer, gvp);
  registerFrontmatterTools(targetServer, gvp);
  registerNoteTools(targetServer, gvp, gvi);
  registerMoveNoteTools(targetServer, gvp);
  registerWriteMergeTools(targetServer, gvp);
  registerWriteSystemTools(targetServer, gvp);
  registerPolicyTools(targetServer, gvp, () => {
    const index = gvi();
    if (!index) return undefined;
    return ({ query, folder, where, limit = 10 }: { query?: string; folder?: string; where?: Record<string, unknown>; limit?: number }) => {
      let notes = Array.from(index.notes.values());
      if (folder) {
        const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
        notes = notes.filter(n => n.path.startsWith(normalizedFolder) || n.path.split('/')[0] === folder.replace('/', ''));
      }
      if (where) {
        notes = notes.filter(n => {
          for (const [key, value] of Object.entries(where)) {
            const noteValue = n.frontmatter[key];
            if (Array.isArray(value)) {
              if (!value.some(v => String(noteValue).toLowerCase() === String(v).toLowerCase())) return false;
            } else if (value !== undefined && String(noteValue ?? '').toLowerCase() !== String(value).toLowerCase()) {
              return false;
            }
          }
          return true;
        });
      }
      return notes.slice(0, limit).map(n => ({
        path: n.path,
        title: n.title,
        frontmatter: n.frontmatter,
        snippet: undefined,
      }));
    };
  });
  registerTagTools(targetServer, gvi, gvp);
  registerWikilinkFeedbackTools(targetServer, gsd);
  // registerToolSelectionFeedbackTools retired (T43) — tool_selection_feedback removed from surface
  registerCorrectionTools(targetServer, gsd);
  // registerInitTools retired (T43) — vault_init removed from surface
  registerConfigTools(
    targetServer,
    gcf,
    (newConfig) => { ctx.updateFlywheelConfig(newConfig); },
    gsd
  );

  // Additional read tools
  registerMetricsTools(targetServer, gvi, gsd);
  // vault_activity retired — modes folded into vault_session_history
  registerSimilarityTools(targetServer, gvi, gvp, gsd);
  registerSemanticTools(targetServer, gvp, gsd);
  // registerReadMergeTools retired (T43) — suggest_merges/dismiss_merge now in entity tool
  registerTemporalAnalysisTools(targetServer, gvi, gvp, gsd);
  // registerSessionHistoryTools retired (T43) — vault_session_history removed from surface
  // registerEntityHistoryTools retired (T43) — vault_entity_history removed from surface
  // registerLearningReportTools retired (T43) — flywheel_learning_report removed from surface
  // registerCalibrationExportTools retired (T43) — flywheel_calibration_export removed from surface

  // Memory tools
  //
  // Claude Code intercepts verbs like "remember", "search memory", "list memories",
  // "forget" onto its native client-side memory plane (Glob/Read against
  // ~/.claude/memory/), never reaching the MCP `memory` tool regardless of how
  // the tool is described or ranked. Measured 3/6 memory-action tests routed to
  // Glob instead of memory(*). To avoid the collision, suppress registration of
  // the `memory` tool when we detect the Claude Code client (via CLAUDECODE=1
  // env var it sets on spawned MCP subprocesses). `brief` stays registered —
  // it's the Claude Code escape hatch for memory retrieval. flywheel-engine and
  // non-Claude clients are unaffected. Override with FW_ENABLE_MEMORY_FOR_CLAUDE=1.
  const suppressMemoryForClaude =
    applyClientSuppressions &&
    process.env.CLAUDECODE === '1' &&
    process.env.FW_ENABLE_MEMORY_FOR_CLAUDE !== '1';
  if (!suppressMemoryForClaude) {
    registerMemoryTools(targetServer, gsd);
  }
  // recall removed — entity/memory search merged into search (uber search)
  // registerRecallTools(targetServer, gsd, gvp, () => gvi() ?? null);
  registerBriefTools(targetServer, gsd);

  // T43 merged tools
  registerNoteTool(targetServer, gvp, gvi);
  registerLinkTool(targetServer, gvi, gvp, gsd);
  registerCorrectTool(targetServer, gsd, gvp);
  registerEntityTool(targetServer, gvp, gsd, gvi);

  // Discovery tool (progressive disclosure meta-tool — only in auto/tiered mode)
  if (controller && controller.mode === 'tiered') {
    registerDiscoveryTools(targetServer, controller);
  }

  // Resources (always registered, not gated by tool presets)
  registerVaultResources(targetServer, () => gvi() ?? null);
}
