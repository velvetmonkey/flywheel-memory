/**
 * flywheel_config key validation tests
 * Ensures VALID_CONFIG_KEYS rejects invalid keys and validates value types.
 */

import { describe, it, expect } from 'vitest';
import { VALID_CONFIG_KEYS } from '../../../src/tools/write/config.js';

describe('VALID_CONFIG_KEYS', () => {
  it('should accept all documented settable keys', () => {
    const expectedKeys = [
      'vault_name',
      'exclude_task_tags',
      'exclude_analysis_tags',
      'exclude_entities',
      'exclude_entity_folders',
      'wikilink_strictness',
      'implicit_detection',
      'implicit_patterns',
      'adaptive_strictness',
      'proactive_linking',
      'proactive_min_score',
      'proactive_max_per_file',
      'proactive_max_per_day',
      'tool_tier_override',
    ];

    for (const key of expectedKeys) {
      expect(VALID_CONFIG_KEYS[key], `Missing config key: ${key}`).toBeDefined();
    }
  });

  it('should reject paths and templates as settable keys', () => {
    expect(VALID_CONFIG_KEYS['paths']).toBeUndefined();
    expect(VALID_CONFIG_KEYS['templates']).toBeUndefined();
  });

  it('should validate wikilink_strictness values', () => {
    const schema = VALID_CONFIG_KEYS['wikilink_strictness'];
    expect(schema.safeParse('conservative').success).toBe(true);
    expect(schema.safeParse('balanced').success).toBe(true);
    expect(schema.safeParse('aggressive').success).toBe(true);
    expect(schema.safeParse('invalid').success).toBe(false);
  });

  it('should validate boolean config keys', () => {
    for (const key of ['implicit_detection', 'adaptive_strictness', 'proactive_linking']) {
      const schema = VALID_CONFIG_KEYS[key];
      expect(schema.safeParse(true).success, `${key} should accept true`).toBe(true);
      expect(schema.safeParse(false).success, `${key} should accept false`).toBe(true);
      expect(schema.safeParse('yes').success, `${key} should reject string`).toBe(false);
      expect(schema.safeParse(1).success, `${key} should reject number`).toBe(false);
    }
  });

  it('should validate array config keys', () => {
    for (const key of ['exclude_task_tags', 'exclude_analysis_tags', 'exclude_entities', 'exclude_entity_folders', 'implicit_patterns']) {
      const schema = VALID_CONFIG_KEYS[key];
      expect(schema.safeParse(['a', 'b']).success, `${key} should accept string[]`).toBe(true);
      expect(schema.safeParse([]).success, `${key} should accept empty array`).toBe(true);
      expect(schema.safeParse('not-array').success, `${key} should reject string`).toBe(false);
      expect(schema.safeParse([1, 2]).success, `${key} should reject number[]`).toBe(false);
    }
  });

  it('should validate number config keys', () => {
    for (const key of ['proactive_min_score', 'proactive_max_per_file', 'proactive_max_per_day']) {
      const schema = VALID_CONFIG_KEYS[key];
      expect(schema.safeParse(20).success, `${key} should accept number`).toBe(true);
      expect(schema.safeParse('20').success, `${key} should reject string`).toBe(false);
    }
  });

  it('should validate tool_tier_override values', () => {
    const schema = VALID_CONFIG_KEYS['tool_tier_override'];
    expect(schema.safeParse('auto').success).toBe(true);
    expect(schema.safeParse('full').success).toBe(true);
    expect(schema.safeParse('minimal').success).toBe(true);
    expect(schema.safeParse('invalid').success).toBe(false);
  });

  it('should validate vault_name as string', () => {
    const schema = VALID_CONFIG_KEYS['vault_name'];
    expect(schema.safeParse('My Vault').success).toBe(true);
    expect(schema.safeParse(123).success).toBe(false);
    expect(schema.safeParse(true).success).toBe(false);
  });
});
