/**
 * Idempotency tests
 *
 * Tests that retry operations don't create duplicate content.
 * Verifies that same operation applied multiple times produces same result.
 */

import fs from 'fs/promises';
import path from 'path';
import type { ReliabilityTestResult, ReliabilityTestConfig } from './types.js';

/**
 * Count occurrences of a string in content
 */
function countOccurrences(content: string, search: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = content.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

/**
 * Simulate append-to-section operation
 */
export async function appendToSection(
  vaultPath: string,
  notePath: string,
  section: string,
  content: string
): Promise<boolean> {
  const fullPath = path.join(vaultPath, notePath);

  try {
    let fileContent = await fs.readFile(fullPath, 'utf-8');

    // Find section
    const sectionRegex = new RegExp(`(^#{1,6}\\s*${section}\\s*$)`, 'im');
    const match = fileContent.match(sectionRegex);

    if (!match) {
      return false;
    }

    // Find end of section (next heading or end of file)
    const sectionStart = match.index! + match[0].length;
    const nextHeadingMatch = fileContent.slice(sectionStart).match(/^#{1,6}\s/m);
    const sectionEnd = nextHeadingMatch
      ? sectionStart + nextHeadingMatch.index!
      : fileContent.length;

    // Insert content before section end
    const before = fileContent.slice(0, sectionEnd);
    const after = fileContent.slice(sectionEnd);

    // Add newline if needed
    const insertContent = before.endsWith('\n')
      ? content + '\n'
      : '\n' + content + '\n';

    fileContent = before + insertContent + after;
    await fs.writeFile(fullPath, fileContent);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if content already exists in section (for idempotency)
 */
export async function contentExistsInSection(
  vaultPath: string,
  notePath: string,
  section: string,
  content: string
): Promise<boolean> {
  const fullPath = path.join(vaultPath, notePath);

  try {
    const fileContent = await fs.readFile(fullPath, 'utf-8');

    // Find section
    const sectionRegex = new RegExp(`(^#{1,6}\\s*${section}\\s*$)`, 'im');
    const match = fileContent.match(sectionRegex);

    if (!match) {
      return false;
    }

    // Get section content
    const sectionStart = match.index! + match[0].length;
    const nextHeadingMatch = fileContent.slice(sectionStart).match(/^#{1,6}\s/m);
    const sectionEnd = nextHeadingMatch
      ? sectionStart + nextHeadingMatch.index!
      : fileContent.length;

    const sectionContent = fileContent.slice(sectionStart, sectionEnd);
    return sectionContent.includes(content);
  } catch {
    return false;
  }
}

/**
 * Idempotent append - only adds if content doesn't exist
 */
export async function idempotentAppendToSection(
  vaultPath: string,
  notePath: string,
  section: string,
  content: string
): Promise<{ added: boolean; alreadyExists: boolean }> {
  // Check if already exists
  const exists = await contentExistsInSection(vaultPath, notePath, section, content);

  if (exists) {
    return { added: false, alreadyExists: true };
  }

  const added = await appendToSection(vaultPath, notePath, section, content);
  return { added, alreadyExists: false };
}

/**
 * Test: Retrying non-idempotent append creates duplicates
 */
export async function testNonIdempotentAppend(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult> {
  const startTime = Date.now();

  try {
    // Setup
    const notePath = 'test-note.md';
    const section = 'Log';
    const content = '- New item';
    const fileContent = `# Test Note\n\n## ${section}\n\n- Existing item\n`;

    await fs.mkdir(config.vaultPath, { recursive: true });
    await fs.writeFile(path.join(config.vaultPath, notePath), fileContent);

    // Append same content 3 times (simulating retries)
    await appendToSection(config.vaultPath, notePath, section, content);
    await appendToSection(config.vaultPath, notePath, section, content);
    await appendToSection(config.vaultPath, notePath, section, content);

    // Check for duplicates
    const finalContent = await fs.readFile(
      path.join(config.vaultPath, notePath),
      'utf-8'
    );
    const occurrences = countOccurrences(finalContent, content);

    // Non-idempotent append SHOULD create duplicates (this tests that)
    if (occurrences !== 3) {
      return {
        name: 'non_idempotent_append',
        passed: false,
        message: `Expected 3 occurrences, got ${occurrences}`,
        duration_ms: Date.now() - startTime,
        metrics: {
          occurrences,
          expected: 3,
        },
      };
    }

    return {
      name: 'non_idempotent_append',
      passed: true,
      message: 'Non-idempotent append correctly creates duplicates (expected behavior)',
      duration_ms: Date.now() - startTime,
      metrics: {
        occurrences,
        appends: 3,
      },
    };
  } catch (error) {
    return {
      name: 'non_idempotent_append',
      passed: false,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Test: Idempotent append prevents duplicates
 */
export async function testIdempotentAppend(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult> {
  const startTime = Date.now();

  try {
    // Setup
    const notePath = 'test-note-idem.md';
    const section = 'Log';
    const content = '- Unique item';
    const fileContent = `# Test Note\n\n## ${section}\n\n- Existing item\n`;

    await fs.mkdir(config.vaultPath, { recursive: true });
    await fs.writeFile(path.join(config.vaultPath, notePath), fileContent);

    // Idempotent append same content 3 times
    const r1 = await idempotentAppendToSection(config.vaultPath, notePath, section, content);
    const r2 = await idempotentAppendToSection(config.vaultPath, notePath, section, content);
    const r3 = await idempotentAppendToSection(config.vaultPath, notePath, section, content);

    // Check for duplicates
    const finalContent = await fs.readFile(
      path.join(config.vaultPath, notePath),
      'utf-8'
    );
    const occurrences = countOccurrences(finalContent, content);

    // Idempotent append should create exactly 1 occurrence
    if (occurrences !== 1) {
      return {
        name: 'idempotent_append',
        passed: false,
        message: `Expected 1 occurrence, got ${occurrences}`,
        duration_ms: Date.now() - startTime,
        metrics: {
          occurrences,
          expected: 1,
        },
      };
    }

    // First should add, rest should be skipped
    if (!r1.added || r1.alreadyExists) {
      return {
        name: 'idempotent_append',
        passed: false,
        message: 'First append should have added content',
        duration_ms: Date.now() - startTime,
      };
    }

    if (r2.added || !r2.alreadyExists) {
      return {
        name: 'idempotent_append',
        passed: false,
        message: 'Second append should have been skipped',
        duration_ms: Date.now() - startTime,
      };
    }

    return {
      name: 'idempotent_append',
      passed: true,
      message: 'Idempotent append correctly prevents duplicates',
      duration_ms: Date.now() - startTime,
      metrics: {
        occurrences,
        appends_attempted: 3,
        appends_executed: 1,
        appends_skipped: 2,
      },
    };
  } catch (error) {
    return {
      name: 'idempotent_append',
      passed: false,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Test: Timestamp-based content is inherently non-idempotent
 */
export async function testTimestampIdempotency(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult> {
  const startTime = Date.now();

  try {
    // Setup
    const notePath = 'test-timestamps.md';
    const section = 'Log';
    const fileContent = `# Test Note\n\n## ${section}\n\n`;

    await fs.mkdir(config.vaultPath, { recursive: true });
    await fs.writeFile(path.join(config.vaultPath, notePath), fileContent);

    // Add timestamped content multiple times
    const baseContent = 'Test entry';
    const timestamps: string[] = [];

    for (let i = 0; i < 3; i++) {
      const time = new Date().toISOString();
      timestamps.push(time);
      const content = `- ${time} ${baseContent}`;
      await appendToSection(config.vaultPath, notePath, section, content);
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Verify each timestamp appears once
    const finalContent = await fs.readFile(
      path.join(config.vaultPath, notePath),
      'utf-8'
    );

    let allUnique = true;
    for (const ts of timestamps) {
      const count = countOccurrences(finalContent, ts);
      if (count !== 1) {
        allUnique = false;
        break;
      }
    }

    return {
      name: 'timestamp_idempotency',
      passed: allUnique,
      message: allUnique
        ? 'Timestamped entries are naturally unique'
        : 'Unexpected duplicate timestamps',
      duration_ms: Date.now() - startTime,
      metrics: {
        unique_timestamps: timestamps.length,
      },
    };
  } catch (error) {
    return {
      name: 'timestamp_idempotency',
      passed: false,
      message: `Test error: ${error instanceof Error ? error.message : String(error)}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Run all idempotency tests
 */
export async function runIdempotencyTests(
  config: ReliabilityTestConfig
): Promise<ReliabilityTestResult[]> {
  const results: ReliabilityTestResult[] = [];

  results.push(await testNonIdempotentAppend(config));
  results.push(await testIdempotentAppend(config));
  results.push(await testTimestampIdempotency(config));

  return results;
}
