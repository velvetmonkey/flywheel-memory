/**
 * HotpotQA Retrieval Benchmark — CI Regression Gate
 *
 * Runs 200 questions (seed 42) as a regression gate to catch catastrophic
 * retrieval regressions. Thresholds (recall_at_5 >= 0.3, mrr >= 0.2) are
 * intentionally conservative — they detect breakage, not quality guarantees.
 *
 * The published 89.6% recall in docs/TESTING.md comes from a separate full
 * 500-question benchmark run. The 200-question CI sample has wider confidence
 * intervals and is not expected to match the headline number.
 *
 * Downloads the dataset on first run (~85MB), cached locally.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync } from 'fs';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildBenchmarkVault, runQuery, runHybridQuery, type TempBenchVault } from './adapter.js';
import { loadHotpotQA } from './dataset-hotpotqa.js';
import { aggregateMetrics, type AggregateMetrics } from './metrics.js';
import type { BenchmarkQuestion } from './adapter.js';

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


// --- Opt-in Hybrid Benchmark (env: FLYWHEEL_BENCH_SEMANTIC=1) ---

const runHybridBench = process.env.FLYWHEEL_BENCH_SEMANTIC === '1';

describe.skipIf(!runHybridBench)('HotpotQA Hybrid Retrieval', { timeout: 600_000 }, () => {
  let hybridVault: TempBenchVault;
  let hybridQuestions: BenchmarkQuestion[];

  beforeAll(async () => {
    hybridQuestions = await loadHotpotQA({ count: 200, seed: 42 });
    hybridVault = await buildBenchmarkVault(hybridQuestions, { semantic: true });
  }, 600_000);

  afterAll(async () => {
    if (hybridVault) await hybridVault.cleanup();
  });

  it('should compare BM25 vs hybrid recall', async () => {
    const bm25Results: Array<{ retrieved: string[]; relevant: Set<string> }> = [];
    const hybridResults: Array<{ retrieved: string[]; relevant: Set<string> }> = [];

    for (const q of hybridQuestions) {
      const relevant = new Set(
        q.supporting_docs
          .map(t => hybridVault.docPathMap.get(t))
          .filter(Boolean) as string[]
      );

      const bm25Retrieved = runQuery(hybridVault.vaultPath, q.question, 10);
      const hybridRetrieved = await runHybridQuery(hybridVault.vaultPath, q.question, 10);

      bm25Results.push({ retrieved: bm25Retrieved, relevant });
      hybridResults.push({ retrieved: hybridRetrieved, relevant });
    }

    const bm25m = aggregateMetrics(bm25Results);
    const hybm = aggregateMetrics(hybridResults);

    console.log('\n=== BM25 vs Hybrid Retrieval ===');
    console.log(`  BM25:   Recall@5=${(bm25m.recall_at_5 * 100).toFixed(1)}% Recall@10=${(bm25m.recall_at_10 * 100).toFixed(1)}% MRR=${bm25m.mrr.toFixed(3)}`);
    console.log(`  Hybrid: Recall@5=${(hybm.recall_at_5 * 100).toFixed(1)}% Recall@10=${(hybm.recall_at_10 * 100).toFixed(1)}% MRR=${hybm.mrr.toFixed(3)}`);
    console.log(`  Delta:  Recall@5=${((hybm.recall_at_5 - bm25m.recall_at_5) * 100).toFixed(1)}pp Recall@10=${((hybm.recall_at_10 - bm25m.recall_at_10) * 100).toFixed(1)}pp`);

    // Write hybrid report
    const reportPath = join(__dirname, 'reports', 'hotpotqa-hybrid.json');
    try {
      mkdirSync(join(__dirname, 'reports'), { recursive: true });
      writeFileSync(reportPath, JSON.stringify({
        generated: new Date().toISOString(),
        dataset: 'hotpot_dev_distractor_v1',
        questions: hybridQuestions.length,
        bm25: bm25m,
        hybrid: hybm,
      }, null, 2));
    } catch { /* ignore */ }
  });
});
