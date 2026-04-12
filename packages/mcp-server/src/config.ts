/**
 * Tool categories, presets, and server instruction generation.
 *
 * Pure configuration — no module-level singletons or side effects.
 */

import { hasEmbeddingsIndex } from './core/read/embeddings.js';
import { serverLog } from './core/shared/serverLog.js';
import type { VaultRegistry } from './vault-registry.js';

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
//   auto       - Progressive disclosure via discover_tools, all categories, hybrid routing
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
//   FLYWHEEL_TOOLS=auto                       # progressive disclosure via discover_tools
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
 * 'auto' enables progressive disclosure (tier-1 visible, tier-2/3 activated by context).
 * Users can override to 'full' via flywheel_config at runtime.
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
  //   auto — progressive disclosure via discover_tools, all categories
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
      enableProgressiveDisclosure: lowerValue === 'auto',
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
        enableProgressiveDisclosure: resolved === 'auto',
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
  };
}

// Per-tool category mapping (tool name -> category).
// This is the single source of truth for tool count: Object.keys(TOOL_CATEGORY).length.
// Every tool MUST have an entry — gate() throws on startup if one is missing.
//
// T43 B3+ tool surface (21 tools total after legacy retirement):
//   search (3): search, init_semantic, discover_tools
//   read (3): read, note_read [compat], find_notes
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

  // read (3) -- read is canonical T43 name; note_read kept as backward-compat alias
  read: 'read',
  note_read: 'read',
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
  note_read: 2,       // backward-compat alias for read (prefer read)
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
  note_read: ['structure', 'section', 'sections'],
  read: ['structure', 'section', 'sections'],  // T43 B3+: canonical alias for note_read
  note: ['create', 'move', 'rename', 'delete'],
  edit_section: ['add', 'remove', 'replace'],
  memory: ['store', 'get', 'search', 'list', 'forget', 'summarize_session', 'brief'],
  entity: ['list', 'alias', 'suggest_aliases', 'merge', 'suggest_merges', 'dismiss_merge'],
  policy: ['list', 'validate', 'preview', 'execute', 'author', 'revise'],
  correct: ['record', 'list', 'resolve', 'undo'],
  link: ['suggest', 'feedback', 'unlinked', 'validate', 'stubs', 'dashboard', 'unsuppress', 'timeline', 'layer_timeseries', 'snapshot_diff'],
  graph: ['analyse', 'backlinks', 'forward_links', 'strong_connections', 'path', 'neighbors', 'strength', 'cooccurrence_gaps'],
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

// ============================================================================
// Server Instructions (dynamic, based on enabled categories)
// ============================================================================

export function generateInstructions(
  categories: Set<ToolCategory>,
  registry?: VaultRegistry | null,
  activeTierCategories?: Set<ToolCategory>,
): string {
  const parts: string[] = [];
  const tieringActive = activeTierCategories !== undefined;
  const isCategoryVisible = (category: ToolCategory): boolean => {
    if (!categories.has(category)) return false;
    if (!tieringActive) return true;
    if (PRESETS.agent.includes(category)) return true;
    return activeTierCategories.has(category);
  };

  // Base instruction (always present)
  parts.push(`Flywheel provides tools to search, read, and write an Obsidian vault's knowledge graph.

**Action-based tools** require an \`action\` parameter that selects the operation.
Each param description is tagged with its action(s) in [brackets] — only provide params for your chosen action.
Wrong action or missing params → error with allowed actions and a corrected example.

Tool routing:
  1. "search" is the primary entry point — one call returns a decision surface of
     notes, entities, and memories with frontmatter, backlinks, outlinks, section
     provenance, dates, entity bridges, and confidence scores. Usually enough to
     answer without reading full files.
  2. For structural, temporal, wikilink, or diagnostic goals, use the specialized
     tools in those categories — they return targeted contracts, not broad results.
  3. Escalate to "read" for full markdown content or word count.
     Use action=structure for heading outline + metadata, action=section for a single
     section by heading name, action=sections for vault-wide heading search.
     Prefer "read" over the built-in Read tool for vault notes — it
     returns enriched metadata (backlinks, outlinks, entities, word count) that Read cannot.
  4. Start with a broad search: just query text, no filters. Use find_notes for
     structural enumeration by folder, tag, or frontmatter — not search.`);

  // Onboarding hint: nudge init_semantic if embeddings aren't built
  if (!hasEmbeddingsIndex()) {
    parts.push(`
**Setup:** Run \`init_semantic\` once to build embeddings. This unlocks hybrid search (BM25 + semantic),
improves search results, and enables similarity-based tools. Without it, search is keyword-only.`);
  }

  // Multi-vault instructions (when registry has multiple vaults)
  if (registry?.isMultiVault) {
    parts.push(`
## Multi-Vault

This server manages multiple vaults. Every tool has an optional "vault" parameter.
- "search" and "find_notes" without vault search ALL vaults and merge results (each result has a "vault" field).
- All other tools default to the primary vault when "vault" is omitted.
- Available vaults: ${registry.getVaultNames().join(', ')}`);
  }

  // Frontmatter guidance (always present -- impacts search, categorization, and suggestions)
  parts.push(`
**Frontmatter matters more than content** for Flywheel's intelligence. When creating or updating notes, always set:
  - \`type:\` — drives entity categorization (person, project, technology). Without it, the category is guessed from the name alone and is often wrong.
  - \`aliases:\` — alternative names so the entity is found when referred to differently. Without it, the entity is invisible to searches using alternate names.
  - \`description:\` — one-line summary shown in search results and used for entity ranking. Without it, search quality is degraded.
  - Tags — used for filtering, suggestion scoring, and schema analysis.
Good frontmatter is the highest-leverage action for improving suggestions, search, and link quality.`);

  // Read category instructions
  if (isCategoryVisible('read')) {
    parts.push(`
## Read

Escalation: "search" (enriched metadata + content preview) → "read"
(full content + word count via action=structure, single section via action=section).
"read" with action=sections finds headings across the vault by regex pattern.`);
  }

  // Write category instructions
  if (isCategoryVisible('write')) {
    parts.push(`
## Write

**Before writing, check for saved policies** with \`policy(action="list")\`. Policies ensure notes are
created with the correct structure and frontmatter for this vault. Use a matching policy instead of
raw write tools when one exists. Fall back to direct tools only when no policy fits.

**Every new note should have \`type\`, \`aliases\`, and \`description\` in frontmatter** — this is what powers
entity categorization, search ranking, and link suggestions. Notes without frontmatter are nearly invisible
to the intelligence layer.

Write to existing notes with "edit_section" (action: add/remove/replace). Create new notes with "note" (action: create).
Update metadata with "vault_update_frontmatter". These are fallback tools — use them when no policy fits.
All writes auto-link entities — no manual [[wikilinks]] needed.
Use "correct" (action: undo) to reverse the last write.

### Policies

Use "policy" to build deterministic, repeatable vault workflows. Describe what you want in plain
language — Claude authors the YAML, saves it, and can execute it on demand. No YAML knowledge needed.

Policies chain vault tools (add/remove/replace sections, create notes, update frontmatter, toggle
tasks) into atomic operations — all steps succeed or all roll back, committed as a single git commit.

Actions: "list" saved policies (do this first), "execute" with variables, "author" a policy
from a description, "validate" the YAML, "preview" (dry-run), "revise" to modify.

Key capabilities:
  - **Variables** — parameterize policies (string, number, boolean, array, enum with defaults).
  - **Conditions** — branch on file/section/frontmatter state (skip steps, don't abort).
  - **Templates** — interpolate variables, builtins ({{today}}, {{now}}), and prior step outputs.
  - **Atomicity** — failure at any step rolls back all changes. One policy = one git commit.

Example: ask "create a policy that generates a weekly review note, pulls open tasks, and updates
project frontmatter" — Claude authors the YAML, saves it to .flywheel/policies/, and runs it whenever
you say "run the weekly review for this week".`);
  }

  // Memory category instructions
  if (isCategoryVisible('memory')) {
    parts.push(`
## Memory

"memory" (action: brief) delivers startup context (recent sessions, active entities, stored memories) — call it at
conversation start. "search" finds everything — notes, entities, and memories in one call. "memory"
(action: store) persists observations, facts, or preferences across sessions (e.g. key decisions,
user preferences, project status). "memory" (action: search/list/forget) for retrieval and cleanup.`);
  }

  // Graph category instructions
  if (isCategoryVisible('graph')) {
    parts.push(`
## Graph

Use "graph" (action: analyse) for structural queries (hubs, orphans, dead ends).
Use "graph" (action: strength) to measure link weight between two notes.
Use "graph" (action: path) to trace the shortest chain between notes.
Use "graph" (action: neighbors) to find shared connections between two notes.
Use "graph" (action: backlinks/forward_links) for link lists.`);
  }
  else if (tieringActive && categories.has('graph')) {
    // Escalation hint handled by unified discover_tools guidance below
  }

  // Note-ops category instructions
  if (isCategoryVisible('note-ops')) {
    parts.push(`
## Note Operations

Use "note" (action: delete) to permanently remove a note (requires confirm:true).
Use "note" (action: move) to relocate a note (updates all backlinks automatically).
Use "note" (action: rename) to change a note's title (updates all backlinks automatically).
Use "entity" (action: merge) to consolidate two entity notes — adds aliases, merges content, rewires wikilinks.`);
  }

  // Tasks category instructions
  if (isCategoryVisible('tasks')) {
    parts.push(`
## Tasks

Use "tasks" (action: list) to query tasks across the vault (filter by status, due date, path, folder, tag).
Use "tasks" (action: toggle) to check/uncheck a task. Use "vault_add_task" to create new tasks.`);
  }

  // Schema category instructions
  if (isCategoryVisible('schema')) {
    parts.push(`
## Schema

Use "schema" (action: overview) before bulk operations to understand field types, values, and note type distribution.
Use "schema" (action: conventions) to infer frontmatter conventions from folder usage patterns.
Use "schema" (action: validate) to validate frontmatter against explicit rules.
Use "schema" (action: rename_field/rename_tag/migrate) for bulk schema changes (preview with dry_run:true first).
Use "insights" (action: note_intelligence) for per-note analysis (completeness, quality, suggestions).`);
  }
  else if (tieringActive && categories.has('schema')) {
    // Escalation hint handled by unified discover_tools guidance below
  }

  if (isCategoryVisible('wikilinks')) {
    parts.push(`
## Wikilinks

Link quality and discovery — not for finding content (use search for that).

- "What should be linked?" → link(action: unlinked) — vault-wide unlinked entity mentions
- "Suggest links for this note" → link(action: suggest) — per-note entity analysis
- "Are any links broken?" → link(action: validate) — dead links + fix suggestions
- "What topics need their own notes?" → link(action: stubs) — frequently-linked but non-existent
- "Was that link correct?" → link(action: feedback) — accept/reject, improves future suggestions
- "What aliases am I missing?" → entity(action: suggest_aliases)`);
  }
  else if (tieringActive && categories.has('wikilinks')) {
    // Escalation hint handled by unified discover_tools guidance below
  }

  if (isCategoryVisible('corrections')) {
    parts.push(`
## Corrections

When the user says something is wrong — a bad link, wrong entity, wrong category:

"correct" (action: record) persists a correction for future sessions.
"correct" (action: list) shows pending/applied/dismissed corrections.
"correct" (action: resolve) marks a correction as applied or dismissed.
"correct" (action: undo) reverses the last vault mutation.
Use "entity" (action: alias) when two names should resolve to the same entity without merging note bodies.`);
  }
  else if (tieringActive && categories.has('corrections')) {
    // Escalation hint handled by unified discover_tools guidance below
  }

  if (isCategoryVisible('temporal')) {
    parts.push(`
## Temporal

Search date filters (modified_after/modified_before) find content within a date range.
Temporal tools analyze *patterns and changes* over time — use them for "what changed" not "what exists":

- "How has X changed/evolved?" → insights(action: evolution) — entity timeline with links, feedback, momentum
- "What was I working on around March 15?" → insights(action: context) — notes, entities, activity in a window
- "What notes need attention?" → insights(action: staleness) — importance × staleness → archive/update/review`);
  }
  else if (tieringActive && categories.has('temporal')) {
    // Escalation hint handled by unified discover_tools guidance below
  }

  if (isCategoryVisible('diagnostics')) {
    parts.push(`
## Diagnostics

 - Health: "doctor" (action: health) — vault status, integrity, pipeline summary
 - Pipeline: "doctor" (action: pipeline) — watcher state, indexing activity
 - Config: "doctor" (action: config) — inspect/set runtime configuration, including tool_tier_override
 - Logs: "doctor" (action: log) — recent server event timeline
 - Maintenance: "refresh_index" — rebuild the vault index`);
  }
  else if (tieringActive && categories.has('diagnostics')) {
    // Escalation hint handled by unified discover_tools guidance below
  }

  // Unified discover_tools guidance (replaces per-category escalation hints)
  if (tieringActive) {
    parts.push(`
**More tools available:** Call \`discover_tools({ query: "your need" })\` to find and activate specialized tools for graph analysis, wikilinks, diagnostics, schema, temporal analysis, note operations, and more. Returns tool names, descriptions, and input schemas.`);
  }

  return parts.join('\n');
}
