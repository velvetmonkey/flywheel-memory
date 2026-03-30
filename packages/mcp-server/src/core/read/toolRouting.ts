/**
 * Semantic Tool Routing
 *
 * Loads the pre-generated tool embedding manifest and provides semantic
 * activation candidates for user queries. Used alongside (not instead of)
 * regex-based ACTIVATION_PATTERNS from T13.
 *
 * Rules:
 *   - Ignores tier-1 tools (always visible)
 *   - Skips short queries (< 2 tokens or < 12 non-space chars)
 *   - Keeps hits with cosine >= 0.30
 *   - Collapses to one activation per category (highest-scoring tool's tier)
 *   - Returns at most 3 category/tier pairs
 */

import type { ToolCategory, ToolTier } from '../../config.js';
import type { ToolTierMode } from '../../tool-registry.js';
import { cosineSimilarity, embedTextCached, getActiveModelId } from './embeddings.js';
import { getActiveScopeOrNull } from '../../vault-scope.js';

// ---------------------------------------------------------------------------
// Manifest types (exported for test seam)
// ---------------------------------------------------------------------------

interface ManifestToolEntry {
  name: string;
  category: string;
  tier: number;
  descriptionHash: string;
  embedding: readonly number[];
}

export interface ToolEmbeddingsManifest {
  model: string;
  dims: number;
  version: number;
  generatedAt: string;
  sourceHash: string;
  tools: readonly ManifestToolEntry[];
}

// ---------------------------------------------------------------------------
// Routing index (in-memory state)
// ---------------------------------------------------------------------------

interface ToolEmbeddingRecord {
  name: string;
  category: ToolCategory;
  tier: ToolTier;
  embedding: Float32Array;
}

export interface SemanticActivation {
  category: ToolCategory;
  tier: ToolTier;
  score: number;
}

export type ToolRoutingMode = 'pattern' | 'hybrid' | 'semantic';

const MANIFEST_VERSION = 1;
const MIN_COSINE = 0.30;
const MAX_ACTIVATIONS = 3;
const MIN_QUERY_TOKENS = 2;
const MIN_QUERY_CHARS = 12;  // non-space chars

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let routingIndex: ToolEmbeddingRecord[] | null = null;
let manifestModel: string | null = null;

// Per-vault effectiveness snapshots (T15b)
const effectivenessSnapshots = new Map<string, ReadonlyMap<string, number>>();
const EFFECTIVENESS_PRIOR_MEAN = 0.8;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and validate the generated manifest. Returns false on
 * missing/corrupt/wrong-version/wrong-dims.
 */
export async function initToolRouting(): Promise<boolean> {
  try {
    const mod = await import('../../generated/tool-embeddings.generated.js');
    const manifest = mod.TOOL_EMBEDDINGS_MANIFEST as ToolEmbeddingsManifest;
    return loadFromManifest(manifest);
  } catch {
    // Manifest missing or corrupt — silently fall back to pattern routing
    routingIndex = null;
    manifestModel = null;
    return false;
  }
}

/**
 * Test seam: create a routing context from an injected manifest.
 * Returns a self-contained object with its own getSemanticActivations().
 */
export function createToolRoutingIndex(manifest: ToolEmbeddingsManifest, options?: {
  effectivenessScores?: ReadonlyMap<string, number>;
}): {
  getSemanticActivations: (query: string, embedFn?: (text: string) => Promise<Float32Array>) => Promise<SemanticActivation[]>;
  hasToolRouting: () => boolean;
} {
  const records: ToolEmbeddingRecord[] = [];
  let valid = false;

  if (validateManifest(manifest)) {
    for (const tool of manifest.tools) {
      if (
        Array.isArray(tool.embedding) &&
        tool.embedding.length === manifest.dims
      ) {
        records.push({
          name: tool.name,
          category: tool.category as ToolCategory,
          tier: tool.tier as ToolTier,
          embedding: new Float32Array(tool.embedding),
        });
      }
    }
    valid = records.length > 0;
  }

  return {
    hasToolRouting: () => valid,
    getSemanticActivations: (query, embedFn) =>
      rankAndCollapse(query, records, valid, manifest?.model ?? '', embedFn, options?.effectivenessScores ?? null),
  };
}

/** True if the manifest loaded successfully. */
export function hasToolRouting(): boolean {
  return routingIndex !== null && routingIndex.length > 0;
}

/**
 * Resolve routing mode from env var.
 * Default: 'hybrid' when toolTierMode === 'tiered', otherwise 'pattern'.
 */
export function getToolRoutingMode(toolTierMode: ToolTierMode): ToolRoutingMode {
  const env = process.env.FLYWHEEL_TOOL_ROUTING?.trim().toLowerCase();
  if (env === 'pattern' || env === 'hybrid' || env === 'semantic') return env;
  return toolTierMode === 'tiered' ? 'hybrid' : 'pattern';
}

/**
 * Return semantic activation candidates for a query.
 * Uses the module-level routing index loaded by initToolRouting().
 */
export async function getSemanticActivations(
  query: string,
): Promise<SemanticActivation[]> {
  return rankAndCollapse(query, routingIndex, hasToolRouting(), manifestModel ?? '');
}


/**
 * Load an effectiveness snapshot for a vault.
 * Scores are posterior accuracy from explicit feedback (T15a).
 */
export function loadEffectivenessSnapshot(vaultName: string, scores: Map<string, number>): void {
  if (scores.size > 0) {
    effectivenessSnapshots.set(vaultName, scores);
  } else {
    effectivenessSnapshots.delete(vaultName);
  }
}

/**
 * Clear effectiveness snapshot(s).
 * Without vaultName, clears all snapshots.
 */
export function clearEffectivenessSnapshot(vaultName?: string): void {
  if (vaultName) {
    effectivenessSnapshots.delete(vaultName);
  } else {
    effectivenessSnapshots.clear();
  }
}

/** Get the active vault's effectiveness snapshot, or null. */
function getActiveEffectivenessSnapshot(): ReadonlyMap<string, number> | null {
  const scope = getActiveScopeOrNull();
  if (!scope?.name) return null;
  return effectivenessSnapshots.get(scope.name) ?? null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function validateManifest(manifest: ToolEmbeddingsManifest | null | undefined): manifest is ToolEmbeddingsManifest {
  return !!(
    manifest &&
    manifest.version === MANIFEST_VERSION &&
    manifest.dims > 0 &&
    manifest.model &&
    Array.isArray(manifest.tools) &&
    manifest.tools.length > 0
  );
}

function loadFromManifest(manifest: ToolEmbeddingsManifest): boolean {
  if (!validateManifest(manifest)) {
    routingIndex = null;
    manifestModel = null;
    return false;
  }

  const records: ToolEmbeddingRecord[] = [];
  for (const tool of manifest.tools) {
    if (
      Array.isArray(tool.embedding) &&
      tool.embedding.length === manifest.dims
    ) {
      records.push({
        name: tool.name,
        category: tool.category as ToolCategory,
        tier: tool.tier as ToolTier,
        embedding: new Float32Array(tool.embedding),
      });
    }
  }

  if (records.length === 0) {
    routingIndex = null;
    manifestModel = null;
    return false;
  }

  routingIndex = records;
  manifestModel = manifest.model;
  return true;
}

function isQueryTooShort(query: string): boolean {
  const nonSpaceChars = query.replace(/\s/g, '').length;
  if (nonSpaceChars < MIN_QUERY_CHARS) return true;

  const tokens = query.trim().split(/\s+/);
  if (tokens.length < MIN_QUERY_TOKENS) return true;

  return false;
}

async function rankAndCollapse(
  query: string,
  index: ToolEmbeddingRecord[] | null,
  isValid: boolean,
  model: string,
  embedFn?: (text: string) => Promise<Float32Array>,
  injectedEffectiveness?: ReadonlyMap<string, number> | null,
): Promise<SemanticActivation[]> {
  if (!isValid || !index || index.length === 0) return [];

  // Model mismatch check — only when using the real embedding pipeline
  if (!embedFn) {
    try {
      const activeModel = getActiveModelId();
      if (activeModel !== model) return [];
    } catch {
      // getActiveModelId may fail if embeddings never initialized — that's fine,
      // it means the default model is in use (not overridden by env)
    }
  }

  if (isQueryTooShort(query)) return [];

  // Embed the query (reuses cache from hybrid search)
  const embed = embedFn ?? embedTextCached;
  const queryEmbedding = await embed(query);

  // Score all non-tier-1 tools
  const effectivenessSnapshot = injectedEffectiveness ?? getActiveEffectivenessSnapshot();
  const scored: Array<{ name: string; category: ToolCategory; tier: ToolTier; score: number }> = [];
  for (const record of index) {
    if (record.tier === 1) continue;  // tier-1 always visible, skip

    const cosine = cosineSimilarity(queryEmbedding, record.embedding);

    // Penalty-only effectiveness adjustment (T15b)
    let adjustedScore = cosine;
    if (effectivenessSnapshot) {
      const eff = effectivenessSnapshot.get(record.name);
      if (eff !== undefined && eff < EFFECTIVENESS_PRIOR_MEAN) {
        adjustedScore = cosine * (eff / EFFECTIVENESS_PRIOR_MEAN);
      }
    }

    if (adjustedScore >= MIN_COSINE) {
      scored.push({
        name: record.name,
        category: record.category,
        tier: record.tier,
        score: Math.round(adjustedScore * 1000) / 1000,
      });
    }
  }

  // Collapse to one activation per category: highest-scoring tool wins
  const categoryBest = new Map<ToolCategory, { tier: ToolTier; score: number }>();
  for (const hit of scored) {
    const existing = categoryBest.get(hit.category);
    if (!existing || hit.score > existing.score) {
      categoryBest.set(hit.category, { tier: hit.tier, score: hit.score });
    }
  }

  // Sort by score desc, take top MAX_ACTIVATIONS
  const activations: SemanticActivation[] = Array.from(categoryBest.entries())
    .map(([category, { tier, score }]) => ({ category, tier, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ACTIVATIONS);

  return activations;
}
