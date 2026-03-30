/**
 * Flywheel Config tool — read/write FlywheelConfig
 * Tools: flywheel_config
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { saveFlywheelConfigToDb } from '@velvetmonkey/vault-core';
import { loadConfig, type FlywheelConfig } from '../../core/read/config.js';

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

/**
 * Register the flywheel_config tool
 */
export function registerConfigTools(
  server: McpServer,
  getConfig: () => FlywheelConfig,
  setConfig: (config: FlywheelConfig) => void,
  getStateDb: () => StateDb | null
): void {
  server.registerTool(
    'flywheel_config',
    {
      title: 'Flywheel Config',
      description:
        'Use when reading or changing Flywheel runtime configuration. Produces the current config state or applies a single key update. Returns the full or updated FlywheelConfig object. Does not restart the server — config changes take effect immediately.',
      inputSchema: {
        mode: z.enum(['get', 'set']).describe('Operation mode'),
        key: z.string().optional().describe('Config key to update (required for set mode)'),
        value: z.unknown().optional().describe('New value for the key (required for set mode)'),
      },
    },
    async ({ mode, key, value }) => {
      switch (mode) {
        case 'get': {
          const config = getConfig();
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(config, null, 2) }],
          };
        }

        case 'set': {
          if (!key) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'key is required for set mode' }) }],
            };
          }

          const schema = VALID_CONFIG_KEYS[key];
          if (!schema) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: `Unknown config key: "${key}". Valid keys: ${Object.keys(VALID_CONFIG_KEYS).join(', ')}`
              }) }],
            };
          }

          const parsed = schema.safeParse(value);
          if (!parsed.success) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: `Invalid value for "${key}": ${parsed.error.message}`
              }) }],
            };
          }

          const stateDb = getStateDb();
          if (!stateDb) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
            };
          }

          // Update the config in memory and persist
          const current = getConfig();
          const updated: FlywheelConfig = { ...current, [key]: parsed.data };
          saveFlywheelConfigToDb(stateDb, updated as unknown as Record<string, unknown>);

          // Reload from db to ensure consistency
          const reloaded = loadConfig(stateDb);
          setConfig(reloaded);

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(reloaded, null, 2) }],
          };
        }
      }
    }
  );
}
