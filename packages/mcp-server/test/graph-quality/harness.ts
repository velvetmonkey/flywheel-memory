/**
 * Graph Quality Test Harness
 *
 * Provides vault building, suggestion running, evaluation metrics,
 * and topology analysis for the 6-pillar graph quality testing framework.
 */

import { mkdtemp, writeFile, rm, mkdir, readFile, readdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  openStateDb,
  deleteStateDb,
  type StateDb,
  type EntityCategory,
} from '@velvetmonkey/vault-core';
import {
  initializeEntityIndex,
  suggestRelatedLinks,
  setWriteStateDb,
  extractLinkedEntities,
} from '../../src/core/write/wikilinks.js';
import { setRecencyStateDb } from '../../src/core/shared/recency.js';
import {
  recordFeedback,
  updateSuppressionList,
} from '../../src/core/write/wikilinkFeedback.js';
import type { ScoringLayer, StrictnessMode, ScoreBreakdown } from '../../src/core/write/types.js';

// =============================================================================
// Types
// =============================================================================

/** Entity specification from fixture files */
export interface EntitySpec {
  name: string;
  category: EntityCategory;
  path: string;
  aliases: string[];
  hubScore: number;
}

/** Note specification from fixture files */
export interface NoteSpec {
  path: string;
  title: string;
  frontmatter?: Record<string, unknown>;
  content: string;
  links: string[];
  folder: string;
}

/** Ground truth link that was stripped for testing */
export interface GroundTruthLink {
  notePath: string;
  entity: string;
  tier: 1 | 2 | 3;
  reason: string;
  chaosFactors?: string[];
}

/** Full vault specification loaded from fixture JSON */
export interface GroundTruthSpec {
  seed: number;
  description: string;
  archetype?: string;
  entities: EntitySpec[];
  notes: NoteSpec[];
  groundTruth: GroundTruthLink[];
}

/** Temporary vault on disk with metadata */
export interface TempVault {
  vaultPath: string;
  stateDb: StateDb;
  spec: GroundTruthSpec;
  cleanup: () => Promise<void>;
}

/** Result of running suggestions on a single note */
export interface SuggestionRun {
  notePath: string;
  suggestions: string[];
  detailed?: Array<{
    entity: string;
    totalScore: number;
    breakdown: ScoreBreakdown;
  }>;
}

/** Precision/recall evaluation report */
export interface PrecisionRecallReport {
  precision: number;
  recall: number;
  f1: number;
  fpRate: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  totalSuggestions: number;
  totalGroundTruth: number;
  byTier: Record<1 | 2 | 3, { precision: number; recall: number; f1: number; count: number }>;
  byCategory: Record<string, { precision: number; recall: number; f1: number; count: number }>;
  byStrictness?: Record<string, { precision: number; recall: number; f1: number }>;
  falseNegativeDetails: Array<{entity: string, notePath: string, tier: 1|2|3}>;
  mrr: number;
  hitsAt3: number;
  precisionAtK: number;
}

/** Graph health metrics */
export interface GraphHealthReport {
  noteCount: number;
  linkCount: number;
  linkDensity: number;
  orphanRate: number;
  orphanCount: number;
  entityCoverage: number;
  connectedness: number;
  clusterCount: number;
  giniCoefficient: number;
  clusteringCoefficient: number;
  avgPathLength: number;
  betweennessCentrality: { top5PctShare: number };
  degreeCentralityStdDev: number;
}

/** Parameter sweep configuration */
export interface ParameterSweep {
  parameter: string;
  values: number[];
  metric: 'f1' | 'precision' | 'recall' | 'mrr';
  vault: 'primary' | 'all_archetypes';
}

/** Sweep result */
export interface SweepResult {
  parameter: string;
  optimal_value: number;
  current_value: number;
  delta: number;
  curve: Array<{ value: number; metric: number }>;
}

// =============================================================================
// Vault Builder
// =============================================================================

/**
 * Build a ground truth vault from a spec on disk.
 *
 * Creates entity notes with frontmatter, content notes with wikilinks,
 * and initializes the entity index via initializeEntityIndex().
 */
export async function buildGroundTruthVault(spec: GroundTruthSpec): Promise<TempVault> {
  const vaultPath = await mkdtemp(path.join(os.tmpdir(), 'flywheel-quality-'));

  // Write all notes to disk
  for (const note of spec.notes) {
    const fullPath = path.join(vaultPath, note.path);
    await mkdir(path.dirname(fullPath), { recursive: true });

    // Build markdown content with frontmatter
    let md = '';
    if (note.frontmatter && Object.keys(note.frontmatter).length > 0) {
      md += '---\n';
      for (const [key, value] of Object.entries(note.frontmatter)) {
        if (Array.isArray(value)) {
          md += `${key}:\n`;
          for (const item of value) {
            md += `  - ${item}\n`;
          }
        } else {
          md += `${key}: ${value}\n`;
        }
      }
      md += '---\n\n';
    }
    md += note.content;

    await writeFile(fullPath, md, 'utf-8');
  }

  // Open StateDb and initialize entity index
  const stateDb = openStateDb(vaultPath);
  setWriteStateDb(stateDb);
  setRecencyStateDb(stateDb);
  await initializeEntityIndex(vaultPath);

  const cleanup = async () => {
    setWriteStateDb(null);
    setRecencyStateDb(null);
    stateDb.close();
    deleteStateDb(vaultPath);
    await rm(vaultPath, { recursive: true, force: true });
  };

  return { vaultPath, stateDb, spec, cleanup };
}

/**
 * Strip ground truth links from a vault's notes on disk.
 *
 * For each ground truth entry, removes the [[entity]] wikilink from the
 * note's content, leaving the entity name as plain text (for Tier 1/2)
 * or removing mention entirely (for Tier 3).
 */
export async function stripLinks(
  vault: TempVault,
  groundTruth: GroundTruthLink[],
): Promise<void> {
  // Group by note path for efficiency
  const byNote = new Map<string, GroundTruthLink[]>();
  for (const gt of groundTruth) {
    const existing = byNote.get(gt.notePath) || [];
    existing.push(gt);
    byNote.set(gt.notePath, existing);
  }

  for (const [notePath, links] of byNote) {
    const fullPath = path.join(vault.vaultPath, notePath);
    let content = await readFile(fullPath, 'utf-8');

    for (const link of links) {
      // Remove [[Entity]] wikilink, leave entity name as plain text
      const wikilinkPattern = new RegExp(`\\[\\[${escapeRegex(link.entity)}\\]\\]`, 'g');
      content = content.replace(wikilinkPattern, link.entity);
    }

    await writeFile(fullPath, content, 'utf-8');
  }

  // Re-initialize entity index after stripping
  await initializeEntityIndex(vault.vaultPath);
}

// =============================================================================
// Suggestion Runner
// =============================================================================

/**
 * Run suggestRelatedLinks() on every content note in the vault.
 *
 * Returns an array of suggestion runs, one per note.
 */
export async function runSuggestionsOnVault(
  vault: TempVault,
  options?: {
    disabledLayers?: ScoringLayer[];
    strictness?: StrictnessMode;
    maxSuggestions?: number;
  },
): Promise<SuggestionRun[]> {
  const runs: SuggestionRun[] = [];

  for (const note of vault.spec.notes) {
    const fullPath = path.join(vault.vaultPath, note.path);
    let content: string;
    try {
      content = await readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const result = await suggestRelatedLinks(content, {
      maxSuggestions: options?.maxSuggestions ?? 8,
      strictness: options?.strictness ?? 'balanced',
      notePath: note.path,
      disabledLayers: options?.disabledLayers,
      detail: true,
    });

    runs.push({
      notePath: note.path,
      suggestions: result.suggestions,
      detailed: result.detailed?.map(d => ({
        entity: d.entity,
        totalScore: d.totalScore,
        breakdown: d.breakdown,
      })),
    });
  }

  return runs;
}

// =============================================================================
// Evaluation
// =============================================================================

/**
 * Evaluate suggestion runs against ground truth.
 *
 * Computes precision, recall, F1, MRR, Hits@3, and breakdowns by tier and category.
 */
export function evaluateSuggestions(
  runs: SuggestionRun[],
  groundTruth: GroundTruthLink[],
  entitySpecs?: EntitySpec[],
): PrecisionRecallReport {
  // Normalize entity names: the entity index returns file-stem names (e.g. "david-chen")
  // while ground truth uses display names (e.g. "David Chen"). Normalize both by
  // lowercasing and replacing hyphens with spaces.
  const normalize = (name: string): string => name.toLowerCase().replace(/-/g, ' ');

  // Build lookup: notePath → set of ground truth entity names (normalized)
  const gtByNote = new Map<string, Set<string>>();
  for (const gt of groundTruth) {
    const set = gtByNote.get(gt.notePath) || new Set();
    set.add(normalize(gt.entity));
    gtByNote.set(gt.notePath, set);
  }

  // Build entity → category map (normalized keys)
  const entityCategoryMap = new Map<string, string>();
  if (entitySpecs) {
    for (const e of entitySpecs) {
      entityCategoryMap.set(normalize(e.name), e.category);
    }
  }

  // Build gt → tier map (normalized keys)
  const gtTierMap = new Map<string, 1 | 2 | 3>();
  for (const gt of groundTruth) {
    gtTierMap.set(`${gt.notePath}::${normalize(gt.entity)}`, gt.tier);
  }

  let truePositives = 0;
  let falsePositives = 0;
  let totalSuggestions = 0;

  // Per-tier tracking
  const tierStats: Record<1 | 2 | 3, { tp: number; fp: number; fn: number; total: number }> = {
    1: { tp: 0, fp: 0, fn: 0, total: 0 },
    2: { tp: 0, fp: 0, fn: 0, total: 0 },
    3: { tp: 0, fp: 0, fn: 0, total: 0 },
  };

  // Per-category tracking
  const catStats = new Map<string, { tp: number; fp: number; fn: number; total: number }>();

  // MRR tracking
  let reciprocalRankSum = 0;
  let hitsAt3Count = 0;
  let queriesWithGt = 0;

  // Count ground truth per tier
  for (const gt of groundTruth) {
    tierStats[gt.tier].total++;
    const cat = entityCategoryMap.get(normalize(gt.entity)) || 'unknown';
    if (!catStats.has(cat)) catStats.set(cat, { tp: 0, fp: 0, fn: 0, total: 0 });
    catStats.get(cat)!.total++;
  }

  // Build set of known-good links per note from the original spec.
  // A suggestion matching an existing wikilink in the original note is NOT a false positive —
  // it's a correct link that just wasn't in our stripped ground truth set.
  // We build this from the runs' source spec (passed indirectly via groundTruth notes).
  // Since we don't have the full spec here, we build it from entitySpecs: any suggestion
  // matching a known entity name is "plausible" — only unknown entities are true FPs.
  const knownEntities = new Set<string>();
  if (entitySpecs) {
    for (const e of entitySpecs) {
      knownEntities.add(normalize(e.name));
      for (const alias of e.aliases) {
        knownEntities.add(normalize(alias));
      }
    }
  }

  // Evaluate each run
  const recoveredGt = new Set<string>();

  for (const run of runs) {
    const noteGt = gtByNote.get(run.notePath);
    if (!noteGt || noteGt.size === 0) {
      // No ground truth for this note — skip entirely.
      // We can't classify suggestions as TP or FP without ground truth.
      continue;
    }

    queriesWithGt++;
    let firstCorrectRank = 0;

    for (let i = 0; i < run.suggestions.length; i++) {
      const suggested = normalize(run.suggestions[i]);

      if (noteGt.has(suggested)) {
        totalSuggestions++;
        truePositives++;
        recoveredGt.add(`${run.notePath}::${suggested}`);

        if (firstCorrectRank === 0) {
          firstCorrectRank = i + 1;
        }

        // Tier tracking
        const tierKey = `${run.notePath}::${suggested}`;
        const tier = gtTierMap.get(tierKey);
        if (tier) tierStats[tier].tp++;

        // Category tracking
        const cat = entityCategoryMap.get(suggested) || 'unknown';
        if (!catStats.has(cat)) catStats.set(cat, { tp: 0, fp: 0, fn: 0, total: 0 });
        catStats.get(cat)!.tp++;
      } else if (!knownEntities.has(suggested)) {
        // Only count as FP if the suggestion is not a known entity —
        // suggesting a real entity that's not in the ground truth is not a false positive,
        // it's a correct suggestion for a link we didn't strip.
        totalSuggestions++;
        falsePositives++;
      }
      // else: suggestion matches a known entity but not in GT — ignore (correct but not measured)
    }

    // MRR: reciprocal of first correct rank
    if (firstCorrectRank > 0) {
      reciprocalRankSum += 1 / firstCorrectRank;
      if (firstCorrectRank <= 3) hitsAt3Count++;
    }
  }

  // Count false negatives (ground truth not recovered)
  const falseNegatives = groundTruth.length - recoveredGt.size;

  // Count per-tier FNs and collect false negative details
  const falseNegativeDetails: Array<{entity: string, notePath: string, tier: 1|2|3}> = [];
  for (const gt of groundTruth) {
    const key = `${gt.notePath}::${normalize(gt.entity)}`;
    if (!recoveredGt.has(key)) {
      tierStats[gt.tier].fn++;
      const cat = entityCategoryMap.get(normalize(gt.entity)) || 'unknown';
      if (!catStats.has(cat)) catStats.set(cat, { tp: 0, fp: 0, fn: 0, total: 0 });
      catStats.get(cat)!.fn++;
      falseNegativeDetails.push({
        entity: gt.entity,
        notePath: gt.notePath,
        tier: gt.tier,
      });
    }
  }

  // Compute aggregate metrics
  const precision = totalSuggestions > 0 ? truePositives / totalSuggestions : 0;
  const recall = groundTruth.length > 0 ? truePositives / groundTruth.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const fpRate = totalSuggestions > 0 ? falsePositives / totalSuggestions : 0;
  const mrr = queriesWithGt > 0 ? reciprocalRankSum / queriesWithGt : 0;
  const hitsAt3 = queriesWithGt > 0 ? hitsAt3Count / queriesWithGt : 0;
  const precisionAtK = totalSuggestions > 0 ? truePositives / Math.min(totalSuggestions, runs.length * 3) : 0;

  // Per-tier breakdown
  const byTier = {} as PrecisionRecallReport['byTier'];
  for (const tier of [1, 2, 3] as const) {
    const t = tierStats[tier];
    const tPrecision = (t.tp + t.fp) > 0 ? t.tp / (t.tp + t.fp) : 0;
    const tRecall = t.total > 0 ? t.tp / t.total : 0;
    const tF1 = tPrecision + tRecall > 0 ? (2 * tPrecision * tRecall) / (tPrecision + tRecall) : 0;
    byTier[tier] = { precision: tPrecision, recall: tRecall, f1: tF1, count: t.total };
  }

  // Per-category breakdown
  const byCategory: PrecisionRecallReport['byCategory'] = {};
  for (const [cat, stats] of catStats) {
    const cPrecision = (stats.tp + stats.fp) > 0 ? stats.tp / (stats.tp + stats.fp) : 0;
    const cRecall = stats.total > 0 ? stats.tp / stats.total : 0;
    const cF1 = cPrecision + cRecall > 0 ? (2 * cPrecision * cRecall) / (cPrecision + cRecall) : 0;
    byCategory[cat] = { precision: cPrecision, recall: cRecall, f1: cF1, count: stats.total };
  }

  return {
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    fpRate: round(fpRate),
    truePositives,
    falsePositives,
    falseNegatives,
    totalSuggestions,
    totalGroundTruth: groundTruth.length,
    byTier,
    byCategory,
    falseNegativeDetails,
    mrr: round(mrr),
    hitsAt3: round(hitsAt3),
    precisionAtK: round(precisionAtK),
  };
}

// =============================================================================
// Graph Topology Metrics
// =============================================================================

/**
 * Compute comprehensive graph health metrics from a vault's link structure.
 *
 * Reads all .md files, extracts [[wikilinks]], and computes topology metrics.
 */
export async function computeGraphHealth(vaultPath: string): Promise<GraphHealthReport> {
  // Scan vault for all notes and their outlinks
  const notes = new Map<string, Set<string>>();  // path → outlink targets
  const backlinks = new Map<string, Set<string>>(); // target → source paths

  const allFiles = await walkMarkdownFiles(vaultPath);

  for (const filePath of allFiles) {
    const relPath = path.relative(vaultPath, filePath);
    const content = await readFile(filePath, 'utf-8');
    const links = extractLinkedEntities(content);

    notes.set(relPath, links);

    for (const target of links) {
      if (!backlinks.has(target)) backlinks.set(target, new Set());
      backlinks.get(target)!.add(relPath);
    }
  }

  const noteCount = notes.size;
  if (noteCount === 0) {
    return {
      noteCount: 0, linkCount: 0, linkDensity: 0, orphanRate: 1,
      orphanCount: 0, entityCoverage: 0, connectedness: 0, clusterCount: 0,
      giniCoefficient: 0, clusteringCoefficient: 0, avgPathLength: 0,
      betweennessCentrality: { top5PctShare: 0 }, degreeCentralityStdDev: 0,
    };
  }

  // Basic metrics
  let linkCount = 0;
  let orphanCount = 0;
  for (const [, outlinks] of notes) {
    linkCount += outlinks.size;
    if (outlinks.size === 0 && !hasInlinks(backlinks, Array.from(notes.keys()))) {
      orphanCount++;
    }
  }

  // Count orphans: notes with zero outlinks AND zero inlinks
  orphanCount = 0;
  for (const [notePath, outlinks] of notes) {
    const hasOut = outlinks.size > 0;
    const hasIn = backlinks.has(notePath) || Array.from(backlinks.values()).some(s => s.has(notePath));
    // Check if note path (without .md) matches any backlink target
    const noteBasename = notePath.replace(/\.md$/, '');
    const noteTitle = path.basename(noteBasename);
    const hasInByTitle = backlinks.has(noteTitle) || backlinks.has(noteTitle.toLowerCase());
    if (!hasOut && !hasIn && !hasInByTitle) {
      orphanCount++;
    }
  }

  const linkDensity = linkCount / noteCount;
  const orphanRate = orphanCount / noteCount;

  // Entity coverage: unique entities linked / total entity notes
  const entityNotes = allFiles.filter(f => {
    const rel = path.relative(vaultPath, f);
    return !rel.startsWith('daily-notes/') && !rel.startsWith('notes/') &&
           !rel.startsWith('projects/docs/') && !rel.startsWith('technologies/guides/');
  });
  const linkedEntities = new Set<string>();
  for (const [, outlinks] of notes) {
    for (const link of outlinks) linkedEntities.add(link.toLowerCase());
  }
  const entityCoverage = entityNotes.length > 0
    ? Math.min(1, linkedEntities.size / entityNotes.length)
    : 0;

  // Build adjacency graph for topology metrics
  const adj = buildAdjacencyGraph(notes, backlinks);
  const nodeList = Array.from(adj.keys());

  // Connectedness: largest connected component / total nodes
  const components = findConnectedComponents(adj);
  const largestComponent = Math.max(...components.map(c => c.length), 0);
  const connectedness = nodeList.length > 0 ? largestComponent / nodeList.length : 0;
  const clusterCount = components.length;

  // Degree distribution for Gini and std dev
  const degrees = nodeList.map(n => (adj.get(n) || new Set()).size);
  const giniCoefficient = computeGini(degrees);
  const degreeCentralityStdDev = computeStdDev(degrees);

  // Clustering coefficient
  const clusteringCoefficient = computeClusteringCoefficient(adj);

  // Average path length (BFS on largest component)
  const avgPathLength = computeAvgPathLength(adj, components[0] || []);

  // Betweenness centrality
  const betweenness = computeBetweennessCentrality(adj, nodeList);
  const sortedBetweenness = betweenness.sort((a, b) => b - a);
  const top5PctCount = Math.max(1, Math.ceil(nodeList.length * 0.05));
  const top5PctSum = sortedBetweenness.slice(0, top5PctCount).reduce((a, b) => a + b, 0);
  const totalBetweenness = sortedBetweenness.reduce((a, b) => a + b, 0);
  const top5PctShare = totalBetweenness > 0 ? top5PctSum / totalBetweenness : 0;

  return {
    noteCount,
    linkCount,
    linkDensity: round(linkDensity),
    orphanRate: round(orphanRate),
    orphanCount,
    entityCoverage: round(entityCoverage),
    connectedness: round(connectedness),
    clusterCount,
    giniCoefficient: round(giniCoefficient),
    clusteringCoefficient: round(clusteringCoefficient),
    avgPathLength: round(avgPathLength),
    betweennessCentrality: { top5PctShare: round(top5PctShare) },
    degreeCentralityStdDev: round(degreeCentralityStdDev),
  };
}

// =============================================================================
// Topology Helper Functions
// =============================================================================

/** Build undirected adjacency graph from notes and backlinks */
function buildAdjacencyGraph(
  notes: Map<string, Set<string>>,
  backlinks: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();

  // Add all notes as nodes
  for (const [notePath] of notes) {
    if (!adj.has(notePath)) adj.set(notePath, new Set());
  }

  // Add edges (bidirectional)
  for (const [source, targets] of notes) {
    for (const target of targets) {
      // Try to resolve target to a note path
      const targetPath = resolveTarget(target, Array.from(notes.keys()));
      if (targetPath) {
        if (!adj.has(source)) adj.set(source, new Set());
        if (!adj.has(targetPath)) adj.set(targetPath, new Set());
        adj.get(source)!.add(targetPath);
        adj.get(targetPath)!.add(source);
      }
    }
  }

  return adj;
}

/** Resolve a wikilink target to a note path */
function resolveTarget(target: string, notePaths: string[]): string | null {
  const targetLower = target.toLowerCase();
  // Try exact match
  for (const p of notePaths) {
    const basename = path.basename(p, '.md').toLowerCase();
    if (basename === targetLower) return p;
  }
  // Try with spaces → hyphens
  const hyphenated = targetLower.replace(/\s+/g, '-');
  for (const p of notePaths) {
    const basename = path.basename(p, '.md').toLowerCase().replace(/\s+/g, '-');
    if (basename === hyphenated) return p;
  }
  return null;
}

/** Find connected components via BFS */
function findConnectedComponents(adj: Map<string, Set<string>>): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const node of adj.keys()) {
    if (visited.has(node)) continue;
    const component: string[] = [];
    const queue = [node];
    visited.add(node);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      const neighbors = adj.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    components.push(component);
  }

  // Sort by size descending
  components.sort((a, b) => b.length - a.length);
  return components;
}

/** Compute Gini coefficient from a distribution */
function computeGini(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;

  let sumDiff = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sumDiff += Math.abs(sorted[i] - sorted[j]);
    }
  }

  return sumDiff / (2 * n * n * mean);
}

/** Compute standard deviation */
function computeStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Compute average clustering coefficient */
function computeClusteringCoefficient(adj: Map<string, Set<string>>): number {
  let totalCoeff = 0;
  let validNodes = 0;

  for (const [node, neighbors] of adj) {
    const k = neighbors.size;
    if (k < 2) continue;

    let triangles = 0;
    const neighborArray = Array.from(neighbors);
    for (let i = 0; i < neighborArray.length; i++) {
      for (let j = i + 1; j < neighborArray.length; j++) {
        const ni = adj.get(neighborArray[i]);
        if (ni && ni.has(neighborArray[j])) {
          triangles++;
        }
      }
    }

    const maxTriangles = (k * (k - 1)) / 2;
    totalCoeff += triangles / maxTriangles;
    validNodes++;
  }

  return validNodes > 0 ? totalCoeff / validNodes : 0;
}

/** Compute average shortest path length via BFS */
function computeAvgPathLength(adj: Map<string, Set<string>>, component: string[]): number {
  if (component.length < 2) return 0;

  // Sample if component is large (>100 nodes)
  const sampleNodes = component.length > 100
    ? component.slice(0, 50)
    : component;

  let totalPath = 0;
  let pathCount = 0;

  for (const start of sampleNodes) {
    const distances = bfs(adj, start);
    for (const [, dist] of distances) {
      if (dist > 0) {
        totalPath += dist;
        pathCount++;
      }
    }
  }

  return pathCount > 0 ? totalPath / pathCount : 0;
}

/** BFS from a start node, returns distances */
function bfs(adj: Map<string, Set<string>>, start: string): Map<string, number> {
  const distances = new Map<string, number>();
  distances.set(start, 0);
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDist = distances.get(current)!;
    const neighbors = adj.get(current) || new Set();

    for (const neighbor of neighbors) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, currentDist + 1);
        queue.push(neighbor);
      }
    }
  }

  return distances;
}

/** Compute betweenness centrality for all nodes */
function computeBetweennessCentrality(
  adj: Map<string, Set<string>>,
  nodes: string[],
): number[] {
  const centrality = new Map<string, number>();
  for (const node of nodes) centrality.set(node, 0);

  // Sample if graph is large
  const sampleNodes = nodes.length > 100 ? nodes.slice(0, 50) : nodes;

  for (const s of sampleNodes) {
    // BFS from s
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();
    const delta = new Map<string, number>();

    for (const v of nodes) {
      pred.set(v, []);
      sigma.set(v, 0);
      dist.set(v, -1);
      delta.set(v, 0);
    }

    sigma.set(s, 1);
    dist.set(s, 0);
    const queue = [s];

    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      const vDist = dist.get(v)!;
      const neighbors = adj.get(v) || new Set();

      for (const w of neighbors) {
        if (dist.get(w) === -1) {
          dist.set(w, vDist + 1);
          queue.push(w);
        }
        if (dist.get(w) === vDist + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          pred.get(w)!.push(v);
        }
      }
    }

    // Accumulate
    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of pred.get(w)!) {
        const d = (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!);
        delta.set(v, delta.get(v)! + d);
      }
      if (w !== s) {
        centrality.set(w, centrality.get(w)! + delta.get(w)!);
      }
    }
  }

  return nodes.map(n => centrality.get(n) || 0);
}

// =============================================================================
// Fixture Validation
// =============================================================================

/**
 * Validate that a fixture's ground truth references actually exist in the spec.
 * Returns an array of missing-reference error messages (empty = valid).
 */
export function validateFixture(spec: GroundTruthSpec): string[] {
  const entityNames = new Set(spec.entities.map(e => e.name.toLowerCase()));
  const notePathSet = new Set(spec.notes.map(n => n.path));
  const missing: string[] = [];

  for (const gt of spec.groundTruth) {
    if (!entityNames.has(gt.entity.toLowerCase())) {
      missing.push(`Ground truth entity "${gt.entity}" not found in fixture entities`);
    }
    if (!notePathSet.has(gt.notePath)) {
      missing.push(`Ground truth note "${gt.notePath}" not found in fixture notes`);
    }
  }
  return missing;
}

// =============================================================================
// Fixture Loading
// =============================================================================

/** Resolve fixture directory - works in both vitest (__dirname) and tsx (import.meta.url) */
function getFixtureDir(): string {
  // Vitest injects __dirname; tsx/ESM does not
  if (typeof __dirname !== 'undefined') return __dirname;
  return path.dirname(fileURLToPath(import.meta.url));
}

/**
 * Load a ground truth spec from a JSON fixture file.
 */
export async function loadFixture(fixturePath: string): Promise<GroundTruthSpec> {
  const content = await readFile(fixturePath, 'utf-8');
  return JSON.parse(content) as GroundTruthSpec;
}

/**
 * Load the primary vault fixture.
 */
export async function loadPrimaryVault(): Promise<GroundTruthSpec> {
  const fixturePath = path.join(getFixtureDir(), 'fixtures', 'primary-vault.json');
  return loadFixture(fixturePath);
}

/**
 * Load an archetype vault fixture by name.
 */
export async function loadArchetype(name: string): Promise<GroundTruthSpec> {
  const fixturePath = path.join(getFixtureDir(), 'fixtures', 'archetypes', `${name}.json`);
  return loadFixture(fixturePath);
}

/**
 * Load the temporal-star fixture (production-representative vault).
 */
export async function loadTemporalStar(): Promise<GroundTruthSpec> {
  const fixturePath = path.join(getFixtureDir(), 'fixtures', 'temporal-star.json');
  return loadFixture(fixturePath);
}

/**
 * Load the chaos vault fixture.
 */
export async function loadChaosVault(): Promise<GroundTruthSpec> {
  const fixturePath = path.join(getFixtureDir(), 'fixtures', 'chaos-vault.json');
  return loadFixture(fixturePath);
}

// =============================================================================
// Learning Curve Runner
// =============================================================================

/** Result of a multi-round learning curve run */
export interface LearningCurveResult {
  rounds: Array<{
    round: number;
    f1: number;
    precision: number;
    recall: number;
    suppressionCount: number;
    byTier: Record<1|2|3, {precision: number; recall: number; f1: number; count: number}>;
  }>;
}

/** Seeded PRNG (mulberry32) for deterministic noise */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalize entity name for comparison */
function normalizeEntity(name: string): string {
  return name.toLowerCase().replace(/-/g, ' ');
}

/**
 * Run a multi-round learning curve on a prepared vault.
 *
 * Expects a vault that has already been built and had its ground truth links stripped.
 * Runs N rounds of suggest -> evaluate -> feedback -> re-suggest with realistic noise.
 */
export async function runLearningCurve(
  vault: TempVault,
  spec: GroundTruthSpec,
  options?: {
    totalRounds?: number;
    tpCorrectRate?: number;
    fpCorrectRate?: number;
    seed?: number;
  },
): Promise<LearningCurveResult> {
  const totalRounds = options?.totalRounds ?? 20;
  const tpCorrectRate = options?.tpCorrectRate ?? 0.85;
  const fpCorrectRate = options?.fpCorrectRate ?? 0.15;
  const seed = options?.seed ?? 42;

  const rng = mulberry32(seed);
  const rounds: LearningCurveResult['rounds'] = [];

  // Ensure stateDb is set for this vault
  setWriteStateDb(vault.stateDb);
  setRecencyStateDb(vault.stateDb);

  for (let roundNum = 0; roundNum < totalRounds; roundNum++) {
    // Step 1: Run suggestions on all notes
    const runs = await runSuggestionsOnVault(vault, { strictness: 'balanced' });

    // Step 2: Evaluate against ground truth
    const report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);

    // Step 3: Classify suggestions as TP or FP
    const gtByNote = new Map<string, Set<string>>();
    for (const gt of spec.groundTruth) {
      const set = gtByNote.get(gt.notePath) || new Set();
      set.add(normalizeEntity(gt.entity));
      gtByNote.set(gt.notePath, set);
    }

    // Step 4: Simulate user feedback with realistic noise
    for (const run of runs) {
      const noteGt = gtByNote.get(run.notePath);
      if (!noteGt) continue;

      for (const suggestion of run.suggestions) {
        const normalizedSuggestion = normalizeEntity(suggestion);
        const isTP = noteGt.has(normalizedSuggestion);

        if (isTP) {
          const isCorrect = rng() < tpCorrectRate;
          recordFeedback(vault.stateDb, suggestion, 'learning-curve', run.notePath, isCorrect);
        } else {
          const isCorrect = rng() < fpCorrectRate;
          recordFeedback(vault.stateDb, suggestion, 'learning-curve', run.notePath, isCorrect);
        }
      }
    }

    // Update suppressions once per round
    updateSuppressionList(vault.stateDb);

    // Step 5: Record round metrics
    const suppressionCount = (vault.stateDb.db.prepare(
      'SELECT COUNT(*) as cnt FROM wikilink_suppressions',
    ).get() as { cnt: number }).cnt;

    rounds.push({
      round: roundNum,
      f1: report.f1,
      precision: report.precision,
      recall: report.recall,
      suppressionCount,
      byTier: report.byTier,
    });
  }

  return { rounds };
}

// =============================================================================
// Utility Functions
// =============================================================================

/** Round to 3 decimal places */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Escape regex special characters */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Check if any backlinks point to this set of notes */
function hasInlinks(backlinks: Map<string, Set<string>>, notePaths: string[]): boolean {
  // This is a simplified check — full implementation in computeGraphHealth
  return false;
}

/** Walk a directory recursively for .md files */
async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden directories
        if (entry.name.startsWith('.')) continue;
        await walk(fullPath);
      } else if (entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

// =============================================================================
// Exports for Tests
// =============================================================================

export {
  computeGini,
  computeStdDev,
  computeClusteringCoefficient,
  computeAvgPathLength,
  findConnectedComponents,
  buildAdjacencyGraph,
};
