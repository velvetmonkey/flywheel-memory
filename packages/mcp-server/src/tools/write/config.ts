/**
 * Flywheel Config tool — read/write FlywheelConfig
 * Tools: flywheel_config
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateDb } from '@velvetmonkey/vault-core';
import { saveFlywheelConfigToDb } from '@velvetmonkey/vault-core';
import { loadConfig, type FlywheelConfig } from '../../core/read/config.js';

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
        'Read or update Flywheel configuration.\n' +
        '- "get": Returns the current FlywheelConfig\n' +
        '- "set": Updates a single config key and returns the updated config\n\n' +
        'Example: flywheel_config({ mode: "get" })\n' +
        'Example: flywheel_config({ mode: "set", key: "exclude_analysis_tags", value: ["habit", "daily"] })',
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

          const stateDb = getStateDb();
          if (!stateDb) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: 'StateDb not available' }) }],
            };
          }

          // Update the config in memory and persist
          const current = getConfig();
          const updated: FlywheelConfig = { ...current, [key]: value };
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
