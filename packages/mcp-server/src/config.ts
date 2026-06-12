/**
 * Tool categories, presets, and server instruction generation.
 *
 * Pure configuration — no module-level singletons or side effects.
 */

import { serverLog } from './core/shared/serverLog.js';

// ============================================================================
// Tool Presets & Composable Bundles
// ============================================================================
// FLYWHEEL_TOOLS / FLYWHEEL_PRESET env var controls which tools are loaded.
//
// T43 B3+ — 21 tools total (down from 63). Tier 1 = 8 core agent tools.
//
// Presets:
//   agent      - Tier-1 tools: search, read, note, edit_section, memory, tasks, doctor, policy — DEFAULT
//   power      - Tier 1+2: agent + link, correct, entity, schema, find_notes, vault_update_frontmatter
//   full       - Tier 1+2+3: power + graph, insights, vault_add_task
//   auto       - Full surface plus informational discover_tools helper
//
// Composable bundles (combine with presets or each other):
//   graph       - Structural graph analysis (graph merged tool)
//   schema      - Schema intelligence + migrations (schema merged tool)
//   wikilinks   - Wikilink suggestions, validation, discovery (link merged tool)
//   corrections - Correction recording + resolution (correct merged tool)
//   tasks       - Task queries, toggle, and creation (tasks + vault_add_task)
//   memory      - Session memory (memory merged tool — includes brief action)
//   note-ops    - Entity management + file ops (entity merged tool)
//   temporal    - Time-based vault intelligence (insights merged tool)
//   diagnostics - Vault health, config, logs (doctor + refresh_index)
//
// Examples:
//   (no env)                                  # focused default preset (agent)
//   FLYWHEEL_TOOLS=auto                       # full surface + discover_tools helper
//   FLYWHEEL_TOOLS=agent                      # core tools only, no disclosure
//   FLYWHEEL_TOOLS=agent,graph                # 29 tools, no tiering
//   FLYWHEEL_TOOLS=search,read,graph          # fine-grained categories
//
// Categories (12):
//   search, read, write, graph, schema, wikilinks,
//   corrections, tasks, memory, note-ops, temporal, diagnostics
// ============================================================================

export type ToolCategory =
  | 'search' | 'read' | 'write'
  | 'graph' | 'schema' | 'wikilinks' | 'corrections'
  | 'tasks' | 'memory' | 'note-ops'
  | 'temporal' | 'diagnostics';

export type ToolTier = 1 | 2 | 3;
export type ToolTierOverride = 'auto' | 'full' | 'minimal';

/**
 * Default tier override for fresh sessions.
 * Retained for runtime compatibility with doctor(action: config), even though
 * the public `auto` preset now means full surface + discover_tools helper.
 */
export const INITIAL_TIER_OVERRIDE: ToolTierOverride = 'auto';

export const ALL_CATEGORIES: ToolCategory[] = [
  'search', 'read', 'write',
  'graph', 'schema', 'wikilinks', 'corrections',
  'tasks', 'memory', 'note-ops',
  'temporal', 'diagnostics',
];

export const PRESETS: Record<string, ToolCategory[]> = {
  // Named presets (3-tier surface — T43 B3+ target: agent=8, power=14, full=17 visible tools)
  //   agent — tier-1 tools: search, read, note, edit_section, memory, tasks, doctor, policy
  agent: ['search', 'read', 'write', 'tasks', 'memory', 'diagnostics'],
  //   power — tier 1+2: agent + link, correct, entity, schema + find_notes, vault_update_frontmatter
  power: ['search', 'read', 'write', 'tasks', 'memory', 'diagnostics', 'wikilinks', 'corrections', 'note-ops', 'schema'],
  //   full — tier 1+2+3: power + graph + temporal (insights) + vault_add_task
  full: ['search', 'read', 'write', 'tasks', 'memory', 'diagnostics', 'wikilinks', 'corrections', 'note-ops', 'schema', 'graph', 'temporal'],
  //   auto — full surface + informational discover_tools helper
  auto: [...ALL_CATEGORIES],

  // Composable bundles (one per category)
  graph: ['graph'],
  schema: ['schema'],
  wikilinks: ['wikilinks'],
  corrections: ['corrections'],
  tasks: ['tasks'],
  memory: ['memory'],
  'note-ops': ['note-ops'],
  temporal: ['temporal'],
  diagnostics: ['diagnostics'],
};

export const DEFAULT_PRESET = 'agent';

// Deprecated aliases -- old names -> new category/preset names
export const DEPRECATED_ALIASES: Record<string, string> = {
  default: 'agent',      // default tracks DEFAULT_PRESET
  minimal: 'agent',
  writer: 'agent',       // writer was agent+tasks, agent now includes tasks
  researcher: 'agent',   // use agent,graph for graph exploration
  backlinks: 'graph',     // legacy alias
  structure: 'read',
  append: 'write',
  frontmatter: 'write',
  notes: 'write',
  orphans: 'graph',
  hubs: 'graph',
  paths: 'graph',
  health: 'diagnostics',
  analysis: 'wikilinks',
  git: 'write',
  ops: 'write',
  policy: 'write',
};

/**
 * Parse FLYWHEEL_TOOLS env var into enabled categories
 */
export function parseEnabledCategories(envValue?: string): Set<ToolCategory> {
  const raw = (envValue ?? process.env.FLYWHEEL_TOOLS ?? process.env.FLYWHEEL_PRESET)?.trim();

  // No env var = use default preset
  if (!raw) {
    return new Set(PRESETS[DEFAULT_PRESET]);
  }

  // Check if it's a preset name (direct match)
  const lowerValue = raw.toLowerCase();
  if (PRESETS[lowerValue]) {
    return new Set(PRESETS[lowerValue]);
  }

  // Check deprecated alias (single value)
  if (DEPRECATED_ALIASES[lowerValue]) {
    const resolved = DEPRECATED_ALIASES[lowerValue];
    if (PRESETS[resolved]) {
      return new Set(PRESETS[resolved]);
    }
    return new Set([resolved as ToolCategory]);
  }

  // Parse comma-separated categories
  const categories = new Set<ToolCategory>();
  for (const item of raw.split(',')) {
    const rawItem = item.trim().toLowerCase();

    // Check deprecated alias
    const resolved = DEPRECATED_ALIASES[rawItem] ?? rawItem;

    if (ALL_CATEGORIES.includes(resolved as ToolCategory)) {
      categories.add(resolved as ToolCategory);
    } else if (PRESETS[resolved]) {
      // Allow preset names in comma list
      for (const c of PRESETS[resolved]) {
        categories.add(c);
      }
    } else {
      serverLog('server', `Unknown tool category "${item}" — ignoring`, 'warn');
    }
  }

  // If nothing valid, fall back to default
  if (categories.size === 0) {
    serverLog('server', `No valid categories found, using default (${DEFAULT_PRESET})`, 'warn');
    return new Set(PRESETS[DEFAULT_PRESET]);
  }

  return categories;
}


// =============================================================================
// Shared Resolver
// =============================================================================

export interface ToolConfig {
  categories: Set<ToolCategory>;
  preset: string | null;
  isFullToolset: boolean;
  enableProgressiveDisclosure: boolean;
  includeDiscoveryTool: boolean;
}

/**
 * Resolve tool configuration from env value.
 * Single source of truth for preset parsing, tiering decisions, and reporting.
 */
export function resolveToolConfig(envValue?: string): ToolConfig {
  const raw = (envValue ?? process.env.FLYWHEEL_TOOLS ?? process.env.FLYWHEEL_PRESET)?.trim();

  if (!raw) {
    const cats = new Set(PRESETS[DEFAULT_PRESET]);
    const isFullToolset = cats.size === ALL_CATEGORIES.length && ALL_CATEGORIES.every(c => cats.has(c));
    return {
      categories: cats,
      preset: DEFAULT_PRESET,
      isFullToolset,
      enableProgressiveDisclosure: false,
      includeDiscoveryTool: false,
    };
  }

  const lowerValue = raw.toLowerCase();

  // Direct preset match
  if (PRESETS[lowerValue]) {
    const cats = new Set(PRESETS[lowerValue]);
    const isFullToolset = cats.size === ALL_CATEGORIES.length && ALL_CATEGORIES.every(c => cats.has(c));
    return {
      categories: cats,
      preset: lowerValue,
      isFullToolset,
      enableProgressiveDisclosure: false,
      includeDiscoveryTool: lowerValue === 'auto',
    };
  }

  // Deprecated alias (single value)
  if (DEPRECATED_ALIASES[lowerValue]) {
    const resolved = DEPRECATED_ALIASES[lowerValue];
    if (PRESETS[resolved]) {
      const cats = new Set(PRESETS[resolved]);
      return {
        categories: cats,
        preset: resolved,
        isFullToolset: cats.size === ALL_CATEGORIES.length && ALL_CATEGORIES.every(c => cats.has(c)),
        enableProgressiveDisclosure: false,
        includeDiscoveryTool: resolved === 'auto',
      };
    }
  }

  // Comma-separated categories — delegate to parseEnabledCategories
  const categories = parseEnabledCategories(raw);
  return {
    categories,
    preset: null,
    isFullToolset: categories.size === ALL_CATEGORIES.length && ALL_CATEGORIES.every(c => categories.has(c)),
    enableProgressiveDisclosure: false,
    includeDiscoveryTool: false,
  };
}

// Per-tool category mapping (tool name -> category).
// This is the single source of truth for tool count: Object.keys(TOOL_CATEGORY).length.
// Every tool MUST have an entry — gate() throws on startup if one is missing.
//
// T43 B3+ tool surface (21 tools total after legacy retirement):
//   search (3): search, init_semantic, discover_tools
//   read (2): read, find_notes
//   write (4): note, edit_section, vault_update_frontmatter, policy
//   graph (1): graph
//   schema (1): schema
//   wikilinks (1): link
//   corrections (1): correct
//   tasks (2): tasks, vault_add_task
//   memory (1): memory
//   note-ops (1): entity
//   temporal (1): insights
//   diagnostics (2): doctor, refresh_index
export const TOOL_CATEGORY: Record<string, ToolCategory> = {
  // search (3)
  search: 'search',
  init_semantic: 'search',
  discover_tools: 'search',

  // read (2)
  read: 'read',
  find_notes: 'read',

  // write (4)
  note: 'write',
  edit_section: 'write',
  vault_update_frontmatter: 'write',
  policy: 'write',

  // graph (1)
  graph: 'graph',

  // schema (1)
  schema: 'schema',

  // wikilinks (1)
  link: 'wikilinks',

  // corrections (1)
  correct: 'corrections',

  // tasks (2)
  tasks: 'tasks',
  vault_add_task: 'tasks',

  // memory (1)
  memory: 'memory',

  // note-ops (1)
  entity: 'note-ops',

  // temporal (1) -- insights absorbs: evolution, staleness, context, note_intelligence, growth
  insights: 'temporal',

  // diagnostics (2)
  doctor: 'diagnostics',
  refresh_index: 'diagnostics',
};

export const TOOL_TIER: Record<string, ToolTier> = {
  // Tier 1 — always visible in agent preset (8 core tools when tiering active)
  // These are the primary entry points for every task class.
  search: 1,
  read: 1,
  note: 1,
  edit_section: 1,
  policy: 1,
  tasks: 1,
  memory: 1,
  doctor: 1,

  // Tier 2 — power-level: context-triggered or explicitly requested
  // Activated by query patterns or when power/full preset is active.
  init_semantic: 2,
  find_notes: 2,
  vault_update_frontmatter: 2,
  link: 2,
  correct: 2,
  entity: 2,
  schema: 2,
  refresh_index: 2,

  // Tier 2 — also triggered by activation signals (graph/temporal patterns fire at tier 2)
  graph: 2,
  insights: 2,

  // Tier 3 — full-level / advanced operations
  vault_add_task: 3,
  discover_tools: 1,  // auto preset only — tier-1 so always visible when registered
};

function assertToolTierCoverage(): void {
  const categoryKeys = Object.keys(TOOL_CATEGORY).sort();
  const tierKeys = Object.keys(TOOL_TIER).sort();
  const missingTier = categoryKeys.filter((key) => !(key in TOOL_TIER));
  const missingCategory = tierKeys.filter((key) => !(key in TOOL_CATEGORY));

  if (missingTier.length > 0 || missingCategory.length > 0 || categoryKeys.length !== tierKeys.length) {
    throw new Error(
      `TOOL_TIER must cover exactly the same tools as TOOL_CATEGORY. ` +
      `missing tier entries: ${missingTier.join(', ') || 'none'}; ` +
      `missing category entries: ${missingCategory.join(', ') || 'none'}`
    );
  }
}

assertToolTierCoverage();

/** Tools only registered when progressive disclosure is active (auto preset). */
export const DISCLOSURE_ONLY_TOOLS = new Set(['discover_tools']);

/**
 * Action discriminators for merged action-param tools.
 *
 * Single source of truth for the sub-actions on tools that use an `action`
 * discriminator field. Used by the doc-fragments generator to render the
 * action-param tools list in CLAUDE.md, and kept here so drift between the
 * tool's Zod schema and the doc is visible in the same file as the tool list.
 */
export const ACTION_PARAM_MAP: Record<string, readonly string[]> = {
  search: ['query', 'similar'],
  tasks: ['list', 'toggle'],  // T43 B3+: toggle action added; vault_toggle_task retired
  read: ['structure', 'section', 'sections', 'raw'],
  note: ['create', 'move', 'rename', 'delete'],
  edit_section: ['add', 'remove', 'replace'],
  memory: ['store', 'get', 'search', 'list', 'forget', 'supersede', 'unsupersede', 'summarize_session', 'brief'],
  entity: ['list', 'alias', 'suggest_aliases', 'merge', 'suggest_merges', 'dismiss_merge'],
  policy: ['list', 'validate', 'preview', 'execute', 'author', 'revise'],
  correct: ['record', 'list', 'resolve', 'undo'],
  link: ['suggest', 'feedback', 'unlinked', 'validate', 'stubs', 'dashboard', 'unsuppress', 'timeline', 'layer_timeseries', 'snapshot_diff'],
  graph: ['analyse', 'backlinks', 'forward_links', 'strong_connections', 'path', 'neighbors', 'strength', 'cooccurrence_gaps', 'export'],
  schema: ['overview', 'field_values', 'conventions', 'folders', 'rename_field', 'rename_tag', 'migrate', 'validate'],
  insights: ['evolution', 'staleness', 'context', 'note_intelligence', 'growth'],
  doctor: ['health', 'diagnosis', 'stats', 'pipeline', 'config', 'log'],
};

/**
 * Sanity-check: every key in ACTION_PARAM_MAP must be a real tool in TOOL_CATEGORY.
 * Catches the case where a merged tool gets renamed or retired and its action
 * list is left dangling.
 */
(function assertActionParamMapCoverage(): void {
  const orphans = Object.keys(ACTION_PARAM_MAP).filter((name) => !(name in TOOL_CATEGORY));
  if (orphans.length > 0) {
    throw new Error(
      `ACTION_PARAM_MAP references tools not in TOOL_CATEGORY: ${orphans.join(', ')}`
    );
  }
})();

// Computed constants — derived from TOOL_CATEGORY and TOOL_TIER, never hardcode these numbers
export const TOTAL_TOOL_COUNT = Object.keys(TOOL_CATEGORY).length;
export const TIER_1_TOOL_COUNT = Object.values(TOOL_TIER).filter(t => t === 1).length;
export const TIER_2_TOOL_COUNT = Object.values(TOOL_TIER).filter(t => t === 2).length;
export const TIER_3_TOOL_COUNT = Object.values(TOOL_TIER).filter(t => t === 3).length;

// generateInstructions moved to instructions.ts (arch-review S12): it calls
// the DB-backed hasEmbeddingsIndex() at runtime, which doesn't belong in a
// pure-configuration module. Importers should use src/instructions.ts.
