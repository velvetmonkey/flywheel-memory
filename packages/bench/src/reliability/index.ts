/**
 * Reliability stress test suite
 *
 * Comprehensive tests for vault mutation reliability:
 * - Rollback verification
 * - Lock contention handling
 * - Idempotency checks
 * - Integrity verification
 */

import fs from 'fs/promises';
import path from 'path';
import type { ReliabilityTestResult, ReliabilityTestConfig } from './types.js';
import { runRollbackTests } from './rollbackTest.js';
import { runLockContentionTests } from './lockContentionTest.js';
import { runIdempotencyTests } from './idempotencyTest.js';
import { runIntegrityTests } from './integrityTest.js';

// Re-export types
export * from './types.js';

// Re-export individual test suites
export { runRollbackTests } from './rollbackTest.js';
export { runLockContentionTests } from './lockContentionTest.js';
export { runIdempotencyTests } from './idempotencyTest.js';
export { runIntegrityTests } from './integrityTest.js';

/**
 * Summary of reliability test results
 */
export interface ReliabilitySummary {
  /** Total tests run */
  total: number;
  /** Tests passed */
  passed: number;
  /** Tests failed */
  failed: number;
  /** Pass rate as percentage */
  passRate: number;
  /** Total duration in ms */
  duration_ms: number;
  /** Results by category */
  categories: {
    rollback: { passed: number; failed: number };
    lockContention: { passed: number; failed: number };
    idempotency: { passed: number; failed: number };
    integrity: { passed: number; failed: number };
  };
  /** All individual results */
  results: ReliabilityTestResult[];
}

/**
 * Create a temporary test directory
 */
export async function createTestDir(basePath: string, name: string): Promise<string> {
  const testDir = path.join(basePath, `test-${name}-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Clean up test directory
 */
export async function cleanupTestDir(testDir: string): Promise<void> {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Summarize test results
 */
function summarizeResults(
  results: ReliabilityTestResult[],
  startTime: number
): ReliabilitySummary {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  // Categorize by test name prefix
  const categories = {
    rollback: { passed: 0, failed: 0 },
    lockContention: { passed: 0, failed: 0 },
    idempotency: { passed: 0, failed: 0 },
    integrity: { passed: 0, failed: 0 },
  };

  for (const r of results) {
    const name = r.name.toLowerCase();
    let category: keyof typeof categories;

    if (name.includes('rollback') || name.includes('partial')) {
      category = 'rollback';
    } else if (name.includes('lock') || name.includes('concurrent')) {
      category = 'lockContention';
    } else if (name.includes('idempotent') || name.includes('timestamp')) {
      category = 'idempotency';
    } else {
      category = 'integrity';
    }

    if (r.passed) {
      categories[category].passed++;
    } else {
      categories[category].failed++;
    }
  }

  return {
    total: results.length,
    passed,
    failed,
    passRate: results.length > 0 ? (passed / results.length) * 100 : 0,
    duration_ms: Date.now() - startTime,
    categories,
    results,
  };
}

/**
 * Run all reliability tests
 */
export async function runAllReliabilityTests(
  basePath: string,
  options?: { iterations?: number; timeout?: number }
): Promise<ReliabilitySummary> {
  const startTime = Date.now();
  const allResults: ReliabilityTestResult[] = [];

  // Create test directories for each suite
  const rollbackDir = await createTestDir(basePath, 'rollback');
  const lockDir = await createTestDir(basePath, 'lock');
  const idempotencyDir = await createTestDir(basePath, 'idempotency');
  const integrityDir = await createTestDir(basePath, 'integrity');

  try {
    // Run each test suite
    console.log('Running rollback tests...');
    const rollbackResults = await runRollbackTests({
      vaultPath: rollbackDir,
      iterations: options?.iterations,
      timeout: options?.timeout,
    });
    allResults.push(...rollbackResults);

    console.log('Running lock contention tests...');
    const lockResults = await runLockContentionTests({
      vaultPath: lockDir,
      isGitRepo: true,
      iterations: options?.iterations,
      timeout: options?.timeout,
    });
    allResults.push(...lockResults);

    console.log('Running idempotency tests...');
    const idempotencyResults = await runIdempotencyTests({
      vaultPath: idempotencyDir,
      iterations: options?.iterations,
      timeout: options?.timeout,
    });
    allResults.push(...idempotencyResults);

    console.log('Running integrity tests...');
    const integrityResults = await runIntegrityTests({
      vaultPath: integrityDir,
      iterations: options?.iterations || 100,
      timeout: options?.timeout,
    });
    allResults.push(...integrityResults);

  } finally {
    // Cleanup
    await cleanupTestDir(rollbackDir);
    await cleanupTestDir(lockDir);
    await cleanupTestDir(idempotencyDir);
    await cleanupTestDir(integrityDir);
  }

  return summarizeResults(allResults, startTime);
}

/**
 * Print test summary to console
 */
export function printReliabilitySummary(summary: ReliabilitySummary): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    RELIABILITY TEST SUMMARY                    ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Total Tests:  ${summary.total}`);
  console.log(`Passed:       ${summary.passed} ✅`);
  console.log(`Failed:       ${summary.failed} ${summary.failed > 0 ? '❌' : ''}`);
  console.log(`Pass Rate:    ${summary.passRate.toFixed(1)}%`);
  console.log(`Duration:     ${summary.duration_ms}ms\n`);

  console.log('By Category:');
  console.log('───────────────────────────────────────────────────────────────');

  const cats = summary.categories;
  console.log(`  Rollback:        ${cats.rollback.passed}/${cats.rollback.passed + cats.rollback.failed} passed`);
  console.log(`  Lock Contention: ${cats.lockContention.passed}/${cats.lockContention.passed + cats.lockContention.failed} passed`);
  console.log(`  Idempotency:     ${cats.idempotency.passed}/${cats.idempotency.passed + cats.idempotency.failed} passed`);
  console.log(`  Integrity:       ${cats.integrity.passed}/${cats.integrity.passed + cats.integrity.failed} passed`);

  if (summary.failed > 0) {
    console.log('\n\nFailed Tests:');
    console.log('───────────────────────────────────────────────────────────────');
    for (const r of summary.results.filter(r => !r.passed)) {
      console.log(`  ❌ ${r.name}: ${r.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}
