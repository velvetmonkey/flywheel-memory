#!/usr/bin/env tsx
/**
 * CLI for running iteration stress tests (10k+ mutations)
 *
 * Usage:
 *   npm run iteration-stress -- --vault /path/to/vault --iterations 10000
 */

import { runIterationStressTest, IterationStressConfig } from '../iteration/index.js';
import fs from 'fs/promises';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const vaultIdx = args.indexOf('--vault');
  const vaultPath = vaultIdx !== -1 ? args[vaultIdx + 1] : null;

  const iterationsIdx = args.indexOf('--iterations');
  const iterations = iterationsIdx !== -1 ? parseInt(args[iterationsIdx + 1]) : 10000;

  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : null;

  if (!vaultPath) {
    console.error('Usage: iteration-stress --vault /path/to/vault [--iterations 10000] [--output results.json]');
    process.exit(1);
  }

  console.log('Running iteration stress test...');
  console.log(`  Vault: ${vaultPath}`);
  console.log(`  Iterations: ${iterations}`);
  console.log();

  const config: IterationStressConfig = {
    vaultPath,
    iterations,
    checkpointInterval: Math.max(100, Math.floor(iterations / 100)),
    operations: {
      add_to_section: 0.4,
      toggle_task: 0.3,
      update_frontmatter: 0.15,
      create_note: 0.1,
      delete_note: 0.05,
    },
  };

  try {
    const result = await runIterationStressTest(config);

    console.log('\n=== Iteration Stress Test Results ===\n');
    console.log(`Total iterations: ${result.totalIterations}`);
    console.log(`Successful: ${result.successfulIterations}`);
    console.log(`Failed: ${result.failedIterations}`);
    console.log(`Duration: ${result.duration_ms}ms`);
    console.log(`Ops/second: ${(result.totalIterations / (result.duration_ms / 1000)).toFixed(2)}`);
    console.log();

    console.log('Performance over time:');
    if (result.checkpoints && result.checkpoints.length > 0) {
      for (const checkpoint of result.checkpoints) {
        console.log(`  Iteration ${checkpoint.iteration}: ${checkpoint.latency_ms.toFixed(2)}ms avg latency`);
      }
    }
    console.log();

    console.log('Integrity checks:');
    console.log(`  Vault integrity: ${result.integrityPassed ? '\u2705 PASSED' : '\u274c FAILED'}`);
    console.log(`  Git health: ${result.gitHealthPassed ? '\u2705 PASSED' : '\u274c FAILED'}`);
    console.log(`  Memory stable: ${result.memoryStable ? '\u2705 PASSED' : '\u274c FAILED'}`);

    if (outputPath) {
      await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
      console.log(`\nResults written to: ${outputPath}`);
    }

    // Exit with error if any checks failed
    if (!result.integrityPassed || !result.gitHealthPassed || result.failedIterations > 0) {
      console.log('\n\u274c Iteration stress test had failures!');
      process.exit(1);
    }

    console.log('\n\u2705 Iteration stress test passed!');
    process.exit(0);
  } catch (error) {
    console.error('Error running iteration stress test:', error);
    process.exit(1);
  }
}

main();
