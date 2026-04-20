/**
 * Policy identifier validation.
 *
 * Policy names are extensionless logical identifiers. Storage code appends
 * `.yaml` internally after validation succeeds.
 */

export interface PolicyNameValidationResult {
  valid: boolean;
  reason?: string;
}

export const POLICY_NAME_ERROR_MESSAGE =
  'Policy name must be an extensionless identifier: ASCII letters/digits with optional internal "-" or "_"';

const POLICY_NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/;

export function validatePolicyName(policyName: string): PolicyNameValidationResult {
  if (!policyName) {
    return { valid: false, reason: 'Policy name is required' };
  }

  if (policyName !== policyName.trim()) {
    return { valid: false, reason: 'Policy name cannot have leading or trailing whitespace' };
  }

  if (policyName.includes('/') || policyName.includes('\\')) {
    return { valid: false, reason: 'Policy name cannot contain path separators' };
  }

  if (policyName.includes('..')) {
    return { valid: false, reason: 'Policy name cannot contain ".."' };
  }

  if (/^[A-Za-z]:/.test(policyName)) {
    return { valid: false, reason: 'Policy name cannot use drive-style prefixes' };
  }

  if (policyName.startsWith('\\\\')) {
    return { valid: false, reason: 'Policy name cannot use UNC-style prefixes' };
  }

  if (policyName.includes('.')) {
    return { valid: false, reason: 'Policy name cannot contain dots' };
  }

  if (!POLICY_NAME_RE.test(policyName)) {
    return { valid: false, reason: POLICY_NAME_ERROR_MESSAGE };
  }

  return { valid: true };
}
