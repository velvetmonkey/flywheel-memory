/**
 * HotpotQA Retrieval Benchmark
 *
 * Measures FTS5 retrieval quality on 200 real HotpotQA questions
 * (2 supporting + 8 distractor documents each).
 *
 * Downloads the dataset on first run (~85MB), cached locally.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildBenchmarkVault, runQuery, type TempBenchVault } from './adapter.js';
import { loadHotpotQA } from './dataset-hotpotqa.js';
import { aggregateMetrics, type AggregateMetrics } from './metrics.js';
import type { BenchmarkQuestion } from './adapter.js';
import { performRecall } from '../../src/tools/read/recall.js';
import { initializeEntityIndex } from '../../src/core/write/wikilinks.js';

let vault: TempBenchVault;
let questions: BenchmarkQuestion[];

describe('HotpotQA Retrieval Benchmark', { timeout: 120_000 }, () => {
  beforeAll(async () => {
    questions = await loadHotpotQA({ count: 200, seed: 42 });
    vault = await buildBenchmarkVault(questions);
  }, 120_000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  it('should load dataset and build vault', () => {
    expect(questions.length).toBe(200);
    expect(vault.docPathMap.size).toBeGreaterThan(100);
  });

  it('should achieve minimum retrieval quality', () => {
    const results = runAllQueries(questions, vault);
    const metrics = aggregateMetrics(results);

    const report = buildReport(questions, vault, metrics);
    writeReport(report);
    printMetrics('Overall', metrics);

    // Realistic thresholds for 10-doc distractor setting
    expect(metrics.recall_at_5).toBeGreaterThanOrEqual(0.3);
    expect(metrics.mrr).toBeGreaterThanOrEqual(0.2);
  });

  it('should report breakdown by type and level', () => {
    const byType: Record<string, Array<{ retrieved: string[]; relevant: Set<string> }>> = {};
    const byLevel: Record<string, Array<{ retrieved: string[]; relevant: Set<string> }>> = {};

    for (const q of questions) {
      const retrieved = runQuery(vault.vaultPath, q.question, 10);
      const relevant = new Set(q.supporting_docs.map(t => vault.docPathMap.get(t)).filter(Boolean) as string[]);
      const entry = { retrieved, relevant };

      const type = q.type || 'unknown';
      (byType[type] ??= []).push(entry);

      const level = q.level || 'unknown';
      (byLevel[level] ??= []).push(entry);
    }

    console.log('\n--- By Type ---');
    for (const [type, results] of Object.entries(byType)) {
      printMetrics(`${type} (n=${results.length})`, aggregateMetrics(results));
    }

    console.log('\n--- By Level ---');
    for (const [level, results] of Object.entries(byLevel)) {
      printMetrics(`${level} (n=${results.length})`, aggregateMetrics(results));
    }

    // Both types should have non-zero recall
    for (const results of Object.values(byType)) {
      expect(aggregateMetrics(results).recall_at_10).toBeGreaterThan(0);
    }
  });

  it('should compare FTS5-only vs full pipeline (entity + FTS5 + graph scoring)', async () => {
    // Initialize entity index for the vault (enables entity search channel)
    await initializeEntityIndex(vault.vaultPath);

    // Run FTS5-only baseline
    const fts5Results = runAllQueries(questions, vault);
    const fts5Metrics = aggregateMetrics(fts5Results);

    // Run full pipeline via performRecall (entity search + FTS5 + graph scoring)
    const pipelineResults: Array<{ retrieved: string[]; relevant: Set<string> }> = [];

    for (const q of questions) {
      // Sanitize query for FTS5 compatibility (same tokenization as runQuery)
      const sanitized = sanitizeForFTS5(q.question);
      const recallResults = await performRecall(vault.stateDb, sanitized, {
        max_results: 10,
        focus: 'notes',  // notes channel = FTS5 + graph scoring
        vaultPath: vault.vaultPath,
      });

      // Extract note paths from recall results
      const retrieved = recallResults
        .filter(r => r.type === 'note')
        .map(r => r.id);

      const relevant = new Set(
        q.supporting_docs
          .map(t => vault.docPathMap.get(t))
          .filter(Boolean) as string[]
      );

      pipelineResults.push({ retrieved, relevant });
    }

    const pipelineMetrics = aggregateMetrics(pipelineResults);

    // Run entity+notes combined pipeline
    const combinedResults: Array<{ retrieved: string[]; relevant: Set<string> }> = [];

    for (const q of questions) {
      const sanitized = sanitizeForFTS5(q.question);
      const recallResults = await performRecall(vault.stateDb, sanitized, {
        max_results: 10,
        vaultPath: vault.vaultPath,
      });

      // For entities, we need to find their note path
      const retrieved: string[] = [];
      for (const r of recallResults) {
        if (r.type === 'note') {
          retrieved.push(r.id);
        } else if (r.type === 'entity') {
          // Find note path matching entity name
          const notePath = vault.docPathMap.get(r.id);
          if (notePath) retrieved.push(notePath);
        }
      }

      const relevant = new Set(
        q.supporting_docs
          .map(t => vault.docPathMap.get(t))
          .filter(Boolean) as string[]
      );

      combinedResults.push({ retrieved, relevant });
    }

    const combinedMetrics = aggregateMetrics(combinedResults);

    console.log('\n=== FTS5-only vs Full Pipeline Comparison ===');
    printMetrics('FTS5-only (baseline)', fts5Metrics);
    printMetrics('Notes + graph scoring', pipelineMetrics);
    printMetrics('Entities + notes + graph', combinedMetrics);

    const deltaRecall = combinedMetrics.recall_at_5 - fts5Metrics.recall_at_5;
    const deltaMrr = combinedMetrics.mrr - fts5Metrics.mrr;
    console.log(`\nDelta (combined vs FTS5): Recall@5 ${deltaRecall >= 0 ? '+' : ''}${(deltaRecall * 100).toFixed(1)}pp, MRR ${deltaMrr >= 0 ? '+' : ''}${deltaMrr.toFixed(3)}`);

    // Update report with comparison
    const report = buildReport(questions, vault, fts5Metrics);
    (report as any).pipeline_comparison = {
      fts5_only: fts5Metrics,
      notes_with_graph: pipelineMetrics,
      entities_and_notes_with_graph: combinedMetrics,
      recall_5_improvement: `${deltaRecall >= 0 ? '+' : ''}${(deltaRecall * 100).toFixed(1)}pp`,
      mrr_improvement: `${deltaMrr >= 0 ? '+' : ''}${deltaMrr.toFixed(3)}`,
    };
    writeReport(report);

    // Pipeline should be at least as good as FTS5
    expect(combinedMetrics.recall_at_10).toBeGreaterThanOrEqual(fts5Metrics.recall_at_10 * 0.9);
  }, 120_000);
});

function runAllQueries(
  questions: BenchmarkQuestion[],
  vault: TempBenchVault,
): Array<{ retrieved: string[]; relevant: Set<string> }> {
  return questions.map(q => {
    const retrieved = runQuery(vault.vaultPath, q.question, 10);
    const relevant = new Set(
      q.supporting_docs
        .map(t => vault.docPathMap.get(t))
        .filter(Boolean) as string[]
    );
    return { retrieved, relevant };
  });
}

function buildReport(
  questions: BenchmarkQuestion[],
  vault: TempBenchVault,
  metrics: AggregateMetrics,
) {
  const byType: Record<string, AggregateMetrics> = {};
  const byLevel: Record<string, AggregateMetrics> = {};

  const typeGroups: Record<string, Array<{ retrieved: string[]; relevant: Set<string> }>> = {};
  const levelGroups: Record<string, Array<{ retrieved: string[]; relevant: Set<string> }>> = {};

  for (const q of questions) {
    const retrieved = runQuery(vault.vaultPath, q.question, 10);
    const relevant = new Set(q.supporting_docs.map(t => vault.docPathMap.get(t)).filter(Boolean) as string[]);
    const entry = { retrieved, relevant };

    (typeGroups[q.type] ??= []).push(entry);
    (levelGroups[q.level || 'unknown'] ??= []).push(entry);
  }

  for (const [k, v] of Object.entries(typeGroups)) byType[k] = aggregateMetrics(v);
  for (const [k, v] of Object.entries(levelGroups)) byLevel[k] = aggregateMetrics(v);

  return {
    generated: new Date().toISOString(),
    dataset: 'hotpot_dev_distractor_v1',
    total_questions: questions.length,
    total_documents: vault.docPathMap.size,
    metrics,
    by_type: byType,
    by_level: byLevel,
  };
}

function writeReport(report: object) {
  const reportPath = join(__dirname, 'reports', 'hotpotqa-latest.json');
  try {
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
  } catch { /* reports dir may not exist */ }
}

function printMetrics(label: string, m: AggregateMetrics) {
  console.log(
    `${label}: Recall@5=${(m.recall_at_5 * 100).toFixed(1)}% Recall@10=${(m.recall_at_10 * 100).toFixed(1)}% ` +
    `MRR=${m.mrr.toFixed(3)} NDCG@10=${m.ndcg_at_10.toFixed(3)} Prec@5=${(m.precision_at_5 * 100).toFixed(1)}%`
  );
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her',
  'was', 'one', 'our', 'out', 'has', 'have', 'been', 'many', 'some', 'them',
  'than', 'its', 'over', 'such', 'that', 'this', 'what', 'with', 'will',
  'each', 'make', 'like', 'from', 'when', 'who', 'which', 'their', 'how',
  'did', 'does', 'more', 'other',
]);

/** Convert natural language question to FTS5 OR-joined query. */
function sanitizeForFTS5(query: string): string {
  return query.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 3)
    .filter(w => !STOP_WORDS.has(w))
    .join(' OR ');
}
