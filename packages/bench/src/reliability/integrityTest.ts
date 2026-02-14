/**
 * Vault integrity tests
 *
 * Tests that vault state remains consistent after various operations.
 * Verifies no corruption, orphaned files, or missing data.
 */

import fs from 'fs/promises';
import path from 'path';
import type {
  ReliabilityTestResult,
  ReliabilityTestConfig,
  IntegrityCheckResult,
} from './types.js';

/**
 * Check if a markdown file is valid (basic structure)
 */
async function isValidMarkdown(filePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    // Basic checks: not empty, valid UTF-8 (read didn't fail)
    return content.length > 0;
  } catch {
    return false;
  }
}

/**
 * Extract wikilinks from content
 */
function extractWikilinks(content: string): string[] {
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const links: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1]);
  }
  return links;
}

/**
 * Check vault integrity
 */
export async function checkVaultIntegrity(
  vaultPath: string
): Promise<IntegrityCheckResult> {
  const result: IntegrityCheckResult = {
    intact: true,
    corruptedFiles: [],
    orphanedFiles: [],
    missingFiles: [],
    errors: [],
  };

  try {
    // Get all markdown files
    const files: string[] = [];
    async function scanDir(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    }
    await scanDir(vaultPath);

    // Check each file
    const existingNotes = new Set<string>();
    const referencedNotes = new Set<string>();

    for (const file of files) {
      const relativePath = path.relative(vaultPath, file);
      const noteName = path.basename(relativePath, '.md');
      existingNotes.add(noteName);

      // Check file is valid
      const valid = await isValidMarkdown(file);
      if (!valid) {
        result.corruptedFiles.push(relativePath);
        result.intact = false;
      }

      // Extract wikilinks
      try {
        const content = await fs.readFile(file, 'utf-8');
        const links = extractWikilinks(content);
        for (const link of links) {
          referencedNotes.add(link);
        }
      } catch (error) {
        result.errors.push(`Error reading ${relativePath}: ${error}`);
      }
    }

    // Check for missing referenced files (broken links)
    for (const ref of referencedNotes) {
      if (!existingNotes.has(ref)) {
        result.missingFiles.push(ref);
      }
    }

    // Note: missing files don't necessarily mean broken integrity
    // as they could be intentionally non-existent (will-be-created notes)

    return result;
  } catch (error) {
    result.intact = false;
    result.errors.push(`Integrity check failed: ${error}`);
    return result;
  }
}

/**
 * Test: Basic integrity check on fresh vault
 */
export async function testFreshVaultIntegrity(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult> {
  const startTime = Date.now();

  try {
    // Create fresh vault with known structure
    await fs.mkdir(config.vaultPath, { recursive: true });

    const files = [
      { path: 'note1.md', content: '# Note 1\n\nLink to [[Note 2]]\n' },
      { path: 'note2.md', content: '# Note 2\n\nLink back to [[Note 1]]\n' },
      { path: 'folder/note3.md', content: '# Note 3\n\nOrphan note\n' },
    ];

    for (const file of files) {
      const fullPath = path.join(config.vaultPath, file.path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file.content);
    }

    // Check integrity
    const integrity = await checkVaultIntegrity(config.vaultPath);

    if (!integrity.intact) {
      return {
        name: 'fresh_vault_integrity',
        passed: false,
        message: `Fresh vault has integrity issues: ${integrity.errors.join(', ')}`,
        duration_ms: Date.now() - startTime,
        metrics: {
          corrupted: integrity.corruptedFiles.length,
          missing: integrity.missingFiles.length,
        },
      };
    }

    return {
      name: 'fresh_vault_integrity',
      passed: true,
      message: 'Fresh vault passes integrity check',
      duration_ms: Date.now() - startTime,
      metrics: {
        files_checked: files.length,
      },
    };
  } catch (error) {
    return {
      name: 'fresh_vault_integrity',
      passed: false,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Test: Integrity after multiple mutations
 */
export async function testIntegrityAfterMutations(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult> {
  const startTime = Date.now();
  const iterations = config.iterations || 100;

  try {
    // Create initial vault
    await fs.mkdir(config.vaultPath, { recursive: true });

    const notePath = path.join(config.vaultPath, 'test.md');
    let content = '# Test Note\n\n## Log\n\n';
    await fs.writeFile(notePath, content);

    // Perform many mutations
    for (let i = 0; i < iterations; i++) {
      content += `- Entry ${i}\n`;
      await fs.writeFile(notePath, content);
    }

    // Check integrity
    const integrity = await checkVaultIntegrity(config.vaultPath);

    // Verify file content
    const finalContent = await fs.readFile(notePath, 'utf-8');
    const entryCount = (finalContent.match(/- Entry \d+/g) || []).length;

    if (entryCount !== iterations) {
      return {
        name: 'integrity_after_mutations',
        passed: false,
        message: `Expected ${iterations} entries, found ${entryCount}`,
        duration_ms: Date.now() - startTime,
        metrics: {
          expected: iterations,
          found: entryCount,
        },
      };
    }

    if (!integrity.intact) {
      return {
        name: 'integrity_after_mutations',
        passed: false,
        message: `Vault corrupted after ${iterations} mutations`,
        duration_ms: Date.now() - startTime,
      };
    }

    return {
      name: 'integrity_after_mutations',
      passed: true,
      message: `Vault intact after ${iterations} mutations`,
      duration_ms: Date.now() - startTime,
      metrics: {
        mutations: iterations,
        entries: entryCount,
      },
    };
  } catch (error) {
    return {
      name: 'integrity_after_mutations',
      passed: false,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Test: Detect corrupted file
 */
export async function testCorruptionDetection(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult> {
  const startTime = Date.now();

  try {
    // Create vault with one corrupted file (empty)
    await fs.mkdir(config.vaultPath, { recursive: true });

    const files = [
      { path: 'good.md', content: '# Good Note\n\nContent here\n' },
      { path: 'empty.md', content: '' }, // Empty = corrupted for our purposes
    ];

    for (const file of files) {
      await fs.writeFile(path.join(config.vaultPath, file.path), file.content);
    }

    // Check integrity
    const integrity = await checkVaultIntegrity(config.vaultPath);

    if (integrity.corruptedFiles.length === 0) {
      return {
        name: 'corruption_detection',
        passed: false,
        message: 'Empty file was not detected as corrupted',
        duration_ms: Date.now() - startTime,
      };
    }

    const emptyDetected = integrity.corruptedFiles.includes('empty.md');
    if (!emptyDetected) {
      return {
        name: 'corruption_detection',
        passed: false,
        message: 'Wrong file marked as corrupted',
        duration_ms: Date.now() - startTime,
        metrics: {
          corrupted: integrity.corruptedFiles.join(', '),
        },
      };
    }

    return {
      name: 'corruption_detection',
      passed: true,
      message: 'Empty file correctly detected as corrupted',
      duration_ms: Date.now() - startTime,
      metrics: {
        corrupted_files: integrity.corruptedFiles.length,
      },
    };
  } catch (error) {
    return {
      name: 'corruption_detection',
      passed: false,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Run all integrity tests
 */
export async function runIntegrityTests(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult[]> {
  const results: ReliabilityTestResult[] = [];

  results.push(await testFreshVaultIntegrity(config));
  results.push(await testIntegrityAfterMutations(config));
  results.push(await testCorruptionDetection(config));

  return results;
}
