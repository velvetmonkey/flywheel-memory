/**
 * Unified policy tool for Flywheel Memory
 *
 * Single `policy` tool with action parameter:
 * - list: List available policies
 * - validate: Validate policy YAML against schema
 * - preview: Dry-run showing what would happen
 * - execute: Run a policy with variables
 * - author: Generate policy YAML from description
 * - revise: Modify existing policy
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
  writePolicyRaw,
  serializePolicyToYaml,
  type PolicyDefinition,
} from '../../core/write/policy/index.js';
import { estimateTokens } from '../../core/write/constants.js';

/**
 * Register the unified policy tool with the MCP server
 */
export function registerPolicyTools(
  server: McpServer,
  vaultPath: string
): void {
  server.tool(
    'policy',
    'Manage vault policies. Actions: "list" (list all policies), "validate" (validate YAML), "preview" (dry-run), "execute" (run policy), "author" (generate policy YAML), "revise" (modify existing policy).',
    {
      action: z.enum(['list', 'validate', 'preview', 'execute', 'author', 'revise'])
        .describe('Action to perform'),
      // validate
      yaml: z.string().optional()
        .describe('Policy YAML content (required for "validate")'),
      // preview, execute, revise
      policy: z.string().optional()
        .describe('Policy name or full YAML content (required for "preview", "execute", "revise")'),
      // preview, execute
      variables: z.record(z.unknown()).optional()
        .describe('Variables to pass to the policy (for "preview", "execute")'),
      // execute
      commit: z.boolean().optional()
        .describe('If true, commit all changes with single atomic commit (for "execute")'),
      // author
      name: z.string().optional()
        .describe('Name for the policy (required for "author")'),
      description: z.string().optional()
        .describe('Description of what the policy should do (required for "author")'),
      steps: z.array(z.object({
        tool: z.string().describe('Tool to call (e.g., vault_add_to_section)'),
        description: z.string().describe('What this step does'),
        params: z.record(z.unknown()).describe('Parameters for the tool'),
      })).optional()
        .describe('Steps the policy should perform (required for "author")'),
      authorVariables: z.array(z.object({
        name: z.string().describe('Variable name'),
        type: z.enum(['string', 'number', 'boolean', 'array', 'enum']).describe('Variable type'),
        required: z.boolean().default(true).describe('Whether variable is required'),
        default: z.unknown().optional().describe('Default value'),
        enum: z.array(z.string()).optional().describe('Allowed values for enum type'),
        description: z.string().optional().describe('Variable description'),
      })).optional()
        .describe('Variables the policy accepts (for "author")'),
      conditions: z.array(z.object({
        id: z.string().describe('Condition ID'),
        check: z.string().describe('Condition type (file_exists, section_exists, etc.)'),
        path: z.string().optional().describe('File path'),
        section: z.string().optional().describe('Section name'),
        field: z.string().optional().describe('Frontmatter field'),
        value: z.unknown().optional().describe('Expected value'),
      })).optional()
        .describe('Conditions for conditional execution (for "author")'),
      // author, revise
      save: z.boolean().optional()
        .describe('If true, save to .claude/policies/ (for "author", "revise")'),
      // revise
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
      }).optional()
        .describe('Changes to make (required for "revise")'),
    },
    async (params) => {
      const { action } = params;

      try {
        switch (action) {
          // ========================================
          // Action: list
          // ========================================
          case 'list': {
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
          }

          // ========================================
          // Action: validate
          // ========================================
          case 'validate': {
            if (!params.yaml) {
              return {
                content: [{ type: 'text', text: JSON.stringify({
                  valid: false,
                  errors: [{ type: 'params', message: '"yaml" parameter is required for action "validate"' }],
                  warnings: [],
                }, null, 2) }],
              };
            }

            const result = parsePolicyString(params.yaml);

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
          }

          // ========================================
          // Action: preview
          // ========================================
          case 'preview': {
            if (!params.policy) {
              return {
                content: [{ type: 'text', text: JSON.stringify({
                  success: false,
                  message: '"policy" parameter is required for action "preview"',
                }, null, 2) }],
              };
            }

            const policyInput = params.policy;
            const variables = params.variables || {};
            let policyDef: PolicyDefinition;

            if (policyInput.includes('\n') || policyInput.includes(':')) {
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

            const preview = await previewPolicy(policyDef, vaultPath, variables);

            return { content: [{ type: 'text', text: JSON.stringify(preview, null, 2) }] };
          }

          // ========================================
          // Action: execute
          // ========================================
          case 'execute': {
            if (!params.policy) {
              return {
                content: [{ type: 'text', text: JSON.stringify({
                  success: false,
                  message: '"policy" parameter is required for action "execute"',
                }, null, 2) }],
              };
            }

            const policyInput = params.policy;
            const variables = params.variables || {};
            const commitFlag = params.commit ?? false;
            let policyDef: PolicyDefinition;

            if (policyInput.includes('\n') || policyInput.includes(':')) {
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

            const result = await executePolicy(policyDef, vaultPath, variables, commitFlag);

            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          // ========================================
          // Action: author
          // ========================================
          case 'author': {
            if (!params.name) {
              return {
                content: [{ type: 'text', text: JSON.stringify({
                  success: false,
                  message: '"name" parameter is required for action "author"',
                }, null, 2) }],
              };
            }
            if (!params.description) {
              return {
                content: [{ type: 'text', text: JSON.stringify({
                  success: false,
                  message: '"description" parameter is required for action "author"',
                }, null, 2) }],
              };
            }
            if (!params.steps || params.steps.length === 0) {
              return {
                content: [{ type: 'text', text: JSON.stringify({
                  success: false,
                  message: '"steps" parameter is required for action "author"',
                }, null, 2) }],
              };
            }

            const authorVars = params.authorVariables || [];
            const authorConditions = params.conditions || [];
            const saveFlag = params.save ?? false;

            const policy: PolicyDefinition = {
              version: '1.0',
              name: params.name,
              description: params.description,
              steps: params.steps.map((s, i) => ({
                id: `step-${i + 1}`,
                tool: s.tool as any,
                params: s.params,
                description: s.description,
              })),
            };

            if (authorVars.length > 0) {
              policy.variables = {};
              for (const v of authorVars) {
                policy.variables[v.name] = {
                  type: v.type,
                  required: v.required,
                  default: v.default as string | number | boolean | string[] | undefined,
                  enum: v.enum,
                  description: v.description,
                };
              }
            }

            if (authorConditions.length > 0) {
              policy.conditions = authorConditions.map(c => ({
                id: c.id,
                check: c.check as any,
                path: c.path,
                section: c.section,
                field: c.field,
                value: c.value as string | number | boolean | undefined,
              }));
            }

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

            const yaml = serializePolicyToYaml(policy);

            let savedPath: string | undefined;
            if (saveFlag) {
              const saveResult = await writePolicyRaw(vaultPath, params.name, yaml, false);
              if (saveResult.success) {
                savedPath = saveResult.path;
              } else {
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
              message: saveFlag ? `Policy '${params.name}' created and saved to ${savedPath}` : `Policy '${params.name}' generated (not saved)`,
              yaml,
              warnings: validation.warnings,
              savedPath,
              tokensEstimate: 0,
            };
            response.tokensEstimate = estimateTokens(response);

            return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
          }

          // ========================================
          // Action: revise
          // ========================================
          case 'revise': {
            if (!params.policy) {
              return {
                content: [{ type: 'text', text: JSON.stringify({
                  success: false,
                  message: '"policy" parameter is required for action "revise"',
                }, null, 2) }],
              };
            }
            if (!params.changes) {
              return {
                content: [{ type: 'text', text: JSON.stringify({
                  success: false,
                  message: '"changes" parameter is required for action "revise"',
                }, null, 2) }],
              };
            }

            const policyName = params.policy;
            const changes = params.changes;
            const saveFlag = params.save ?? false;

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

            if (changes.description) {
              policy.description = changes.description;
            }

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

            if (changes.removeVariables && changes.removeVariables.length > 0 && policy.variables) {
              for (const name of changes.removeVariables) {
                delete policy.variables[name];
              }
              if (Object.keys(policy.variables).length === 0) {
                delete policy.variables;
              }
            }

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

            if (changes.removeConditions && changes.removeConditions.length > 0 && policy.conditions) {
              policy.conditions = policy.conditions.filter(c => !changes.removeConditions!.includes(c.id));
              if (policy.conditions.length === 0) {
                delete policy.conditions;
              }
            }

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

            if (changes.removeSteps && changes.removeSteps.length > 0) {
              policy.steps = policy.steps.filter(s => !changes.removeSteps!.includes(s.id));
            }

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

            const yaml = serializePolicyToYaml(policy);

            if (saveFlag) {
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
              message: saveFlag ? `Policy '${policyName}' revised and saved` : `Policy '${policyName}' revised (not saved)`,
              yaml,
              warnings: validation.warnings,
              tokensEstimate: 0,
            };
            response.tokensEstimate = estimateTokens(response);

            return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
          }
        }
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: `Policy ${action} failed: ${error instanceof Error ? error.message : String(error)}`,
            }, null, 2),
          }],
        };
      }
    }
  );
}
