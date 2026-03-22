/**
 * Retrieval Benchmark
 *
 * Measures FTS5 retrieval quality on synthetic multi-document questions.
 * Produces Recall@K, MRR, Precision@K, and NDCG metrics.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildBenchmarkVault, runQuery, type TempBenchVault } from './adapter.js';
import { BENCHMARK_QUESTIONS } from './dataset.js';
import { aggregateMetrics, recallAtK, mrr } from './metrics.js';

let vault: TempBenchVault;

describe('Retrieval Benchmark', () => {
  beforeAll(async () => {
    vault = await buildBenchmarkVault(BENCHMARK_QUESTIONS);
  }, 30_000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  it('should build vault with all documents', () => {
    expect(vault.docPathMap.size).toBeGreaterThan(0);
    // Each question has 2-4 context docs, many shared across questions
    expect(vault.docPathMap.size).toBeGreaterThanOrEqual(10);
  });

  it('should retrieve supporting documents with Recall@5 >= 40%', () => {
    const results: Array<{ retrieved: string[]; relevant: Set<string> }> = [];

    for (const q of BENCHMARK_QUESTIONS) {
      const retrieved = runQuery(vault.vaultPath, q.question, 10);

      const relevant = new Set<string>();
      for (const docTitle of q.supporting_docs) {
        const path = vault.docPathMap.get(docTitle);
        if (path) relevant.add(path);
      }

      results.push({ retrieved, relevant });
    }

    const metrics = aggregateMetrics(results);

    // Write report
    const report = {
      generated: new Date().toISOString(),
      total_questions: BENCHMARK_QUESTIONS.length,
      bridge_questions: BENCHMARK_QUESTIONS.filter(q => q.type === 'bridge').length,
      comparison_questions: BENCHMARK_QUESTIONS.filter(q => q.type === 'comparison').length,
      total_documents: vault.docPathMap.size,
      metrics,
    };

    const reportPath = join(__dirname, 'reports', 'latest.json');
    try {
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
    } catch { /* reports dir may not exist in CI */ }

    console.log('\n=== Retrieval Benchmark Results ===');
    console.log(`Questions: ${report.total_questions} (${report.bridge_questions} bridge, ${report.comparison_questions} comparison)`);
    console.log(`Documents: ${report.total_documents}`);
    console.log(`Recall@5:    ${(metrics.recall_at_5 * 100).toFixed(1)}%`);
    console.log(`Recall@10:   ${(metrics.recall_at_10 * 100).toFixed(1)}%`);
    console.log(`Precision@5: ${(metrics.precision_at_5 * 100).toFixed(1)}%`);
    console.log(`MRR:         ${metrics.mrr.toFixed(3)}`);
    console.log(`NDCG@10:     ${metrics.ndcg_at_10.toFixed(3)}`);

    // Minimum thresholds
    expect(metrics.recall_at_5).toBeGreaterThanOrEqual(0.4);
    expect(metrics.mrr).toBeGreaterThanOrEqual(0.3);
  });

  it('should show per-type breakdown', () => {
    const bridgeResults: Array<{ retrieved: string[]; relevant: Set<string> }> = [];
    const comparisonResults: Array<{ retrieved: string[]; relevant: Set<string> }> = [];

    for (const q of BENCHMARK_QUESTIONS) {
      const retrieved = runQuery(vault.vaultPath, q.question, 10);
      const relevant = new Set<string>();
      for (const docTitle of q.supporting_docs) {
        const path = vault.docPathMap.get(docTitle);
        if (path) relevant.add(path);
      }

      if (q.type === 'bridge') {
        bridgeResults.push({ retrieved, relevant });
      } else {
        comparisonResults.push({ retrieved, relevant });
      }
    }

    const bridgeMetrics = aggregateMetrics(bridgeResults);
    const comparisonMetrics = aggregateMetrics(comparisonResults);

    console.log('\n--- Bridge Questions ---');
    console.log(`Recall@5: ${(bridgeMetrics.recall_at_5 * 100).toFixed(1)}%, MRR: ${bridgeMetrics.mrr.toFixed(3)}`);
    console.log('\n--- Comparison Questions ---');
    console.log(`Recall@5: ${(comparisonMetrics.recall_at_5 * 100).toFixed(1)}%, MRR: ${comparisonMetrics.mrr.toFixed(3)}`);

    // Both types should have non-zero recall
    expect(bridgeMetrics.recall_at_5).toBeGreaterThan(0);
    expect(comparisonMetrics.recall_at_5).toBeGreaterThan(0);
  });
});
