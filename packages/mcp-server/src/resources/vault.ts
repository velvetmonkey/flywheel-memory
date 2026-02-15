/**
 * MCP Resources - Expose vault metadata for ambient context
 *
 * Resources are passively loaded by MCP clients, giving Claude
 * ambient vault awareness without explicit tool calls.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultIndex } from '../core/read/types.js';
import { getFrontmatterSchema } from '../tools/read/frontmatter.js';

/**
 * Register vault resources with the MCP server
 *
 * These resources are aspirational for future MCP client support. Claude Code
 * doesn't currently auto-load resources, but the health_check and vault_schema
 * tools already supersede their functionality. Keeping them registered so
 * they're available when clients add resource support.
 */
export function registerVaultResources(
  server: McpServer,
  getIndex: () => VaultIndex | null,
): void {
  // ========================================
  // Resource: vault://stats
  // ========================================
  server.registerResource(
    'vault-stats',
    'vault://stats',
    {
      title: 'Vault Statistics',
      description: 'Overview of vault size, tags, links, and orphan count',
      mimeType: 'application/json',
    },
    async (uri) => {
      const index = getIndex();
      if (!index) {
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'Index not ready' }) }],
        };
      }

      const noteCount = index.notes.size;
      const tagCount = index.tags.size;

      // Count total links
      let totalLinks = 0;
      for (const note of index.notes.values()) {
        totalLinks += note.outlinks.length;
      }

      // Count orphans (notes with no backlinks)
      let orphanCount = 0;
      for (const note of index.notes.values()) {
        const normalizedTitle = note.title.toLowerCase();
        const backlinks = index.backlinks.get(normalizedTitle);
        if (!backlinks || backlinks.length === 0) {
          orphanCount++;
        }
      }

      const stats = {
        note_count: noteCount,
        tag_count: tagCount,
        total_links: totalLinks,
        orphan_count: orphanCount,
        index_built_at: index.builtAt.toISOString(),
      };

      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(stats, null, 2) }],
      };
    }
  );

  // ========================================
  // Resource: vault://schema
  // ========================================
  server.registerResource(
    'vault-schema',
    'vault://schema',
    {
      title: 'Vault Schema',
      description: 'Frontmatter field summary: field names, types, frequency',
      mimeType: 'application/json',
    },
    async (uri) => {
      const index = getIndex();
      if (!index) {
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'Index not ready' }) }],
        };
      }

      const schema = getFrontmatterSchema(index);

      // Return a compact summary (field names, types, and counts only)
      const compact = {
        total_notes: schema.total_notes,
        notes_with_frontmatter: schema.notes_with_frontmatter,
        field_count: schema.field_count,
        fields: schema.fields.map(f => ({
          name: f.name,
          types: f.types,
          count: f.count,
          examples: f.examples.slice(0, 3),
        })),
      };

      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(compact, null, 2) }],
      };
    }
  );

  // ========================================
  // Resource: vault://recent
  // ========================================
  server.registerResource(
    'vault-recent',
    'vault://recent',
    {
      title: 'Recently Modified Notes',
      description: 'Last 10 modified notes in the vault',
      mimeType: 'application/json',
    },
    async (uri) => {
      const index = getIndex();
      if (!index) {
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'Index not ready' }) }],
        };
      }

      const notes = Array.from(index.notes.values())
        .sort((a, b) => b.modified.getTime() - a.modified.getTime())
        .slice(0, 10)
        .map(n => ({
          path: n.path,
          title: n.title,
          modified: n.modified.toISOString(),
          tags: n.tags,
        }));

      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ recent_notes: notes }, null, 2) }],
      };
    }
  );
}
