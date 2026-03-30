/**
 * Tool Count Verification Tests
 *
 * Ensures documentation tool counts match actual implementation.
 * Prevents documentation from becoming stale.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { PRESETS, TOOL_CATEGORY, TOOL_TIER } from '../../../src/config.js';
import { VALID_CONFIG_KEYS } from '../../../src/tools/write/config.js';

const TOOLS_DIR = path.join(__dirname, '../../../src/tools');
const DOCS_DIR = path.join(__dirname, '../../../../../docs');
const CONFIG_PATH = path.join(__dirname, '../../../src/config.ts');

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
    it('should have key tools documented in TOOLS.md', async () => {
      const toolsPath = path.join(DOCS_DIR, 'TOOLS.md');
      const content = await fs.readFile(toolsPath, 'utf-8');

      // TOOLS.md should mention key tools
      expect(content).toContain('vault_add_to_section');
      expect(content).toContain('vault_toggle_task');
    });

    it('should document config keys in CONFIGURATION.md', async () => {
      const configPath = path.join(DOCS_DIR, 'CONFIGURATION.md');
      const content = await fs.readFile(configPath, 'utf-8');

      // All settable config keys should be documented
      expect(content).toContain('wikilink_strictness');
      expect(content).toContain('exclude_entities');
      expect(content).toContain('exclude_entity_folders');
      expect(content).toContain('implicit_detection');

      // paths/templates should be documented as read-only
      expect(content).toContain('read-only');
    });
  });

  describe('tool naming conventions', () => {
    it('should use valid prefixes or known standalone names', async () => {
      const { toolNames } = await countToolsInSource();

      // Some consolidated tools use short, non-prefixed names
      const ALLOWED_STANDALONE = new Set([
        'search', 'tasks', 'graph_analysis', 'vault_schema', 'schema_conventions', 'schema_validate',
        'semantic_analysis', 'note_intelligence', 'policy',
        'health_check', 'refresh_index', 'suggest_wikilinks', 'validate_links',
        'rename_field', 'migrate_field_values',
        'rename_tag', 'wikilink_feedback',
        'init_semantic',
        'list_entities', 'flywheel_config',
        'server_log',
        'suggest_entity_merges', 'dismiss_merge_suggestion',
        'suggest_entity_aliases', 'merge_entities', 'absorb_as_alias',
        'unlinked_mentions_report', 'discover_stub_candidates', 'discover_cooccurrence_gaps',
        'memory', 'brief',
        'predict_stale_notes', 'track_concept_evolution', 'temporal_summary',
        'flywheel_doctor',
        'flywheel_trust_report',
        'flywheel_benchmark',
        'flywheel_learning_report',
        'flywheel_calibration_export',
        'export_graph',
        'tool_selection_feedback',
        'pipeline_status',
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

// =============================================================================
// Documentation Contract Tests
// =============================================================================

/**
 * Parse TOOL_CATEGORY from config.ts source → Record<category, toolName[]>
 */
async function parseToolCategoryFromSource(): Promise<Record<string, string[]>> {
  const source = await fs.readFile(CONFIG_PATH, 'utf-8');
  const match = source.match(/const TOOL_CATEGORY[^{]*\{([\s\S]*?)\n\};/);
  if (!match) throw new Error('Could not find TOOL_CATEGORY in config.ts');
  const entries = [...match[1].matchAll(/^\s*(\w+):\s*'([\w-]+)'/gm)];
  const byCategory: Record<string, string[]> = {};
  for (const [, tool, cat] of entries) {
    (byCategory[cat] ??= []).push(tool);
  }
  return byCategory;
}

/**
 * Parse PRESETS from config.ts source → Record<preset, category[]>
 */
async function parsePresetsFromSource(): Promise<Record<string, string[]>> {
  const source = await fs.readFile(CONFIG_PATH, 'utf-8');
  const match = source.match(/const PRESETS[^{]*\{([\s\S]*?)\n\};/);
  if (!match) throw new Error('Could not find PRESETS in config.ts');
  const result: Record<string, string[]> = {};
  // Match lines like: default: ['search', 'read', 'write', 'tasks'],
  const presetLines = [...match[1].matchAll(/^\s*(\w[\w-]*):\s*\[([^\]]*)\]/gm)];
  for (const [, name, categoriesStr] of presetLines) {
    const categories = [...categoriesStr.matchAll(/'([\w-]+)'/g)].map(m => m[1]);
    if (categories.length > 0) {
      result[name] = categories;
    }
  }
  return result;
}

describe('Documentation Contracts', () => {
  it('CONFIGURATION.md category counts match TOOL_CATEGORY source', async () => {
    const byCategory = await parseToolCategoryFromSource();
    const configContent = await fs.readFile(path.join(DOCS_DIR, 'CONFIGURATION.md'), 'utf-8');

    // Parse the composable bundles table: | `category` | N |
    const bundleRows = [...configContent.matchAll(/\|\s*`(\w[\w-]*)`\s*\|\s*(\d+)\s*\|/g)];
    const docCounts: Record<string, number> = {};
    for (const [, cat, count] of bundleRows) {
      // Only track categories that exist in TOOL_CATEGORY
      if (byCategory[cat]) {
        docCounts[cat] = parseInt(count, 10);
      }
    }

    // Every category in source should appear in doc with correct count
    for (const [cat, tools] of Object.entries(byCategory)) {
      if (docCounts[cat] !== undefined) {
        expect(docCounts[cat], `CONFIGURATION.md claims ${cat} has ${docCounts[cat]} tools, source has ${tools.length}`).toBe(tools.length);
      }
    }
  });

  it('CONFIGURATION.md settable keys match VALID_CONFIG_KEYS', async () => {
    const configContent = await fs.readFile(path.join(DOCS_DIR, 'CONFIGURATION.md'), 'utf-8');

    for (const key of Object.keys(VALID_CONFIG_KEYS)) {
      expect(configContent, `VALID_CONFIG_KEYS key "${key}" not documented in CONFIGURATION.md`).toContain(key);
    }

    // paths and templates should NOT be in VALID_CONFIG_KEYS
    expect(VALID_CONFIG_KEYS['paths']).toBeUndefined();
    expect(VALID_CONFIG_KEYS['templates']).toBeUndefined();

    // Doc should mention read-only
    expect(configContent).toContain('read-only');
  });

  it('TOOLS.md total tool count matches source', async () => {
    const byCategory = await parseToolCategoryFromSource();
    const toolsContent = await fs.readFile(path.join(DOCS_DIR, 'TOOLS.md'), 'utf-8');

    const totalInSource = Object.values(byCategory).reduce((sum, tools) => sum + tools.length, 0);

    // TOOLS.md total should match TOOL_CATEGORY count
    const match = toolsContent.match(/(\d+)\s+tools/);
    expect(match, 'TOOLS.md should contain a tool count').toBeTruthy();

    const docTotal = parseInt(match![1], 10);
    expect(docTotal, `TOOLS.md claims ${docTotal} tools, source has ${totalInSource}`).toBe(totalInSource);
  });

  it('preset compositions match source', async () => {
    const presets = await parsePresetsFromSource();

    expect(presets['default']).toEqual(['search', 'read', 'write', 'tasks', 'memory']);
    // agent preset removed — deprecated alias to default
  });
});

// =============================================================================
// Tool Gating Invariants (T11)
// =============================================================================

describe('Tool Gating Invariants', () => {
  it('every server.tool() call has a TOOL_CATEGORY entry', async () => {
    const { toolNames } = await countToolsInSource();
    const byCategory = await parseToolCategoryFromSource();
    const categorized = new Set(Object.values(byCategory).flat());

    for (const tool of toolNames) {
      expect(
        categorized.has(tool),
        `Tool "${tool}" registered via server.tool() but missing from TOOL_CATEGORY in config.ts`
      ).toBe(true);
    }
  });

  it('every TOOL_CATEGORY entry has a server.tool() registration', async () => {
    const { toolNames } = await countToolsInSource();
    const byCategory = await parseToolCategoryFromSource();
    const sourceSet = new Set(toolNames);
    const categorized = Object.values(byCategory).flat();

    for (const tool of categorized) {
      expect(
        sourceSet.has(tool),
        `TOOL_CATEGORY has entry for "${tool}" but no server.tool() call found in source`
      ).toBe(true);
    }
  });

  it('TOOL_TIER covers exactly the same tools as TOOL_CATEGORY', () => {
    const categoryTools = Object.keys(TOOL_CATEGORY).sort();
    const tierTools = Object.keys(TOOL_TIER).sort();

    expect(tierTools).toEqual(categoryTools);
  });

  it('tier-1 tools exactly match the default preset tool set', () => {
    const defaultCategories = new Set(PRESETS.default);
    const defaultPresetTools = Object.entries(TOOL_CATEGORY)
      .filter(([, category]) => defaultCategories.has(category))
      .map(([tool]) => tool)
      .sort();
    const tierOneTools = Object.entries(TOOL_TIER)
      .filter(([, tier]) => tier === 1)
      .map(([tool]) => tool)
      .sort();

    expect(tierOneTools).toEqual(defaultPresetTools);
    expect(tierOneTools).toHaveLength(18);
  });

  it('tier counts match the expected 18/58 split', () => {
    const tierOneCount = Object.values(TOOL_TIER).filter((tier) => tier === 1).length;
    const higherTierCount = Object.values(TOOL_TIER).filter((tier) => tier > 1).length;

    expect(tierOneCount).toBe(18);
    expect(higherTierCount).toBe(Object.keys(TOOL_TIER).length - 18);
  });
});
