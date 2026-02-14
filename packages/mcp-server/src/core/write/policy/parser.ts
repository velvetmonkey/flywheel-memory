/**
 * Policy YAML parser
 *
 * Parses YAML policy files and validates them against the schema.
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import type { PolicyDefinition, PolicyValidationResult } from './types.js';
import { validatePolicySchema } from './schema.js';

/**
 * Parse YAML content to a policy object
 * Uses gray-matter for YAML parsing (already a dependency)
 */
export function parseYaml(content: string): unknown {
  // gray-matter expects frontmatter format, but we can use it for plain YAML
  // by treating the whole content as "data"
  const parsed = matter(`---\n${content}\n---`);
  return parsed.data;
}

/**
 * Parse and validate a policy from YAML string
 */
export function parsePolicyString(yamlContent: string): PolicyValidationResult {
  try {
    const parsed = parseYaml(yamlContent);
    return validatePolicySchema(parsed);
  } catch (error) {
    return {
      valid: false,
      errors: [{
        type: 'schema',
        message: `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
      }],
      warnings: [],
    };
  }
}

/**
 * Load and parse a policy from a file
 */
export async function loadPolicyFile(filePath: string): Promise<PolicyValidationResult> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return parsePolicyString(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        valid: false,
        errors: [{
          type: 'schema',
          message: `Policy file not found: ${filePath}`,
        }],
        warnings: [],
      };
    }
    return {
      valid: false,
      errors: [{
        type: 'schema',
        message: `Failed to read policy file: ${error instanceof Error ? error.message : String(error)}`,
      }],
      warnings: [],
    };
  }
}

/**
 * Load a policy by name from the vault's .claude/policies directory
 */
export async function loadPolicy(
  vaultPath: string,
  policyName: string
): Promise<PolicyValidationResult> {
  const policiesDir = path.join(vaultPath, '.claude', 'policies');
  const policyPath = path.join(policiesDir, `${policyName}.yaml`);

  // Also try .yml extension
  try {
    await fs.access(policyPath);
    return loadPolicyFile(policyPath);
  } catch {
    const ymlPath = path.join(policiesDir, `${policyName}.yml`);
    try {
      await fs.access(ymlPath);
      return loadPolicyFile(ymlPath);
    } catch {
      return {
        valid: false,
        errors: [{
          type: 'schema',
          message: `Policy '${policyName}' not found in ${policiesDir}`,
        }],
        warnings: [],
      };
    }
  }
}

/**
 * Serialize a policy definition to YAML string
 */
export function serializePolicyToYaml(policy: PolicyDefinition): string {
  const lines: string[] = [];

  // Version
  lines.push(`version: "${policy.version}"`);
  lines.push(`name: "${escapeYamlString(policy.name)}"`);
  lines.push(`description: "${escapeYamlString(policy.description)}"`);
  lines.push('');

  // Variables
  if (policy.variables && Object.keys(policy.variables).length > 0) {
    lines.push('variables:');
    for (const [name, def] of Object.entries(policy.variables)) {
      lines.push(`  ${name}:`);
      lines.push(`    type: ${def.type}`);
      if (def.required !== undefined) {
        lines.push(`    required: ${def.required}`);
      }
      if (def.default !== undefined) {
        lines.push(`    default: ${serializeValue(def.default)}`);
      }
      if (def.enum) {
        lines.push(`    enum: [${def.enum.map(v => `"${escapeYamlString(v)}"`).join(', ')}]`);
      }
      if (def.description) {
        lines.push(`    description: "${escapeYamlString(def.description)}"`);
      }
    }
    lines.push('');
  }

  // Conditions
  if (policy.conditions && policy.conditions.length > 0) {
    lines.push('conditions:');
    for (const cond of policy.conditions) {
      lines.push(`  - id: "${escapeYamlString(cond.id)}"`);
      lines.push(`    check: ${cond.check}`);
      if (cond.path) {
        lines.push(`    path: "${escapeYamlString(cond.path)}"`);
      }
      if (cond.section) {
        lines.push(`    section: "${escapeYamlString(cond.section)}"`);
      }
      if (cond.field) {
        lines.push(`    field: "${escapeYamlString(cond.field)}"`);
      }
      if (cond.value !== undefined) {
        lines.push(`    value: ${serializeValue(cond.value)}`);
      }
    }
    lines.push('');
  }

  // Steps
  lines.push('steps:');
  for (const step of policy.steps) {
    lines.push(`  - id: "${escapeYamlString(step.id)}"`);
    lines.push(`    tool: ${step.tool}`);
    if (step.when) {
      lines.push(`    when: "${escapeYamlString(step.when)}"`);
    }
    if (step.description) {
      lines.push(`    description: "${escapeYamlString(step.description)}"`);
    }
    lines.push('    params:');
    for (const [key, value] of Object.entries(step.params)) {
      const serialized = serializeValue(value);
      if (typeof value === 'string' && value.includes('\n')) {
        // Multi-line string
        lines.push(`      ${key}: |`);
        for (const line of value.split('\n')) {
          lines.push(`        ${line}`);
        }
      } else {
        lines.push(`      ${key}: ${serialized}`);
      }
    }
  }

  // Output
  if (policy.output) {
    lines.push('');
    lines.push('output:');
    if (policy.output.summary) {
      lines.push(`  summary: "${escapeYamlString(policy.output.summary)}"`);
    }
    if (policy.output.files) {
      lines.push(`  files: [${policy.output.files.map(f => `"${escapeYamlString(f)}"`).join(', ')}]`);
    }
  }

  return lines.join('\n');
}

/**
 * Escape special characters in YAML string values
 */
function escapeYamlString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Serialize a value for YAML
 */
function serializeValue(value: unknown): string {
  if (typeof value === 'string') {
    // Check if needs quoting
    if (
      value === '' ||
      value.includes(':') ||
      value.includes('#') ||
      value.includes('{') ||
      value.includes('}') ||
      value.startsWith(' ') ||
      value.endsWith(' ') ||
      /^[0-9]/.test(value) ||
      ['true', 'false', 'null', 'yes', 'no'].includes(value.toLowerCase())
    ) {
      return `"${escapeYamlString(value)}"`;
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(v => serializeValue(v)).join(', ')}]`;
  }
  if (value === null || value === undefined) {
    return 'null';
  }
  // Objects get JSON serialized (not ideal but functional)
  return JSON.stringify(value);
}

/**
 * Validate a YAML string without fully parsing
 * Quick check for syntax errors
 */
export function quickValidateYaml(content: string): { valid: boolean; error?: string } {
  try {
    parseYaml(content);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Extract policy metadata without full validation
 * Useful for listing policies
 */
export function extractPolicyMetadata(yamlContent: string): {
  name?: string;
  description?: string;
  version?: string;
  variables?: string[];
} {
  try {
    const parsed = parseYaml(yamlContent) as Record<string, unknown>;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined,
      variables: parsed.variables && typeof parsed.variables === 'object'
        ? Object.keys(parsed.variables)
        : undefined,
    };
  } catch {
    return {};
  }
}
