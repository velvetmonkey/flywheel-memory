import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '../../../../../');
const README_PATH = path.join(REPO_ROOT, 'README.md');
const DOCS_TESTING_PATH = path.join(REPO_ROOT, 'docs', 'TESTING.md');
const DOCS_PROVE_IT_PATH = path.join(REPO_ROOT, 'docs', 'PROVE-IT.md');
const DOCS_README_PATH = path.join(REPO_ROOT, 'docs', 'README.md');
const DOCS_VISION_PATH = path.join(REPO_ROOT, 'docs', 'VISION.md');
const DOCS_QUALITY_REPORT_PATH = path.join(REPO_ROOT, 'docs', 'QUALITY_REPORT.md');
const DEMOS_DIR = path.join(REPO_ROOT, 'demos');

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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('documentation claims truth', () => {
  it.skipIf(!hasResults)('README and benchmark docs match the latest checked-in HotpotQA and LoCoMo artifacts', async () => {
    const [readme, testingDoc, proveItDoc] = await Promise.all([
      read(README_PATH),
      read(DOCS_TESTING_PATH),
      read(DOCS_PROVE_IT_PATH),
    ]);

    const hotpotRunDir = await findLatestRunDir('hotpotqa');
    const hotpotAnalysis = JSON.parse(await read(path.join(hotpotRunDir, 'analysis.json')));

    const locomoRunDir = await findLatestRunDir('locomo');
    const locomoAnalysis = JSON.parse(await read(path.join(locomoRunDir, 'analysis.json')));
    const locomoReport = await read(path.join(locomoRunDir, 'report.md'));

    const hotpotDocRecall = `${(hotpotAnalysis.overall_recall * 100).toFixed(1)}%`;
    const hotpotFullRecall = `${((hotpotAnalysis.full_recall_count / hotpotAnalysis.total_questions) * 100).toFixed(1)}%`;
    const hotpotPartialRecall = `${((hotpotAnalysis.partial_recall_count / hotpotAnalysis.total_questions) * 100).toFixed(1)}%`;
    const hotpotCost = `$${(hotpotAnalysis.total_cost_usd / hotpotAnalysis.total_questions).toFixed(3)}`;

    const locomoEvidenceRecall = `${(locomoAnalysis.overall_evidence_recall * 100).toFixed(1)}%`;
    const locomoFinalF1 = locomoAnalysis.overall_final_token_f1.toFixed(3);
    const locomoRawF1 = locomoAnalysis.overall_raw_token_f1.toFixed(3);
    const locomoCost = `$${(locomoAnalysis.total_cost_usd / locomoAnalysis.scored_questions).toFixed(3)}`;
    const judgeMatch = locomoReport.match(/Answer Accuracy \| \*\*([0-9.]+%)\*\*/);
    expect(judgeMatch, 'LoCoMo report should include Answer Accuracy').toBeTruthy();
    const locomoAccuracy = judgeMatch![1];

    for (const doc of [readme, testingDoc, proveItDoc]) {
      expect(doc).toContain(hotpotDocRecall);
      expect(doc).toContain(locomoEvidenceRecall);
    }

    expect(testingDoc).toContain(hotpotCost);
    expect(proveItDoc).toContain(hotpotCost);
    expect(readme).toContain(locomoAccuracy);
    expect(testingDoc).toContain(locomoAccuracy);
    expect(proveItDoc).toContain(locomoAccuracy);
    expect(testingDoc).toContain(locomoFinalF1);
    expect(proveItDoc).toContain(locomoFinalF1);
    expect(proveItDoc).toContain(locomoRawF1);
    expect(proveItDoc).toContain(locomoCost);
    expect(proveItDoc).toContain(hotpotFullRecall);
    expect(proveItDoc).toContain(hotpotPartialRecall);
  });

  it('README and docs do not contain known stale benchmark or quality phrases', async () => {
    const docs = await Promise.all([
      read(README_PATH),
      read(DOCS_TESTING_PATH),
      read(DOCS_PROVE_IT_PATH),
      read(DOCS_VISION_PATH),
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

  it('README graph-quality headline matches the latest generated quality report', async () => {
    const [readme, qualityReport] = await Promise.all([
      read(README_PATH),
      read(DOCS_QUALITY_REPORT_PATH),
    ]);

    const balancedMatch = qualityReport.match(/\| balanced \| ([0-9.]+%) \| ([0-9.]+%) \| ([0-9.]+%) \|/i);
    expect(balancedMatch, 'QUALITY_REPORT should include balanced-mode metrics').toBeTruthy();

    const [, precision, recall, f1] = balancedMatch!;
    expect(readme).toContain(precision);
    expect(readme).toContain(recall);
    expect(readme).toContain(f1);
  });

  it('docs index lists the shipped demos with .mcp.json files', async () => {
    const docsIndex = await read(DOCS_README_PATH);
    const entries = await fs.readdir(DEMOS_DIR, { withFileTypes: true });
    const shippedDemos = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);

    const configuredDemos: string[] = [];
    for (const demo of shippedDemos) {
      try {
        await fs.access(path.join(DEMOS_DIR, demo, '.mcp.json'));
        configuredDemos.push(demo);
      } catch {
        // Not a shipped demo vault, ignore.
      }
    }

    expect(configuredDemos.length).toBe(7);
    for (const demo of configuredDemos) {
      expect(docsIndex).toMatch(new RegExp(`\\[${escapeRegex(demo)}\\]`));
    }
  });
});
