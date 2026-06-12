/**
 * Server factory + HTTP McpServer pool (arch-review S10 — extracted verbatim
 * from index.ts).
 *
 * Owns the resolved tool configuration (resolveToolConfig at module load —
 * same process phase as before: before main() runs), createConfiguredServer
 * for per-request HTTP servers, and the HTTP server pool.
 *
 * The IMPORT-TIME stdio server construction stays in index.ts (observable
 * timing: initialize-freeze snapshots + D4 pin) — it consumes the exports
 * below.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  resolveToolConfig,
  type ToolCategory,
} from './../config.js';
import { generateInstructions } from './../instructions.js';
import {
  applyToolGating,
  registerAllTools,
  type ToolTierMode,
} from './../tool-registry.js';
import { serverLog } from './../core/shared/serverLog.js';
import { pkg, vaultRegistry, setLastMcpRequestAt } from './state.js';
import { buildRegistryContext, buildVaultCallbacks } from './registryContext.js';

export const toolConfig = resolveToolConfig();
export const enabledCategories = toolConfig.categories;
export const toolTierMode: ToolTierMode = toolConfig.enableProgressiveDisclosure ? 'tiered' : 'off';

export function getInstructionActiveCategories(): Set<ToolCategory> | undefined {
  return toolConfig.enableProgressiveDisclosure ? new Set(enabledCategories) : undefined;
}

/**
 * Create a fully configured McpServer with tool gating and all tools registered.
 * Used by HTTP transport to create per-request servers.
 */
export function createConfiguredServer(): McpServer {
  const s = new McpServer(
    { name: 'flywheel-memory', version: pkg.version },
    { instructions: generateInstructions(enabledCategories, vaultRegistry, getInstructionActiveCategories()) },
  );
  const ctx = buildRegistryContext();
  const toolTierController = applyToolGating(
    s,
    enabledCategories,
    ctx.getStateDb,
    vaultRegistry,
    ctx.getVaultPath,
    buildVaultCallbacks(),
    toolTierMode,
    undefined,
    toolConfig.isFullToolset,
    () => { setLastMcpRequestAt(Date.now()); },
  );
  registerAllTools(s, ctx, toolTierController);
  toolTierController.finalizeRegistration();
  return s;
}

// ============================================================================
// HTTP McpServer Pool
// ============================================================================

export const HTTP_POOL_SIZE = 4;
export const httpServerPool: McpServer[] = [];
export let httpRequestCount = 0;
export let httpServerCreateCount = 0;
export let httpServerReuseCount = 0;
export let httpServerDiscardCount = 0;

export function incrementHttpRequestCount(): void {
  httpRequestCount++;
}

export function acquireHttpServer(): McpServer {
  const pooled = httpServerPool.pop();
  if (pooled) {
    httpServerReuseCount++;
    return pooled;
  }
  httpServerCreateCount++;
  return createConfiguredServer();
}

export function releaseHttpServer(s: McpServer): void {
  if (httpServerPool.length < HTTP_POOL_SIZE) {
    httpServerPool.push(s);
  }
  // else silently discard — pool is full
}

export function discardHttpServer(_s: McpServer): void {
  httpServerDiscardCount++;
  // Do not requeue — instance may be in a bad state
}

/** Invalidate all pooled servers (e.g. after secondary vault registration). */
export function invalidateHttpPool(): void {
  const count = httpServerPool.length;
  httpServerPool.length = 0;
  if (count > 0) {
    serverLog('http', `Pool invalidated: discarded ${count} cached server(s)`);
  }
}
