/**
 * discover_tools — progressive disclosure meta-tool.
 *
 * The LLM calls this with a natural-language query to find and activate
 * specialized tools beyond the core surface. Returns matching tool names,
 * descriptions, and input schemas so the LLM can call them immediately.
 *
 * Uses the same pattern-matching activation logic as implicit search-based
 * activation (getPatternSignals + unionSignalsByCategory), ensuring the
 * two paths cannot drift.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { TOOL_CATEGORY, ALL_CATEGORIES } from '../../config.js';
import type { ToolCategory } from '../../config.js';
import { getPatternSignals, unionSignalsByCategory } from '../../tool-registry.js';
import type { ToolTierController } from '../../tool-registry.js';
import { getSemanticActivations, hasToolRouting } from '../../core/read/toolRouting.js';

/** Convert a RegisteredTool's Zod inputSchema to JSON Schema for the response. */
function toJsonSchema(inputSchema: unknown): object {
  const obj = normalizeObjectSchema(inputSchema as any);
  if (!obj) return { type: 'object' };
  return toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy: 'input' });
}

export function registerDiscoveryTools(
  server: McpServer,
  controller: ToolTierController,
): void {
  server.tool(
    'discover_tools',
    'Find and activate specialized tools. Call with what you need — e.g. "vault health", "graph connections", "schema migration". Returns matching tool names, descriptions, and input schemas. Does not execute discovered tools — call them separately after discovery.',
    {
      query: z.string().describe(
        'Natural language description of what you need — e.g. "vault health", "backlinks and graph", "schema migration"',
      ),
    },
    async ({ query }) => {
      // Pattern-based activation (deterministic, same logic as implicit search activation)
      let signals = unionSignalsByCategory(getPatternSignals(query));

      // Semantic fallback: when patterns return nothing and embeddings are available,
      // use the semantic router to find relevant tool categories
      let matchMethod: 'pattern' | 'semantic' = 'pattern';
      if (signals.length === 0 && hasToolRouting()) {
        try {
          const semanticHits = await getSemanticActivations(query);
          if (semanticHits.length > 0) {
            signals = semanticHits.map(({ category, tier }) => ({ category, tier }));
            matchMethod = 'semantic';
          }
        } catch {
          // Semantic routing failed — continue with empty signals
        }
      }

      // Track matched and newly activated categories
      const matchedCategories: ToolCategory[] = [];
      const newlyActivatedCategories: ToolCategory[] = [];

      for (const { category, tier } of signals) {
        const wasActive = controller.activeCategories.has(category);
        matchedCategories.push(category);
        controller.activateCategory(category, tier);
        if (!wasActive && controller.activeCategories.has(category)) {
          newlyActivatedCategories.push(category);
        }
      }

      // Collect tools from matched categories (both previously active and newly enabled)
      const tools: Array<{ name: string; description: string; category: string; inputSchema: object }> = [];
      for (const [name, handle] of controller.getRegisteredTools()) {
        const cat = TOOL_CATEGORY[name];
        if (handle.enabled && cat && matchedCategories.includes(cat)) {
          tools.push({
            name,
            description: (handle as any).description ?? '',
            category: cat,
            inputSchema: toJsonSchema((handle as any).inputSchema),
          });
        }
      }

      const result = {
        matched_categories: matchedCategories,
        newly_activated_categories: newlyActivatedCategories,
        match_method: matchMethod,
        tools,
        hint: tools.length === 0
          ? `No tools matched "${query}". Available categories: ${ALL_CATEGORIES.join(', ')}`
          : `${tools.length} tools available across ${matchedCategories.join(', ')}`,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
