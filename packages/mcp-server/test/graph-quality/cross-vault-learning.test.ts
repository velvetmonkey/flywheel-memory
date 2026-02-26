/**
 * Suite: Cross-Vault Learning Curves
 *
 * Runs the same 20-round learning curve on multiple vault topologies
 * to verify feedback convergence isn't topology-dependent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildGroundTruthVault,
  stripLinks,
  loadPrimaryVault,
  loadArchetype,
  loadTemporalStar,
  runLearningCurve,
  type TempVault,
  type GroundTruthSpec,
  type LearningCurveResult,
} from './harness.js';
import { writeReport, Timer, type TestReport } from './report-utils.js';

const TOTAL_ROUNDS = 20;

interface VaultRun {
  name: string;
  spec: GroundTruthSpec;
  vault: TempVault;
  result: LearningCurveResult;
}

describe('Suite: Cross-Vault Learning Curves', () => {
  const vaultRuns: VaultRun[] = [];
  const timer = new Timer();

  beforeAll(async () => {
    const configs = [
      { name: 'primary', loader: loadPrimaryVault },
      { name: 'small-world', loader: () => loadArchetype('small-world') },
      { name: 'hub-and-spoke', loader: () => loadArchetype('hub-and-spoke') },
      { name: 'temporal-star', loader: loadTemporalStar },
    ];

    for (const config of configs) {
      const spec = await config.loader();
      const vault = await buildGroundTruthVault(spec);
      await stripLinks(vault, spec.groundTruth);
      const result = await runLearningCurve(vault, spec, { totalRounds: TOTAL_ROUNDS });
      vaultRuns.push({ name: config.name, spec, vault, result });
    }
  }, 1200000); // 20 min for 4 vaults x 20 rounds

  afterAll(async () => {
    // Write report
    if (vaultRuns.length > 0) {
      const report: TestReport = {
        suite: 'cross-vault-learning-report',
        timestamp: new Date().toISOString(),
        duration_ms: timer.elapsed(),
        summary: Object.fromEntries(
          vaultRuns.map(v => [`${v.name}_final_f1`, v.result.rounds[v.result.rounds.length - 1]?.f1 ?? 0])
        ),
        details: vaultRuns.map(v => ({
          vault: v.name,
          entityCount: v.spec.entities.length,
          gtCount: v.spec.groundTruth.length,
          rounds: v.result.rounds,
        })),
        tuning_recommendations: [],
      };
      await writeReport(report);
    }

    for (const run of vaultRuns) {
      if (run.vault) await run.vault.cleanup();
    }
  });

  // Per-vault: F1 doesn't regress
  for (const vaultName of ['primary', 'small-world', 'hub-and-spoke', 'temporal-star']) {
    it(`${vaultName}: F1 at R19 >= F1 at R0`, () => {
      const run = vaultRuns.find(v => v.name === vaultName);
      if (!run || run.result.rounds.length < TOTAL_ROUNDS) return;
      const r0 = run.result.rounds[0];
      const rN = run.result.rounds[TOTAL_ROUNDS - 1];
      expect(rN.f1).toBeGreaterThanOrEqual(r0.f1);
    });
  }

  // Per-vault: no catastrophic drops
  for (const vaultName of ['primary', 'small-world', 'hub-and-spoke', 'temporal-star']) {
    it(`${vaultName}: no single round drops F1 by more than 20pp`, () => {
      const run = vaultRuns.find(v => v.name === vaultName);
      if (!run || run.result.rounds.length < 2) return;
      for (let i = 1; i < run.result.rounds.length; i++) {
        const drop = run.result.rounds[i - 1].f1 - run.result.rounds[i].f1;
        expect(drop).toBeLessThanOrEqual(0.20);
      }
    });
  }

  // Per-vault: suppression not runaway
  for (const vaultName of ['primary', 'small-world', 'hub-and-spoke', 'temporal-star']) {
    it(`${vaultName}: suppression count < 60% of entities`, () => {
      const run = vaultRuns.find(v => v.name === vaultName);
      if (!run || run.result.rounds.length === 0) return;
      const maxSup = Math.ceil(run.spec.entities.length * 0.6);
      for (const r of run.result.rounds) {
        expect(r.suppressionCount).toBeLessThanOrEqual(maxSup);
      }
    });
  }

  // Cross-vault comparison (informational)
  it('reports convergence comparison', () => {
    for (const run of vaultRuns) {
      if (run.result.rounds.length < 2) continue;
      const f1Deltas = [];
      for (let i = 1; i < run.result.rounds.length; i++) {
        f1Deltas.push(run.result.rounds[i].f1 - run.result.rounds[i-1].f1);
      }
      const avgDelta = f1Deltas.reduce((a,b) => a+b, 0) / f1Deltas.length;
      // Informational -- log convergence rate
      console.log(`${run.name}: avg F1 delta/round = ${(avgDelta * 100).toFixed(2)}pp`);
    }
    expect(vaultRuns.length).toBeGreaterThanOrEqual(2);
  });
});
