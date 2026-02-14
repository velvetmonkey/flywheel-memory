#!/usr/bin/env node
/**
 * CLI for running benchmarks
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { generateVault, loadVaultConfig, VAULT_PRESETS } from '../generator/vault.js';
import { BenchmarkRunner, benchmark } from '../harness/runner.js';
import { writeJsonReport, writeMarkdownReport, printResults } from '../harness/reporter.js';
import { exitIfRegressions } from '../harness/regression.js';
import { checkIntegrity } from '../iteration/integrityChecker.js';

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let sizes: number[] = [1000, 10000];
  let outputDir = './benchmark-results';
  let baselinePath: string | undefined;
  let generateVaults = true;
  let vaultDir = '/tmp/flywheel-bench';
  let all = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--sizes':
      case '-s':
        sizes = args[++i].split(',').map(s => parseInt(s.trim(), 10));
        break;
      case '--output':
      case '-o':
        outputDir = args[++i];
        break;
      case '--baseline':
      case '-b':
        baselinePath = args[++i];
        break;
      case '--vault-dir':
        vaultDir = args[++i];
        break;
      case '--no-generate':
        generateVaults = false;
        break;
      case '--all':
        all = true;
        break;
      case '--check-regression':
        // Just check regressions, don't run benchmarks
        await checkRegressions(outputDir, baselinePath);
        return;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  if (all) {
    sizes = [1000, 10000, 50000, 100000];
  }

  // Generate or locate vaults
  const vaultPaths = new Map<number, string>();

  for (const size of sizes) {
    const sizeKey = size >= 1000 ? `${size / 1000}k` : String(size);
    const vaultPath = path.join(vaultDir, `vault-${sizeKey}`);

    if (generateVaults) {
      console.log(`\nGenerating ${sizeKey} vault...`);
      const config = await loadVaultConfig(sizeKey, vaultPath, 12345); // Fixed seed for reproducibility
      await generateVault(config);
    } else {
      // Verify vault exists
      try {
        await fs.access(vaultPath);
      } catch {
        console.error(`Vault not found: ${vaultPath}`);
        console.error('Run with --generate or generate vaults first');
        process.exit(1);
      }
    }

    vaultPaths.set(size, vaultPath);
  }

  // Define benchmark suites
  const suites = [
    benchmark('vault_scan', async (vaultPath) => {
      // Simulate vault scanning
      const files = await walkDir(vaultPath);
      for (const file of files.slice(0, 100)) {
        await fs.readFile(file, 'utf-8');
      }
    }),

    benchmark('integrity_check', async (vaultPath) => {
      await checkIntegrity(vaultPath);
    }),

    benchmark('file_read_100', async (vaultPath) => {
      const files = await walkDir(vaultPath);
      const sample = files.slice(0, 100);
      await Promise.all(sample.map(f => fs.readFile(f, 'utf-8')));
    }),

    benchmark('wikilink_extract', async (vaultPath) => {
      const files = await walkDir(vaultPath);
      const sample = files.slice(0, 50);
      let totalLinks = 0;

      for (const file of sample) {
        const content = await fs.readFile(file, 'utf-8');
        const links = content.match(/\[\[([^\]]+)\]\]/g) || [];
        totalLinks += links.length;
      }
    })
  ];

  // Run benchmarks
  console.log('\nRunning benchmarks...');

  const runner = new BenchmarkRunner({
    vaultSizes: sizes,
    outputDir,
    baseline: baselinePath,
    warmupIterations: 2,
    iterations: 5
  });

  runner.registerAll(suites);
  const results = await runner.run(vaultPaths);

  // Output results
  printResults(results);

  const jsonPath = await writeJsonReport(results, outputDir);
  const mdPath = await writeMarkdownReport(results, outputDir);

  console.log(`\nResults written to:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  Markdown: ${mdPath}`);

  // Check regressions
  if (results.regressions.length > 0) {
    exitIfRegressions(results.regressions);
  }
}

async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(d: string) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

async function checkRegressions(outputDir: string, baselinePath?: string) {
  if (!baselinePath) {
    console.error('No baseline path provided for regression check');
    process.exit(1);
  }

  // Find latest result
  const files = await fs.readdir(outputDir);
  const jsonFiles = files.filter(f => f.endsWith('.json') && f.startsWith('benchmark-'));
  jsonFiles.sort().reverse();

  if (jsonFiles.length === 0) {
    console.error('No benchmark results found');
    process.exit(1);
  }

  const latestPath = path.join(outputDir, jsonFiles[0]);
  const latest = JSON.parse(await fs.readFile(latestPath, 'utf-8'));
  const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf-8'));

  // Compare
  const { compareResults } = await import('../harness/regression.js');
  const regressions = compareResults(latest, baseline);

  if (regressions.length > 0) {
    exitIfRegressions(regressions);
  } else {
    console.log('✅ No regressions detected');
  }
}

function printHelp() {
  console.log(`
Flywheel Bench - Benchmark Runner

Usage:
  npx tsx src/cli/bench.ts [options]

Options:
  -s, --sizes <list>    Vault sizes to test (comma-separated: 1000,10000)
  -o, --output <dir>    Output directory for results
  -b, --baseline <file> Baseline JSON for regression detection
  --vault-dir <dir>     Directory for generated vaults
  --no-generate         Skip vault generation (use existing)
  --all                 Test all sizes (1k, 10k, 50k, 100k)
  --check-regression    Only check regressions (no benchmark run)
  -h, --help            Show this help

Examples:
  npx tsx src/cli/bench.ts --sizes 1000,10000
  npx tsx src/cli/bench.ts --all --baseline baseline.json
  npx tsx src/cli/bench.ts --check-regression -b baseline.json
`);
}

main().catch(console.error);
