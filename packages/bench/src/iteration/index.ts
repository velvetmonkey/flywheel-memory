/**
 * Iteration stress testing module
 *
 * Simulation-only helper for long-running stress probes. This module does not
 * execute Flywheel's production mutation pipeline; it exercises a lightweight
 * placeholder loop so callers can smoke-test integrity and memory trends.
 */

export { runStressTest, DEFAULT_STRESS_CONFIG } from './stressTest.js';
export { checkIntegrity } from './integrityChecker.js';
export { checkGitHealth } from './gitHealthChecker.js';
export { PerformanceTracker } from './performanceTracker.js';

/**
 * Simulation-only config for iteration stress testing
 */
export interface IterationStressConfig {
  vaultPath: string;
  iterations: number;
  checkpointInterval?: number;
  operations?: {
    add_to_section?: number;
    toggle_task?: number;
    update_frontmatter?: number;
    create_note?: number;
    delete_note?: number;
  };
}

/**
 * Result from the simulation-only iteration stress test
 */
export interface IterationStressResult {
  totalIterations: number;
  successfulIterations: number;
  failedIterations: number;
  duration_ms: number;
  integrityPassed: boolean;
  gitHealthPassed: boolean;
  memoryStable: boolean;
  checkpoints?: Array<{
    iteration: number;
    latency_ms: number;
    memory_mb: number;
  }>;
}

/**
 * Run the simulation-only iteration stress test.
 *
 * This wrapper does not call the production write stack. It is useful for
 * lightweight smoke checks, not for evidence about live mutation safety.
 */
export async function runIterationStressTest(
  config: IterationStressConfig
): Promise<IterationStressResult> {
  const { checkIntegrity } = await import('./integrityChecker.js');
  const { checkGitHealth } = await import('./gitHealthChecker.js');

  const startTime = Date.now();
  const checkpoints: IterationStressResult['checkpoints'] = [];

  let successfulIterations = 0;
  let failedIterations = 0;

  const checkpointInterval = config.checkpointInterval || Math.max(100, Math.floor(config.iterations / 10));

  // Track memory at start
  const startMemory = process.memoryUsage().heapUsed / 1024 / 1024;
  let maxMemory = startMemory;

  // Simulation only: this does not execute real Flywheel mutations.
  for (let i = 1; i <= config.iterations; i++) {
    const iterStart = Date.now();

    // Simulate one placeholder mutation cycle.
    try {
      await simulateMutation(config.vaultPath);
      successfulIterations++;
    } catch {
      failedIterations++;
    }

    // Track checkpoint
    if (i % checkpointInterval === 0 || i === config.iterations) {
      const currentMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      maxMemory = Math.max(maxMemory, currentMemory);

      checkpoints.push({
        iteration: i,
        latency_ms: Date.now() - iterStart,
        memory_mb: currentMemory,
      });

      // Log progress
      const progress = Math.floor((i / config.iterations) * 100);
      process.stdout.write(`\r  Progress: ${progress}% (${i}/${config.iterations})`);
    }
  }

  console.log(); // New line after progress

  // Final integrity check
  const integrityResult = await checkIntegrity(config.vaultPath);
  const gitHealthResult = await checkGitHealth(config.vaultPath);

  // Check memory stability (should not grow more than 2x)
  const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;
  const memoryGrowth = finalMemory / startMemory;
  const memoryStable = memoryGrowth < 2.0;

  return {
    totalIterations: config.iterations,
    successfulIterations,
    failedIterations,
    duration_ms: Date.now() - startTime,
    integrityPassed: !integrityResult.corrupted,
    gitHealthPassed: gitHealthResult.isHealthy,
    memoryStable,
    checkpoints,
  };
}

/**
 * Simulate a mutation operation (placeholder only)
 */
async function simulateMutation(vaultPath: string): Promise<void> {
  // Placeholder simulation: read the vault directory and wait briefly.
  const fs = await import('fs/promises');
  const path = await import('path');

  try {
    await fs.readdir(vaultPath);
    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 1));
  } catch {
    // Ignore errors in simulation
  }
}
