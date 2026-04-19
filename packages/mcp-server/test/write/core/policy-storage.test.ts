import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTempVault,
  cleanupTempVault,
} from '../helpers/testUtils.js';
import {
  policyExists,
  getPolicyPath,
  savePolicy,
  deletePolicy,
  readPolicyRaw,
  writePolicyRaw,
} from '../../../src/core/write/policy/storage.js';
import { loadPolicy } from '../../../src/core/write/policy/parser.js';
import type { PolicyDefinition } from '../../../src/core/write/policy/types.js';

const VALID_POLICY: PolicyDefinition = {
  version: '1.0',
  name: 'safe-policy',
  description: 'Valid policy fixture',
  steps: [
    {
      id: 'create-note',
      tool: 'vault_create_note',
      params: {
        path: 'notes/test.md',
        content: 'hello',
      },
    },
  ],
};

const VALID_POLICY_YAML = `
version: "1.0"
name: "safe-policy"
description: "Valid policy fixture"
steps:
  - id: "create-note"
    tool: vault_create_note
    params:
      path: "notes/test.md"
      content: "hello"
`.trim();

describe('Policy Storage', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(vaultPath);
  });

  describe.each([
    '../escape',
    'bad/name',
    'bad name',
    'policy.yaml',
    'C:\\evil',
    '\\\\server\\share',
  ])('invalid policy name %s', (policyName) => {
    it('rejects all storage entry points and parser lookup', async () => {
      expect(await policyExists(vaultPath, policyName)).toBe(false);
      expect(await getPolicyPath(vaultPath, policyName)).toBeNull();

      const saveResult = await savePolicy(vaultPath, {
        ...VALID_POLICY,
        name: policyName,
      });
      expect(saveResult.success).toBe(false);
      expect(saveResult.message).toMatch(/invalid policy name/i);

      const deleteResult = await deletePolicy(vaultPath, policyName);
      expect(deleteResult.success).toBe(false);
      expect(deleteResult.message).toMatch(/invalid policy name/i);

      const readResult = await readPolicyRaw(vaultPath, policyName);
      expect(readResult.success).toBe(false);
      expect(readResult.message).toMatch(/invalid policy name/i);

      const writeResult = await writePolicyRaw(vaultPath, policyName, VALID_POLICY_YAML, true);
      expect(writeResult.success).toBe(false);
      expect(writeResult.message).toMatch(/invalid policy name/i);

      const loadResult = await loadPolicy(vaultPath, policyName);
      expect(loadResult.valid).toBe(false);
      expect(loadResult.errors[0]?.message).toMatch(/invalid policy name/i);
      expect(loadResult.errors[0]?.path).toBe('name');
    });
  });
});
