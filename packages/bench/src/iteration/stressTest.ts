/**
 * Stress testing - 10k+ mutation stability validation
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  StressTestConfig,
  StressTestResult,
  MutationDistribution,
  PerformanceSnapshot
} from '../types.js';
import { checkIntegrity } from './integrityChecker.js';
import { checkGitHealth } from './gitHealthChecker.js';
import { SeededRandom } from '../generator/notes.js';

/**
 * Default stress test configuration
 */
export const DEFAULT_STRESS_CONFIG: Omit<StressTestConfig, 'vaultPath'> = {
  mutationCount: 10000,
  distribution: {
    add_to_section: 0.4,
    toggle_task: 0.3,
    update_frontmatter: 0.15,
    create_note: 0.1,
    delete_note: 0.05
  },
  checkInterval: 1000,
  verbose: false
};

/**
 * Mutation types that the stress test can perform
 */
type MutationType = keyof MutationDistribution;

interface MutationResult {
  type: MutationType;
  success: boolean;
  duration_ms: number;
  error?: string;
}

/**
 * Run a stress test on a vault
 */
export async function runStressTest(
  config: StressTestConfig,
  mutationFunctions: MutationFunctions
): Promise<StressTestResult> {
  const startTime = Date.now();
  const rng = new SeededRandom(Date.now());

  const result: StressTestResult = {
    totalMutations: 0,
    successfulMutations: 0,
    failedMutations: 0,
    integrityChecks: [],
    performanceTimeline: [],
    gitHealth: { totalObjects: 0, looseObjects: 0, packedObjects: 0, totalSize_mb: 0, isHealthy: true, issues: [] },
    duration_ms: 0
  };

  console.log(`Starting stress test: ${config.mutationCount} mutations`);
  console.log(`Distribution: ${JSON.stringify(config.distribution)}`);

  // Initial integrity check
  const initialCheck = await checkIntegrity(config.vaultPath);
  result.integrityChecks.push({ iteration: 0, ...initialCheck });

  // Run mutations
  for (let i = 1; i <= config.mutationCount; i++) {
    // Select mutation type based on distribution
    const mutationType = selectMutation(rng, config.distribution);

    // Execute mutation
    const mutationResult = await executeMutation(
      mutationType,
      config.vaultPath,
      rng,
      mutationFunctions
    );

    result.totalMutations++;
    if (mutationResult.success) {
      result.successfulMutations++;
    } else {
      result.failedMutations++;
      if (config.verbose) {
        console.warn(`  Mutation ${i} failed: ${mutationResult.error}`);
      }
    }

    // Record performance snapshot
    if (i % 100 === 0 || i === config.mutationCount) {
      const memory = process.memoryUsage();
      result.performanceTimeline.push({
        iteration: i,
        timestamp: new Date().toISOString(),
        mutation_latency_ms: mutationResult.duration_ms,
        memory_mb: memory.rss / (1024 * 1024),
        heap_used_mb: memory.heapUsed / (1024 * 1024)
      });
    }

    // Integrity check at intervals
    if (i % config.checkInterval === 0) {
      if (config.verbose) {
        console.log(`  Iteration ${i}: Running integrity check...`);
      }
      const check = await checkIntegrity(config.vaultPath);
      result.integrityChecks.push({ iteration: i, ...check });

      if (check.corrupted) {
        console.error(`  CORRUPTION DETECTED at iteration ${i}`);
        break;
      }
    }

    // Progress logging
    if (i % 1000 === 0) {
      const progress = ((i / config.mutationCount) * 100).toFixed(1);
      console.log(`  Progress: ${progress}% (${i}/${config.mutationCount})`);
    }
  }

  // Final integrity check
  const finalCheck = await checkIntegrity(config.vaultPath);
  result.integrityChecks.push({ iteration: config.mutationCount, ...finalCheck });

  // Git health check
  result.gitHealth = await checkGitHealth(config.vaultPath);

  result.duration_ms = Date.now() - startTime;

  // Summary
  console.log('\nStress test complete:');
  console.log(`  Total: ${result.totalMutations}`);
  console.log(`  Success: ${result.successfulMutations}`);
  console.log(`  Failed: ${result.failedMutations}`);
  console.log(`  Duration: ${(result.duration_ms / 1000).toFixed(1)}s`);
  console.log(`  Git healthy: ${result.gitHealth.isHealthy}`);

  return result;
}

/**
 * Select a mutation type based on distribution weights
 */
function selectMutation(rng: SeededRandom, distribution: MutationDistribution): MutationType {
  const roll = rng.next();
  let cumulative = 0;

  for (const [type, weight] of Object.entries(distribution)) {
    cumulative += weight;
    if (roll < cumulative) {
      return type as MutationType;
    }
  }

  return 'add_to_section'; // Fallback
}

/**
 * Interface for mutation functions
 */
export interface MutationFunctions {
  addToSection: (vaultPath: string, rng: SeededRandom) => Promise<void>;
  toggleTask: (vaultPath: string, rng: SeededRandom) => Promise<void>;
  updateFrontmatter: (vaultPath: string, rng: SeededRandom) => Promise<void>;
  createNote: (vaultPath: string, rng: SeededRandom) => Promise<void>;
  deleteNote: (vaultPath: string, rng: SeededRandom) => Promise<void>;
}

/**
 * Execute a single mutation
 */
async function executeMutation(
  type: MutationType,
  vaultPath: string,
  rng: SeededRandom,
  fns: MutationFunctions
): Promise<MutationResult> {
  const start = performance.now();

  try {
    switch (type) {
      case 'add_to_section':
        await fns.addToSection(vaultPath, rng);
        break;
      case 'toggle_task':
        await fns.toggleTask(vaultPath, rng);
        break;
      case 'update_frontmatter':
        await fns.updateFrontmatter(vaultPath, rng);
        break;
      case 'create_note':
        await fns.createNote(vaultPath, rng);
        break;
      case 'delete_note':
        await fns.deleteNote(vaultPath, rng);
        break;
    }

    return {
      type,
      success: true,
      duration_ms: performance.now() - start
    };
  } catch (error) {
    return {
      type,
      success: false,
      duration_ms: performance.now() - start,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Default mutation implementations for standalone testing
 */
export function createDefaultMutationFunctions(): MutationFunctions {
  return {
    async addToSection(vaultPath: string, rng: SeededRandom) {
      const files = await getMarkdownFiles(vaultPath);
      if (files.length === 0) return;

      const file = rng.pick(files);
      const content = await fs.readFile(file, 'utf-8');

      // Find a section and add content
      const lines = content.split('\n');
      const sectionIndices = lines
        .map((line, i) => line.startsWith('## ') ? i : -1)
        .filter(i => i !== -1);

      if (sectionIndices.length === 0) {
        // Add a new section
        lines.push('');
        lines.push('## Log');
        lines.push('');
        lines.push(`- ${new Date().toISOString().split('T')[1].slice(0, 5)} Test entry`);
      } else {
        // Add to existing section
        const sectionIdx = rng.pick(sectionIndices);
        const insertIdx = sectionIdx + 2;
        lines.splice(insertIdx, 0, `- ${new Date().toISOString().split('T')[1].slice(0, 5)} Test entry`);
      }

      await fs.writeFile(file, lines.join('\n'), 'utf-8');
    },

    async toggleTask(vaultPath: string, rng: SeededRandom) {
      const files = await getMarkdownFiles(vaultPath);
      if (files.length === 0) return;

      const file = rng.pick(files);
      const content = await fs.readFile(file, 'utf-8');

      // Find tasks
      const taskRegex = /- \[([ x])\]/g;
      const matches = [...content.matchAll(taskRegex)];

      if (matches.length === 0) return;

      const match = rng.pick(matches);
      const newState = match[1] === ' ' ? 'x' : ' ';
      const newContent = content.slice(0, match.index!) +
        `- [${newState}]` +
        content.slice(match.index! + 5);

      await fs.writeFile(file, newContent, 'utf-8');
    },

    async updateFrontmatter(vaultPath: string, rng: SeededRandom) {
      const files = await getMarkdownFiles(vaultPath);
      if (files.length === 0) return;

      const file = rng.pick(files);
      const content = await fs.readFile(file, 'utf-8');

      // Check for frontmatter
      if (!content.startsWith('---')) {
        // Add frontmatter
        const newContent = `---\nmodified: ${new Date().toISOString().split('T')[0]}\n---\n\n${content}`;
        await fs.writeFile(file, newContent, 'utf-8');
        return;
      }

      // Update existing frontmatter
      const endIdx = content.indexOf('---', 3);
      if (endIdx === -1) return;

      const frontmatter = content.slice(4, endIdx);
      const rest = content.slice(endIdx + 3);

      // Update or add modified date
      const modifiedLine = `modified: ${new Date().toISOString().split('T')[0]}`;
      let newFrontmatter: string;

      if (frontmatter.includes('modified:')) {
        newFrontmatter = frontmatter.replace(/modified:.*/, modifiedLine);
      } else {
        newFrontmatter = frontmatter.trimEnd() + '\n' + modifiedLine + '\n';
      }

      await fs.writeFile(file, `---\n${newFrontmatter}---${rest}`, 'utf-8');
    },

    async createNote(vaultPath: string, rng: SeededRandom) {
      const timestamp = Date.now();
      const filename = `stress-test-note-${timestamp}.md`;
      const content = `# Stress Test Note\n\nCreated at ${new Date().toISOString()}\n\nRandom content: ${rng.next()}\n`;

      await fs.writeFile(path.join(vaultPath, filename), content, 'utf-8');
    },

    async deleteNote(vaultPath: string, rng: SeededRandom) {
      const files = await getMarkdownFiles(vaultPath);
      // Only delete stress test notes
      const stressTestFiles = files.filter(f => path.basename(f).startsWith('stress-test-note-'));

      if (stressTestFiles.length === 0) return;

      const file = rng.pick(stressTestFiles);
      await fs.unlink(file);
    }
  };
}

/**
 * Get all markdown files in a vault
 */
async function getMarkdownFiles(vaultPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  await walk(vaultPath);
  return files;
}

/**
 * Validate stress test results
 */
export function validateStressTestResults(result: StressTestResult): {
  passed: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check for corruption
  const corrupted = result.integrityChecks.some(c => c.corrupted);
  if (corrupted) {
    issues.push('Vault corruption detected during stress test');
  }

  // Check failure rate (should be < 1%)
  const failureRate = result.failedMutations / result.totalMutations;
  if (failureRate > 0.01) {
    issues.push(`High failure rate: ${(failureRate * 100).toFixed(2)}%`);
  }

  // Check performance degradation
  if (result.performanceTimeline.length >= 2) {
    const early = result.performanceTimeline.slice(0, 10);
    const late = result.performanceTimeline.slice(-10);

    const earlyAvg = early.reduce((sum, p) => sum + p.mutation_latency_ms, 0) / early.length;
    const lateAvg = late.reduce((sum, p) => sum + p.mutation_latency_ms, 0) / late.length;

    const degradation = (lateAvg - earlyAvg) / earlyAvg;
    if (degradation > 1) { // More than 2x slower
      issues.push(`Performance degraded ${(degradation * 100).toFixed(0)}% over test duration`);
    }
  }

  // Check memory growth
  if (result.performanceTimeline.length >= 2) {
    const first = result.performanceTimeline[0];
    const last = result.performanceTimeline[result.performanceTimeline.length - 1];

    const memoryGrowth = (last.memory_mb - first.memory_mb) / first.memory_mb;
    if (memoryGrowth > 2) { // More than 3x memory
      issues.push(`Memory grew ${(memoryGrowth * 100).toFixed(0)}% during test`);
    }
  }

  // Check git health
  if (!result.gitHealth.isHealthy) {
    issues.push(`Git health issues: ${result.gitHealth.issues.join(', ')}`);
  }

  return {
    passed: issues.length === 0,
    issues
  };
}
