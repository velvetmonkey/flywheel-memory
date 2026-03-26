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
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const __trFilename = fileURLToPath(import.meta.url);
const __trDirname = dirname(__trFilename);
const trPkg = JSON.parse(readFileSync(join(__trDirname, '../package.json'), 'utf-8'));

import type { VaultIndex } from './core/read/types.js';
import type { FlywheelConfig } from './core/read/config.js';
import type { WatcherStatus } from './core/read/watch/index.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { getSessionId } from '@velvetmonkey/vault-core';

import { TOOL_CATEGORY, type ToolCategory } from './config.js';
import { VaultRegistry, type VaultContext } from './vault-registry.js';
import { runInVaultScope, getActiveScopeOrNull, type VaultScope } from './vault-scope.js';

// Core imports - Tool Tracking
import { recordToolInvocation } from './core/shared/toolTracking.js';

// Read tool registrations
import { registerGraphTools } from './tools/read/graph.js';
import { registerGraphExportTools } from './tools/read/graphExport.js';
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
import { registerRecallTools } from './tools/read/recall.js';
import { registerBriefTools } from './tools/read/brief.js';
import { registerConfigTools } from './tools/write/config.js';
import { registerInitTools } from './tools/write/enrich.js';

// Additional read tool registrations
import { registerMetricsTools } from './tools/read/metrics.js';
import { registerActivityTools } from './tools/read/activity.js';
import { registerSimilarityTools } from './tools/read/similarity.js';
import { registerSemanticTools } from './tools/read/semantic.js';
import { registerMergeTools as registerReadMergeTools } from './tools/read/merges.js';
import { registerTemporalAnalysisTools } from './tools/read/temporalAnalysis.js';
import { registerSessionHistoryTools } from './tools/read/sessionHistory.js';
import { registerEntityHistoryTools } from './tools/read/entityHistory.js';
import { registerLearningReportTools } from './tools/read/learningReport.js';
import { registerCalibrationExportTools } from './tools/read/calibrationExport.js';

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
  updateVaultIndex: (index: VaultIndex) => void;
  updateFlywheelConfig: (config: FlywheelConfig) => void;
}

/** Vault activation callbacks for multi-vault gating */
export interface VaultActivationCallbacks {
  activateVault: (ctx: VaultContext) => void;
  buildVaultScope: (ctx: VaultContext) => VaultScope;
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
): { registered: number; skipped: number } {
  let _registered = 0;
  let _skipped = 0;

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

  function wrapWithTracking(toolName: string, handler: (...args: any[]) => any): (...args: any[]) => any {
    return async (...args: any[]) => {
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

            recordToolInvocation(db, {
              tool_name: toolName,
              session_id: sessionId,
              note_paths: notePaths,
              duration_ms: Date.now() - start,
              success,
              response_tokens: responseTokens,
              baseline_tokens: baselineTokens,
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
    if (!isMultiVault || !registry || !vaultCallbacks) return handler;
    return async (...args: any[]) => {
      const params = args[0];
      const vaultName = params?.vault;
      // Remove vault from params before forwarding (tools don't expect it)
      if (params && 'vault' in params) {
        delete params.vault;
      }
      // Cross-vault search: when no vault specified, search all vaults and merge
      if (toolName === 'search' && !vaultName) {
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

    for (const ctx of reg.getAllContexts()) {
      callbacks.activateVault(ctx);
      try {
        // Run each vault's search inside its own ALS context
        const result = await runInVaultScope(callbacks.buildVaultScope(ctx), () => handler(...args));
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

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Register all tools on a McpServer instance.
 * Uses scope-aware getters that read from ALS VaultScope first,
 * falling back to module-level singletons via the injected context.
 */
export function registerAllTools(
  targetServer: McpServer,
  ctx: ToolRegistryContext,
): void {
  const { getVaultPath: gvp, getVaultIndex: gvi, getStateDb: gsd, getFlywheelConfig: gcf } = ctx;

  // Read tools
  registerHealthTools(targetServer, gvi, gvp, gcf, gsd, ctx.getWatcherStatus, () => trPkg.version);
  registerReadSystemTools(
    targetServer,
    gvi,
    (newIndex) => { ctx.updateVaultIndex(newIndex); },
    gvp,
    (newConfig) => { ctx.updateFlywheelConfig(newConfig); },
    gsd
  );
  registerGraphTools(targetServer, gvi, gvp, gsd);
  registerGraphExportTools(targetServer, gvi, gvp, gsd);
  registerWikilinkTools(targetServer, gvi, gvp, gsd);
  registerQueryTools(targetServer, gvi, gvp, gsd);
  registerPrimitiveTools(targetServer, gvi, gvp, gcf, gsd);
  registerGraphAnalysisTools(targetServer, gvi, gvp, gsd, gcf);
  registerSemanticAnalysisTools(targetServer, gvi, gvp);
  registerVaultSchemaTools(targetServer, gvi, gvp);
  registerNoteIntelligenceTools(targetServer, gvi, gvp, gcf);
  registerMigrationTools(targetServer, gvi, gvp);

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
  registerCorrectionTools(targetServer, gsd);
  registerInitTools(targetServer, gvp, gsd);
  registerConfigTools(
    targetServer,
    gcf,
    (newConfig) => { ctx.updateFlywheelConfig(newConfig); },
    gsd
  );

  // Additional read tools
  registerMetricsTools(targetServer, gvi, gsd);
  registerActivityTools(targetServer, gsd, () => { try { return getSessionId(); } catch { return null; } });
  registerSimilarityTools(targetServer, gvi, gvp, gsd);
  registerSemanticTools(targetServer, gvp, gsd);
  registerReadMergeTools(targetServer, gsd);
  registerTemporalAnalysisTools(targetServer, gvi, gvp, gsd);
  registerSessionHistoryTools(targetServer, gsd);
  registerEntityHistoryTools(targetServer, gsd);
  registerLearningReportTools(targetServer, gvi, gsd);
  registerCalibrationExportTools(targetServer, gvi, gsd, gcf);

  // Memory tools
  registerMemoryTools(targetServer, gsd);
  registerRecallTools(targetServer, gsd, gvp, () => gvi() ?? null);
  registerBriefTools(targetServer, gsd);

  // Resources (always registered, not gated by tool presets)
  registerVaultResources(targetServer, () => gvi() ?? null);
}
