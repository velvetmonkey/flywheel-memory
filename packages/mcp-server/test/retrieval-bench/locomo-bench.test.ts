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
  getRelevantPaths,
  type LoCoMoVault,
  type VaultMode,
} from './adapter-locomo.js';
import { aggregateMetrics, type AggregateMetrics } from './metrics.js';
import { performRecall } from '../../src/tools/read/recall.js';
import { initializeEntityIndex, setWriteStateDb } from '../../src/core/write/wikilinks.js';
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

  it('should compare FTS5-only vs full pipeline', async () => {
    await initializeEntityIndex(vault.vaultPath);

    const testQuestions = questions.filter(q => q.category !== 'adversarial');

    // FTS5-only baseline
    const fts5Results = runAllQueries(testQuestions, vault);
    const fts5Metrics = aggregateMetrics(fts5Results);

    // Full pipeline via performRecall
    const pipelineResults: Array<{ retrieved: string[]; relevant: Set<string> }> = [];

    for (const q of testQuestions) {
      const sanitized = sanitizeForFTS5(q.question);
      try {
        const recallResults = await performRecall(vault.stateDb, sanitized, {
          max_results: 10,
          focus: 'notes',
          vaultPath: vault.vaultPath,
        });

        const retrieved = recallResults
          .filter(r => r.type === 'note')
          .map(r => r.id);

        const relevant = getRelevantPaths(q, vault);
        if (relevant.size > 0) {
          pipelineResults.push({ retrieved, relevant });
        }
      } catch {
        const relevant = getRelevantPaths(q, vault);
        if (relevant.size > 0) {
          pipelineResults.push({ retrieved: [], relevant });
        }
      }
    }

    const pipelineMetrics = aggregateMetrics(pipelineResults);

    console.log('\n=== FTS5-only vs Full Pipeline ===');
    printMetrics('FTS5-only', fts5Metrics);
    printMetrics('Full pipeline (notes)', pipelineMetrics);

    const deltaRecall = pipelineMetrics.recall_at_5 - fts5Metrics.recall_at_5;
    console.log(`Delta: Recall@5 ${deltaRecall >= 0 ? '+' : ''}${(deltaRecall * 100).toFixed(1)}pp`);

    // Add pipeline comparison to shared report
    report.pipeline_comparison = {
      fts5_only: fts5Metrics,
      full_pipeline: pipelineMetrics,
    };

    // Pipeline should not be significantly worse than FTS5
    expect(pipelineMetrics.recall_at_10).toBeGreaterThanOrEqual(fts5Metrics.recall_at_10 * 0.8);
  }, 300_000);
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

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her',
  'was', 'one', 'our', 'out', 'has', 'have', 'been', 'many', 'some', 'them',
  'than', 'its', 'over', 'such', 'that', 'this', 'what', 'with', 'will',
  'each', 'make', 'like', 'from', 'when', 'who', 'which', 'their', 'how',
  'did', 'does', 'more', 'other',
]);

function sanitizeForFTS5(query: string): string {
  return query.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 3)
    .filter(w => !STOP_WORDS.has(w))
    .join(' OR ');
}
