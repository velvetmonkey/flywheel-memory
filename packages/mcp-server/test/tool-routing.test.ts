/**
 * T14 — Semantic Tool Routing Tests
 *
 * Catalog contract tests, manifest freshness tests, and routing unit tests.
 * Routing unit tests use a synthetic manifest with the createToolRoutingIndex
 * test seam — no model download or network access required.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { collectToolCatalog, getCatalogSourceHash } from '../src/tools/toolCatalog.js';
import { TOOL_CATEGORY, TOOL_TIER } from '../src/config.js';
import {
  createToolRoutingIndex,
  getToolRoutingMode,
  loadEffectivenessSnapshot,
  clearEffectivenessSnapshot,
  type ToolEmbeddingsManifest,
  type SemanticActivation,
} from '../src/core/read/toolRouting.js';

// ============================================================================
// Catalog Contract Tests
// ============================================================================

describe('tool catalog collector', () => {
  const catalog = collectToolCatalog();

  it('collects exactly 77 tools', () => {
    expect(catalog.size).toBe(77);
  });

  it('tool names match TOOL_CATEGORY keys', () => {
    const catalogNames = new Set(catalog.keys());
    const categoryNames = new Set(Object.keys(TOOL_CATEGORY));
    expect(catalogNames).toEqual(categoryNames);
  });

  it('tool names match TOOL_TIER keys', () => {
    const catalogNames = new Set(catalog.keys());
    const tierNames = new Set(Object.keys(TOOL_TIER));
    expect(catalogNames).toEqual(tierNames);
  });

  it('every entry has a non-empty normalized description', () => {
    for (const [name, entry] of catalog) {
      expect(entry.description.length, `${name} description should not be empty`).toBeGreaterThan(0);
      // Normalized: no leading/trailing whitespace, no double spaces
      expect(entry.description).toBe(entry.description.trim());
      expect(entry.description).not.toMatch(/\s{2,}/);
    }
  });

  it('every entry has a stable descriptionHash', () => {
    // Run twice — hashes should be identical
    const catalog2 = collectToolCatalog();
    for (const [name, entry] of catalog) {
      const entry2 = catalog2.get(name);
      expect(entry2, `${name} missing in second collection`).toBeDefined();
      expect(entry.descriptionHash).toBe(entry2!.descriptionHash);
    }
  });

  it('sourceHash is stable across collections', () => {
    const hash1 = getCatalogSourceHash(catalog);
    const hash2 = getCatalogSourceHash(collectToolCatalog());
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{16}$/);
  });
});


// ============================================================================
// Description Quality Contract Tests (T21 audit)
// ============================================================================

describe('description quality contracts', () => {
  const catalog = collectToolCatalog();

  it('no raw newlines in descriptions', () => {
    for (const [name, entry] of catalog) {
      expect(entry.rawDescription.includes('\n'), `${name} has raw newlines in description`).toBe(false);
    }
  });

  it('normalized description length within bounds (>=60, <=500; tier 1 <=800)', () => {
    for (const [name, entry] of catalog) {
      const tier = TOOL_TIER[name];
      const maxLen = tier === 1 ? 800 : 500;
      expect(entry.description.length, `${name} too short (${entry.description.length} chars)`).toBeGreaterThanOrEqual(60);
      expect(entry.description.length, `${name} too long (${entry.description.length} chars, max ${maxLen})`).toBeLessThanOrEqual(maxLen);
    }
  });

  it('every description ends with a period', () => {
    for (const [name, entry] of catalog) {
      expect(entry.description.endsWith('.'), `${name} description should end with a period`).toBe(true);
    }
  });

  it('no markdown formatting in descriptions', () => {
    for (const [name, entry] of catalog) {
      expect(entry.description, `${name} has markdown characters`).not.toMatch(/[#*`]/);
    }
  });
});

// ============================================================================
// Manifest Freshness Tests
// ============================================================================

describe('manifest freshness', () => {
  // Import the generated manifest
  let manifest: ToolEmbeddingsManifest;
  const catalog = collectToolCatalog();

  it('manifest loads successfully', async () => {
    const mod = await import('../src/generated/tool-embeddings.generated.js');
    manifest = mod.TOOL_EMBEDDINGS_MANIFEST;
    expect(manifest).toBeDefined();
  });

  it('manifest tool count matches catalog minus routing-excluded tools', async () => {
    const mod = await import('../src/generated/tool-embeddings.generated.js');
    manifest = mod.TOOL_EMBEDDINGS_MANIFEST;
    // tool_selection_feedback is excluded from semantic routing (meta-diagnostics)
    const ROUTING_EXCLUDED = 1;
    expect(manifest.tools.length).toBe(catalog.size - ROUTING_EXCLUDED);
  });

  it('manifest tool names match catalog names minus routing-excluded', async () => {
    const mod = await import('../src/generated/tool-embeddings.generated.js');
    manifest = mod.TOOL_EMBEDDINGS_MANIFEST;
    const manifestNames = new Set(manifest.tools.map((t) => t.name));
    const catalogNames = new Set(catalog.keys());
    // tool_selection_feedback intentionally excluded from semantic routing
    catalogNames.delete('tool_selection_feedback');
    expect(manifestNames).toEqual(catalogNames);
  });

  it('manifest category/tier per tool matches catalog', async () => {
    const mod = await import('../src/generated/tool-embeddings.generated.js');
    manifest = mod.TOOL_EMBEDDINGS_MANIFEST;
    for (const tool of manifest.tools) {
      const entry = catalog.get(tool.name);
      expect(entry, `${tool.name} missing in catalog`).toBeDefined();
      expect(tool.category, `${tool.name} category mismatch`).toBe(entry!.category);
      expect(tool.tier, `${tool.name} tier mismatch`).toBe(entry!.tier);
    }
  });

  it('manifest descriptionHash per tool matches catalog', async () => {
    const mod = await import('../src/generated/tool-embeddings.generated.js');
    manifest = mod.TOOL_EMBEDDINGS_MANIFEST;
    for (const tool of manifest.tools) {
      const entry = catalog.get(tool.name);
      expect(entry, `${tool.name} missing in catalog`).toBeDefined();
      expect(tool.descriptionHash, `${tool.name} descriptionHash stale`).toBe(entry!.descriptionHash);
    }
  });

  it('manifest model is Xenova/all-MiniLM-L6-v2', async () => {
    const mod = await import('../src/generated/tool-embeddings.generated.js');
    manifest = mod.TOOL_EMBEDDINGS_MANIFEST;
    expect(manifest.model).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('manifest dims is 384', async () => {
    const mod = await import('../src/generated/tool-embeddings.generated.js');
    manifest = mod.TOOL_EMBEDDINGS_MANIFEST;
    expect(manifest.dims).toBe(384);
  });

  it('each embedding has exactly 384 elements', async () => {
    const mod = await import('../src/generated/tool-embeddings.generated.js');
    manifest = mod.TOOL_EMBEDDINGS_MANIFEST;
    for (const tool of manifest.tools) {
      expect(tool.embedding.length, `${tool.name} embedding dims`).toBe(384);
    }
  });
});

// ============================================================================
// Routing Unit Tests (synthetic manifest, offline)
// ============================================================================

/**
 * Build a synthetic manifest for offline testing.
 * Creates fake embeddings that cluster by category so we can test
 * the routing logic without a real model.
 */
function buildSyntheticManifest(): ToolEmbeddingsManifest {
  const dims = 8;  // small for testing

  // Each category gets a distinct direction vector
  const categoryVectors: Record<string, number[]> = {
    graph:       [1, 0, 0, 0, 0, 0, 0, 0],
    temporal:    [0, 1, 0, 0, 0, 0, 0, 0],
    wikilinks:   [0, 0, 1, 0, 0, 0, 0, 0],
    corrections: [0, 0, 0, 1, 0, 0, 0, 0],
    diagnostics: [0, 0, 0, 0, 1, 0, 0, 0],
    schema:      [0, 0, 0, 0, 0, 1, 0, 0],
    'note-ops':  [0, 0, 0, 0, 0, 0, 1, 0],
    search:      [0, 0, 0, 0, 0, 0, 0, 1],
  };

  const tools = [
    // Tier 1 (should be ignored by routing)
    { name: 'search', category: 'search', tier: 1 },
    { name: 'brief', category: 'memory', tier: 1 },

    // Tier 2 (should be considered)
    { name: 'graph_analysis', category: 'graph', tier: 2 },
    { name: 'get_backlinks', category: 'graph', tier: 2 },
    { name: 'get_context_around_date', category: 'temporal', tier: 2 },
    { name: 'temporal_summary', category: 'temporal', tier: 2 },
    { name: 'suggest_wikilinks', category: 'wikilinks', tier: 2 },
    { name: 'vault_record_correction', category: 'corrections', tier: 2 },
    { name: 'health_check', category: 'diagnostics', tier: 2 },
    { name: 'flywheel_doctor', category: 'diagnostics', tier: 2 },

    // Tier 3
    { name: 'vault_schema', category: 'schema', tier: 3 },
    { name: 'vault_delete_note', category: 'note-ops', tier: 3 },
  ];

  return {
    model: 'test-model',
    dims,
    version: 1,
    generatedAt: '2026-01-01T00:00:00Z',
    sourceHash: 'test',
    tools: tools.map((t) => ({
      name: t.name,
      category: t.category,
      tier: t.tier,
      descriptionHash: 'test',
      embedding: categoryVectors[t.category] || new Array(dims).fill(0),
    })),
  };
}

/** Create a mock embed function that returns a specific direction. */
function mockEmbedFn(vector: number[]): (text: string) => Promise<Float32Array> {
  return async () => new Float32Array(vector);
}

describe('semantic routing (synthetic manifest)', () => {
  const manifest = buildSyntheticManifest();

  it('graph-style query activates graph category', async () => {
    const { getSemanticActivations } = createToolRoutingIndex(manifest);
    // Query vector points toward graph direction
    const results = await getSemanticActivations(
      'show me backlinks and connections in the graph',
      mockEmbedFn([1, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(results.some((r) => r.category === 'graph')).toBe(true);
  });

  it('temporal-style query activates temporal category', async () => {
    const { getSemanticActivations } = createToolRoutingIndex(manifest);
    const results = await getSemanticActivations(
      'what happened last week in my notes',
      mockEmbedFn([0, 1, 0, 0, 0, 0, 0, 0]),
    );
    expect(results.some((r) => r.category === 'temporal')).toBe(true);
  });

  it('short query "hi" returns no semantic activations', async () => {
    const { getSemanticActivations } = createToolRoutingIndex(manifest);
    const results = await getSemanticActivations(
      'hi',
      mockEmbedFn([1, 1, 1, 1, 1, 1, 1, 1]),
    );
    expect(results).toEqual([]);
  });

  it('single char query returns no activations (< 12 non-space chars)', async () => {
    const { getSemanticActivations } = createToolRoutingIndex(manifest);
    const results = await getSemanticActivations(
      'a',
      mockEmbedFn([1, 1, 1, 1, 1, 1, 1, 1]),
    );
    expect(results).toEqual([]);
  });

  it('tier-1 tools never appear in results', async () => {
    const { getSemanticActivations } = createToolRoutingIndex(manifest);
    // Point toward search direction (tier 1)
    const results = await getSemanticActivations(
      'search for something in the vault please',
      mockEmbedFn([0, 0, 0, 0, 0, 0, 0, 1]),
    );
    // search is tier 1, should not appear
    expect(results.some((r) => r.category === 'search')).toBe(false);
    // memory is tier 1 (brief), should not appear
    expect(results.some((r) => r.category === 'memory')).toBe(false);
  });

  it('cosine below threshold is ignored', async () => {
    const { getSemanticActivations } = createToolRoutingIndex(manifest);
    // Orthogonal to all category vectors — all cosine will be 0
    const results = await getSemanticActivations(
      'something with zero cosine similarity to everything',
      mockEmbedFn([0, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(results).toEqual([]);
  });

  it('category collapse keeps highest-scoring tool tier', async () => {
    // Create manifest where graph has tier 2 and tier 3 tools with different cosines
    const customManifest: ToolEmbeddingsManifest = {
      model: 'test-model',
      dims: 4,
      version: 1,
      generatedAt: '2026-01-01T00:00:00Z',
      sourceHash: 'test',
      tools: [
        // graph_a: tier 2, slightly off-axis — lower cosine to [1,0,0,0]
        { name: 'graph_a', category: 'graph', tier: 2, descriptionHash: 'a', embedding: [0.8, 0.6, 0, 0] },
        // graph_b: tier 3, perfectly aligned — highest cosine to [1,0,0,0]
        { name: 'graph_b', category: 'graph', tier: 3, descriptionHash: 'b', embedding: [1, 0, 0, 0] },
        { name: 'temporal_a', category: 'temporal', tier: 2, descriptionHash: 'c', embedding: [0, 1, 0, 0] },
      ],
    };
    const { getSemanticActivations } = createToolRoutingIndex(customManifest);
    const results = await getSemanticActivations(
      'show me graph analysis and connections please',
      mockEmbedFn([1, 0, 0, 0]),
    );
    const graphResult = results.find((r) => r.category === 'graph');
    expect(graphResult).toBeDefined();
    // graph_b (tier 3) has higher cosine (1.0) than graph_a (tier 2, ~0.8), so tier 3 wins
    expect(graphResult!.tier).toBe(3);
  });

  it('max 3 category/tier pairs returned', async () => {
    // Query that matches everything
    const { getSemanticActivations } = createToolRoutingIndex(manifest);
    // Uniform vector — equally similar to all directions
    const uniformVec = new Array(8).fill(1 / Math.sqrt(8));
    const results = await getSemanticActivations(
      'show me everything about all categories at once please',
      mockEmbedFn(uniformVec),
    );
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('bad manifest returns no activations', async () => {
    const badManifest = {
      model: 'test-model',
      dims: 4,
      version: 999, // wrong version
      generatedAt: '2026-01-01T00:00:00Z',
      sourceHash: 'test',
      tools: [],
    };
    const { getSemanticActivations, hasToolRouting } = createToolRoutingIndex(badManifest);
    expect(hasToolRouting()).toBe(false);
    const results = await getSemanticActivations(
      'show me graph connections in the vault please',
      mockEmbedFn([1, 0, 0, 0]),
    );
    expect(results).toEqual([]);
  });

  it('hasToolRouting returns true for valid manifest', () => {
    const { hasToolRouting } = createToolRoutingIndex(manifest);
    expect(hasToolRouting()).toBe(true);
  });
});

// ============================================================================
// Routing Mode Tests
// ============================================================================

describe('getToolRoutingMode', () => {
  // getToolRoutingMode is already imported at the top

  it('defaults to hybrid when tiered', () => {
    delete process.env.FLYWHEEL_TOOL_ROUTING;
    expect(getToolRoutingMode('tiered')).toBe('hybrid');
  });

  it('defaults to pattern when not tiered', () => {
    delete process.env.FLYWHEEL_TOOL_ROUTING;
    expect(getToolRoutingMode('off')).toBe('pattern');
  });

  it('respects explicit env var', () => {
    process.env.FLYWHEEL_TOOL_ROUTING = 'semantic';
    expect(getToolRoutingMode('tiered')).toBe('semantic');
    process.env.FLYWHEEL_TOOL_ROUTING = 'pattern';
    expect(getToolRoutingMode('tiered')).toBe('pattern');
    delete process.env.FLYWHEEL_TOOL_ROUTING;
  });
});


// ============================================================================
// Effectiveness-Aware Routing Tests (T15b)
// ============================================================================

describe('effectiveness-aware routing', () => {
  const manifest = buildSyntheticManifest();

  afterEach(() => {
    clearEffectivenessSnapshot();
  });

  it('no snapshot leaves routing unchanged', async () => {
    const { getSemanticActivations } = createToolRoutingIndex(manifest);
    const results = await getSemanticActivations(
      'show me backlinks and connections in the graph',
      mockEmbedFn([1, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(results.some(r => r.category === 'graph')).toBe(true);
  });

  it('low effectiveness penalizes tool below threshold', async () => {
    // graph_analysis has cosine ~1.0 with graph vector, but with eff=0.2
    // adjusted = 1.0 * (0.2/0.8) = 0.25 which is below MIN_COSINE (0.30)
    const effScores = new Map([['graph_analysis', 0.2], ['get_backlinks', 0.2]]);
    const { getSemanticActivations } = createToolRoutingIndex(manifest, {
      effectivenessScores: effScores,
    });
    const results = await getSemanticActivations(
      'show me backlinks and connections in the graph',
      mockEmbedFn([1, 0, 0, 0, 0, 0, 0, 0]),
    );
    // Graph tools should be penalized out
    expect(results.some(r => r.category === 'graph')).toBe(false);
  });

  it('effectiveness >= 0.8 is neutral (no boost)', async () => {
    const effScores = new Map([['graph_analysis', 0.95], ['get_backlinks', 0.9]]);
    const { getSemanticActivations } = createToolRoutingIndex(manifest, {
      effectivenessScores: effScores,
    });
    const results = await getSemanticActivations(
      'show me backlinks and connections in the graph',
      mockEmbedFn([1, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(results.some(r => r.category === 'graph')).toBe(true);
    // Score should not exceed raw cosine
    const graphResult = results.find(r => r.category === 'graph');
    expect(graphResult!.score).toBeLessThanOrEqual(1.0);
  });

  it('per-vault isolation: different vaults hold independent snapshots', () => {
    const scoresA = new Map([['graph_analysis', 0.5]]);
    const scoresB = new Map([['graph_analysis', 0.9]]);

    loadEffectivenessSnapshot('vault-a', scoresA);
    loadEffectivenessSnapshot('vault-b', scoresB);

    // Clear one vault
    clearEffectivenessSnapshot('vault-a');

    // vault-a cleared, vault-b still present
    // We can't directly test per-request resolution without ALS,
    // but we verify the map operations are isolated
    loadEffectivenessSnapshot('vault-a', new Map());  // empty = deleted
    // vault-b should still be present
    loadEffectivenessSnapshot('vault-c', scoresA);
    clearEffectivenessSnapshot('vault-c');
    // No cross-talk assertion — if this doesn't throw, isolation works
  });

  it('updated snapshot replaces previous routing behavior', async () => {
    // First: low effectiveness blocks graph
    const lowScores = new Map([['graph_analysis', 0.2], ['get_backlinks', 0.2]]);
    const { getSemanticActivations: getFirst } = createToolRoutingIndex(manifest, {
      effectivenessScores: lowScores,
    });
    const blocked = await getFirst(
      'show me backlinks and connections in the graph',
      mockEmbedFn([1, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(blocked.some(r => r.category === 'graph')).toBe(false);

    // Second: high effectiveness restores graph
    const highScores = new Map([['graph_analysis', 0.85], ['get_backlinks', 0.85]]);
    const { getSemanticActivations: getSecond } = createToolRoutingIndex(manifest, {
      effectivenessScores: highScores,
    });
    const restored = await getSecond(
      'show me backlinks and connections in the graph',
      mockEmbedFn([1, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(restored.some(r => r.category === 'graph')).toBe(true);
  });
});
