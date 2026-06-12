#!/usr/bin/env node
/**
 * Flywheel Memory - MCP tools that search, write, and auto-link your Obsidian vault — and learn from your edits.
 *
 * 66 declared tools across 12 categories (see TOTAL_TOOL_COUNT in config.ts)
 * - policy (unified: list, validate, preview, execute, author, revise)
 * - Temporal tools absorbed into search (modified_after/modified_before) + get_vault_stats (recent_activity)
 * - Dropped: policy_diff, policy_export, policy_import, get_contemporaneous_notes
 * - graph_analysis (7 modes: orphans, dead_ends, sources, hubs, stale, immature, emerging_hubs)
 * - semantic_analysis (extracted: clusters, bridges)
 * - vault_schema (4 modes: overview, field_values, inconsistencies, contradictions)
 * - schema_conventions (extracted: conventions, incomplete, suggest_values)
 * - schema_validate (extracted: validate, missing)
 * - note_intelligence (unified: prose_patterns, suggest_frontmatter, wikilinks, compute, semantic_links)
 * - validate_links (absorbed find_broken_links via typos_only param)
 *
 * COMPOSITION ROOT (arch-review S10): this file owns only
 *   1. buildStdioServer() — stdio McpServer construction + tool gating +
 *      registration;
 *   2. main(), which sequences the boot phases via the boot/ modules.
 *
 * D4 FIX (arch-review G3 close-out): the stdio server is now built INSIDE
 * main(), after the registry's full membership is established (primary +
 * registerSecondaryVaults), so multi-vault gating injects the `vault` param +
 * activation wrapper — stdio multi-vault routing is live, mirroring the HTTP
 * per-request path. Previously this ran at module load with vaultRegistry=null,
 * which made multi-vault routing silently dead (writes to a named secondary
 * vault landed in the primary). The single-vault initialize payload is
 * unchanged (a one-context registry is !isMultiVault, so generateInstructions
 * emits no multi-vault section); the multi-vault initialize payload changes
 * deliberately (gains the multi-vault section + per-tool `vault` param) and its
 * freeze fixture (initialize.multi.json) was re-frozen with this commit.
 *
 * Nothing may import this file (arch ratchet B3).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { generateInstructions } from './instructions.js';
import { applyToolGating, registerAllTools } from './tool-registry.js';
import { serverLog } from './core/shared/serverLog.js';

import { setPkg, setLastMcpRequestAt, vaultRegistry } from './boot/state.js';
import { buildRegistryContext, buildVaultCallbacks } from './boot/registryContext.js';
import {
  toolConfig,
  enabledCategories,
  toolTierMode,
  getInstructionActiveCategories,
} from './boot/serverFactory.js';
import {
  resolveVaultEnvironment,
  initializePrimaryVault,
  registerSecondaryVaults,
  loadToolRoutingState,
  bootPrimaryVault,
  bootSecondaryVaultsInBackground,
} from './boot/vaultBoot.js';
import { connectTransports, startWatchdog } from './boot/transport.js';
import { runInitSemanticCli } from './boot/cli.js';
import { installShutdownHandlers } from './boot/shutdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
setPkg(pkg);

// ============================================================================
// Stdio Server construction (built in main(), after registry membership)
// ============================================================================
// Constructed AFTER the registry knows all vaults (D4 fix), so multi-vault
// gating injects the `vault` param + activation wrapper. generateInstructions
// and applyToolGating read the live vaultRegistry binding at call time.

function buildStdioServer(): McpServer {
  const server = new McpServer(
    { name: 'flywheel-memory', version: pkg.version },
    { instructions: generateInstructions(enabledCategories, vaultRegistry, getInstructionActiveCategories()) },
  );

  const registryCtx = buildRegistryContext();
  const gatingResult = applyToolGating(
    server,
    enabledCategories,
    registryCtx.getStateDb,
    vaultRegistry,
    registryCtx.getVaultPath,
    buildVaultCallbacks(),
    toolTierMode,
    undefined,
    toolConfig.isFullToolset,
    () => { setLastMcpRequestAt(Date.now()); },
  );
  registerAllTools(server, registryCtx, gatingResult);
  gatingResult.finalizeRegistration();

  const categoryList = Array.from(enabledCategories).sort().join(', ');
  serverLog('server', `Tool categories: ${categoryList}`);
  serverLog('server', `Registered ${gatingResult.registered} tools, skipped ${gatingResult.skipped}`);

  return server;
}

// ============================================================================
// Main Entry Point — sequences the boot phases (see src/boot/)
// ============================================================================

async function main() {
  // Phase 0: resolve + validate vault path (at startup, not import time)
  const { vaultConfigs, startTime } = resolveVaultEnvironment();
  // Phase 1: initialize primary vault (StateDb only — fast)
  await initializePrimaryVault(vaultConfigs, startTime);
  // Phase 1a (D4 fix): register secondary vault contexts (StateDb only) so the
  // registry membership is complete before the stdio server is gated below.
  await registerSecondaryVaults(vaultConfigs, startTime);
  // Phase 1b/1c: tool routing manifest + effectiveness snapshots
  await loadToolRoutingState(startTime);
  // Build + gate the stdio server with the now-complete registry (D4 fix).
  const server = buildStdioServer();
  // Phase 2: connect transports BEFORE heavy work
  const transportMode = await connectTransports(server, startTime);
  // Phase 3: integrity kick + co-occurrence + primary vault boot
  await bootPrimaryVault(startTime);
  // Optional watchdog self-ping
  await startWatchdog(transportMode);
  // Phase 4: secondary vaults boot (index build) in background
  bootSecondaryVaultsInBackground(vaultConfigs, startTime);
}

if (process.argv.includes('--init-semantic')) {
  runInitSemanticCli();
} else {
  main().catch((error) => {
    console.error('[Memory] Fatal error:', error);
    process.exit(1);
  });
}

installShutdownHandlers();
