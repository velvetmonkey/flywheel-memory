/**
 * Merged edit_section tool for Flywheel Memory
 * Tool: edit_section
 *
 * Discriminated union on action: add | remove | replace
 * Absorbs: vault_add_to_section, vault_remove_from_section, vault_replace_in_section
 *
 * Registration + dispatch only — the mutation pipeline lives in
 * core/write/sections.ts (arch-review S3 fork reunification).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatMcpResult, errorResult } from '../../core/write/mutation-helpers.js';
import { handleAdd, handleRemove, handleReplace } from '../../core/write/sections.js';
import type { FlywheelConfig } from '../../core/read/types.js';

/**
 * Register the merged `edit_section` tool with the MCP server.
 */
export function registerEditSectionTool(
  server: McpServer,
  getVaultPath: () => string,
  getConfig: () => FlywheelConfig = () => ({})
): void {
  server.tool(
    'edit_section',
    'Edit content inside a named section of a vault note. action: add — append/prepend under the heading (auto-wikilinks). action: remove — delete matching text. action: replace — find-and-replace within the section. Returns mutation result with path, section, preview. Does not touch other sections.',
    {
      action: z.enum(['add', 'remove', 'replace']).describe(
        'Operation to perform: add | remove | replace'
      ),
      path: z.string().describe(
        'Vault-relative path to the note (e.g., "daily-notes/2026-01-28.md")'
      ),
      section: z.string().describe(
        'Heading text to edit (e.g., "Log" or "## Log")'
      ),

      // add-only params
      content: z.string().optional().describe('[add] Content to insert under the section'),
      create_if_missing: z.boolean().optional().describe(
        '[add] If true and the note does not exist, create it from template first'
      ),
      position: z.enum(['append', 'prepend']).optional().describe(
        '[add] Where to insert content (default: append)'
      ),
      format: z
        .enum(['plain', 'bullet', 'task', 'numbered', 'timestamp-bullet'])
        .optional()
        .describe('[add] How to format the content (default: plain)'),
      skipWikilinks: z.boolean().optional().describe(
        '[add|replace] If true, skip auto-wikilink application'
      ),
      suggestOutgoingLinks: z.boolean().optional().describe(
        '[add|replace] Append suggested outgoing wikilinks based on content'
      ),
      maxSuggestions: z.number().min(1).max(10).optional().describe(
        '[add|replace] Maximum number of suggested wikilinks (1-10, default: 5)'
      ),
      children: z.array(z.object({
        label: z.string().describe('Bold label, e.g. "**Result:**"'),
        content: z.string().describe('Pre-neutralized text; sanitized and indented by this tool'),
      })).optional().describe('[add] Labeled sub-bullets appended under the parent content line'),
      linkedEntities: z.array(z.string()).optional().describe(
        '[add] Entity names already linked in the content. When skipWikilinks=true, these are tracked for feedback without re-processing.'
      ),
      shard: z.object({
        enabled: z.boolean().optional(),
        pattern: z.string().optional(),
        maxBytes: z.number().min(1024).optional(),
        maxEntries: z.number().min(1).optional(),
        mode: z.literal('audit').optional(),
        lightIndex: z.boolean().optional(),
      }).optional().describe(
        '[add] Route append-only operational content into bounded shard notes and link them from the requested note'
      ),

      // remove-only params
      pattern: z.string().optional().describe(
        '[remove] Text or pattern to match for removal'
      ),

      // replace-only params
      search: z.string().optional().describe(
        '[replace] Text or pattern to search for'
      ),
      replacement: z.string().optional().describe(
        '[replace] Text to replace with'
      ),

      // shared remove|replace params
      mode: z.enum(['first', 'last', 'all']).optional().describe(
        '[remove|replace] Which matches to act on (default: first)'
      ),
      useRegex: z.boolean().optional().describe(
        '[remove|replace] Treat pattern/search as regex'
      ),

      // shared universal params
      commit: z.boolean().optional().describe('If true, commit this change to git (creates undo point)'),
      dry_run: z.boolean().optional().describe('Preview changes without writing to disk'),
      agent_id: z.string().optional().describe('Agent identifier for multi-agent scoping'),
      session_id: z.string().optional().describe('Session identifier for conversation scoping'),
    },
    async (params) => {
      const { action, path: notePath } = params;

      // ── Runtime validation: required-by-action params ──────────────────
      if (action === 'add' && params.content === undefined) {
        return formatMcpResult(
          errorResult(notePath,
            'action=add requires content.\n' +
            'Example: { action: "add", path: "daily-notes/2026-01-28.md", section: "Log", content: "note text" }'
          )
        );
      }
      if (action === 'remove' && !params.pattern) {
        return formatMcpResult(
          errorResult(notePath,
            'action=remove requires pattern.\n' +
            'Example: { action: "remove", path: "daily-notes/2026-01-28.md", section: "Log", pattern: "old text" }'
          )
        );
      }
      if (action === 'replace' && (!params.search || params.replacement === undefined)) {
        return formatMcpResult(
          errorResult(notePath,
            'action=replace requires search and replacement.\n' +
            'Example: { action: "replace", path: "notes/foo.md", section: "Status", search: "draft", replacement: "final" }'
          )
        );
      }

      switch (action) {
        case 'add':     return handleAdd(params, getVaultPath, getConfig);
        case 'remove':  return handleRemove(params, getVaultPath);
        case 'replace': return handleReplace(params, getVaultPath);
      }
    }
  );
}

