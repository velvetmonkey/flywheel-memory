/**
 * Parser and schema validation tests
 */

import { describe, it, expect } from 'vitest';
import {
  parseYaml,
  parsePolicyString,
  serializePolicyToYaml,
  quickValidateYaml,
  extractPolicyMetadata,
} from '../../../src/core/policy/parser.js';
import {
  validatePolicySchema,
  validateVariables,
  resolveVariables,
} from '../../../src/core/policy/schema.js';
import type { PolicyDefinition } from '../../../src/core/policy/types.js';

describe('parseYaml', () => {
  it('should parse simple YAML', () => {
    const yaml = `
name: test
version: "1.0"
`;
    const result = parseYaml(yaml) as Record<string, unknown>;
    expect(result.name).toBe('test');
    expect(result.version).toBe('1.0');
  });

  it('should parse arrays', () => {
    const yaml = `
items:
  - one
  - two
  - three
`;
    const result = parseYaml(yaml) as Record<string, unknown>;
    expect(result.items).toEqual(['one', 'two', 'three']);
  });

  it('should parse nested objects', () => {
    const yaml = `
user:
  name: Alice
  address:
    city: NYC
`;
    const result = parseYaml(yaml) as Record<string, unknown>;
    expect((result.user as any).name).toBe('Alice');
    expect((result.user as any).address.city).toBe('NYC');
  });
});

describe('parsePolicyString', () => {
  const validPolicy = `
version: "1.0"
name: test-policy
description: A test policy

variables:
  note_path:
    type: string
    required: true

steps:
  - id: step-1
    tool: vault_add_to_section
    params:
      path: "{{note_path}}"
      section: Log
      content: Test content
`;

  it('should parse valid policy', () => {
    const result = parsePolicyString(validPolicy);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.policy?.name).toBe('test-policy');
    expect(result.policy?.steps).toHaveLength(1);
  });

  it('should reject policy without version', () => {
    const yaml = `
name: test
description: test
steps:
  - id: s1
    tool: vault_add_to_section
    params: {}
`;
    const result = parsePolicyString(yaml);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path?.includes('version'))).toBe(true);
  });

  it('should reject policy without steps', () => {
    const yaml = `
version: "1.0"
name: test
description: test
`;
    const result = parsePolicyString(yaml);
    expect(result.valid).toBe(false);
    // Error could mention "steps" or be "Required" from Zod
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should report invalid tool names', () => {
    const yaml = `
version: "1.0"
name: test
description: test
steps:
  - id: s1
    tool: invalid_tool
    params: {}
`;
    const result = parsePolicyString(yaml);
    expect(result.valid).toBe(false);
  });

  it('should detect duplicate step IDs', () => {
    const yaml = `
version: "1.0"
name: test
description: test
steps:
  - id: step1
    tool: vault_add_to_section
    params: {}
  - id: step1
    tool: vault_add_to_section
    params: {}
`;
    const result = parsePolicyString(yaml);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('Duplicate step'))).toBe(true);
  });

  it('should warn about unused variables', () => {
    const yaml = `
version: "1.0"
name: test
description: test
variables:
  unused:
    type: string
steps:
  - id: step1
    tool: vault_add_to_section
    params:
      path: test.md
`;
    const result = parsePolicyString(yaml);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.message.includes('unused'))).toBe(true);
  });
});

describe('validatePolicySchema', () => {
  it('should validate enum variables require enum array', () => {
    const policy = {
      version: '1.0',
      name: 'test',
      description: 'test',
      variables: {
        choice: {
          type: 'enum',
          // Missing enum array
        },
      },
      steps: [{ id: 's1', tool: 'vault_add_to_section', params: {} }],
    };
    const result = validatePolicySchema(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('enum'))).toBe(true);
  });

  it('should validate condition references in steps', () => {
    const policy = {
      version: '1.0',
      name: 'test',
      description: 'test',
      conditions: [
        { id: 'exists', check: 'file_exists', path: 'test.md' },
      ],
      steps: [
        {
          id: 's1',
          tool: 'vault_add_to_section',
          when: '{{conditions.missing}}', // Invalid reference
          params: {},
        },
      ],
    };
    const result = validatePolicySchema(policy);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('unknown condition'))).toBe(true);
  });

  it('should warn about undefined variable references', () => {
    const policy = {
      version: '1.0',
      name: 'test',
      description: 'test',
      variables: {
        // Define a variable but reference a different one in steps
        defined_var: { type: 'string' },
      },
      steps: [
        {
          id: 's1',
          tool: 'vault_add_to_section',
          params: { path: '{{undefined_var}}' },
        },
      ],
    };
    const result = validatePolicySchema(policy);
    expect(result.valid).toBe(true); // Still valid, but warns
    expect(result.warnings.some(w => w.message.includes('undefined'))).toBe(true);
  });
});

describe('validateVariables', () => {
  const policy: PolicyDefinition = {
    version: '1.0',
    name: 'test',
    description: 'test',
    variables: {
      required_string: { type: 'string', required: true },
      optional_string: { type: 'string', required: false, default: 'default' },
      number_var: { type: 'number' },
      bool_var: { type: 'boolean' },
      array_var: { type: 'array' },
      enum_var: { type: 'enum', enum: ['a', 'b', 'c'] },
    },
    steps: [{ id: 's1', tool: 'vault_add_to_section', params: {} }],
  };

  it('should validate required variables', () => {
    const result = validateVariables(policy, {});
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('required_string'))).toBe(true);
  });

  it('should accept valid variables', () => {
    const result = validateVariables(policy, {
      required_string: 'test',
      number_var: 42,
      bool_var: true,
      array_var: ['a', 'b'],
      enum_var: 'a',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should reject wrong types', () => {
    expect(validateVariables(policy, { required_string: 123 }).valid).toBe(false);
    expect(validateVariables(policy, { required_string: 'ok', number_var: 'not a number' }).valid).toBe(false);
    expect(validateVariables(policy, { required_string: 'ok', bool_var: 'not bool' }).valid).toBe(false);
    expect(validateVariables(policy, { required_string: 'ok', array_var: 'not array' }).valid).toBe(false);
  });

  it('should validate enum values', () => {
    const result = validateVariables(policy, {
      required_string: 'ok',
      enum_var: 'invalid',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('one of'))).toBe(true);
  });
});

describe('resolveVariables', () => {
  const policy: PolicyDefinition = {
    version: '1.0',
    name: 'test',
    description: 'test',
    variables: {
      required_string: { type: 'string', required: true },
      with_default: { type: 'string', default: 'default_value' },
    },
    steps: [{ id: 's1', tool: 'vault_add_to_section', params: {} }],
  };

  it('should apply defaults', () => {
    const resolved = resolveVariables(policy, { required_string: 'test' });
    expect(resolved.required_string).toBe('test');
    expect(resolved.with_default).toBe('default_value');
  });

  it('should not override provided values with defaults', () => {
    const resolved = resolveVariables(policy, {
      required_string: 'test',
      with_default: 'custom',
    });
    expect(resolved.with_default).toBe('custom');
  });
});

describe('serializePolicyToYaml', () => {
  it('should serialize a basic policy', () => {
    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'test',
      description: 'A test policy',
      steps: [
        {
          id: 'step1',
          tool: 'vault_add_to_section',
          params: { path: 'test.md', section: 'Log' },
        },
      ],
    };
    const yaml = serializePolicyToYaml(policy);
    expect(yaml).toContain('version: "1.0"');
    expect(yaml).toContain('name: "test"');
    expect(yaml).toContain('step1');
    expect(yaml).toContain('vault_add_to_section');
  });

  it('should serialize variables', () => {
    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'test',
      description: 'test',
      variables: {
        name: { type: 'string', required: true, description: 'The name' },
      },
      steps: [{ id: 's1', tool: 'vault_add_to_section', params: {} }],
    };
    const yaml = serializePolicyToYaml(policy);
    expect(yaml).toContain('variables:');
    expect(yaml).toContain('name:');
    expect(yaml).toContain('type: string');
  });

  it('should serialize conditions', () => {
    const policy: PolicyDefinition = {
      version: '1.0',
      name: 'test',
      description: 'test',
      conditions: [
        { id: 'exists', check: 'file_exists', path: 'test.md' },
      ],
      steps: [{ id: 's1', tool: 'vault_add_to_section', params: {} }],
    };
    const yaml = serializePolicyToYaml(policy);
    expect(yaml).toContain('conditions:');
    expect(yaml).toContain('file_exists');
  });
});

describe('quickValidateYaml', () => {
  it('should accept valid YAML', () => {
    expect(quickValidateYaml('name: test')).toEqual({ valid: true });
  });

  it('should reject invalid YAML', () => {
    const result = quickValidateYaml('name: [invalid');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('extractPolicyMetadata', () => {
  it('should extract metadata from policy', () => {
    const yaml = `
version: "1.0"
name: my-policy
description: My description
variables:
  var1:
    type: string
  var2:
    type: number
`;
    const meta = extractPolicyMetadata(yaml);
    expect(meta.name).toBe('my-policy');
    expect(meta.description).toBe('My description');
    expect(meta.version).toBe('1.0');
    expect(meta.variables).toEqual(['var1', 'var2']);
  });

  it('should handle missing fields', () => {
    const meta = extractPolicyMetadata('invalid yaml content');
    expect(meta.name).toBeUndefined();
  });
});
