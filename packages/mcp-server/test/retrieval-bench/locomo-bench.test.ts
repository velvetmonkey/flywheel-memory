/**
 * LoCoMo Retrieval Benchmark
 *
 * Measures retrieval quality on the LoCoMo-10 dataset (10 conversations,
 * ~1986 QA pairs across 5 categories). Tests FTS5 retrieval against
 * evidence session notes, with vault mode comparison and pipeline comparison.
 *
 * Downloads the dataset on first run (~2MB), cached locally.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadLoCoMo, flattenQuestions, CATEGORY_MAP } from './dataset-locomo.js';
import type { LoCoMoEntry, LoCoMoBenchmarkQuestion } from './dataset-locomo.js';
import {
  buildLoCoMoVault,
  runQuery,
  runMultiHopQuery,
  runHybridQuery,
  getRelevantPaths,
  type LoCoMoVault,
  type VaultMode,
} from './adapter-locomo.js';
import { aggregateMetrics, type AggregateMetrics } from './metrics.js';
import { setWriteStateDb } from '../../src/core/write/wikilinks.js';
import { setFTS5Database } from '../../src/core/read/fts5.js';
import { setRecencyStateDb } from '../../src/core/shared/recency.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let entries: LoCoMoEntry[];
let questions: LoCoMoBenchmarkQuestion[];
let vault: LoCoMoVault;
// Accumulated report — each test contributes its section
const report: Record<string, any> = {};

describe('LoCoMo Retrieval Benchmark', { timeout: 300_000 }, () => {
  beforeAll(async () => {
    entries = await loadLoCoMo();
    questions = flattenQuestions(entries);
    vault = await buildLoCoMoVault(entries, { mode: 'dialog' });
  }, 300_000);

  afterAll(async () => {
    // Write final accumulated report
    writeReport(report);
    if (vault) await vault.cleanup();
  });

  it('should load dataset and build vault', () => {
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(questions.length).toBeGreaterThan(100);
    expect(vault.totalSessions).toBeGreaterThan(50);

    console.log(`Loaded: ${entries.length} conversations, ${questions.length} QA pairs, ${vault.totalSessions} session notes`);

    // Count by category
    const byCat: Record<string, number> = {};
    for (const q of questions) {
      byCat[q.category] = (byCat[q.category] || 0) + 1;
    }
    console.log('By category:', byCat);
  });

  it('should achieve minimum retrieval quality on non-adversarial questions', () => {
    // Exclude adversarial questions (no evidence to retrieve)
    const testQuestions = questions.filter(q => q.category !== 'adversarial');
    const results = runAllQueries(testQuestions, vault);
    const metrics = aggregateMetrics(results);

    // Populate shared report
    Object.assign(report, buildReport(entries, questions, vault, metrics, testQuestions, results));
    printMetrics('Overall (non-adversarial)', metrics);

    // Conversational text is harder for FTS5 than encyclopedic text
    expect(metrics.recall_at_10).toBeGreaterThanOrEqual(0.15);
  });

  it('should report breakdown by question category', () => {
    const byCategory: Record<string, Array<{ retrieved: string[]; relevant: Set<string> }>> = {};

    for (const q of questions) {
      if (q.category === 'adversarial') continue;

      const retrieved = runQuery(vault.vaultPath, q.question, 10);
      const relevant = getRelevantPaths(q, vault);
      if (relevant.size === 0) continue;

      (byCategory[q.category] ??= []).push({ retrieved, relevant });
    }

    console.log('\n--- By Category ---');
    for (const [cat, results] of Object.entries(byCategory).sort()) {
      printMetrics(`${cat} (n=${results.length})`, aggregateMetrics(results));
    }

    // All categories should have some recall
    for (const [cat, results] of Object.entries(byCategory)) {
      const m = aggregateMetrics(results);
      expect(m.recall_at_10, `${cat} should have non-zero recall`).toBeGreaterThan(0);
    }
  });

  it('should compare vault modes (dialog vs observation vs summary)', async () => {
    const modes: VaultMode[] = ['dialog', 'observation', 'summary'];
    const testQuestions = questions.filter(q => q.category !== 'adversarial');
    const modeResults: Record<string, AggregateMetrics> = {};

    for (const mode of modes) {
      let modeVault: LoCoMoVault | undefined;
      try {
        modeVault = await buildLoCoMoVault(entries, { mode });

        const results: Array<{ retrieved: string[]; relevant: Set<string> }> = [];
        for (const q of testQuestions) {
          const retrieved = runQuery(modeVault.vaultPath, q.question, 10);
          const relevant = getRelevantPaths(q, modeVault);
          if (relevant.size > 0) {
            results.push({ retrieved, relevant });
          }
        }

        const metrics = aggregateMetrics(results);
        modeResults[mode] = metrics;
        printMetrics(`${mode} mode`, metrics);
      } finally {
        if (modeVault) await modeVault.cleanup();
      }
    }

    // Restore module-level state for the original vault (cleanup nullified it)
    setWriteStateDb(vault.stateDb);
    setRecencyStateDb(vault.stateDb);
    setFTS5Database(vault.stateDb.db);

    // Add mode comparison to shared report
    report.by_vault_mode = modeResults;

    console.log('\n=== Vault Mode Comparison ===');
    for (const [mode, m] of Object.entries(modeResults)) {
      console.log(`  ${mode}: Recall@5=${(m.recall_at_5 * 100).toFixed(1)}% Recall@10=${(m.recall_at_10 * 100).toFixed(1)}%`);
    }
  }, 300_000);


  it('should compare single-hop vs multi-hop retrieval for multi_hop questions', () => {
    const multiHopQuestions = questions.filter(q => q.category === 'multi_hop');
    
    const singleHopResults: Array<{ retrieved: string[]; relevant: Set<string> }> = [];
    const multiHopResults: Array<{ retrieved: string[]; relevant: Set<string> }> = [];
    
    for (const q of multiHopQuestions) {
      const relevant = getRelevantPaths(q, vault);
      if (relevant.size === 0) continue;
      
      const singleRetrieved = runQuery(vault.vaultPath, q.question, 10);
      const multiRetrieved = runMultiHopQuery(vault.vaultPath, q.question, 10);
      
      singleHopResults.push({ retrieved: singleRetrieved, relevant });
      multiHopResults.push({ retrieved: multiRetrieved, relevant });
    }
    
    const singleMetrics = aggregateMetrics(singleHopResults);
    const multiMetrics = aggregateMetrics(multiHopResults);
    
    console.log('\n=== Multi-Hop Retrieval Comparison (multi_hop category) ===');
    console.log(`  Single-hop: Recall@5=${(singleMetrics.recall_at_5 * 100).toFixed(1)}% Recall@10=${(singleMetrics.recall_at_10 * 100).toFixed(1)}% MRR=${singleMetrics.mrr.toFixed(3)}`);
    console.log(`  Multi-hop:  Recall@5=${(multiMetrics.recall_at_5 * 100).toFixed(1)}% Recall@10=${(multiMetrics.recall_at_10 * 100).toFixed(1)}% MRR=${multiMetrics.mrr.toFixed(3)}`);
    console.log(`  Delta:      Recall@5=${((multiMetrics.recall_at_5 - singleMetrics.recall_at_5) * 100).toFixed(1)}pp Recall@10=${((multiMetrics.recall_at_10 - singleMetrics.recall_at_10) * 100).toFixed(1)}pp`);
    
    // Multi-hop should not regress vs single-hop
    expect(multiMetrics.recall_at_5).toBeGreaterThanOrEqual(singleMetrics.recall_at_5 - 0.02);
  });

});

// --- Helpers ---

function runAllQueries(
  testQuestions: LoCoMoBenchmarkQuestion[],
  v: LoCoMoVault,
): Array<{ retrieved: string[]; relevant: Set<string> }> {
  const results: Array<{ retrieved: string[]; relevant: Set<string> }> = [];
  for (const q of testQuestions) {
    const retrieved = runQuery(v.vaultPath, q.question, 10);
    const relevant = getRelevantPaths(q, v);
    if (relevant.size > 0) {
      results.push({ retrieved, relevant });
    }
  }
  return results;
}

function buildReport(
  entries: LoCoMoEntry[],
  allQuestions: LoCoMoBenchmarkQuestion[],
  v: LoCoMoVault,
  metrics: AggregateMetrics,
  testQuestions: LoCoMoBenchmarkQuestion[],
  precomputedResults?: Array<{ retrieved: string[]; relevant: Set<string> }>,
) {
  const byCategory: Record<string, AggregateMetrics> = {};
  const categoryGroups: Record<string, Array<{ retrieved: string[]; relevant: Set<string> }>> = {};

  if (precomputedResults) {
    // Use pre-computed results, match against testQuestions by index
    for (let i = 0, ri = 0; i < testQuestions.length && ri < precomputedResults.length; i++) {
      const q = testQuestions[i];
      const relevant = getRelevantPaths(q, v);
      if (relevant.size === 0) continue;
      (categoryGroups[q.category] ??= []).push(precomputedResults[ri++]);
    }
  } else {
    for (const q of testQuestions) {
      const retrieved = runQuery(v.vaultPath, q.question, 10);
      const relevant = getRelevantPaths(q, v);
      if (relevant.size === 0) continue;
      (categoryGroups[q.category] ??= []).push({ retrieved, relevant });
    }
  }

  for (const [k, results] of Object.entries(categoryGroups)) {
    byCategory[k] = aggregateMetrics(results);
  }

  return {
    generated: new Date().toISOString(),
    dataset: 'locomo10',
    total_conversations: entries.length,
    total_questions: allQuestions.length,
    total_sessions: v.totalSessions,
    scored_questions: testQuestions.length,
    metrics,
    by_category: byCategory,
  };
}

function writeReport(report: object) {
  const reportsDir = join(__dirname, 'reports');
  try {
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(join(reportsDir, 'locomo-latest.json'), JSON.stringify(report, null, 2));
  } catch { /* reports dir may not exist */ }
}

function printMetrics(label: string, m: AggregateMetrics) {
  console.log(
    `${label}: Recall@5=${(m.recall_at_5 * 100).toFixed(1)}% Recall@10=${(m.recall_at_10 * 100).toFixed(1)}% ` +
    `MRR=${m.mrr.toFixed(3)} NDCG@10=${m.ndcg_at_10.toFixed(3)} Prec@5=${(m.precision_at_5 * 100).toFixed(1)}%`,
  );
}


// --- Opt-in Hybrid Benchmark (env: FLYWHEEL_BENCH_SEMANTIC=1) ---

const runHybrid = process.env.FLYWHEEL_BENCH_SEMANTIC === '1';

describe.skipIf(!runHybrid)('LoCoMo Hybrid Retrieval', { timeout: 600_000 }, () => {
  let hybridEntries: LoCoMoEntry[];
  let hybridQuestions: LoCoMoBenchmarkQuestion[];
  let hybridVault: LoCoMoVault;

  beforeAll(async () => {
    hybridEntries = await loadLoCoMo();
    hybridQuestions = flattenQuestions(hybridEntries);
    hybridVault = await buildLoCoMoVault(hybridEntries, { mode: 'dialog', semantic: true });
  }, 600_000);

  afterAll(async () => {
    if (hybridVault) await hybridVault.cleanup();
  });

  it('should compare BM25 vs hybrid recall across all categories', async () => {
    const testQuestions = hybridQuestions.filter(q => q.category !== 'adversarial');

    const byCategory: Record<string, {
      bm25: Array<{ retrieved: string[]; relevant: Set<string> }>;
      hybrid: Array<{ retrieved: string[]; relevant: Set<string> }>;
    }> = {};

    for (const q of testQuestions) {
      const relevant = getRelevantPaths(q, hybridVault);
      if (relevant.size === 0) continue;

      const bm25Retrieved = runQuery(hybridVault.vaultPath, q.question, 10);
      const hybridRetrieved = await runHybridQuery(hybridVault.vaultPath, q.question, 10);

      const cat = q.category;
      (byCategory[cat] ??= { bm25: [], hybrid: [] });
      byCategory[cat].bm25.push({ retrieved: bm25Retrieved, relevant });
      byCategory[cat].hybrid.push({ retrieved: hybridRetrieved, relevant });
    }

    console.log('\n=== BM25 vs Hybrid Retrieval Comparison ===');
    for (const [cat, { bm25, hybrid }] of Object.entries(byCategory).sort()) {
      const bm25m = aggregateMetrics(bm25);
      const hybm = aggregateMetrics(hybrid);
      const delta5 = ((hybm.recall_at_5 - bm25m.recall_at_5) * 100).toFixed(1);
      const delta10 = ((hybm.recall_at_10 - bm25m.recall_at_10) * 100).toFixed(1);
      console.log(`  ${cat} (n=${bm25.length}):`);
      console.log(`    BM25:   Recall@5=${(bm25m.recall_at_5 * 100).toFixed(1)}% Recall@10=${(bm25m.recall_at_10 * 100).toFixed(1)}% MRR=${bm25m.mrr.toFixed(3)}`);
      console.log(`    Hybrid: Recall@5=${(hybm.recall_at_5 * 100).toFixed(1)}% Recall@10=${(hybm.recall_at_10 * 100).toFixed(1)}% MRR=${hybm.mrr.toFixed(3)}`);
      console.log(`    Delta:  Recall@5=${delta5}pp Recall@10=${delta10}pp`);
    }

    // Overall comparison
    const allBm25 = Object.values(byCategory).flatMap(c => c.bm25);
    const allHybrid = Object.values(byCategory).flatMap(c => c.hybrid);
    const overallBm25 = aggregateMetrics(allBm25);
    const overallHybrid = aggregateMetrics(allHybrid);
    console.log(`\n  Overall:`);
    console.log(`    BM25:   Recall@5=${(overallBm25.recall_at_5 * 100).toFixed(1)}% Recall@10=${(overallBm25.recall_at_10 * 100).toFixed(1)}%`);
    console.log(`    Hybrid: Recall@5=${(overallHybrid.recall_at_5 * 100).toFixed(1)}% Recall@10=${(overallHybrid.recall_at_10 * 100).toFixed(1)}%`);

    // Write hybrid report
    const reportDir = join(__dirname, 'reports');
    mkdirSync(reportDir, { recursive: true });
    const hybridReport: Record<string, any> = {
      generated: new Date().toISOString(),
      dataset: 'locomo10',
      method: 'hybrid_comparison',
    };
    for (const [cat, { bm25, hybrid }] of Object.entries(byCategory)) {
      hybridReport[cat] = {
        bm25: aggregateMetrics(bm25),
        hybrid: aggregateMetrics(hybrid),
      };
    }
    hybridReport.overall = {
      bm25: overallBm25,
      hybrid: overallHybrid,
    };
    writeFileSync(join(reportDir, 'locomo-hybrid.json'), JSON.stringify(hybridReport, null, 2));
  });
});
