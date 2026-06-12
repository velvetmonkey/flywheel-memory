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
 *   1. the IMPORT-TIME stdio McpServer construction + tool gating +
 *      registration — this runs at module load with vaultRegistry=null,
 *      which is OBSERVABLE (initialize-freeze snapshots; known defect D4
 *      pinned by cross-vault-isolation tests) and must not move into main();
 *   2. main(), which sequences the boot phases via the boot/ modules.
 * Nothing may import this file (arch ratchet B3).
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { generateInstructions } from './config.js';
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
// Primary Server Instance (stdio transport)
// ============================================================================
// Constructed at MODULE LOAD, before main() runs: vaultRegistry is still null
// here, so instructions lack the multi-vault section and gating sees
// isMultiVault=false (defect D4 — pinned, do not "fix" by moving this block).

const server = new McpServer(
  { name: 'flywheel-memory', version: pkg.version },
  { instructions: generateInstructions(enabledCategories, vaultRegistry, getInstructionActiveCategories()) },
);

const _registryCtx = buildRegistryContext();
const _gatingResult = applyToolGating(
  server,
  enabledCategories,
  _registryCtx.getStateDb,
  vaultRegistry,
  _registryCtx.getVaultPath,
  buildVaultCallbacks(),
  toolTierMode,
  undefined,
  toolConfig.isFullToolset,
  () => { setLastMcpRequestAt(Date.now()); },
);
registerAllTools(server, _registryCtx, _gatingResult);
_gatingResult.finalizeRegistration();

const categoryList = Array.from(enabledCategories).sort().join(', ');
serverLog('server', `Tool categories: ${categoryList}`);
serverLog('server', `Registered ${_gatingResult.registered} tools, skipped ${_gatingResult.skipped}`);

// ============================================================================
// Main Entry Point — sequences the boot phases (see src/boot/)
// ============================================================================

async function main() {
  // Phase 0: resolve + validate vault path (at startup, not import time)
  const { vaultConfigs, startTime } = resolveVaultEnvironment();
  // Phase 1: initialize primary vault (StateDb only — fast)
  await initializePrimaryVault(vaultConfigs, startTime);
  // Phase 1b/1c: tool routing manifest + effectiveness snapshots
  await loadToolRoutingState(startTime);
  // Phase 2: connect transports BEFORE heavy work
  const transportMode = await connectTransports(server, startTime);
  // Phase 3: integrity kick + co-occurrence + primary vault boot
  await bootPrimaryVault(startTime);
  // Optional watchdog self-ping
  await startWatchdog(transportMode);
  // Phase 4: secondary vaults boot in background
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
