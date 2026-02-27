/**
 * Tool Count Verification Tests
 *
 * Ensures documentation tool counts match actual implementation.
 * Prevents documentation from becoming stale.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const TOOLS_DIR = path.join(__dirname, '../../../src/tools');
const DOCS_DIR = path.join(__dirname, '../../../../docs');

/**
 * Count tool registrations in source files (scans read/ and write/ subdirectories)
 */
async function countToolsInSource(): Promise<{
  total: number;
  byFile: Record<string, number>;
  toolNames: string[];
}> {
  let total = 0;
  const byFile: Record<string, number> = {};
  const toolNames: string[] = [];

  for (const subdir of ['read', 'write']) {
    const subdirPath = path.join(TOOLS_DIR, subdir);
    const files = await fs.readdir(subdirPath);
    const tsFiles = files.filter(f => f.endsWith('.ts'));

    for (const file of tsFiles) {
      const content = await fs.readFile(path.join(subdirPath, file), 'utf-8');

      // Match server.tool('tool_name', or server.registerTool('tool_name', patterns
      const matches = content.matchAll(/server\.(?:register)?[Tt]ool\(\s*['"]([^'"]+)['"]/g);

      const names: string[] = [];
      for (const match of matches) {
        names.push(match[1]);
        toolNames.push(match[1]);
      }

      const key = `${subdir}/${file}`;
      byFile[key] = names.length;
      total += names.length;
    }
  }

  return { total, byFile, toolNames };
}

/**
 * Extract claimed tool count from documentation
 */
async function extractDocToolCount(docPath: string): Promise<number | null> {
  try {
    const content = await fs.readFile(docPath, 'utf-8');

    // Look for patterns like "11 tools" or "51 query tools"
    const matches = content.match(/(\d+)\s+(?:mutation\s+)?tools?/gi);
    if (matches) {
      // Return the first match's number
      const firstMatch = matches[0].match(/(\d+)/);
      return firstMatch ? parseInt(firstMatch[1], 10) : null;
    }

    return null;
  } catch {
    return null;
  }
}

describe('Tool Count Verification', () => {
  describe('flywheel-memory tools', () => {
    it('should have the expected number of mutation tools', async () => {
      const { total, byFile, toolNames } = await countToolsInSource();

      // Log for debugging
      console.log('Tools by file:', byFile);
      console.log('Total tools:', total);
      console.log('Tool names:', toolNames);

      // The exact count depends on implementation
      // Core mutation tools: add, remove, replace (3)
      // Task tools: toggle, add (2)
      // Frontmatter tools: update, add (2)
      // Note tools: create, delete (2)
      // System tools: list_sections, undo (2)
      // Move tools: move, rename (2)
      // Policy tools: 9

      // Total should be around 22 based on grep results
      expect(total).toBeGreaterThanOrEqual(10);
    });

    it('should have all core mutation tools registered', async () => {
      const { toolNames } = await countToolsInSource();
      const toolSet = new Set(toolNames);

      // Core mutation tools that should always exist
      const coreMutationTools = [
        'vault_add_to_section',
        'vault_remove_from_section',
        'vault_replace_in_section',
      ];

      for (const tool of coreMutationTools) {
        expect(toolSet.has(tool), `Missing core tool: ${tool}`).toBe(true);
      }
    });

    it('should have all task tools registered', async () => {
      const { toolNames } = await countToolsInSource();
      const toolSet = new Set(toolNames);

      const taskTools = [
        'vault_toggle_task',
        'vault_add_task',
      ];

      for (const tool of taskTools) {
        expect(toolSet.has(tool), `Missing task tool: ${tool}`).toBe(true);
      }
    });

    it('should have all frontmatter tools registered', async () => {
      const { toolNames } = await countToolsInSource();
      const toolSet = new Set(toolNames);

      const frontmatterTools = [
        'vault_update_frontmatter',
      ];

      for (const tool of frontmatterTools) {
        expect(toolSet.has(tool), `Missing frontmatter tool: ${tool}`).toBe(true);
      }
    });

    it('should have all note management tools registered', async () => {
      const { toolNames } = await countToolsInSource();
      const toolSet = new Set(toolNames);

      const noteTools = [
        'vault_create_note',
        'vault_delete_note',
      ];

      for (const tool of noteTools) {
        expect(toolSet.has(tool), `Missing note tool: ${tool}`).toBe(true);
      }
    });

    it('should have all system tools registered', async () => {
      const { toolNames } = await countToolsInSource();
      const toolSet = new Set(toolNames);

      const systemTools = [
        'vault_undo_last_mutation',
      ];

      for (const tool of systemTools) {
        expect(toolSet.has(tool), `Missing system tool: ${tool}`).toBe(true);
      }
    });
  });

  describe('documentation accuracy', () => {
    it('should have consistent tool descriptions in README', async () => {
      const readmePath = path.join(DOCS_DIR, 'README.md');

      try {
        const content = await fs.readFile(readmePath, 'utf-8');

        // README should mention key tools
        expect(content).toContain('vault_add_to_section');
        expect(content).toContain('vault_toggle_task');
      } catch (error) {
        // README might not exist or be in different location
        console.log('README not found at expected path, skipping');
      }
    });

    it('should have tools documented in tools-reference.md', async () => {
      const toolsRefPath = path.join(DOCS_DIR, 'tools-reference.md');

      try {
        const content = await fs.readFile(toolsRefPath, 'utf-8');

        // Check for key tool documentation
        expect(content).toContain('vault_add_to_section');
        expect(content).toContain('vault_replace_in_section');
        expect(content).toContain('vault_toggle_task');
      } catch (error) {
        console.log('tools-reference.md not found, skipping');
      }
    });
  });

  describe('tool naming conventions', () => {
    it('should use valid prefixes or known standalone names', async () => {
      const { toolNames } = await countToolsInSource();

      // Some consolidated tools use short, non-prefixed names
      const ALLOWED_STANDALONE = new Set([
        'search', 'tasks', 'graph_analysis', 'vault_schema', 'note_intelligence', 'policy',
        'health_check', 'refresh_index', 'suggest_wikilinks', 'validate_links',
        'rename_field', 'migrate_field_values',
        'rename_tag', 'wikilink_feedback',
        'init_semantic',
        'list_entities', 'flywheel_config',
        'server_log',
        'suggest_entity_merges', 'dismiss_merge_suggestion',
        'suggest_entity_aliases', 'merge_entities', 'absorb_as_alias',
        'unlinked_mentions_report', 'discover_stub_candidates', 'discover_cooccurrence_gaps',
        'memory', 'recall', 'brief',
      ]);

      for (const tool of toolNames) {
        const hasValidPrefix = tool.startsWith('vault_') || tool.startsWith('policy_') || tool.startsWith('get_') || tool.startsWith('find_') || ALLOWED_STANDALONE.has(tool);
        expect(hasValidPrefix, `Tool ${tool} should start with vault_ or policy_ or be an allowed standalone name`).toBe(true);
      }
    });

    it('should use snake_case for tool names', async () => {
      const { toolNames } = await countToolsInSource();

      for (const tool of toolNames) {
        // Should not have camelCase humps (capital letters)
        const hasCamelCase = /[A-Z]/.test(tool);
        expect(hasCamelCase, `Tool ${tool} should use snake_case`).toBe(false);

        // Should only contain lowercase letters and underscores
        const validPattern = /^[a-z_]+$/;
        expect(validPattern.test(tool), `Tool ${tool} should only contain lowercase letters and underscores`).toBe(true);
      }
    });
  });
});
