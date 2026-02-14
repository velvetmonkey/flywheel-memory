/**
 * Episodic Memory tools for AI Agent deployments
 * Tools: vault_log_interaction, vault_search_interactions
 *
 * These tools provide structured interaction logging and retrieval
 * for multi-agent systems, enabling agents to maintain conversation
 * context and learn from past interactions.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { writeVaultFile, validatePath } from '../../core/write/writer.js';
import {
  formatMcpResult,
  errorResult,
  successResult,
  handleGitCommit,
} from '../../core/write/mutation-helpers.js';
import type { InteractionLog, InteractionSearchFilters } from '../../core/write/types.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Generate a unique interaction ID
 */
function generateInteractionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `int-${timestamp}-${random}`;
}

/**
 * Get the directory path for interactions on a given date
 */
function getInteractionDir(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `_interactions/${year}-${month}-${day}`;
}

/**
 * Parse interaction frontmatter to InteractionLog
 */
function parseInteractionFromFrontmatter(
  frontmatter: Record<string, unknown>,
  id: string
): InteractionLog {
  return {
    id,
    agent_id: frontmatter.agent_id as string,
    session_id: frontmatter.session_id as string | undefined,
    interaction_type: frontmatter.interaction_type as string,
    summary: frontmatter.summary as string,
    entities_involved: frontmatter.entities_involved as string[] | undefined,
    metadata: frontmatter.metadata as Record<string, unknown> | undefined,
    timestamp: frontmatter.timestamp as string,
  };
}

/**
 * Read interaction notes from a directory
 */
async function readInteractionsFromDir(
  vaultPath: string,
  dirPath: string,
  filters: InteractionSearchFilters
): Promise<InteractionLog[]> {
  const fullDirPath = path.join(vaultPath, dirPath);
  const interactions: InteractionLog[] = [];

  try {
    const files = await fs.readdir(fullDirPath);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(fullDirPath, file);
      const content = await fs.readFile(filePath, 'utf-8');

      // Parse frontmatter manually (simple YAML extraction)
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) continue;

      // Simple YAML parsing for frontmatter
      const frontmatterStr = frontmatterMatch[1];
      const frontmatter: Record<string, unknown> = {};

      // Parse simple key: value pairs and arrays
      const lines = frontmatterStr.split('\n');
      let currentKey = '';
      let currentArray: string[] | null = null;

      for (const line of lines) {
        const keyMatch = line.match(/^(\w+):\s*(.*)$/);
        if (keyMatch) {
          if (currentArray && currentKey) {
            frontmatter[currentKey] = currentArray;
            currentArray = null;
          }
          const [, key, value] = keyMatch;
          if (value === '' || value === '[]') {
            currentKey = key;
            currentArray = [];
          } else if (value.startsWith('[') && value.endsWith(']')) {
            // Inline array
            frontmatter[key] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
          } else {
            frontmatter[key] = value.replace(/^['"]|['"]$/g, '');
          }
        } else if (line.match(/^\s+-\s+(.*)$/)) {
          const itemMatch = line.match(/^\s+-\s+(.*)$/);
          if (itemMatch && currentArray) {
            currentArray.push(itemMatch[1].replace(/^['"]|['"]$/g, ''));
          }
        }
      }
      if (currentArray && currentKey) {
        frontmatter[currentKey] = currentArray;
      }

      const id = file.replace('.md', '');
      const interaction = parseInteractionFromFrontmatter(frontmatter, id);

      // Apply filters
      if (filters.agent_id && interaction.agent_id !== filters.agent_id) continue;
      if (filters.session_id && interaction.session_id !== filters.session_id) continue;
      if (filters.interaction_type && interaction.interaction_type !== filters.interaction_type) continue;
      if (filters.entity) {
        const hasEntity = interaction.entities_involved?.some(
          e => e.toLowerCase().includes(filters.entity!.toLowerCase())
        );
        if (!hasEntity) continue;
      }

      interactions.push(interaction);
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return interactions;
}

/**
 * Register episodic memory tools with the MCP server
 */
export function registerMemoryTools(
  server: McpServer,
  vaultPath: string
): void {
  // ========================================
  // Tool: vault_log_interaction
  // ========================================
  server.tool(
    'vault_log_interaction',
    'Log a structured agent-user interaction for episodic memory',
    {
      agent_id: z.string().describe('Agent identifier that is logging this interaction'),
      session_id: z.string().optional().describe('Session identifier for conversation context'),
      interaction_type: z.string().describe('Type of interaction (e.g., "conversation", "tool_use", "decision", "observation")'),
      summary: z.string().describe('Brief summary of the interaction'),
      entities_involved: z.array(z.string()).optional().describe('Entities mentioned or involved in this interaction'),
      metadata: z.record(z.any()).optional().describe('Additional structured metadata'),
      commit: z.boolean().default(false).describe('If true, commit this change to git'),
    },
    async ({ agent_id, session_id, interaction_type, summary, entities_involved, metadata, commit }) => {
      try {
        // 1. Generate interaction ID and timestamp
        const interactionId = generateInteractionId();
        const timestamp = new Date().toISOString();
        const date = new Date();

        // 2. Build the directory and file path
        const dirPath = getInteractionDir(date);
        const notePath = `${dirPath}/${interactionId}.md`;

        // 3. Validate path
        if (!validatePath(vaultPath, notePath)) {
          return formatMcpResult(errorResult(notePath, 'Invalid path'));
        }

        // 4. Ensure directory exists
        const fullDirPath = path.join(vaultPath, dirPath);
        await fs.mkdir(fullDirPath, { recursive: true });

        // 5. Build frontmatter
        const frontmatter: Record<string, unknown> = {
          id: interactionId,
          agent_id,
          interaction_type,
          summary,
          timestamp,
        };

        if (session_id) {
          frontmatter.session_id = session_id;
        }
        if (entities_involved && entities_involved.length > 0) {
          frontmatter.entities_involved = entities_involved;
        }
        if (metadata && Object.keys(metadata).length > 0) {
          frontmatter.metadata = metadata;
        }

        // 6. Build content (summary as body)
        const content = `# ${interaction_type}: ${summary.substring(0, 50)}${summary.length > 50 ? '...' : ''}

${summary}

${entities_involved && entities_involved.length > 0 ? `## Entities\n${entities_involved.map(e => `- [[${e}]]`).join('\n')}` : ''}
`.trim();

        // 7. Write the interaction note
        await writeVaultFile(vaultPath, notePath, content, frontmatter);

        // 8. Handle git commit
        const gitInfo = await handleGitCommit(vaultPath, notePath, commit, '[Crank:Memory]');

        return formatMcpResult(
          successResult(notePath, `Logged interaction: ${interactionId}`, gitInfo, {
            preview: JSON.stringify({
              id: interactionId,
              agent_id,
              session_id,
              interaction_type,
              timestamp,
              entities_involved,
            }, null, 2),
          })
        );
      } catch (error) {
        return formatMcpResult(
          errorResult('_interactions', `Failed to log interaction: ${error instanceof Error ? error.message : String(error)}`)
        );
      }
    }
  );

  // ========================================
  // Tool: vault_search_interactions
  // ========================================
  server.tool(
    'vault_search_interactions',
    'Search past interactions by various filters',
    {
      agent_id: z.string().optional().describe('Filter by agent'),
      session_id: z.string().optional().describe('Filter by session'),
      interaction_type: z.string().optional().describe('Filter by interaction type'),
      entity: z.string().optional().describe('Filter by entity involvement (partial match)'),
      time_start: z.string().optional().describe('Start of time range (ISO string, e.g., "2026-01-01")'),
      time_end: z.string().optional().describe('End of time range (ISO string, e.g., "2026-01-31")'),
      limit: z.number().min(1).max(100).default(20).describe('Maximum results to return'),
    },
    async ({ agent_id, session_id, interaction_type, entity, time_start, time_end, limit }) => {
      try {
        const filters: InteractionSearchFilters = {
          agent_id,
          session_id,
          interaction_type,
          entity,
          time_start,
          time_end,
          limit,
        };

        // 1. Determine date range to search
        const endDate = time_end ? new Date(time_end) : new Date();
        const startDate = time_start ? new Date(time_start) : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // Default 30 days back

        // 2. Collect all interaction directories in range
        const allInteractions: InteractionLog[] = [];
        const currentDate = new Date(startDate);

        while (currentDate <= endDate) {
          const dirPath = getInteractionDir(currentDate);
          const dayInteractions = await readInteractionsFromDir(vaultPath, dirPath, filters);
          allInteractions.push(...dayInteractions);

          // Move to next day
          currentDate.setDate(currentDate.getDate() + 1);
        }

        // 3. Apply time range filter more precisely
        const filteredInteractions = allInteractions.filter(interaction => {
          const interactionTime = new Date(interaction.timestamp);
          if (time_start && interactionTime < startDate) return false;
          if (time_end && interactionTime > endDate) return false;
          return true;
        });

        // 4. Sort by timestamp descending (most recent first)
        filteredInteractions.sort((a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        // 5. Apply limit
        const results = filteredInteractions.slice(0, limit);

        // 6. Return results
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              count: results.length,
              total_matched: filteredInteractions.length,
              filters_applied: {
                agent_id,
                session_id,
                interaction_type,
                entity,
                time_start: startDate.toISOString(),
                time_end: endDate.toISOString(),
              },
              interactions: results,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              message: `Failed to search interactions: ${error instanceof Error ? error.message : String(error)}`,
              count: 0,
              interactions: [],
            }, null, 2),
          }],
        };
      }
    }
  );
}
