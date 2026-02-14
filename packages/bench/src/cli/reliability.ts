#!/usr/bin/env tsx
/**
 * CLI for running reliability stress tests
 *
 * Usage:
 *   npm run test:reliability
 *   tsx src/cli/reliability.ts
 */

import { runAllReliabilityTests } from '../reliability/index.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const iterations = parseInt(args.find(a => a.startsWith('--iterations='))?.split('=')[1] || '100');
  const timeout = parseInt(args.find(a => a.startsWith('--timeout='))?.split('=')[1] || '30000');

  console.log('Running reliability stress tests...');
  console.log(`  Iterations: ${iterations}`);
  console.log(`  Timeout: ${timeout}ms`);
  console.log();

  // Create temp directory for tests
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'flywheel-reliability-'));

  try {
    const summary = await runAllReliabilityTests(basePath, { iterations, timeout });

    console.log('\n=== Reliability Test Summary ===\n');
    console.log(`Total tests: ${summary.total}`);
    console.log(`Passed: ${summary.passed}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Duration: ${summary.duration_ms}ms`);
    console.log();

    if (summary.results.length > 0) {
      console.log('Results by test:');
      for (const result of summary.results) {
        const status = result.passed ? '\u2705' : '\u274c';
        console.log(`  ${status} ${result.name}: ${result.passed ? 'PASSED' : 'FAILED'}`);
        if (!result.passed && result.message) {
          console.log(`     Message: ${result.message}`);
        }
        if (result.metrics) {
          const metricsStr = Object.entries(result.metrics)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
          console.log(`     Metrics: ${metricsStr}`);
        }
      }
    }

    // Exit with error code if any tests failed
    if (summary.failed > 0) {
      console.log('\nSome reliability tests failed!');
      process.exit(1);
    }

    console.log('\nAll reliability tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('Error running reliability tests:', error);
    process.exit(1);
  } finally {
    // Cleanup
    try {
      await fs.rm(basePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

main();
