/**
 * Tool Catalog Collector
 *
 * Builds a canonical catalog of all tool metadata by registering all tools
 * against a synthetic capture server. Used by the manifest generator and
 * contract tests — never called at runtime.
 */

import crypto from 'crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_CATEGORY, TOOL_TIER, type ToolCategory, type ToolTier } from '../config.js';
import { registerAllTools, type ToolRegistryContext } from '../tool-registry.js';

export interface CatalogEntry {
  name: string;
  description: string;      // normalized: trimmed, whitespace-collapsed
  rawDescription: string;   // original description string, for validation only
  category: ToolCategory;
  tier: ToolTier;
  descriptionHash: string;  // sha256 of normalized description, first 16 chars
}

/** Normalize a description: trim and collapse internal whitespace. */
function normalizeDescription(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** SHA-256 hash of a string, first 16 hex chars. */
function hashDescription(normalized: string): string {
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Create a synthetic capture server that records tool registrations
 * without executing any handlers.
 */
function createCaptureServer(): { server: McpServer; captured: Map<string, string> } {
  const captured = new Map<string, string>();

  const server = {
    // server.tool(name, description, schema, handler) — description is 2nd arg (string)
    // server.tool(name, schema, handler) — no description string
    tool(name: string, ...args: unknown[]) {
      // Find the description string — it's the first string arg after name
      const descArg = args.find((a) => typeof a === 'string');
      if (typeof descArg === 'string') {
        captured.set(name, descArg);
      }
      // Return a fake RegisteredTool handle
      return { enabled: true };
    },

    // server.registerTool(name, { description, ... }, handler)
    registerTool(name: string, descriptor: unknown, ..._rest: unknown[]) {
      if (descriptor && typeof descriptor === 'object' && 'description' in descriptor) {
        const desc = (descriptor as { description: string }).description;
        if (typeof desc === 'string') {
          captured.set(name, desc);
        }
      }
      return { enabled: true };
    },

    // No-op for resources
    registerResource(..._args: unknown[]) {
      return undefined;
    },

    // No-op for resource templates
    registerResourceTemplate(..._args: unknown[]) {
      return undefined;
    },
  } as unknown as McpServer;

  return { server, captured };
}

/**
 * Create stub context for registerAllTools().
 * All getters return minimal stubs — handlers are never executed during collection.
 */
function createStubContext(): ToolRegistryContext {
  return {
    getVaultPath: () => '/stub',
    getVaultIndex: () => ({ notes: new Map(), entities: new Map(), aliases: new Map() }) as any,
    getStateDb: () => null,
    getFlywheelConfig: () => ({}) as any,
    getWatcherStatus: () => null,
    getPipelineActivity: () => null,
    updateVaultIndex: () => {},
    updateFlywheelConfig: () => {},
  };
}

/**
 * Collect the live tool catalog by registering all tools against a synthetic
 * capture server. Does not mutate any global state.
 *
 * @throws Error if a captured tool is missing from TOOL_CATEGORY or TOOL_TIER
 */
export function collectToolCatalog(): Map<string, CatalogEntry> {
  const { server, captured } = createCaptureServer();
  const ctx = createStubContext();

  registerAllTools(server, ctx);

  const catalog = new Map<string, CatalogEntry>();
  const missingCategory: string[] = [];
  const missingTier: string[] = [];

  for (const [name, rawDescription] of captured) {
    const category = TOOL_CATEGORY[name];
    const tier = TOOL_TIER[name];

    if (!category) missingCategory.push(name);
    if (!tier) missingTier.push(name);
    if (!category || !tier) continue;

    const description = normalizeDescription(rawDescription);
    catalog.set(name, {
      rawDescription,
      name,
      description,
      category,
      tier,
      descriptionHash: hashDescription(description),
    });
  }

  if (missingCategory.length > 0 || missingTier.length > 0) {
    const parts: string[] = [];
    if (missingCategory.length > 0) {
      parts.push(`Tools missing TOOL_CATEGORY: ${missingCategory.join(', ')}`);
    }
    if (missingTier.length > 0) {
      parts.push(`Tools missing TOOL_TIER: ${missingTier.join(', ')}`);
    }
    throw new Error(`Tool catalog collection failed: ${parts.join('. ')}`);
  }

  return catalog;
}

/**
 * Stable hash of all catalog entries sorted by name.
 * Used to skip manifest regeneration when descriptions haven't changed.
 */
export function getCatalogSourceHash(catalog: Map<string, CatalogEntry>): string {
  const sorted = Array.from(catalog.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => `${e.name}:${e.category}:${e.tier}:${e.descriptionHash}`)
    .join('\n');

  return crypto.createHash('sha256').update(sorted).digest('hex').slice(0, 16);
}
