/**
 * Runtime config store for doctor(action: config) (arch-review S7).
 *
 * VALID_CONFIG_KEYS moved from the retired tools/write/config.ts (whose
 * flywheel_config registration died at T43); setConfigKey owns validation +
 * persistence + reload so the doctor tool stays a thin dispatcher.
 */

import { z } from 'zod';
import { saveFlywheelConfigToDb, type StateDb } from '@velvetmonkey/vault-core';
import { loadConfig, type FlywheelConfig } from '../read/config.js';

export const VALID_CONFIG_KEYS: Record<string, z.ZodType> = {
  vault_name: z.string(),
  exclude: z.array(z.string()),
  /** @deprecated Use `exclude` instead */
  exclude_task_tags: z.array(z.string()),
  /** @deprecated Use `exclude` instead */
  exclude_analysis_tags: z.array(z.string()),
  /** @deprecated Use `exclude` instead */
  exclude_entities: z.array(z.string()),
  exclude_entity_folders: z.array(z.string()),
  wikilink_strictness: z.enum(['conservative', 'balanced', 'aggressive']),
  implicit_detection: z.boolean(),
  implicit_patterns: z.array(z.string()),
  adaptive_strictness: z.boolean(),
  proactive_linking: z.boolean(),
  proactive_min_score: z.number(),
  proactive_max_per_file: z.number(),
  proactive_max_per_day: z.number(),
  tool_tier_override: z.enum(['auto', 'full', 'minimal']),
  custom_categories: z.record(z.string(), z.object({
    type_boost: z.number().optional(),
  })),
};

export type SetConfigResult =
  | { error: string }
  | { config: FlywheelConfig; deprecatedWarning?: string };

/**
 * Validate, persist, and reload a single config key. Validation errors are
 * reported before StateDb absence — the original doctor(config) check order.
 */
export function setConfigKey(
  stateDb: StateDb | null,
  currentConfig: FlywheelConfig,
  key: string,
  value: unknown,
): SetConfigResult {
  const configSchema = VALID_CONFIG_KEYS[key];
  if (!configSchema) {
    return { error: `Unknown config key: "${key}". Valid keys: ${Object.keys(VALID_CONFIG_KEYS).join(', ')}` };
  }
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) {
    return { error: `Invalid value for "${key}": ${parsed.error.message}` };
  }
  if (!stateDb) {
    return { error: 'StateDb not available' };
  }
  const updated: FlywheelConfig = { ...currentConfig, [key]: parsed.data };
  saveFlywheelConfigToDb(stateDb, updated as unknown as Record<string, unknown>);
  const reloaded = loadConfig(stateDb);
  if (key === 'tool_tier_override') {
    return {
      config: reloaded,
      deprecatedWarning: 'tool_tier_override is deprecated and has no runtime effect. Use agent, power, or full presets instead.',
    };
  }
  return { config: reloaded };
}
