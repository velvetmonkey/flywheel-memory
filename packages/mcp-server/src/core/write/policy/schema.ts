/**
 * Zod schema for policy YAML validation
 */

import { z } from 'zod';
import type {
  PolicyDefinition,
  PolicyVariable,
  PolicyCondition,
  PolicyStep,
  PolicyValidationResult,
  PolicyValidationError,
  PolicyValidationWarning,
} from './types.js';

/**
 * Variable type enum
 */
const PolicyVariableTypeSchema = z.enum(['string', 'number', 'boolean', 'array', 'enum']);

/**
 * Variable definition schema
 */
const PolicyVariableSchema = z.object({
  type: PolicyVariableTypeSchema,
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  enum: z.array(z.string()).optional(),
  description: z.string().optional(),
}).refine(
  (data) => {
    // If type is enum, enum array must be provided
    if (data.type === 'enum' && (!data.enum || data.enum.length === 0)) {
      return false;
    }
    return true;
  },
  { message: 'Enum type requires a non-empty enum array' }
);

/**
 * Condition check type enum
 */
const ConditionCheckTypeSchema = z.enum([
  'file_exists',
  'file_not_exists',
  'section_exists',
  'section_not_exists',
  'frontmatter_equals',
  'frontmatter_exists',
  'frontmatter_not_exists',
]);

/**
 * Condition definition schema
 */
const PolicyConditionSchema = z.object({
  id: z.string().min(1, 'Condition id is required'),
  check: ConditionCheckTypeSchema,
  path: z.string().optional(),
  section: z.string().optional(),
  field: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
}).refine(
  (data) => {
    // file_exists and file_not_exists require path
    if (['file_exists', 'file_not_exists'].includes(data.check) && !data.path) {
      return false;
    }
    // section_* require path and section
    if (['section_exists', 'section_not_exists'].includes(data.check) && (!data.path || !data.section)) {
      return false;
    }
    // frontmatter_* require path and field
    if (['frontmatter_equals', 'frontmatter_exists', 'frontmatter_not_exists'].includes(data.check) && (!data.path || !data.field)) {
      return false;
    }
    // frontmatter_equals requires value
    if (data.check === 'frontmatter_equals' && data.value === undefined) {
      return false;
    }
    return true;
  },
  { message: 'Condition is missing required fields for its check type' }
);

/**
 * Tool name enum - all available vault tools
 */
const PolicyToolNameSchema = z.enum([
  'vault_add_to_section',
  'vault_remove_from_section',
  'vault_replace_in_section',
  'vault_create_note',
  'vault_delete_note',
  'vault_toggle_task',
  'vault_add_task',
  'vault_update_frontmatter',
  'vault_add_frontmatter_field',
]);

/**
 * Step definition schema
 */
const PolicyStepSchema = z.object({
  id: z.string().min(1, 'Step id is required'),
  tool: PolicyToolNameSchema,
  when: z.string().optional(),
  params: z.record(z.unknown()),
  description: z.string().optional(),
});

/**
 * Output configuration schema
 */
const PolicyOutputSchema = z.object({
  summary: z.string().optional(),
  files: z.array(z.string()).optional(),
});

/**
 * Complete policy definition schema
 */
export const PolicyDefinitionSchema = z.object({
  version: z.literal('1.0'),
  name: z.string().min(1, 'Policy name is required'),
  description: z.string().min(1, 'Policy description is required'),
  variables: z.record(PolicyVariableSchema).optional(),
  conditions: z.array(PolicyConditionSchema).optional(),
  steps: z.array(PolicyStepSchema).min(1, 'At least one step is required'),
  output: PolicyOutputSchema.optional(),
});

/**
 * Validate a parsed policy object against the schema
 */
export function validatePolicySchema(policy: unknown): PolicyValidationResult {
  const errors: PolicyValidationError[] = [];
  const warnings: PolicyValidationWarning[] = [];

  // Run Zod validation
  const result = PolicyDefinitionSchema.safeParse(policy);

  if (!result.success) {
    // Convert Zod errors to our format
    for (const issue of result.error.issues) {
      errors.push({
        type: 'schema',
        message: issue.message,
        path: issue.path.join('.'),
      });
    }

    return { valid: false, errors, warnings };
  }

  const validPolicy = result.data as PolicyDefinition;

  // Additional semantic validation

  // Check for unique step ids
  const stepIds = new Set<string>();
  for (let i = 0; i < validPolicy.steps.length; i++) {
    const step = validPolicy.steps[i];
    if (stepIds.has(step.id)) {
      errors.push({
        type: 'step',
        message: `Duplicate step id: ${step.id}`,
        path: `steps[${i}].id`,
      });
    }
    stepIds.add(step.id);
  }

  // Check for unique condition ids
  if (validPolicy.conditions) {
    const condIds = new Set<string>();
    for (let i = 0; i < validPolicy.conditions.length; i++) {
      const cond = validPolicy.conditions[i];
      if (condIds.has(cond.id)) {
        errors.push({
          type: 'condition',
          message: `Duplicate condition id: ${cond.id}`,
          path: `conditions[${i}].id`,
        });
      }
      condIds.add(cond.id);
    }

    // Check that condition references in steps are valid
    for (let i = 0; i < validPolicy.steps.length; i++) {
      const step = validPolicy.steps[i];
      if (step.when) {
        // Extract condition id from {{conditions.xxx}}
        const match = step.when.match(/\{\{conditions\.(\w+)\}\}/);
        if (match) {
          const refId = match[1];
          if (!condIds.has(refId)) {
            errors.push({
              type: 'step',
              message: `Step references unknown condition: ${refId}`,
              path: `steps[${i}].when`,
            });
          }
        }
      }
    }
  }

  // Validate variable references in step params match defined variables
  if (validPolicy.variables) {
    const varNames = new Set(Object.keys(validPolicy.variables));

    for (let i = 0; i < validPolicy.steps.length; i++) {
      const step = validPolicy.steps[i];
      const paramsStr = JSON.stringify(step.params);

      // Find all {{variables.xxx}} or {{xxx}} references
      const varRefs = paramsStr.match(/\{\{(?:variables\.)?(\w+)(?:\.[^}]*)?\}\}/g) || [];

      for (const ref of varRefs) {
        // Extract variable name
        const match = ref.match(/\{\{(?:variables\.)?(\w+)/);
        if (match) {
          const varName = match[1];
          // Skip builtins, conditions, and steps
          if (['now', 'today', 'time', 'date', 'conditions', 'steps'].includes(varName)) {
            continue;
          }
          if (!varNames.has(varName)) {
            warnings.push({
              type: 'suggestion',
              message: `Step references undefined variable: ${varName}`,
              path: `steps[${i}].params`,
            });
          }
        }
      }
    }
  }

  // Check for unused variables
  if (validPolicy.variables) {
    const usedVars = new Set<string>();
    const policyStr = JSON.stringify(validPolicy.steps);

    for (const varName of Object.keys(validPolicy.variables)) {
      const patterns = [
        `{{${varName}}}`,
        `{{variables.${varName}}}`,
        `{{${varName} |`,
        `{{variables.${varName} |`,
        `{{${varName}.`,
        `{{variables.${varName}.`,
      ];

      if (patterns.some(p => policyStr.includes(p))) {
        usedVars.add(varName);
      }
    }

    for (const varName of Object.keys(validPolicy.variables)) {
      if (!usedVars.has(varName)) {
        warnings.push({
          type: 'unused',
          message: `Variable '${varName}' is defined but never used`,
          path: `variables.${varName}`,
        });
      }
    }
  }

  // Check for unused conditions
  if (validPolicy.conditions) {
    const usedConds = new Set<string>();

    for (const step of validPolicy.steps) {
      if (step.when) {
        const match = step.when.match(/\{\{conditions\.(\w+)\}\}/);
        if (match) {
          usedConds.add(match[1]);
        }
      }
    }

    for (const cond of validPolicy.conditions) {
      if (!usedConds.has(cond.id)) {
        warnings.push({
          type: 'unused',
          message: `Condition '${cond.id}' is defined but never used`,
          path: `conditions`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    policy: errors.length === 0 ? validPolicy : undefined,
  };
}

/**
 * Validate that provided variables match policy requirements
 */
export function validateVariables(
  policy: PolicyDefinition,
  providedVars: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!policy.variables) {
    // No variables defined, anything goes
    return { valid: true, errors: [] };
  }

  for (const [name, def] of Object.entries(policy.variables)) {
    const value = providedVars[name];

    // Check required
    if (def.required && value === undefined && def.default === undefined) {
      errors.push(`Required variable '${name}' is not provided`);
      continue;
    }

    // If no value and has default, skip type checking (default will be used)
    if (value === undefined) {
      continue;
    }

    // Type validation
    switch (def.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push(`Variable '${name}' must be a string, got ${typeof value}`);
        }
        break;

      case 'number':
        if (typeof value !== 'number') {
          errors.push(`Variable '${name}' must be a number, got ${typeof value}`);
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`Variable '${name}' must be a boolean, got ${typeof value}`);
        }
        break;

      case 'array':
        if (!Array.isArray(value)) {
          errors.push(`Variable '${name}' must be an array, got ${typeof value}`);
        }
        break;

      case 'enum':
        if (def.enum && !def.enum.includes(String(value))) {
          errors.push(`Variable '${name}' must be one of: ${def.enum.join(', ')}`);
        }
        break;
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Resolve variable values with defaults applied
 */
export function resolveVariables(
  policy: PolicyDefinition,
  providedVars: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...providedVars };

  if (!policy.variables) {
    return resolved;
  }

  for (const [name, def] of Object.entries(policy.variables)) {
    if (resolved[name] === undefined && def.default !== undefined) {
      resolved[name] = def.default;
    }
  }

  return resolved;
}
