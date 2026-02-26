/**
 * Regression Gate: ensures suggestion quality metrics don't regress
 * beyond a 5% tolerance from recorded baselines.
 *
 * To regenerate: npx tsx test/graph-quality/generate-baselines.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildGroundTruthVault,
  stripLinks,
  runSuggestionsOnVault,
  evaluateSuggestions,
  loadPrimaryVault,
  type TempVault,
  type GroundTruthSpec,
  type PrecisionRecallReport,
} from './harness.js';
import type { StrictnessMode } from '../../src/core/write/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baselinesPath = path.join(__dirname, 'baselines.json');

interface BaselineMetrics {
  f1: number;
  precision: number;
  recall: number;
  mrr: number;
}

interface Baselines {
  generated: string;
  primary: Record<string, BaselineMetrics>;
}

describe('Regression Gate', () => {
  let vault: TempVault;
  let spec: GroundTruthSpec;
  let baselines: Baselines | null = null;
  const reports: Record<string, PrecisionRecallReport> = {};
  const modes: StrictnessMode[] = ['conservative', 'balanced', 'aggressive'];

  beforeAll(async () => {
    // Load baselines — if the file doesn't exist, tests will be skipped gracefully
    try {
      const raw = await readFile(baselinesPath, 'utf-8');
      baselines = JSON.parse(raw) as Baselines;
    } catch {
      // baselines.json missing or invalid — tests will skip
      return;
    }

    spec = await loadPrimaryVault();
    vault = await buildGroundTruthVault(spec);
    await stripLinks(vault, spec.groundTruth);

    for (const mode of modes) {
      const runs = await runSuggestionsOnVault(vault, { strictness: mode });
      reports[mode] = evaluateSuggestions(runs, spec.groundTruth, spec.entities);
    }
  }, 60000);

  afterAll(async () => {
    if (vault) await vault.cleanup();
  });

  it('baselines.json exists and is valid', () => {
    expect(baselines).not.toBeNull();
    expect(baselines!.primary).toBeDefined();

    for (const mode of modes) {
      expect(baselines!.primary[mode]).toBeDefined();
      expect(baselines!.primary[mode].f1).toBeTypeOf('number');
      expect(baselines!.primary[mode].precision).toBeTypeOf('number');
      expect(baselines!.primary[mode].recall).toBeTypeOf('number');
      expect(baselines!.primary[mode].mrr).toBeTypeOf('number');
    }
  });

  for (const mode of modes) {
    it(`${mode} F1 within 5% of baseline`, () => {
      if (!baselines) return; // skip if baselines missing
      const baseline = baselines.primary[mode];
      const report = reports[mode];
      expect(report).toBeDefined();
      expect(report.f1).toBeGreaterThanOrEqual(baseline.f1 - 0.05);
    });
  }

  it('should maintain T3 recall above floor', () => {
    if (!baselines) return;
    const report = reports['balanced'];
    expect(report).toBeDefined();
    expect(report.byTier[3].recall).toBeGreaterThanOrEqual(0.13);
  });

  it('no metric regresses more than 5%', () => {
    if (!baselines) return; // skip if baselines missing

    for (const mode of modes) {
      const baseline = baselines.primary[mode];
      const report = reports[mode];
      expect(report).toBeDefined();

      expect(
        report.precision,
        `${mode} precision regressed: ${report.precision} < ${baseline.precision} - 0.05`,
      ).toBeGreaterThanOrEqual(baseline.precision - 0.05);

      expect(
        report.recall,
        `${mode} recall regressed: ${report.recall} < ${baseline.recall} - 0.05`,
      ).toBeGreaterThanOrEqual(baseline.recall - 0.05);

      expect(
        report.mrr,
        `${mode} MRR regressed: ${report.mrr} < ${baseline.mrr} - 0.05`,
      ).toBeGreaterThanOrEqual(baseline.mrr - 0.05);
    }
  });
});
