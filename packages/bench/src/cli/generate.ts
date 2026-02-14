#!/usr/bin/env node
/**
 * CLI for vault generation
 */

import { generateVault, loadVaultConfig, VAULT_PRESETS } from '../generator/vault.js';

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let preset = '1k';
  let outputDir = './test-vault';
  let seed: number | undefined;
  let initGit = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--size':
      case '-s':
        preset = args[++i];
        break;
      case '--output':
      case '-o':
        outputDir = args[++i];
        break;
      case '--seed':
        seed = parseInt(args[++i], 10);
        break;
      case '--init-git':
        initGit = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (!args[i].startsWith('-')) {
          outputDir = args[i];
        }
    }
  }

  // Validate preset
  if (!VAULT_PRESETS[preset]) {
    console.error(`Unknown preset: ${preset}`);
    console.error(`Available presets: ${Object.keys(VAULT_PRESETS).join(', ')}`);
    process.exit(1);
  }

  try {
    const config = await loadVaultConfig(preset, outputDir, seed);
    config.initGit = initGit;
    const result = await generateVault(config);

    console.log('\nVault generated successfully:');
    console.log(`  Path: ${result.path}`);
    console.log(`  Notes: ${result.noteCount}`);
    console.log(`  Entities: ${result.entityCount}`);
    console.log(`  Links: ${result.totalLinks}`);
    console.log(`  Folders: ${result.folderCount}`);
    console.log(`  Seed: ${result.seed}`);
  } catch (error) {
    console.error('Failed to generate vault:', error);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
Flywheel Bench - Vault Generator

Usage:
  npx tsx src/cli/generate.ts [options] [output-dir]

Options:
  -s, --size <preset>   Vault size preset (1k, 10k, 50k, 100k)
  -o, --output <dir>    Output directory
  --seed <number>       Random seed for reproducibility
  --init-git            Initialize git repo and commit files
  -h, --help            Show this help

Examples:
  npx tsx src/cli/generate.ts --size 10k ./test-vault
  npx tsx src/cli/generate.ts -s 1k -o /tmp/bench-vault --seed 12345
`);
}

main().catch(console.error);
