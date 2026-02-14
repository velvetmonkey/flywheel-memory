/**
 * Policy storage utilities
 *
 * Manages policies stored in .claude/policies/ directory.
 */

import fs from 'fs/promises';
import path from 'path';
import type { PolicyMetadata, PolicyDefinition } from './types.js';
import { extractPolicyMetadata, parsePolicyString, serializePolicyToYaml } from './parser.js';

/**
 * Get the policies directory path for a vault
 */
export function getPoliciesDir(vaultPath: string): string {
  return path.join(vaultPath, '.claude', 'policies');
}

/**
 * Ensure the policies directory exists
 */
export async function ensurePoliciesDir(vaultPath: string): Promise<void> {
  const dir = getPoliciesDir(vaultPath);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * List all policies in the vault
 */
export async function listPolicies(vaultPath: string): Promise<PolicyMetadata[]> {
  const dir = getPoliciesDir(vaultPath);
  const policies: PolicyMetadata[] = [];

  try {
    const files = await fs.readdir(dir);

    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) {
        continue;
      }

      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const metadata = extractPolicyMetadata(content);

      policies.push({
        name: metadata.name || file.replace(/\.ya?ml$/, ''),
        description: metadata.description || 'No description',
        path: file,
        lastModified: stat.mtime,
        version: metadata.version || '1.0',
        requiredVariables: metadata.variables || [],
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    // Directory doesn't exist - no policies
  }

  // Sort by name
  policies.sort((a, b) => a.name.localeCompare(b.name));

  return policies;
}

/**
 * Check if a policy exists
 */
export async function policyExists(vaultPath: string, policyName: string): Promise<boolean> {
  const dir = getPoliciesDir(vaultPath);

  // Try both extensions
  const yamlPath = path.join(dir, `${policyName}.yaml`);
  const ymlPath = path.join(dir, `${policyName}.yml`);

  try {
    await fs.access(yamlPath);
    return true;
  } catch {
    try {
      await fs.access(ymlPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get the full path to a policy file
 */
export async function getPolicyPath(vaultPath: string, policyName: string): Promise<string | null> {
  const dir = getPoliciesDir(vaultPath);

  const yamlPath = path.join(dir, `${policyName}.yaml`);
  const ymlPath = path.join(dir, `${policyName}.yml`);

  try {
    await fs.access(yamlPath);
    return yamlPath;
  } catch {
    try {
      await fs.access(ymlPath);
      return ymlPath;
    } catch {
      return null;
    }
  }
}

/**
 * Save a policy to the vault
 */
export async function savePolicy(
  vaultPath: string,
  policy: PolicyDefinition,
  overwrite: boolean = false
): Promise<{ success: boolean; path: string; message: string }> {
  const dir = getPoliciesDir(vaultPath);
  await ensurePoliciesDir(vaultPath);

  const filename = `${policy.name}.yaml`;
  const filePath = path.join(dir, filename);

  // Check if exists
  if (!overwrite) {
    try {
      await fs.access(filePath);
      return {
        success: false,
        path: filename,
        message: `Policy '${policy.name}' already exists. Use overwrite=true to replace.`,
      };
    } catch {
      // File doesn't exist - good
    }
  }

  // Serialize and save
  const yaml = serializePolicyToYaml(policy);
  await fs.writeFile(filePath, yaml, 'utf-8');

  return {
    success: true,
    path: filename,
    message: `Policy '${policy.name}' saved to ${filename}`,
  };
}

/**
 * Delete a policy from the vault
 */
export async function deletePolicy(
  vaultPath: string,
  policyName: string
): Promise<{ success: boolean; message: string }> {
  const policyPath = await getPolicyPath(vaultPath, policyName);

  if (!policyPath) {
    return {
      success: false,
      message: `Policy '${policyName}' not found`,
    };
  }

  await fs.unlink(policyPath);

  return {
    success: true,
    message: `Policy '${policyName}' deleted`,
  };
}

/**
 * Read raw policy YAML content
 */
export async function readPolicyRaw(
  vaultPath: string,
  policyName: string
): Promise<{ success: boolean; content?: string; message: string }> {
  const policyPath = await getPolicyPath(vaultPath, policyName);

  if (!policyPath) {
    return {
      success: false,
      message: `Policy '${policyName}' not found`,
    };
  }

  const content = await fs.readFile(policyPath, 'utf-8');

  return {
    success: true,
    content,
    message: `Read policy '${policyName}'`,
  };
}

/**
 * Write raw policy YAML content
 */
export async function writePolicyRaw(
  vaultPath: string,
  policyName: string,
  content: string,
  overwrite: boolean = false
): Promise<{ success: boolean; path: string; message: string }> {
  const dir = getPoliciesDir(vaultPath);
  await ensurePoliciesDir(vaultPath);

  const filename = `${policyName}.yaml`;
  const filePath = path.join(dir, filename);

  // Check if exists
  if (!overwrite) {
    try {
      await fs.access(filePath);
      return {
        success: false,
        path: filename,
        message: `Policy '${policyName}' already exists. Use overwrite=true to replace.`,
      };
    } catch {
      // File doesn't exist - good
    }
  }

  // Validate before saving
  const validation = parsePolicyString(content);
  if (!validation.valid) {
    return {
      success: false,
      path: filename,
      message: `Invalid policy: ${validation.errors.map(e => e.message).join('; ')}`,
    };
  }

  await fs.writeFile(filePath, content, 'utf-8');

  return {
    success: true,
    path: filename,
    message: `Policy '${policyName}' saved to ${filename}`,
  };
}

/**
 * Compare two policy versions and return diff information
 */
export function diffPolicies(
  oldPolicy: PolicyDefinition,
  newPolicy: PolicyDefinition
): {
  variablesAdded: string[];
  variablesRemoved: string[];
  variablesChanged: string[];
  stepsAdded: string[];
  stepsRemoved: string[];
  stepsChanged: string[];
  conditionsAdded: string[];
  conditionsRemoved: string[];
} {
  const result = {
    variablesAdded: [] as string[],
    variablesRemoved: [] as string[],
    variablesChanged: [] as string[],
    stepsAdded: [] as string[],
    stepsRemoved: [] as string[],
    stepsChanged: [] as string[],
    conditionsAdded: [] as string[],
    conditionsRemoved: [] as string[],
  };

  // Compare variables
  const oldVars = new Set(Object.keys(oldPolicy.variables || {}));
  const newVars = new Set(Object.keys(newPolicy.variables || {}));

  for (const v of newVars) {
    if (!oldVars.has(v)) {
      result.variablesAdded.push(v);
    } else if (JSON.stringify(oldPolicy.variables?.[v]) !== JSON.stringify(newPolicy.variables?.[v])) {
      result.variablesChanged.push(v);
    }
  }
  for (const v of oldVars) {
    if (!newVars.has(v)) {
      result.variablesRemoved.push(v);
    }
  }

  // Compare steps
  const oldSteps = new Set(oldPolicy.steps.map(s => s.id));
  const newSteps = new Set(newPolicy.steps.map(s => s.id));

  for (const s of newSteps) {
    if (!oldSteps.has(s)) {
      result.stepsAdded.push(s);
    } else {
      const oldStep = oldPolicy.steps.find(st => st.id === s);
      const newStep = newPolicy.steps.find(st => st.id === s);
      if (JSON.stringify(oldStep) !== JSON.stringify(newStep)) {
        result.stepsChanged.push(s);
      }
    }
  }
  for (const s of oldSteps) {
    if (!newSteps.has(s)) {
      result.stepsRemoved.push(s);
    }
  }

  // Compare conditions
  const oldConds = new Set((oldPolicy.conditions || []).map(c => c.id));
  const newConds = new Set((newPolicy.conditions || []).map(c => c.id));

  for (const c of newConds) {
    if (!oldConds.has(c)) {
      result.conditionsAdded.push(c);
    }
  }
  for (const c of oldConds) {
    if (!newConds.has(c)) {
      result.conditionsRemoved.push(c);
    }
  }

  return result;
}

/**
 * Export a policy as a portable string (same as raw YAML)
 */
export async function exportPolicy(
  vaultPath: string,
  policyName: string
): Promise<{ success: boolean; content?: string; message: string }> {
  return readPolicyRaw(vaultPath, policyName);
}

/**
 * Import a policy from YAML content
 */
export async function importPolicy(
  vaultPath: string,
  content: string,
  overwrite: boolean = false
): Promise<{ success: boolean; policyName?: string; message: string }> {
  // Parse and validate
  const validation = parsePolicyString(content);

  if (!validation.valid) {
    return {
      success: false,
      message: `Invalid policy: ${validation.errors.map(e => e.message).join('; ')}`,
    };
  }

  const policy = validation.policy!;

  // Save with the policy's name
  const saveResult = await savePolicy(vaultPath, policy, overwrite);

  return {
    success: saveResult.success,
    policyName: policy.name,
    message: saveResult.message,
  };
}
