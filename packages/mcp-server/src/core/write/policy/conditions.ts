/**
 * Policy condition evaluators
 *
 * Evaluates conditions like file_exists, section_exists, frontmatter_equals
 * to support conditional step execution.
 */

import fs from 'fs/promises';
import path from 'path';
import type { PolicyCondition, PolicyContext } from './types.js';
import { interpolate } from './template.js';
import { readVaultFile, findSection } from '../writer.js';

/**
 * Result of evaluating a condition
 */
export interface ConditionResult {
  /** Whether the condition is met */
  met: boolean;
  /** Reason for the result (for debugging) */
  reason: string;
}

/**
 * Evaluate a single condition
 */
export async function evaluateCondition(
  condition: PolicyCondition,
  vaultPath: string,
  context: PolicyContext
): Promise<ConditionResult> {
  // Interpolate path and other template values
  const interpolatedPath = condition.path
    ? interpolate(condition.path, context)
    : undefined;

  const interpolatedSection = condition.section
    ? interpolate(condition.section, context)
    : undefined;

  const interpolatedField = condition.field
    ? interpolate(condition.field, context)
    : undefined;

  switch (condition.check) {
    case 'file_exists':
      return evaluateFileExists(vaultPath, interpolatedPath!, true);

    case 'file_not_exists':
      return evaluateFileExists(vaultPath, interpolatedPath!, false);

    case 'section_exists':
      return evaluateSectionExists(
        vaultPath,
        interpolatedPath!,
        interpolatedSection!,
        true
      );

    case 'section_not_exists':
      return evaluateSectionExists(
        vaultPath,
        interpolatedPath!,
        interpolatedSection!,
        false
      );

    case 'frontmatter_exists':
      return evaluateFrontmatterExists(
        vaultPath,
        interpolatedPath!,
        interpolatedField!,
        true
      );

    case 'frontmatter_not_exists':
      return evaluateFrontmatterExists(
        vaultPath,
        interpolatedPath!,
        interpolatedField!,
        false
      );

    case 'frontmatter_equals':
      return evaluateFrontmatterEquals(
        vaultPath,
        interpolatedPath!,
        interpolatedField!,
        condition.value
      );

    default:
      return {
        met: false,
        reason: `Unknown condition type: ${condition.check}`,
      };
  }
}

/**
 * Evaluate file_exists / file_not_exists condition
 */
async function evaluateFileExists(
  vaultPath: string,
  notePath: string,
  expectExists: boolean
): Promise<ConditionResult> {
  const fullPath = path.join(vaultPath, notePath);

  try {
    await fs.access(fullPath);
    // File exists
    return {
      met: expectExists,
      reason: expectExists
        ? `File exists: ${notePath}`
        : `File exists (expected not to): ${notePath}`,
    };
  } catch {
    // File doesn't exist
    return {
      met: !expectExists,
      reason: !expectExists
        ? `File does not exist: ${notePath}`
        : `File does not exist (expected to): ${notePath}`,
    };
  }
}

/**
 * Evaluate section_exists / section_not_exists condition
 */
async function evaluateSectionExists(
  vaultPath: string,
  notePath: string,
  sectionName: string,
  expectExists: boolean
): Promise<ConditionResult> {
  const fullPath = path.join(vaultPath, notePath);

  // First check if file exists
  try {
    await fs.access(fullPath);
  } catch {
    return {
      met: !expectExists,
      reason: `File does not exist: ${notePath}`,
    };
  }

  // Read file and check for section
  try {
    const { content } = await readVaultFile(vaultPath, notePath);
    const section = findSection(content, sectionName);

    if (section) {
      return {
        met: expectExists,
        reason: expectExists
          ? `Section '${sectionName}' exists in ${notePath}`
          : `Section '${sectionName}' exists (expected not to) in ${notePath}`,
      };
    } else {
      return {
        met: !expectExists,
        reason: !expectExists
          ? `Section '${sectionName}' does not exist in ${notePath}`
          : `Section '${sectionName}' does not exist (expected to) in ${notePath}`,
      };
    }
  } catch (error) {
    return {
      met: false,
      reason: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Evaluate frontmatter_exists / frontmatter_not_exists condition
 */
async function evaluateFrontmatterExists(
  vaultPath: string,
  notePath: string,
  fieldName: string,
  expectExists: boolean
): Promise<ConditionResult> {
  const fullPath = path.join(vaultPath, notePath);

  // First check if file exists
  try {
    await fs.access(fullPath);
  } catch {
    return {
      met: !expectExists,
      reason: `File does not exist: ${notePath}`,
    };
  }

  // Read file and check frontmatter
  try {
    const { frontmatter } = await readVaultFile(vaultPath, notePath);

    const hasField = frontmatter && fieldName in frontmatter;

    if (hasField) {
      return {
        met: expectExists,
        reason: expectExists
          ? `Frontmatter field '${fieldName}' exists in ${notePath}`
          : `Frontmatter field '${fieldName}' exists (expected not to) in ${notePath}`,
      };
    } else {
      return {
        met: !expectExists,
        reason: !expectExists
          ? `Frontmatter field '${fieldName}' does not exist in ${notePath}`
          : `Frontmatter field '${fieldName}' does not exist (expected to) in ${notePath}`,
      };
    }
  } catch (error) {
    return {
      met: false,
      reason: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Evaluate frontmatter_equals condition
 */
async function evaluateFrontmatterEquals(
  vaultPath: string,
  notePath: string,
  fieldName: string,
  expectedValue: unknown
): Promise<ConditionResult> {
  const fullPath = path.join(vaultPath, notePath);

  // First check if file exists
  try {
    await fs.access(fullPath);
  } catch {
    return {
      met: false,
      reason: `File does not exist: ${notePath}`,
    };
  }

  // Read file and check frontmatter value
  try {
    const { frontmatter } = await readVaultFile(vaultPath, notePath);

    if (!frontmatter || !(fieldName in frontmatter)) {
      return {
        met: false,
        reason: `Frontmatter field '${fieldName}' does not exist in ${notePath}`,
      };
    }

    const actualValue = frontmatter[fieldName];

    // Compare values (handle type coercion for simple types)
    const isEqual = compareValues(actualValue, expectedValue);

    return {
      met: isEqual,
      reason: isEqual
        ? `Frontmatter field '${fieldName}' equals ${JSON.stringify(expectedValue)}`
        : `Frontmatter field '${fieldName}' is ${JSON.stringify(actualValue)}, expected ${JSON.stringify(expectedValue)}`,
    };
  } catch (error) {
    return {
      met: false,
      reason: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Compare two values with type coercion for simple types
 */
function compareValues(actual: unknown, expected: unknown): boolean {
  // Exact equality
  if (actual === expected) return true;

  // String comparison (coerce both to string)
  if (String(actual) === String(expected)) return true;

  // Array comparison
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return false;
    return actual.every((v, i) => compareValues(v, expected[i]));
  }

  // Object comparison
  if (
    typeof actual === 'object' &&
    typeof expected === 'object' &&
    actual !== null &&
    expected !== null
  ) {
    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);
    if (actualKeys.length !== expectedKeys.length) return false;
    return actualKeys.every(key =>
      compareValues(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key]
      )
    );
  }

  return false;
}

/**
 * Evaluate all conditions in a policy and return results map
 */
export async function evaluateAllConditions(
  conditions: PolicyCondition[],
  vaultPath: string,
  context: PolicyContext
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};

  for (const condition of conditions) {
    const result = await evaluateCondition(condition, vaultPath, context);
    results[condition.id] = result.met;
  }

  return results;
}

/**
 * Check if a step should execute based on its when clause
 */
export function shouldStepExecute(
  when: string | undefined,
  conditionResults: Record<string, boolean>
): { execute: boolean; reason?: string } {
  if (!when) {
    // No condition, always execute
    return { execute: true };
  }

  // Parse the when clause: {{conditions.xxx}}
  const match = when.match(/\{\{conditions\.(\w+)\}\}/);
  if (!match) {
    // Invalid format, treat as truthy
    console.error(`[Policy] Invalid when clause format: ${when}`);
    return { execute: true, reason: 'Invalid when clause format' };
  }

  const conditionId = match[1];
  const result = conditionResults[conditionId];

  if (result === undefined) {
    console.error(`[Policy] Unknown condition referenced: ${conditionId}`);
    return { execute: false, reason: `Unknown condition: ${conditionId}` };
  }

  return {
    execute: result,
    reason: result ? undefined : `Condition '${conditionId}' was not met`,
  };
}
