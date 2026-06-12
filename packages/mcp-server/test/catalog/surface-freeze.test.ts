/**
 * Surface Freeze Test (arch-review S0)
 *
 * Pins the COMPLETE registered tool surface — name, category, tier,
 * description, and full input JSON schema — against a committed fixture.
 *
 * Rationale: the existing catalog descriptionHash (toolCatalog.ts) covers
 * description text only; a zod schema change would slip through it. The
 * arch-review refactor slices (G2 plan, bar B5) must be schema-diff-clean,
 * so this test serializes every tool's full input schema via zod-to-json-schema
 * and compares against test/catalog/__fixtures__/tool-surface.json.
 *
 * Regenerate (only when an intentional surface change ships, outside the
 * arch-review): FW_UPDATE_SURFACE=1 npx vitest run test/catalog/surface-freeze.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_CATEGORY, TOOL_TIER } from '../../src/config.js';
import { registerAllTools, type ToolRegistryContext, type ToolTierController } from '../../src/tool-registry.js';

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'tool-surface.json');

interface SurfaceEntry {
  name: string;
  category: string;
  tier: number;
  title?: string;
  description: string;
  inputSchema: unknown;
}

/** Capture server recording name, description, and the raw zod shape per tool. */
function createSchemaCaptureServer(): {
  server: McpServer;
  captured: Map<string, { description: string; title?: string; shape: Record<string, z.ZodTypeAny> }>;
} {
  const captured = new Map<string, { description: string; title?: string; shape: Record<string, z.ZodTypeAny> }>();

  const server = {
    // server.tool(name, description?, schemaShape, handler)
    tool(name: string, ...args: unknown[]) {
      const description = (args.find((a) => typeof a === 'string') as string) ?? '';
      const handlerIdx = args.findIndex((a) => typeof a === 'function');
      const shape = (handlerIdx > 0 ? args[handlerIdx - 1] : undefined) as
        | Record<string, z.ZodTypeAny>
        | undefined;
      captured.set(name, { description, shape: shape ?? {} });
      return { enabled: true };
    },
    // server.registerTool(name, { title?, description, inputSchema }, handler)
    registerTool(name: string, descriptor: Record<string, unknown>, ..._rest: unknown[]) {
      captured.set(name, {
        description: typeof descriptor?.description === 'string' ? descriptor.description : '',
        title: typeof descriptor?.title === 'string' ? descriptor.title : undefined,
        shape: (descriptor?.inputSchema ?? {}) as Record<string, z.ZodTypeAny>,
      });
      return { enabled: true };
    },
    registerResource(..._args: unknown[]) { return undefined; },
    registerResourceTemplate(..._args: unknown[]) { return undefined; },
  } as unknown as McpServer;

  return { server, captured };
}

function createStubContext(): ToolRegistryContext {
  return {
    getVaultPath: () => '/stub',
    getVaultIndex: () => ({ notes: new Map(), entities: new Map(), aliases: new Map() }) as any,
    getStateDb: () => null,
    getFlywheelConfig: () => ({}) as any,
    getWatcherStatus: () => null,
    getPipelineActivity: () => null,
    getVaultRuntimeState: () => ({
      bootState: 'ready',
      integrityState: 'healthy',
      integrityCheckInProgress: false,
      integrityStartedAt: null,
      integritySource: null,
      lastIntegrityCheckedAt: null,
      lastIntegrityDurationMs: null,
      lastIntegrityDetail: null,
      lastBackupAt: null,
    }),
    updateVaultIndex: () => {},
    updateFlywheelConfig: () => {},
  };
}

function createStubController(): ToolTierController {
  return {
    mode: 'tiered',
    registered: 0,
    skipped: 0,
    activeCategories: new Set(),
    getOverride: () => 'auto',
    finalizeRegistration: () => {},
    activateCategory: () => {},
    enableTierCategory: () => {},
    enableAllTiers: () => {},
    setOverride: () => {},
    getActivatedCategoryTiers: () => new Map(),
    getRegisteredTools: () => new Map(),
  };
}

function collectSurface(): SurfaceEntry[] {
  const { server, captured } = createSchemaCaptureServer();
  registerAllTools(server, createStubContext(), createStubController(), {
    applyClientSuppressions: false,
  });

  const entries: SurfaceEntry[] = [];
  for (const [name, { description, title, shape }] of captured) {
    const category = TOOL_CATEGORY[name];
    const tier = TOOL_TIER[name];
    expect(category, `tool "${name}" missing TOOL_CATEGORY entry`).toBeDefined();
    expect(tier, `tool "${name}" missing TOOL_TIER entry`).toBeDefined();
    entries.push({
      name,
      category,
      tier,
      ...(title !== undefined ? { title } : {}),
      description,
      // $refStrategy none → fully inlined, deterministic output
      inputSchema: zodToJsonSchema(z.object(shape), { $refStrategy: 'none' }),
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

describe('Tool surface freeze (arch-review S0)', () => {
  it('registered tool surface matches the committed snapshot exactly', () => {
    const surface = collectSurface();

    if (process.env.FW_UPDATE_SURFACE === '1') {
      mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
      writeFileSync(FIXTURE_PATH, JSON.stringify(surface, null, 2) + '\n');
    }

    expect(
      existsSync(FIXTURE_PATH),
      'tool-surface.json fixture missing — generate with FW_UPDATE_SURFACE=1'
    ).toBe(true);

    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as SurfaceEntry[];

    // Compare names first for a readable failure on add/remove
    expect(surface.map((e) => e.name)).toEqual(fixture.map((e) => e.name));
    // Then the full surface (schemas included)
    expect(surface).toEqual(fixture);
  });

  it('surface covers exactly the TOOL_CATEGORY tool list', () => {
    const surface = collectSurface();
    const expected = Object.keys(TOOL_CATEGORY).sort();
    // discover_tools only registers in tiered mode via registerDiscoveryTools —
    // stub controller reports mode 'tiered', so the full surface is present.
    expect(surface.map((e) => e.name)).toEqual(expected);
  });
});
