/**
 * Policy system types for Flywheel Memory
 * Defines the schema for policy YAML files and execution results
 */

/**
 * Variable type in a policy definition
 */
export type PolicyVariableType = 'string' | 'number' | 'boolean' | 'array' | 'enum';

/**
 * Variable definition in a policy
 */
export interface PolicyVariable {
  /** Variable type for validation */
  type: PolicyVariableType;
  /** Whether this variable must be provided */
  required?: boolean;
  /** Default value if not provided */
  default?: string | number | boolean | string[];
  /** For enum type: allowed values */
  enum?: string[];
  /** Human-readable description */
  description?: string;
}

/**
 * Condition types for conditional execution
 */
export type ConditionCheckType =
  | 'file_exists'
  | 'file_not_exists'
  | 'section_exists'
  | 'section_not_exists'
  | 'frontmatter_equals'
  | 'frontmatter_exists'
  | 'frontmatter_not_exists';

/**
 * Condition definition for conditional step execution
 */
export interface PolicyCondition {
  /** Unique identifier for this condition */
  id: string;
  /** Type of check to perform */
  check: ConditionCheckType;
  /** Path to file (supports template interpolation) */
  path?: string;
  /** Section name for section_exists/section_not_exists */
  section?: string;
  /** Frontmatter field name for frontmatter_* checks */
  field?: string;
  /** Expected value for frontmatter_equals */
  value?: string | number | boolean;
}

/**
 * Available tool names that can be called from policy steps
 */
export type PolicyToolName =
  | 'vault_add_to_section'
  | 'vault_remove_from_section'
  | 'vault_replace_in_section'
  | 'vault_create_note'
  | 'vault_delete_note'
  | 'vault_toggle_task'
  | 'vault_add_task'
  | 'vault_update_frontmatter'
  | 'vault_add_frontmatter_field';

/**
 * Step definition in a policy
 */
export interface PolicyStep {
  /** Unique identifier for this step */
  id: string;
  /** Tool to execute */
  tool: PolicyToolName;
  /** Optional condition (reference to condition id: "{{conditions.cond_id}}") */
  when?: string;
  /** Tool parameters (supports template interpolation) */
  params: Record<string, unknown>;
  /** Human-readable description */
  description?: string;
}

/**
 * Complete policy definition (matches YAML schema)
 */
export interface PolicyDefinition {
  /** Schema version */
  version: '1.0';
  /** Policy name (used as identifier) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Variable definitions */
  variables?: Record<string, PolicyVariable>;
  /** Condition definitions */
  conditions?: PolicyCondition[];
  /** Steps to execute in order */
  steps: PolicyStep[];
  /** Output configuration */
  output?: {
    /** Summary template */
    summary?: string;
    /** Files affected (auto-populated or template) */
    files?: string[];
  };
}

/**
 * Result of a single step execution
 */
export interface StepExecutionResult {
  /** Step id */
  stepId: string;
  /** Whether step executed successfully */
  success: boolean;
  /** Result message */
  message: string;
  /** Whether step was skipped due to condition */
  skipped?: boolean;
  /** Skip reason if skipped */
  skipReason?: string;
  /** File path affected */
  path?: string;
  /** Preview of changes */
  preview?: string;
  /** Outputs that can be referenced by subsequent steps via {{steps.stepId.outputKey}} */
  outputs?: Record<string, unknown>;
}

/**
 * Result of policy execution
 */
export interface PolicyExecutionResult {
  /** Whether all steps succeeded */
  success: boolean;
  /** Policy name that was executed */
  policyName: string;
  /** Overall message */
  message: string;
  /** Results for each step */
  stepResults: StepExecutionResult[];
  /** Git commit hash (if committed) */
  gitCommit?: string;
  /** Whether undo is available */
  undoAvailable?: boolean;
  /** Files that were modified */
  filesModified: string[];
  /** Summary from output template */
  summary?: string;
  /** Estimated tokens for response */
  tokensEstimate?: number;
  /**
   * Whether the failure is retryable (e.g., git lock contention)
   * Agents should retry with exponential backoff when this is true
   */
  retryable?: boolean;
  /** Suggested retry delay in milliseconds */
  retryAfterMs?: number;
  /** Whether git lock contention was detected */
  lockContention?: boolean;
}

/**
 * Result of policy validation
 */
export interface PolicyValidationResult {
  /** Whether policy is valid */
  valid: boolean;
  /** Validation errors */
  errors: PolicyValidationError[];
  /** Validation warnings (non-blocking) */
  warnings: PolicyValidationWarning[];
  /** Parsed policy (if valid) */
  policy?: PolicyDefinition;
}

/**
 * Validation error (blocks execution)
 */
export interface PolicyValidationError {
  /** Error type */
  type: 'schema' | 'variable' | 'step' | 'condition' | 'template';
  /** Error message */
  message: string;
  /** Location in policy (e.g., "steps[0].params.path") */
  path?: string;
}

/**
 * Validation warning (non-blocking)
 */
export interface PolicyValidationWarning {
  /** Warning type */
  type: 'deprecated' | 'unused' | 'suggestion';
  /** Warning message */
  message: string;
  /** Location in policy */
  path?: string;
}

/**
 * Preview result for dry-run execution
 */
export interface PolicyPreviewResult {
  /** Policy name */
  policyName: string;
  /** Variables resolved */
  resolvedVariables: Record<string, unknown>;
  /** Conditions evaluated */
  conditionResults: Record<string, boolean>;
  /** Steps that would execute */
  stepsToExecute: {
    stepId: string;
    tool: PolicyToolName;
    resolvedParams: Record<string, unknown>;
    skipped: boolean;
    skipReason?: string;
  }[];
  /** Files that would be affected */
  filesAffected: string[];
  /** Estimated tokens */
  tokensEstimate?: number;
}

/**
 * Context for template interpolation
 */
export interface PolicyContext {
  /** User-provided variables */
  variables: Record<string, unknown>;
  /** Evaluated conditions */
  conditions: Record<string, boolean>;
  /** Built-in values */
  builtins: {
    now: string;      // ISO timestamp
    today: string;    // YYYY-MM-DD
    time: string;     // HH:MM
    date: string;     // Same as today for clarity
  };
  /** Outputs from previous steps (for step chaining via {{steps.stepId.outputKey}}) */
  steps: Record<string, Record<string, unknown>>;
}

/**
 * Policy storage metadata
 */
export interface PolicyMetadata {
  /** Policy name */
  name: string;
  /** Policy description */
  description: string;
  /** File path relative to .claude/policies/ */
  path: string;
  /** Last modified date */
  lastModified: Date;
  /** Version from policy file */
  version: string;
  /** Variables required */
  requiredVariables: string[];
}
