/**
 * Tool Registration & Documentation Contract Tests
 *
 * Source invariants: tool registrations match TOOL_CATEGORY, TOOL_TIER,
 * and PRESETS. Documentation wording contracts: user-facing docs describe
 * presets and routing correctly and contain no stale count-based language.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { PRESETS, TOOL_CATEGORY, TOOL_TIER, ALL_CATEGORIES, TIER_1_TOOL_COUNT } from '../../../src/config.js';
import { VALID_CONFIG_KEYS } from '../../../src/tools/write/config.js';

const TOOLS_DIR = path.join(__dirname, '../../../src/tools');
const DOCS_DIR = path.join(__dirname, '../../../../../docs');
const ROOT_DIR = path.join(__dirname, '../../../../..');
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
 * Strip fenced code blocks from markdown content for prose-only scanning.
 */
function stripFencedCode(content: string): string {
  return content.replace(/```[\s\S]*?```/g, '');
}

/**
 * Read a doc file relative to the repo root.
 */
async function readDoc(relativePath: string): Promise<string> {
  return fs.readFile(path.join(ROOT_DIR, relativePath), 'utf-8');
}

// Files subject to stale-copy scanning (excludes CLAUDE.md and docs/TESTING.md)
const SCANNED_DOCS = [
  'README.md',
  'docs/TOOLS.md',
  'docs/CONFIGURATION.md',
  'docs/ARCHITECTURE.md',
  'docs/SETUP.md',
  'docs/PROVE-IT.md',
  'docs/VISION.md',
  'docs/OPENCLAW.md',
  'docs/TROUBLESHOOTING.md',
  'docs/SHARING.md',
  'docs/README.md',
  'packages/mcp-server/README.md',
];

// =============================================================================
// Tool Registration Verification
// =============================================================================

describe('Tool Registration Verification', () => {
  it('should have at least 10 mutation tools', async () => {
    const { total } = await countToolsInSource();
    expect(total).toBeGreaterThanOrEqual(10);
  });

  it('should have all core mutation tools registered', async () => {
    const { toolNames } = await countToolsInSource();
    const toolSet = new Set(toolNames);

    for (const tool of [
      'vault_add_to_section',
      'vault_remove_from_section',
      'vault_replace_in_section',
    ]) {
      expect(toolSet.has(tool), `Missing core tool: ${tool}`).toBe(true);
    }
  });

  it('should have all task tools registered', async () => {
    const { toolNames } = await countToolsInSource();
    const toolSet = new Set(toolNames);

    for (const tool of ['vault_toggle_task', 'vault_add_task']) {
      expect(toolSet.has(tool), `Missing task tool: ${tool}`).toBe(true);
    }
  });

  it('should have all frontmatter tools registered', async () => {
    const { toolNames } = await countToolsInSource();
    const toolSet = new Set(toolNames);
    expect(toolSet.has('vault_update_frontmatter'), 'Missing frontmatter tool').toBe(true);
  });

  it('should have all note management tools registered', async () => {
    const { toolNames } = await countToolsInSource();
    const toolSet = new Set(toolNames);

    for (const tool of ['vault_create_note', 'vault_delete_note']) {
      expect(toolSet.has(tool), `Missing note tool: ${tool}`).toBe(true);
    }
  });

  it('should have all system tools registered', async () => {
    const { toolNames } = await countToolsInSource();
    const toolSet = new Set(toolNames);
    expect(toolSet.has('vault_undo_last_mutation'), 'Missing system tool').toBe(true);
  });
});

// =============================================================================
// Tool Naming Conventions
// =============================================================================

describe('Tool Naming Conventions', () => {
  it('should use valid prefixes or known standalone names', async () => {
    const { toolNames } = await countToolsInSource();

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
      'discover_tools',
    ]);

    for (const tool of toolNames) {
      const hasValidPrefix = tool.startsWith('vault_') || tool.startsWith('policy_') || tool.startsWith('get_') || tool.startsWith('find_') || ALLOWED_STANDALONE.has(tool);
      expect(hasValidPrefix, `Tool ${tool} should start with vault_ or policy_ or be an allowed standalone name`).toBe(true);
    }
  });

  it('should use snake_case for tool names', async () => {
    const { toolNames } = await countToolsInSource();

    for (const tool of toolNames) {
      expect(/[A-Z]/.test(tool), `Tool ${tool} should use snake_case`).toBe(false);
      expect(/^[a-z_]+$/.test(tool), `Tool ${tool} should only contain lowercase letters and underscores`).toBe(true);
    }
  });
});

// =============================================================================
// Documentation Contracts — Source Invariants
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
  const presetLines = [...match[1].matchAll(/^\s*(\w[\w-]*):\s*\[([^\]]*)\]/gm)];
  for (const [, name, categoriesStr] of presetLines) {
    const categories = [...categoriesStr.matchAll(/'([\w-]+)'/g)].map(m => m[1]);
    if (categories.length > 0) {
      result[name] = categories;
    }
  }
  return result;
}

describe('Documentation Contracts — Source Invariants', () => {
  it('CONFIGURATION.md settable keys match VALID_CONFIG_KEYS', async () => {
    const configContent = await fs.readFile(path.join(DOCS_DIR, 'CONFIGURATION.md'), 'utf-8');

    for (const key of Object.keys(VALID_CONFIG_KEYS)) {
      expect(configContent, `VALID_CONFIG_KEYS key "${key}" not documented in CONFIGURATION.md`).toContain(key);
    }

    expect(VALID_CONFIG_KEYS['paths']).toBeUndefined();
    expect(VALID_CONFIG_KEYS['templates']).toBeUndefined();
    expect(configContent).toContain('read-only');
  });

  it('TOOLS.md documents key tools', async () => {
    const toolsContent = await fs.readFile(path.join(DOCS_DIR, 'TOOLS.md'), 'utf-8');
    expect(toolsContent).toContain('vault_add_to_section');
    expect(toolsContent).toContain('vault_toggle_task');
  });

  it('preset compositions match source', async () => {
    const presets = await parsePresetsFromSource();

    // full uses [...ALL_CATEGORIES] spread — verify via runtime import
    expect(PRESETS.full.length).toBe(ALL_CATEGORIES.length);
    expect(presets['agent']).toEqual(['search', 'read', 'write', 'tasks', 'memory']);
  });
});

// =============================================================================
// Tool Gating Invariants
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

  it('tier-1 tools exactly match the agent preset tool set', () => {
    const agentCategories = new Set(PRESETS.agent);
    const agentPresetTools = Object.entries(TOOL_CATEGORY)
      .filter(([, category]) => agentCategories.has(category))
      .map(([tool]) => tool)
      .sort();
    const tierOneTools = Object.entries(TOOL_TIER)
      .filter(([, tier]) => tier === 1)
      .map(([tool]) => tool)
      .sort();

    expect(tierOneTools).toEqual(agentPresetTools);
    expect(tierOneTools).toHaveLength(TIER_1_TOOL_COUNT);
  });

  it('tier counts match the expected tier-1/remainder split', () => {
    const tierOneCount = Object.values(TOOL_TIER).filter((tier) => tier === 1).length;
    const higherTierCount = Object.values(TOOL_TIER).filter((tier) => tier > 1).length;

    expect(tierOneCount).toBe(TIER_1_TOOL_COUNT);
    expect(higherTierCount).toBe(Object.keys(TOOL_TIER).length - TIER_1_TOOL_COUNT);
  });
});

// =============================================================================
// Documentation Wording Contracts
// =============================================================================

describe('Documentation Wording Contracts', () => {
  it('TOOLS.md describes progressive disclosure', async () => {
    const content = await readDoc('docs/TOOLS.md');
    expect(content).toMatch(/progressively/i);
  });

  it('TOOLS.md documents tool_selection_feedback', async () => {
    const content = await readDoc('docs/TOOLS.md');
    expect(content).toContain('tool_selection_feedback');
  });

  it('CONFIGURATION.md documents FLYWHEEL_TOOL_ROUTING', async () => {
    const content = await readDoc('docs/CONFIGURATION.md');
    expect(content).toContain('FLYWHEEL_TOOL_ROUTING');
  });

  it('docs describe full as the default preset', async () => {
    const tools = await readDoc('docs/TOOLS.md');
    const config = await readDoc('docs/CONFIGURATION.md');
    const combined = tools + config;

    // Must mention full as default somewhere
    expect(combined).toMatch(/`full`[^`]*default|default[^`]*`full`/i);
  });

  it('docs describe agent as the fixed reduced preset', async () => {
    const tools = await readDoc('docs/TOOLS.md');
    const config = await readDoc('docs/CONFIGURATION.md');
    const combined = tools + config;

    expect(combined).toMatch(/`agent`[^`]*fixed|fixed[^`]*`agent`/i);
  });
});

// =============================================================================
// Stale Copy Detection
// =============================================================================

describe('Stale Copy Detection', () => {
  describe('prose scan (fenced code stripped)', () => {
    it('no user-facing "N tools" phrasing in prose', async () => {
      const failures: string[] = [];

      for (const docPath of SCANNED_DOCS) {
        try {
          const raw = await readDoc(docPath);
          const prose = stripFencedCode(raw);
          const matches = prose.match(/(?<!tier-)\b\d+\s+tools\b/gi);
          if (matches) {
            failures.push(`${docPath}: ${matches.join(', ')}`);
          }
        } catch {
          // File may not exist in all configurations
        }
      }

      expect(failures, `Stale "N tools" phrasing found:\n${failures.join('\n')}`).toHaveLength(0);
    });

    it('no "Start with default" recommendations in prose', async () => {
      const failures: string[] = [];

      for (const docPath of SCANNED_DOCS) {
        try {
          const raw = await readDoc(docPath);
          const prose = stripFencedCode(raw);
          const matches = prose.match(/Start with.*\bdefault\b/gi);
          if (matches) {
            failures.push(`${docPath}: ${matches.join(', ')}`);
          }
        } catch {
          // skip missing files
        }
      }

      expect(failures, `Stale "Start with default" found:\n${failures.join('\n')}`).toHaveLength(0);
    });

    it('no "Included in the default preset" in prose', async () => {
      const failures: string[] = [];

      for (const docPath of SCANNED_DOCS) {
        try {
          const raw = await readDoc(docPath);
          const prose = stripFencedCode(raw);
          if (prose.includes('Included in the default preset')) {
            failures.push(docPath);
          }
        } catch {
          // skip missing files
        }
      }

      expect(failures, `Stale "Included in the default preset" found:\n${failures.join('\n')}`).toHaveLength(0);
    });
  });

  describe('raw scan (includes code blocks)', () => {
    it('no FLYWHEEL_TOOLS or FLYWHEEL_PRESET set to "default" in examples', async () => {
      const failures: string[] = [];

      for (const docPath of SCANNED_DOCS) {
        try {
          const raw = await readDoc(docPath);
          // Match "FLYWHEEL_TOOLS": "default" or "FLYWHEEL_PRESET": "default"
          if (/(?:"FLYWHEEL_TOOLS"|"FLYWHEEL_PRESET")\s*:\s*"default"/.test(raw)) {
            failures.push(`${docPath}: JSON example sets FLYWHEEL_TOOLS/PRESET to "default"`);
          }
          // Match FLYWHEEL_TOOLS=default (not followed by comma — that would be default,something)
          if (/FLYWHEEL_TOOLS=default(?:[^,\w]|$)/.test(raw)) {
            failures.push(`${docPath}: env example sets FLYWHEEL_TOOLS=default`);
          }
        } catch {
          // skip missing files
        }
      }

      expect(failures, `Stale default preset examples:\n${failures.join('\n')}`).toHaveLength(0);
    });
  });
});
