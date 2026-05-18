import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '../../../../../');
const README_PATH = path.join(REPO_ROOT, 'README.md');
const DOCS_TESTING_PATH = path.join(REPO_ROOT, 'docs', 'TESTING.md');
const BENCH_ITERATION_INDEX_PATH = path.join(REPO_ROOT, 'packages', 'bench', 'src', 'iteration', 'index.ts');
const BENCH_ITERATION_CLI_PATH = path.join(REPO_ROOT, 'packages', 'bench', 'src', 'cli', 'iteration-stress.ts');

const hasResults = existsSync(path.join(REPO_ROOT, 'demos', 'hotpotqa', 'results'))
  && existsSync(path.join(REPO_ROOT, 'demos', 'locomo', 'results'));

async function read(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8');
}

async function findLatestRunDir(dataset: 'hotpotqa' | 'locomo'): Promise<string> {
  const resultsDir = path.join(REPO_ROOT, 'demos', dataset, 'results');
  const entries = await fs.readdir(resultsDir, { withFileTypes: true });
  const runs = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('run-'))
    .map(entry => entry.name)
    .sort();

  if (runs.length === 0) {
    throw new Error(`No run directories found in ${resultsDir}`);
  }

  return path.join(resultsDir, runs[runs.length - 1]);
}

describe('documentation claims truth', () => {
  it.skipIf(!hasResults)('README and benchmark docs match the latest checked-in HotpotQA and LoCoMo artifacts', async () => {
    const [readme, testingDoc] = await Promise.all([
      read(README_PATH),
      read(DOCS_TESTING_PATH),
    ]);

    const hotpotRunDir = await findLatestRunDir('hotpotqa');
    const hotpotAnalysis = JSON.parse(await read(path.join(hotpotRunDir, 'analysis.json')));

    const locomoRunDir = await findLatestRunDir('locomo');
    const locomoAnalysis = JSON.parse(await read(path.join(locomoRunDir, 'analysis.json')));
    const locomoReport = await read(path.join(locomoRunDir, 'report.md'));

    const hotpotDocRecall = `${(hotpotAnalysis.overall_recall * 100).toFixed(1)}%`;
    const hotpotCost = `$${(hotpotAnalysis.total_cost_usd / hotpotAnalysis.total_questions).toFixed(3)}`;

    const locomoEvidenceRecall = `${(locomoAnalysis.overall_evidence_recall * 100).toFixed(1)}%`;
    const locomoFinalF1 = locomoAnalysis.overall_final_token_f1.toFixed(3);
    const judgeMatch = locomoReport.match(/Answer Accuracy \| \*\*([0-9.]+%)\*\*/);
    expect(judgeMatch, 'LoCoMo report should include Answer Accuracy').toBeTruthy();
    const locomoAccuracy = judgeMatch![1];

    for (const doc of [readme, testingDoc]) {
      expect(doc).toContain(hotpotDocRecall);
      expect(doc).toContain(locomoEvidenceRecall);
    }

    expect(testingDoc).toContain(hotpotCost);
    expect(readme).toContain(locomoAccuracy);
    expect(testingDoc).toContain(locomoAccuracy);
    expect(testingDoc).toContain(locomoFinalF1);
  });

  it('README and docs do not contain known stale benchmark or quality phrases', async () => {
    const docs = await Promise.all([
      read(README_PATH),
      read(DOCS_TESTING_PATH),
    ]);

    const bannedPhrases = [
      '2,712',
      '129 test files',
      '47,000+ lines of test code',
      '100% wikilink precision',
      'Precision holds at 100%',
      '84.9% recall, 58.8% accuracy',
      '759 questions',
      'As of March 2026, we are not aware',
      'We are not aware of any other MCP server',
    ];

    for (const doc of docs) {
      for (const phrase of bannedPhrases) {
        expect(doc.includes(phrase), `Unexpected stale phrase: ${phrase}`).toBe(false);
      }
    }
  });

  it('iteration stress bench is labeled simulation-only everywhere it surfaces', async () => {
    const [iterationIndex, iterationCli] = await Promise.all([
      read(BENCH_ITERATION_INDEX_PATH),
      read(BENCH_ITERATION_CLI_PATH),
    ]);

    expect(iterationIndex).toContain('simulation-only');
    expect(iterationCli).toContain('simulation-only');
    expect(iterationIndex).not.toContain('real impl would use mutation functions');
    expect(iterationCli).toContain('Running iteration stress test (simulation-only)');
  });
});
