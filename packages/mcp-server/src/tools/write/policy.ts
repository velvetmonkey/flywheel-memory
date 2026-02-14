/**
 * Policy tools for Flywheel Crank
 *
 * Tools:
 * - policy_validate: Validate a policy YAML against schema
 * - policy_preview: Dry-run showing what would happen
 * - policy_author: Generate policy YAML from description (AI-assisted)
 * - policy_revise: Modify existing policy
 * - policy_execute: Run a policy with variables
 * - policy_list: List available policies
 * - policy_diff: Compare two policy versions
 * - policy_export: Export policy for sharing
 * - policy_import: Import shared policy
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  parsePolicyString,
  loadPolicy,
  validatePolicySchema,
  validateVariables,
  executePolicy,
  previewPolicy,
  listPolicies,
  readPolicyRaw,
  writePolicyRaw,
  importPolicy,
  exportPolicy,
  diffPolicies,
  serializePolicyToYaml,
  type PolicyDefinition,
  type PolicyValidationResult,
} from '../../core/write/policy/index.js';
import { estimateTokens } from '../../core/write/constants.js';

/**
 * Register policy tools with the MCP server
 */
export function registerPolicyTools(
  server: McpServer,
  vaultPath: string
): void {
  // ========================================
  // Tool: policy_validate
  // ========================================
  server.tool(
    'policy_validate',
    'Validate a policy YAML string against the schema. Returns validation errors and warnings.',
    {
      yaml: z.string().describe('Policy YAML content to validate'),
    },
    async ({ yaml }) => {
      try {
        const result = parsePolicyString(yaml);

        const response = {
          valid: result.valid,
          errors: result.errors,
          warnings: result.warnings,
          policy: result.policy ? {
            name: result.policy.name,
            description: result.policy.description,
            variables: result.policy.variables ? Object.keys(result.policy.variables) : [],
            steps: result.policy.steps.map(s => s.id),
            conditions: result.policy.conditions?.map(c => c.id) || [],
          } : undefined,
          tokensEstimate: 0,
        };
        response.tokensEstimate = estimateTokens(response);

        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      } catch (error) {
        const response = {
          valid: false,
          errors: [{ type: 'schema', message: String(error) }],
          warnings: [],
          tokensEstimate: 0,
        };
        response.tokensEstimate = estimateTokens(response);
        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      }
    }
  );

  // ========================================
  // Tool: policy_preview
  // ========================================
  server.tool(
    'policy_preview',
    'Preview policy execution without making changes (dry run). Shows resolved variables, conditions, and steps that would execute.',
    {
      policy: z.string().describe('Policy name (loads from .claude/policies/) or full YAML content'),
      variables: z.record(z.unknown()).default({}).describe('Variables to pass to the policy'),
    },
    async ({ policy: policyInput, variables }) => {
      try {
        let policyDef: PolicyDefinition;

        // Check if input is a name or YAML content
        if (policyInput.includes('\n') || policyInput.includes(':')) {
          // Looks like YAML content
          const validation = parsePolicyString(policyInput);
          if (!validation.valid || !validation.policy) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: `Invalid policy: ${validation.errors.map(e => e.message).join('; ')}`,
                }, null, 2),
              }],
            };
          }
          policyDef = validation.policy;
        } else {
          // Load by name
          const loaded = await loadPolicy(vaultPath, policyInput);
          if (!loaded.valid || !loaded.policy) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: `Policy not found or invalid: ${loaded.errors.map(e => e.message).join('; ')}`,
                }, null, 2),
              }],
            };
          }
          policyDef = loaded.policy;
        }

        // Validate variables
        const varValidation = validateVariables(policyDef, variables);
        if (!varValidation.valid) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: `Variable validation failed: ${varValidation.errors.join('; ')}`,
              }, null, 2),
            }],
          };
        }

        // Run preview
        const preview = await previewPolicy(policyDef, vaultPath, variables);

        return { content: [{ type: 'text', text: JSON.stringify(preview, null, 2) }] };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: `Preview failed: ${error instanceof Error ? error.message : String(error)}`,
            }, null, 2),
          }],
        };
      }
    }
  );

  // ========================================
  // Tool: policy_execute
  // ========================================
  server.tool(
    'policy_execute',
    'Execute a policy with provided variables. Creates a single atomic git commit for all changes.',
    {
      policy: z.string().describe('Policy name (loads from .claude/policies/) or full YAML content'),
      variables: z.record(z.unknown()).default({}).describe('Variables to pass to the policy'),
      commit: z.boolean().default(false).describe('If true, commit all changes with single atomic commit'),
    },
    async ({ policy: policyInput, variables, commit }) => {
      try {
        let policyDef: PolicyDefinition;

        // Check if input is a name or YAML content
        if (policyInput.includes('\n') || policyInput.includes(':')) {
          // Looks like YAML content
          const validation = parsePolicyString(policyInput);
          if (!validation.valid || !validation.policy) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: `Invalid policy: ${validation.errors.map(e => e.message).join('; ')}`,
                }, null, 2),
              }],
            };
          }
          policyDef = validation.policy;
        } else {
          // Load by name
          const loaded = await loadPolicy(vaultPath, policyInput);
          if (!loaded.valid || !loaded.policy) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: `Policy not found or invalid: ${loaded.errors.map(e => e.message).join('; ')}`,
                }, null, 2),
              }],
            };
          }
          policyDef = loaded.policy;
        }

        // Validate variables
        const varValidation = validateVariables(policyDef, variables);
        if (!varValidation.valid) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: `Variable validation failed: ${varValidation.errors.join('; ')}`,
              }, null, 2),
            }],
          };
        }

        // Execute policy
        const result = await executePolicy(policyDef, vaultPath, variables, commit);

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: `Execution failed: ${error instanceof Error ? error.message : String(error)}`,
            }, null, 2),
          }],
        };
      }
    }
  );

  // ========================================
  // Tool: policy_author
  // ========================================
  server.tool(
    'policy_author',
    'Generate a policy YAML template based on a description. Returns YAML that can be reviewed and saved.',
    {
      name: z.string().describe('Name for the policy (used as filename)'),
      description: z.string().describe('Description of what the policy should do'),
      steps: z.array(z.object({
        tool: z.string().describe('Tool to call (e.g., vault_add_to_section)'),
        description: z.string().describe('What this step does'),
        params: z.record(z.unknown()).describe('Parameters for the tool'),
      })).describe('Steps the policy should perform'),
      variables: z.array(z.object({
        name: z.string().describe('Variable name'),
        type: z.enum(['string', 'number', 'boolean', 'array', 'enum']).describe('Variable type'),
        required: z.boolean().default(true).describe('Whether variable is required'),
        default: z.unknown().optional().describe('Default value'),
        enum: z.array(z.string()).optional().describe('Allowed values for enum type'),
        description: z.string().optional().describe('Variable description'),
      })).default([]).describe('Variables the policy accepts'),
      conditions: z.array(z.object({
        id: z.string().describe('Condition ID'),
        check: z.string().describe('Condition type (file_exists, section_exists, etc.)'),
        path: z.string().optional().describe('File path'),
        section: z.string().optional().describe('Section name'),
        field: z.string().optional().describe('Frontmatter field'),
        value: z.unknown().optional().describe('Expected value'),
      })).default([]).describe('Conditions for conditional execution'),
      save: z.boolean().default(false).describe('If true, save to .claude/policies/'),
    },
    async ({ name, description, steps, variables, conditions, save }) => {
      try {
        // Build policy object
        const policy: PolicyDefinition = {
          version: '1.0',
          name,
          description,
          steps: steps.map((s, i) => ({
            id: `step-${i + 1}`,
            tool: s.tool as any,
            params: s.params,
            description: s.description,
          })),
        };

        // Add variables if provided
        if (variables.length > 0) {
          policy.variables = {};
          for (const v of variables) {
            policy.variables[v.name] = {
              type: v.type,
              required: v.required,
              default: v.default as string | number | boolean | string[] | undefined,
              enum: v.enum,
              description: v.description,
            };
          }
        }

        // Add conditions if provided
        if (conditions.length > 0) {
          policy.conditions = conditions.map(c => ({
            id: c.id,
            check: c.check as any,
            path: c.path,
            section: c.section,
            field: c.field,
            value: c.value as string | number | boolean | undefined,
          }));
        }

        // Validate
        const validation = validatePolicySchema(policy);
        if (!validation.valid) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: `Generated policy is invalid: ${validation.errors.map(e => e.message).join('; ')}`,
                warnings: validation.warnings,
              }, null, 2),
            }],
          };
        }

        // Serialize to YAML
        const yaml = serializePolicyToYaml(policy);

        // Save if requested
        let savedPath: string | undefined;
        if (save) {
          const saveResult = await writePolicyRaw(vaultPath, name, yaml, false);
          if (saveResult.success) {
            savedPath = saveResult.path;
          } else {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: saveResult.message,
                  yaml, // Return YAML anyway
                }, null, 2),
              }],
            };
          }
        }

        const response = {
          success: true,
          message: save ? `Policy '${name}' created and saved to ${savedPath}` : `Policy '${name}' generated (not saved)`,
          yaml,
          warnings: validation.warnings,
          savedPath,
          tokensEstimate: 0,
        };
        response.tokensEstimate = estimateTokens(response);

        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: `Failed to generate policy: ${error instanceof Error ? error.message : String(error)}`,
            }, null, 2),
          }],
        };
      }
    }
  );

  // ========================================
  // Tool: policy_revise
  // ========================================
  server.tool(
    'policy_revise',
    'Modify an existing policy. Can update description, add/remove steps, add/remove variables.',
    {
      policy: z.string().describe('Policy name to revise'),
      changes: z.object({
        description: z.string().optional().describe('New description'),
        addVariables: z.array(z.object({
          name: z.string(),
          type: z.enum(['string', 'number', 'boolean', 'array', 'enum']),
          required: z.boolean().default(true),
          default: z.unknown().optional(),
          enum: z.array(z.string()).optional(),
          description: z.string().optional(),
        })).optional().describe('Variables to add'),
        removeVariables: z.array(z.string()).optional().describe('Variable names to remove'),
        addSteps: z.array(z.object({
          id: z.string(),
          tool: z.string(),
          params: z.record(z.unknown()),
          when: z.string().optional(),
          description: z.string().optional(),
          afterStep: z.string().optional().describe('Insert after this step ID'),
        })).optional().describe('Steps to add'),
        removeSteps: z.array(z.string()).optional().describe('Step IDs to remove'),
        addConditions: z.array(z.object({
          id: z.string(),
          check: z.string(),
          path: z.string().optional(),
          section: z.string().optional(),
          field: z.string().optional(),
          value: z.unknown().optional(),
        })).optional().describe('Conditions to add'),
        removeConditions: z.array(z.string()).optional().describe('Condition IDs to remove'),
      }).describe('Changes to make'),
      save: z.boolean().default(false).describe('If true, save changes'),
    },
    async ({ policy: policyName, changes, save }) => {
      try {
        // Load existing policy
        const loaded = await loadPolicy(vaultPath, policyName);
        if (!loaded.valid || !loaded.policy) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: `Policy not found: ${policyName}`,
              }, null, 2),
            }],
          };
        }

        const policy = { ...loaded.policy };

        // Apply description change
        if (changes.description) {
          policy.description = changes.description;
        }

        // Add variables
        if (changes.addVariables && changes.addVariables.length > 0) {
          policy.variables = policy.variables || {};
          for (const v of changes.addVariables) {
            policy.variables[v.name] = {
              type: v.type,
              required: v.required,
              default: v.default as string | number | boolean | string[] | undefined,
              enum: v.enum,
              description: v.description,
            };
          }
        }

        // Remove variables
        if (changes.removeVariables && changes.removeVariables.length > 0 && policy.variables) {
          for (const name of changes.removeVariables) {
            delete policy.variables[name];
          }
          if (Object.keys(policy.variables).length === 0) {
            delete policy.variables;
          }
        }

        // Add conditions
        if (changes.addConditions && changes.addConditions.length > 0) {
          policy.conditions = policy.conditions || [];
          for (const c of changes.addConditions) {
            policy.conditions.push({
              id: c.id,
              check: c.check as any,
              path: c.path,
              section: c.section,
              field: c.field,
              value: c.value as string | number | boolean | undefined,
            });
          }
        }

        // Remove conditions
        if (changes.removeConditions && changes.removeConditions.length > 0 && policy.conditions) {
          policy.conditions = policy.conditions.filter(c => !changes.removeConditions!.includes(c.id));
          if (policy.conditions.length === 0) {
            delete policy.conditions;
          }
        }

        // Add steps
        if (changes.addSteps && changes.addSteps.length > 0) {
          for (const s of changes.addSteps) {
            const newStep = {
              id: s.id,
              tool: s.tool as any,
              params: s.params,
              when: s.when,
              description: s.description,
            };

            if (s.afterStep) {
              const idx = policy.steps.findIndex(st => st.id === s.afterStep);
              if (idx >= 0) {
                policy.steps.splice(idx + 1, 0, newStep);
              } else {
                policy.steps.push(newStep);
              }
            } else {
              policy.steps.push(newStep);
            }
          }
        }

        // Remove steps
        if (changes.removeSteps && changes.removeSteps.length > 0) {
          policy.steps = policy.steps.filter(s => !changes.removeSteps!.includes(s.id));
        }

        // Validate
        const validation = validatePolicySchema(policy);
        if (!validation.valid) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: `Revised policy is invalid: ${validation.errors.map(e => e.message).join('; ')}`,
              }, null, 2),
            }],
          };
        }

        // Serialize
        const yaml = serializePolicyToYaml(policy);

        // Save if requested
        if (save) {
          const saveResult = await writePolicyRaw(vaultPath, policyName, yaml, true);
          if (!saveResult.success) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: saveResult.message,
                  yaml,
                }, null, 2),
              }],
            };
          }
        }

        const response = {
          success: true,
          message: save ? `Policy '${policyName}' revised and saved` : `Policy '${policyName}' revised (not saved)`,
          yaml,
          warnings: validation.warnings,
          tokensEstimate: 0,
        };
        response.tokensEstimate = estimateTokens(response);

        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: `Failed to revise policy: ${error instanceof Error ? error.message : String(error)}`,
            }, null, 2),
          }],
        };
      }
    }
  );

  // ========================================
  // Tool: policy_list
  // ========================================
  server.tool(
    'policy_list',
    'List all available policies in the vault\'s .claude/policies/ directory',
    {},
    async () => {
      try {
        const policies = await listPolicies(vaultPath);

        const response = {
          success: true,
          count: policies.length,
          policies: policies.map(p => ({
            name: p.name,
            description: p.description,
            path: p.path,
            version: p.version,
            requiredVariables: p.requiredVariables,
            lastModified: p.lastModified.toISOString(),
          })),
          tokensEstimate: 0,
        };
        response.tokensEstimate = estimateTokens(response);

        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: `Failed to list policies: ${error instanceof Error ? error.message : String(error)}`,
            }, null, 2),
          }],
        };
      }
    }
  );

  // ========================================
  // Tool: policy_diff
  // ========================================
  server.tool(
    'policy_diff',
    'Compare two versions of a policy and show differences',
    {
      oldPolicy: z.string().describe('Old policy name or YAML'),
      newPolicy: z.string().describe('New policy name or YAML'),
    },
    async ({ oldPolicy, newPolicy }) => {
      try {
        // Load/parse both policies
        let oldDef: PolicyDefinition;
        let newDef: PolicyDefinition;

        // Parse old policy
        if (oldPolicy.includes('\n') || oldPolicy.includes(':')) {
          const validation = parsePolicyString(oldPolicy);
          if (!validation.valid || !validation.policy) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: `Invalid old policy: ${validation.errors.map(e => e.message).join('; ')}`,
                }, null, 2),
              }],
            };
          }
          oldDef = validation.policy;
        } else {
          const loaded = await loadPolicy(vaultPath, oldPolicy);
          if (!loaded.valid || !loaded.policy) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: `Old policy not found: ${oldPolicy}`,
                }, null, 2),
              }],
            };
          }
          oldDef = loaded.policy;
        }

        // Parse new policy
        if (newPolicy.includes('\n') || newPolicy.includes(':')) {
          const validation = parsePolicyString(newPolicy);
          if (!validation.valid || !validation.policy) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: `Invalid new policy: ${validation.errors.map(e => e.message).join('; ')}`,
                }, null, 2),
              }],
            };
          }
          newDef = validation.policy;
        } else {
          const loaded = await loadPolicy(vaultPath, newPolicy);
          if (!loaded.valid || !loaded.policy) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: `New policy not found: ${newPolicy}`,
                }, null, 2),
              }],
            };
          }
          newDef = loaded.policy;
        }

        // Compare
        const diff = diffPolicies(oldDef, newDef);

        const response = {
          success: true,
          oldPolicy: oldDef.name,
          newPolicy: newDef.name,
          diff,
          hasChanges:
            diff.variablesAdded.length > 0 ||
            diff.variablesRemoved.length > 0 ||
            diff.variablesChanged.length > 0 ||
            diff.stepsAdded.length > 0 ||
            diff.stepsRemoved.length > 0 ||
            diff.stepsChanged.length > 0 ||
            diff.conditionsAdded.length > 0 ||
            diff.conditionsRemoved.length > 0,
          tokensEstimate: 0,
        };
        response.tokensEstimate = estimateTokens(response);

        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: `Failed to diff policies: ${error instanceof Error ? error.message : String(error)}`,
            }, null, 2),
          }],
        };
      }
    }
  );

  // ========================================
  // Tool: policy_export
  // ========================================
  server.tool(
    'policy_export',
    'Export a policy as YAML for sharing',
    {
      policy: z.string().describe('Policy name to export'),
    },
    async ({ policy: policyName }) => {
      try {
        const result = await exportPolicy(vaultPath, policyName);

        if (!result.success) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: result.message,
              }, null, 2),
            }],
          };
        }

        const response = {
          success: true,
          policyName,
          yaml: result.content,
          message: `Policy '${policyName}' exported`,
          tokensEstimate: 0,
        };
        response.tokensEstimate = estimateTokens(response);

        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: `Failed to export policy: ${error instanceof Error ? error.message : String(error)}`,
            }, null, 2),
          }],
        };
      }
    }
  );

  // ========================================
  // Tool: policy_import
  // ========================================
  server.tool(
    'policy_import',
    'Import a policy from YAML content',
    {
      yaml: z.string().describe('Policy YAML content to import'),
      overwrite: z.boolean().default(false).describe('If true, overwrite existing policy with same name'),
    },
    async ({ yaml, overwrite }) => {
      try {
        const result = await importPolicy(vaultPath, yaml, overwrite);

        const response = {
          success: result.success,
          policyName: result.policyName,
          message: result.message,
          tokensEstimate: 0,
        };
        response.tokensEstimate = estimateTokens(response);

        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: `Failed to import policy: ${error instanceof Error ? error.message : String(error)}`,
            }, null, 2),
          }],
        };
      }
    }
  );
}
