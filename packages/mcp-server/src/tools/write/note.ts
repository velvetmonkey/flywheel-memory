/**
 * Merged note tool for Flywheel Memory
 * Tool: note
 *
 * Discriminated union on action: create | move | rename | delete
 * Absorbs: vault_create_note, vault_move_note, vault_rename_note, vault_delete_note
 *
 * Registration + dispatch only — create/delete live in
 * core/write/noteLifecycle.ts, move/rename in core/write/noteMove.ts
 * (arch-review S4 fork reunification).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatMcpResult, errorResult } from '../../core/write/mutation-helpers.js';
import { handleCreate, handleDelete } from '../../core/write/noteLifecycle.js';
import { moveNote, renameNote } from '../../core/write/noteMove.js';
import type { VaultIndex } from '../../core/read/types.js';

/**
 * Register the merged `note` tool with the MCP server
 */
export function registerNoteTool(
  server: McpServer,
  getVaultPath: () => string,
  getIndex?: () => VaultIndex
): void {
  server.tool(
    'note',
    'Create, move, rename, or delete a vault note. action: create — new note with optional content and frontmatter. action: move — relocate note (rewires backlinks). action: rename — rename file (rewires wikilinks). action: delete — remove note (requires confirm:true). Returns mutation result with path and rewired backlinks. Does not edit note content.',
    {
      action: z.enum(['create', 'move', 'rename', 'delete']).describe(
        'Operation to perform: create | move | rename | delete'
      ),
      path: z.string().describe(
        'Vault-relative path of the note to act on (e.g., "projects/my-note.md")'
      ),

      // create-only params
      content: z.string().optional().describe('[create] Initial content for the note'),
      frontmatter: z.record(z.any()).optional().describe(
        '[create] Frontmatter fields (JSON object). Set type, aliases, description for best results.'
      ),
      overwrite: z.boolean().optional().describe('[create] If true, overwrite existing file'),
      expectedHash: z.string().optional().describe(
        '[create] CAS precondition for overwrite: content hash of the on-disk file as last read (from read action=raw). Write fails with code WRITE_CONFLICT if the file changed since. Only meaningful with overwrite:true.'
      ),
      template: z.string().optional().describe(
        '[create] Vault-relative path to a template file. Variables {{date}} and {{title}} are substituted.'
      ),
      skipWikilinks: z.boolean().optional().describe(
        '[create] If true, skip auto-wikilink application'
      ),
      suggestOutgoingLinks: z.boolean().optional().describe(
        '[create] Append suggested outgoing wikilinks based on content'
      ),
      maxSuggestions: z.number().min(1).max(10).optional().describe(
        '[create] Maximum number of suggested wikilinks to append (1-10, default: 5)'
      ),

      // move-only params
      destination: z.string().optional().describe(
        '[move] New vault-relative path to move the note to (e.g., "archive/my-note.md")'
      ),

      // rename-only params
      new_name: z.string().optional().describe(
        '[rename] New filename without extension (e.g., "better-title")'
      ),

      // delete-only params
      confirm: z.boolean().optional().describe(
        '[delete] Must be true to execute deletion (safety guard)'
      ),

      // shared optional params
      updateBacklinks: z.boolean().optional().describe(
        '[move|rename] If true (default), updates all backlinks pointing to this note'
      ),
      commit: z.boolean().optional().describe('If true, commit changes to git'),
      dry_run: z.boolean().optional().describe('Preview changes without writing to disk'),
      agent_id: z.string().optional().describe('[create] Agent identifier for multi-agent scoping'),
      session_id: z.string().optional().describe('[create] Session identifier for conversation scoping'),
    },
    async (params) => {
      const { action, path: rawPath } = params;

      // ── Runtime validation: required-by-action params ──────────────────
      if (action === 'move' && !params.destination) {
        return formatMcpResult(
          errorResult(rawPath,
            'action=move requires destination.\n' +
            'Example: { action: "move", path: "inbox/my-note.md", destination: "projects/my-note.md" }'
          )
        );
      }
      if (action === 'rename' && !params.new_name) {
        return formatMcpResult(
          errorResult(rawPath,
            'action=rename requires new_name.\n' +
            'Example: { action: "rename", path: "projects/old-title.md", new_name: "better-title" }'
          )
        );
      }
      if (action === 'delete' && params.confirm !== true) {
        return formatMcpResult(
          errorResult(rawPath,
            'action=delete requires confirm:true to execute.\n' +
            'Example: { action: "delete", path: "notes/my-note.md", confirm: true }\n' +
            'Use dry_run:true first to preview what will be deleted.'
          )
        );
      }

      switch (action) {
        case 'create': return handleCreate(params, getVaultPath);
        case 'move':   return handleMove(params, getVaultPath);
        case 'rename': return handleRename(params, getVaultPath);
        case 'delete': return handleDelete(params, getVaultPath, getIndex);
      }
    }
  );
}

// ============================================================================
// Move/rename glue — param mapping onto core/write/noteMove.ts
// ============================================================================

async function handleMove(
  params: {
    path: string;
    destination?: string;
    updateBacklinks?: boolean;
    commit?: boolean;
    dry_run?: boolean;
  },
  getVaultPath: () => string
) {
  const result = await moveNote(getVaultPath(), {
    oldPath: params.path,
    newPath: params.destination ?? '',
    updateBacklinks: params.updateBacklinks,
    commit: params.commit,
    dry_run: params.dry_run,
  });

  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

async function handleRename(
  params: {
    path: string;
    new_name?: string;
    updateBacklinks?: boolean;
    commit?: boolean;
    dry_run?: boolean;
  },
  getVaultPath: () => string
) {
  const result = await renameNote(getVaultPath(), {
    notePath: params.path,
    newTitle: params.new_name ?? '',
    updateBacklinks: params.updateBacklinks,
    commit: params.commit,
    dry_run: params.dry_run,
  });

  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}
