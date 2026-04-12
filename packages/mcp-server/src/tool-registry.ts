/**
 * Flywheel-owned tool registration and dispatch.
 *
 * Runtime owns registration state, visibility, and tools/list + tools/call
 * dispatch. MCP SDK private helpers are not used.
 */

import * as path from 'path';
import { dirname, join } from 'path';
import { statSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeObjectSchema, safeParseAsync, getParseErrorMessage } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const __trFilename = fileURLToPath(import.meta.url);
const __trDirname = dirname(__trFilename);
const trPkg = JSON.parse(readFileSync(join(__trDirname, '../package.json'), 'utf-8'));

import type { VaultIndex } from './core/read/types.js';
import type { FlywheelConfig } from './core/read/config.js';
import type { WatcherStatus } from './core/read/watch/index.js';
import type { PipelineActivity } from './core/read/watch/pipeline.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { getSessionId } from '@velvetmonkey/vault-core';

import { DISCLOSURE_ONLY_TOOLS, TOOL_CATEGORY, type ToolCategory, type ToolTier, type ToolTierOverride } from './config.js';
import { VaultRegistry, type VaultContext } from './vault-registry.js';
import { runInVaultScope, getActiveScopeOrNull, type VaultScope } from './vault-scope.js';

import { recordToolInvocation } from './core/shared/toolTracking.js';
import { registerHealthTools } from './tools/read/health.js';
import { registerQueryTools } from './tools/read/query.js';
import { registerFindNotesTools } from './tools/read/find_notes.js';
import { registerSystemTools as registerReadSystemTools } from './tools/read/system.js';
import { registerPrimitiveTools } from './tools/read/primitives.js';
import { registerSchemaTools } from './tools/read/schemaTools.js';
import { registerGraphTools2 } from './tools/read/graphTools.js';
import { registerInsightsTools } from './tools/read/insightsTools.js';
import { registerTaskTools } from './tools/write/tasks.js';
import { registerFrontmatterTools } from './tools/write/frontmatter.js';
import { registerPolicyTools } from './tools/write/policy.js';
import { registerCorrectTool } from './tools/write/correct.js';
import { registerEntityTool } from './tools/write/entity.js';
import { registerLinkTool } from './tools/write/link.js';
import { registerNoteTool } from './tools/write/note.js';
import { registerEditSectionTool } from './tools/write/editSection.js';
import { detectMisroute, recordHeuristicMisroute } from './core/shared/misrouteDetection.js';
import { registerMemoryTools } from './tools/write/memory.js';
import { registerSemanticTools } from './tools/read/semantic.js';
import { registerDiscoveryTools } from './tools/read/discovery.js';
import { registerVaultResources } from './resources/vault.js';

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

export interface VaultActivationCallbacks {
  activateVault: (ctx: VaultContext) => void;
  buildVaultScope: (ctx: VaultContext) => VaultScope;
}

export type ToolTierMode = 'off' | 'tiered';
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

export interface ToolRegistrationSurface {
  tool: McpServer['tool'];
  registerTool: McpServer['registerTool'];
  registerResource: McpServer['registerResource'];
  sendToolListChanged: McpServer['sendToolListChanged'];
}

const RUNTIME = Symbol('tool-runtime');

const ACTIVATION_PATTERNS: Array<{ category: ToolCategory; tier: ToolTier; patterns: RegExp[] }> = [
  { category: 'memory', tier: 1, patterns: [/\b(remember|recall|forget|memory|memories|preference|setting|store|stored|brief(ing)?|session context|note to self|what do you know)\b/i] },
  { category: 'graph', tier: 2, patterns: [/\b(backlinks?|forward links?|connections?|link path|paths?|hubs?|orphans?|dead ends?|clusters?|bridges?)\b/i] },
  { category: 'wikilinks', tier: 2, patterns: [/\b(wikilinks?|link suggestions?|stubs?|unlinked mentions?|aliases?)\b/i] },
  { category: 'corrections', tier: 2, patterns: [/\b(corrections?|wrong links?|bad links?|mistakes?|fix(es|ing)?|errors?)\b/i] },
  { category: 'temporal', tier: 2, patterns: [/\b(history|timeline|timelines|evolution|stale notes?|around date|weekly review|monthly review|quarterly review)\b/i] },
  { category: 'diagnostics', tier: 2, patterns: [/\b(health|doctor|diagnostics?|status|config|configuration|pipeline|refresh index|reindex|logs?|insights?|intelligence|analyze note|quality score|audit|staleness|growth trends?)\b/i] },
  { category: 'schema', tier: 3, patterns: [/\b(schema|schemas|frontmatter|metadata|conventions?|rename field|rename tag|migrate|folder structure|folder tree|note counts)\b/i] },
  { category: 'note-ops', tier: 3, patterns: [/\b(create note|delete note|move note|rename note|merge entit(y|ies)|merge notes?|deduplicate|also known as|aka|nickname)\b/i] },
];

const MUTATING_TOOL_NAMES = new Set([
  'edit_section',
  'note',
  'vault_add_task',
  'vault_update_frontmatter',
  'tasks',
  'policy',
  'correct',
  'entity',
  'link',
  'schema',
  'doctor',
  'memory',
  'refresh_index',
  'init_semantic',
]);

const MAX_QUERY_CONTEXT_LENGTH = 500;
const QUERY_CONTEXT_FIELDS = ['query', 'focus', 'analysis', 'entity', 'heading', 'field', 'date', 'concept'] as const;

export function getPatternSignals(raw: string): Array<{ category: ToolCategory; tier: ToolTier }> {
  if (!raw) return [];
  return ACTIVATION_PATTERNS
    .filter(({ patterns }) => patterns.some((pattern) => pattern.test(raw)))
    .map(({ category, tier }) => ({ category, tier }));
}

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

function createToolError(errorMessage: string): CallToolResult {
  return {
    content: [{ type: 'text', text: errorMessage }],
    isError: true,
  };
}

function toJsonSchema(inputSchema: unknown, pipeStrategy: 'input' | 'output'): object {
  const obj = normalizeObjectSchema(inputSchema as any);
  if (!obj) return { type: 'object' };
  return toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy });
}

function extractQueryContext(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const p = params as Record<string, unknown>;
  const parts: string[] = [];
  for (const field of QUERY_CONTEXT_FIELDS) {
    const val = p[field];
    if (typeof val === 'string' && val.trim()) parts.push(val.trim());
  }
  if (parts.length === 0) return undefined;
  const joined = parts.join(' | ').replace(/\s+/g, ' ');
  return joined.length > MAX_QUERY_CONTEXT_LENGTH ? joined.slice(0, MAX_QUERY_CONTEXT_LENGTH) : joined;
}

class FlywheelToolRuntime {
  private registeredCount = 0;
  private skippedCount = 0;
  private override: ToolTierOverride = 'auto';
  private readonly toolHandles = new Map<string, RegisteredTool>();

  readonly controller: ToolTierController;
  readonly surface: ToolRegistrationSurface;

  constructor(
    private readonly targetServer: McpServer,
    private readonly categories: Set<ToolCategory>,
    private readonly getDb: () => StateDb | null,
    private readonly registry?: VaultRegistry | null,
    private readonly getVaultPath?: () => string,
    private readonly vaultCallbacks?: VaultActivationCallbacks,
    private readonly mode: ToolTierMode = 'off',
    private readonly onTierStateChange?: (controller: ToolTierController) => void,
    private readonly onToolCall?: () => void,
  ) {
    this.controller = {
      mode: this.mode,
      get registered() { return thisRuntime.registeredCount; },
      get skipped() { return thisRuntime.skippedCount; },
      get activeCategories() { return new Set(thisRuntime.categories); },
      getOverride: () => this.override,
      finalizeRegistration: () => {
        this.installCustomHandlers();
        this.assertNoTaskTools();
        this.onTierStateChange?.(this.controller);
      },
      activateCategory: () => {},
      enableTierCategory: () => {},
      enableAllTiers: () => {
        this.override = 'full';
        this.onTierStateChange?.(this.controller);
      },
      setOverride: (override: ToolTierOverride) => {
        this.override = override;
        this.onTierStateChange?.(this.controller);
      },
      getActivatedCategoryTiers: () => new Map(Array.from(this.categories).map((category) => [category, 1 as ToolTier])),
      getRegisteredTools: () => this.toolHandles,
    };

    const thisRuntime = this;
    this.surface = {
      tool: ((name: string, ...args: any[]) => this.registerLegacyTool(name, ...args)) as McpServer['tool'],
      registerTool: ((name: string, config: any, cb: any) => this.registerStructuredTool(name, config, cb)) as McpServer['registerTool'],
      registerResource: this.targetServer.registerResource.bind(this.targetServer),
      sendToolListChanged: this.targetServer.sendToolListChanged.bind(this.targetServer),
    };
  }

  private gate(name: string): boolean {
    const category = TOOL_CATEGORY[name];
    if (!category) {
      throw new Error(`Tool "${name}" has no entry in TOOL_CATEGORY (config.ts).`);
    }
    if (!this.categories.has(category)) {
      this.skippedCount++;
      return false;
    }
    if (DISCLOSURE_ONLY_TOOLS.has(name) && this.mode !== 'tiered') {
      this.skippedCount++;
      return false;
    }
    this.registeredCount++;
    return true;
  }

  private injectVaultParam(args: any[]): void {
    if (!this.registry?.isMultiVault) return;
    const handlerIdx = args.findIndex((a) => typeof a === 'function');
    if (handlerIdx <= 0) return;
    const schemaIdx = handlerIdx - 1;
    const schema = args[schemaIdx];
    if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
      schema.vault = z.string().optional().describe(
        `Vault name for multi-vault mode. Available: ${this.registry.getVaultNames().join(', ')}. Default: ${this.registry.primaryName}`,
      );
    }
  }

  private wrapWithIntegrityGate(toolName: string, handler: (...args: any[]) => any): (...args: any[]) => any {
    if (!MUTATING_TOOL_NAMES.has(toolName)) return handler;
    return async (...args: any[]) => {
      const params = (args[0] && typeof args[0] === 'object') ? args[0] as Record<string, unknown> : undefined;
      const vaultCtx = this.getTargetVaultContext(params);
      const integrityState = vaultCtx?.integrityState ?? getActiveScopeOrNull()?.integrityState;
      if (integrityState === 'failed') {
        throw new Error('StateDb integrity failed; write operations are disabled until recovery/restart.');
      }
      return handler(...args);
    };
  }

  private getTargetVaultContext(params: Record<string, unknown> | undefined): VaultContext | null {
    if (!this.registry) return null;
    if (this.registry.isMultiVault) {
      const vaultName = typeof params?.vault === 'string' ? params.vault : undefined;
      return this.registry.getContext(vaultName);
    }
    return this.registry.getContext();
  }

  private wrapWithVaultActivation(toolName: string, handler: (...args: any[]) => any): (...args: any[]) => any {
    if (!this.registry?.isMultiVault || !this.vaultCallbacks) return handler;
    return async (...args: any[]) => {
      const params = args[0];
      const vaultName = params?.vault;
      if (params && 'vault' in params) delete params.vault;
      if ((toolName === 'search' || toolName === 'find_notes') && !vaultName) {
        return this.crossVaultSearch(handler, args);
      }
      const ctx = this.registry!.getContext(vaultName);
      this.vaultCallbacks!.activateVault(ctx);
      return runInVaultScope(this.vaultCallbacks!.buildVaultScope(ctx), () => handler(...args));
    };
  }

  private async crossVaultSearch(
    handler: (...args: any[]) => any,
    args: any[],
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const perVault: Array<{ vault: string; data: any }> = [];
    const callerConsumer: string = args[0]?.consumer ?? 'llm';
    const crossArgs = [{ ...args[0], consumer: 'human' }, ...args.slice(1)];

    for (const ctx of this.registry!.getAllContexts()) {
      this.vaultCallbacks!.activateVault(ctx);
      try {
        const result = await runInVaultScope(this.vaultCallbacks!.buildVaultScope(ctx), () => handler(...crossArgs));
        const text = result?.content?.[0]?.text;
        if (text) perVault.push({ vault: ctx.name, data: JSON.parse(text) });
      } catch {
        // Skip vaults that error during search.
      }
    }

    const mergedResults: any[] = [];
    const mergedEntities: any[] = [];
    const mergedMemories: any[] = [];
    const vaultsSearched: string[] = [];
    let query: string | undefined;

    for (const { vault, data } of perVault) {
      vaultsSearched.push(vault);
      if (data.query) query = data.query;
      if (data.error || data.building) continue;
      for (const item of data.results || data.notes || []) mergedResults.push({ vault, ...item });
      if (Array.isArray(data.entities)) for (const item of data.entities) mergedEntities.push({ vault, ...item });
      if (Array.isArray(data.memories)) for (const item of data.memories) mergedMemories.push({ vault, ...item });
    }

    if (mergedResults.some((r) => r.rrf_score != null)) {
      mergedResults.sort((a, b) => (b.rrf_score ?? 0) - (a.rrf_score ?? 0));
    }

    const limit = args[0]?.limit ?? 10;
    const truncated = mergedResults.slice(0, limit);
    if (callerConsumer === 'llm') {
      const { applySandwichOrdering } = await import('./tools/read/query.js');
      applySandwichOrdering(truncated);
      for (const result of truncated) {
        delete result.rrf_score;
        delete result.in_fts5;
        delete result.in_semantic;
        delete result.in_entity;
        delete result.graph_boost;
        delete result._combined_score;
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
          ...(mergedEntities.length > 0 ? { entities: mergedEntities.slice(0, limit) } : {}),
          ...(mergedMemories.length > 0 ? { memories: mergedMemories.slice(0, limit) } : {}),
        }, null, 2),
      }],
    };
  }

  private wrapWithTracking(toolName: string, handler: (...args: any[]) => any): (...args: any[]) => any {
    return async (...args: any[]) => {
      this.onToolCall?.();
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
        const db = this.getDb();
        if (!db) continueTracking();
        else {
          try {
            let sessionId: string | undefined;
            try { sessionId = getSessionId(); } catch {}

            let responseTokens: number | undefined;
            if (result?.content) {
              let totalChars = 0;
              for (const block of result.content) {
                if (block?.type === 'text' && typeof block.text === 'string') totalChars += block.text.length;
              }
              if (totalChars > 0) responseTokens = Math.ceil(totalChars / 4);
            }

            let baselineTokens: number | undefined;
            if (notePaths && notePaths.length > 0 && this.getVaultPath) {
              const vp = this.getVaultPath();
              let totalBytes = 0;
              for (const p of notePaths) {
                try { totalBytes += statSync(path.join(vp, p)).size; } catch {}
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

            if (queryContext) {
              try {
                const misroute = detectMisroute(toolName, queryContext);
                if (misroute) recordHeuristicMisroute(db, invocationId, misroute);
              } catch {}
            }
          } catch {}
        }

        function continueTracking() {
          return;
        }
      }
    };
  }

  private normalizeLegacyToolArgs(args: any[]): any[] {
    this.injectVaultParam(args);
    if (args.length > 0 && typeof args[args.length - 1] === 'function') {
      let handler = args[args.length - 1];
      handler = this.wrapWithVaultActivation(String(args[0] ?? ''), handler);
      handler = this.wrapWithIntegrityGate(String(args[0] ?? ''), handler);
      args[args.length - 1] = this.wrapWithTracking(String(args[0] ?? ''), handler);
    }
    return args;
  }

  private registerLegacyTool(name: string, ...args: any[]): RegisteredTool | undefined {
    if (!this.gate(name)) return undefined;
    this.injectVaultParam(args);
    if (args.length > 0 && typeof args[args.length - 1] === 'function') {
      let handler = args[args.length - 1];
      handler = this.wrapWithVaultActivation(name, handler);
      handler = this.wrapWithIntegrityGate(name, handler);
      args[args.length - 1] = this.wrapWithTracking(name, handler);
    }
    const registered = (this.targetServer.tool as any)(name, ...args) as RegisteredTool;
    this.toolHandles.set(name, registered);
    return registered;
  }

  private registerStructuredTool(name: string, config: any, cb: any): RegisteredTool | undefined {
    if (!this.gate(name)) return undefined;
    const wrappedConfig = config ? { ...config } : {};
    if (wrappedConfig.inputSchema && typeof wrappedConfig.inputSchema === 'object') {
      wrappedConfig.inputSchema = { ...wrappedConfig.inputSchema };
    }
    const args: any[] = [wrappedConfig, cb];
    this.injectVaultParam(args);
    let handler = args[1];
    handler = this.wrapWithVaultActivation(name, handler);
    handler = this.wrapWithIntegrityGate(name, handler);
    handler = this.wrapWithTracking(name, handler);
    const registered = this.targetServer.registerTool(name, args[0], handler);
    this.toolHandles.set(name, registered);
    return registered;
  }

  private assertNoTaskTools(): void {
    for (const [name, tool] of this.toolHandles) {
      const taskSupport = tool.execution?.taskSupport;
      if (taskSupport && taskSupport !== 'forbidden') {
        throw new Error(`Tool ${name} uses taskSupport '${taskSupport}', which is unsupported in Flywheel's custom dispatcher.`);
      }
      if ('createTask' in tool.handler) {
        throw new Error(`Tool ${name} registered a task handler, which is unsupported in Flywheel's custom dispatcher.`);
      }
    }
  }

  private async validateToolInput(tool: RegisteredTool, args: unknown, toolName: string): Promise<unknown> {
    if (!tool.inputSchema) return undefined;
    const inputObj = normalizeObjectSchema(tool.inputSchema);
    const schemaToParse = inputObj ?? tool.inputSchema;
    const parseResult = await safeParseAsync(schemaToParse, args);
    if (!parseResult.success) {
      const errorMessage = getParseErrorMessage('error' in parseResult ? parseResult.error : 'Unknown error');
      throw new McpError(ErrorCode.InvalidParams, `Input validation error: Invalid arguments for tool ${toolName}: ${errorMessage}`);
    }
    return parseResult.data;
  }

  private async validateToolOutput(tool: RegisteredTool, result: any, toolName: string): Promise<void> {
    if (!tool.outputSchema || !('content' in result) || result.isError) return;
    if (!result.structuredContent) {
      throw new McpError(ErrorCode.InvalidParams, `Output validation error: Tool ${toolName} has an output schema but no structured content was provided`);
    }
    const outputObj = normalizeObjectSchema(tool.outputSchema);
    const schemaToParse = outputObj ?? tool.outputSchema;
    const parseResult = await safeParseAsync(schemaToParse, result.structuredContent);
    if (!parseResult.success) {
      const errorMessage = getParseErrorMessage('error' in parseResult ? parseResult.error : 'Unknown error');
      throw new McpError(ErrorCode.InvalidParams, `Output validation error: Invalid structured content for tool ${toolName}: ${errorMessage}`);
    }
  }

  private async executeToolHandler(tool: RegisteredTool, args: unknown, extra: any): Promise<any> {
    const handler = tool.handler as any;
    if ('createTask' in handler) {
      throw new McpError(ErrorCode.InternalError, 'Task handlers are unsupported in Flywheel custom dispatch');
    }
    if (tool.inputSchema) {
      return await handler(args, extra);
    }
    return await handler(extra);
  }

  private installCustomHandlers(): void {
    this.targetServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Array.from(this.toolHandles.entries())
        .filter(([, tool]) => tool.enabled)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, tool]) => {
          const definition: Record<string, unknown> = {
            name,
            title: tool.title,
            description: tool.description,
            inputSchema: toJsonSchema(tool.inputSchema, 'input'),
            annotations: tool.annotations,
            execution: tool.execution,
            _meta: tool._meta,
          };
          if (tool.outputSchema) {
            definition.outputSchema = toJsonSchema(tool.outputSchema, 'output');
          }
          return definition;
        }),
    }));

    this.targetServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try {
        const tool = this.toolHandles.get(request.params.name);
        if (!tool) {
          throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
        }
        if (!tool.enabled) {
          throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} disabled`);
        }
        if (request.params.task) {
          throw new McpError(ErrorCode.MethodNotFound, `Tool ${request.params.name} does not support task augmentation`);
        }
        const args = await this.validateToolInput(tool, request.params.arguments, request.params.name);
        const result = await this.executeToolHandler(tool, args, extra);
        await this.validateToolOutput(tool, result, request.params.name);
        return result;
      } catch (error) {
        if (error instanceof McpError && error.code === ErrorCode.UrlElicitationRequired) throw error;
        return createToolError(error instanceof Error ? error.message : String(error));
      }
    });
  }
}

function getRuntime(controller?: ToolTierController | null): FlywheelToolRuntime | null {
  return controller ? ((controller as any)[RUNTIME] ?? null) : null;
}

export function applyToolGating(
  targetServer: McpServer,
  categories: Set<ToolCategory>,
  getDb: () => StateDb | null,
  registry?: VaultRegistry | null,
  getVaultPath?: () => string,
  vaultCallbacks?: VaultActivationCallbacks,
  tierMode: ToolTierMode = 'off',
  onTierStateChange?: (controller: ToolTierController) => void,
  _isFullToolset: boolean = false,
  onToolCall?: () => void,
): ToolTierController {
  const runtime = new FlywheelToolRuntime(
    targetServer,
    categories,
    getDb,
    registry,
    getVaultPath,
    vaultCallbacks,
    tierMode,
    onTierStateChange,
    onToolCall,
  );
  (runtime.controller as any)[RUNTIME] = runtime;
  return runtime.controller;
}

export interface RegisterAllToolsOptions {
  applyClientSuppressions?: boolean;
}

export function registerAllTools(
  targetServer: McpServer,
  ctx: ToolRegistryContext,
  controller?: ToolTierController | null,
  options: RegisterAllToolsOptions = {},
): void {
  const runtime = getRuntime(controller);
  const surface = runtime?.surface ?? targetServer as unknown as ToolRegistrationSurface;
  const { applyClientSuppressions = true } = options;
  const { getVaultPath: gvp, getVaultIndex: gvi, getStateDb: gsd, getFlywheelConfig: gcf } = ctx;

  registerHealthTools(surface as any, gvi, gvp, gcf, gsd, ctx.getWatcherStatus, () => trPkg.version, ctx.getPipelineActivity, ctx.getVaultRuntimeState, (newConfig) => { ctx.updateFlywheelConfig(newConfig); });
  registerReadSystemTools(surface as any, gvi, (newIndex) => { ctx.updateVaultIndex(newIndex); }, gvp, (newConfig) => { ctx.updateFlywheelConfig(newConfig); }, gsd);
  registerQueryTools(surface as any, gvi, gvp, gsd);
  registerFindNotesTools(surface as any, gvi, gsd);
  registerPrimitiveTools(surface as any, gvi, gvp, gcf, gsd);
  registerSchemaTools(surface as any, gvi, gvp);
  registerGraphTools2(surface as any, gvi, gvp, gsd);
  registerInsightsTools(surface as any, gvi, gvp, gsd, gcf);

  registerTaskTools(surface as any, gvp);
  registerFrontmatterTools(surface as any, gvp);
  registerPolicyTools(surface as any, gvp, () => {
    const index = gvi();
    if (!index) return undefined;
    return ({ query, folder, where, limit = 10 }: { query?: string; folder?: string; where?: Record<string, unknown>; limit?: number }) => {
      let notes = Array.from(index.notes.values());
      if (folder) {
        const normalizedFolder = folder.endsWith('/') ? folder : `${folder}/`;
        notes = notes.filter((n) => n.path.startsWith(normalizedFolder) || n.path.split('/')[0] === folder.replace('/', ''));
      }
      if (where) {
        notes = notes.filter((n) => {
          for (const [key, value] of Object.entries(where)) {
            const noteValue = n.frontmatter[key];
            if (Array.isArray(value)) {
              if (!value.some((v) => String(noteValue).toLowerCase() === String(v).toLowerCase())) return false;
            } else if (value !== undefined && String(noteValue ?? '').toLowerCase() !== String(value).toLowerCase()) {
              return false;
            }
          }
          return true;
        });
      }
      return notes.slice(0, limit).map((n) => ({
        path: n.path,
        title: n.title,
        frontmatter: n.frontmatter,
        snippet: undefined,
      }));
    };
  });

  registerSemanticTools(surface as any, gvp, gsd);

  const suppressMemoryForClaude =
    applyClientSuppressions &&
    process.env.CLAUDECODE === '1' &&
    process.env.FW_ENABLE_MEMORY_FOR_CLAUDE !== '1';
  if (!suppressMemoryForClaude) {
    registerMemoryTools(surface as any, gsd);
  }

  registerNoteTool(surface as any, gvp, gvi);
  registerLinkTool(surface as any, gvi, gvp, gsd);
  registerCorrectTool(surface as any, gsd, gvp);
  registerEntityTool(surface as any, gvp, gsd, gvi);
  registerEditSectionTool(surface as any, gvp, gcf);

  if (controller?.mode === 'tiered') {
    registerDiscoveryTools(surface as any, controller);
  }

  registerVaultResources(surface as any, () => gvi() ?? null);
}
