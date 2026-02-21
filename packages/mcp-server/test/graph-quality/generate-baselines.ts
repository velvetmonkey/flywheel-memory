#!/usr/bin/env npx tsx
/**
 * Generate baselines.json for regression gate testing.
 * Run: npx tsx test/graph-quality/generate-baselines.ts
 */
import {
  loadPrimaryVault,
  buildGroundTruthVault,
  stripLinks,
  runSuggestionsOnVault,
  evaluateSuggestions,
} from './harness.js';
import { writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('Loading primary vault fixture...');
  const spec = await loadPrimaryVault();

  console.log('Building ground truth vault...');
  const vault = await buildGroundTruthVault(spec);
  await stripLinks(vault, spec.groundTruth);

  const modes = ['conservative', 'balanced', 'aggressive'] as const;
  const primary: Record<string, { f1: number; precision: number; recall: number; mrr: number }> = {};

  for (const mode of modes) {
    console.log(`Running suggestions in ${mode} mode...`);
    const runs = await runSuggestionsOnVault(vault, { strictness: mode });
    const report = evaluateSuggestions(runs, spec.groundTruth, spec.entities);

    primary[mode] = {
      f1: report.f1,
      precision: report.precision,
      recall: report.recall,
      mrr: report.mrr,
    };

    console.log(`  ${mode}: F1=${report.f1}, P=${report.precision}, R=${report.recall}, MRR=${report.mrr}`);
  }

  const baselines = {
    generated: new Date().toISOString().split('T')[0],
    primary,
  };

  const outPath = path.join(__dirname, 'baselines.json');
  await writeFile(outPath, JSON.stringify(baselines, null, 2) + '\n', 'utf-8');
  console.log(`Baselines written to ${outPath}`);

  await vault.cleanup();
}

main().catch((err) => {
  console.error('Failed to generate baselines:', err);
  process.exit(1);
});
