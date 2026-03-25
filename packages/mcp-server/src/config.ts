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
// Presets:
//   default    - Note-taking essentials: search, read, write, tasks (16 tools)
//   agent      - Autonomous AI agents: search, read, write, memory (16 tools)
//   full       - All tools except agent memory (71 tools). Add ",memory" for all 74.
//
// Composable bundles (combine with presets or each other):
//   graph       - Structural analysis + link detail + semantic + export (11 tools)
//   schema      - Schema intelligence + migrations: vault_schema, schema_conventions, schema_validate, note_intelligence, rename_field, migrate_field_values, rename_tag (7 tools)
//   wikilinks   - Wikilink suggestions, validation, discovery (7 tools)
//   corrections - Correction recording + resolution (4 tools)
//   tasks       - Task queries and mutations (3 tools)
//   memory      - Agent working memory + recall + brief (3 tools)
//   note-ops    - File management: delete, move, rename, merge (4 tools)
//   temporal    - Time-based vault intelligence (4 tools)
//   diagnostics - Vault health, stats, config, activity, merges, doctor, trust, benchmark, session/entity history (18 tools)
//
// Examples:
//   FLYWHEEL_TOOLS=default                    # 16 tools
//   FLYWHEEL_TOOLS=agent                      # 16 tools
//   FLYWHEEL_TOOLS=default,graph              # 27 tools
//   FLYWHEEL_TOOLS=agent,tasks                # 16 tools
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

export const ALL_CATEGORIES: ToolCategory[] = [
  'search', 'read', 'write',
  'graph', 'schema', 'wikilinks', 'corrections',
  'tasks', 'memory', 'note-ops',
  'temporal', 'diagnostics',
];

export const PRESETS: Record<string, ToolCategory[]> = {
  // Presets
  default: ['search', 'read', 'write', 'tasks'],
  agent: ['search', 'read', 'write', 'memory'],
  full: ALL_CATEGORIES.filter(c => c !== 'memory'),

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

export const DEFAULT_PRESET = 'default';

// Deprecated aliases -- old names -> new category/preset names
export const DEPRECATED_ALIASES: Record<string, string> = {
  minimal: 'default',
  writer: 'default',     // writer was default+tasks, now default includes tasks
  researcher: 'default', // use default,graph for graph exploration
  backlinks: 'graph',     // get_backlinks moved to graph
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
    serverLog('server', `Preset "${lowerValue}" is deprecated — use "${resolved}" instead`, 'warn');
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
    if (resolved !== rawItem) {
      serverLog('server', `Category "${rawItem}" is deprecated — use "${resolved}" instead`, 'warn');
    }

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

// Per-tool category mapping (tool name -> category).
// This is the single source of truth for tool count: Object.keys(TOOL_CATEGORY).length.
// Every tool MUST have an entry — gate() throws on startup if one is missing.
export const TOOL_CATEGORY: Record<string, ToolCategory> = {
  // search (3 tools)
  search: 'search',
  init_semantic: 'search',
  find_similar: 'search',

  // read (3 tools) -- note reading
  get_note_structure: 'read',
  get_section_content: 'read',
  find_sections: 'read',

  // write (7 tools) -- content mutations + frontmatter + note creation + undo + policy
  vault_add_to_section: 'write',
  vault_remove_from_section: 'write',
  vault_replace_in_section: 'write',
  vault_update_frontmatter: 'write',
  vault_create_note: 'write',
  vault_undo_last_mutation: 'write',
  policy: 'write',

  // graph (11 tools) -- structural analysis + link detail + export
  graph_analysis: 'graph',
  semantic_analysis: 'graph',
  get_backlinks: 'graph',
  get_forward_links: 'graph',
  get_connection_strength: 'graph',
  list_entities: 'graph',
  get_link_path: 'graph',
  get_common_neighbors: 'graph',
  get_weighted_links: 'graph',
  get_strong_connections: 'graph',
  export_graph: 'graph',

  // schema (7 tools) -- schema intelligence + migrations
  vault_schema: 'schema',
  schema_conventions: 'schema',
  schema_validate: 'schema',
  note_intelligence: 'schema',
  rename_field: 'schema',
  migrate_field_values: 'schema',
  rename_tag: 'schema',

  // wikilinks (7 tools) -- suggestions, validation, discovery
  suggest_wikilinks: 'wikilinks',
  validate_links: 'wikilinks',
  wikilink_feedback: 'wikilinks',
  discover_stub_candidates: 'wikilinks',
  discover_cooccurrence_gaps: 'wikilinks',
  suggest_entity_aliases: 'wikilinks',
  unlinked_mentions_report: 'wikilinks',

  // corrections (4 tools)
  vault_record_correction: 'corrections',
  vault_list_corrections: 'corrections',
  vault_resolve_correction: 'corrections',
  absorb_as_alias: 'corrections',

  // tasks (3 tools)
  tasks: 'tasks',
  vault_toggle_task: 'tasks',
  vault_add_task: 'tasks',

  // memory (3 tools) -- agent working memory
  memory: 'memory',
  recall: 'memory',
  brief: 'memory',

  // note-ops (4 tools) -- file management
  vault_delete_note: 'note-ops',
  vault_move_note: 'note-ops',
  vault_rename_note: 'note-ops',
  merge_entities: 'note-ops',

  // temporal (4 tools) -- time-based vault intelligence
  get_context_around_date: 'temporal',
  predict_stale_notes: 'temporal',
  track_concept_evolution: 'temporal',
  temporal_summary: 'temporal',

  // diagnostics (18 tools) -- vault health, stats, config, activity, merges, doctor, trust, benchmark, history
  health_check: 'diagnostics',
  get_vault_stats: 'diagnostics',
  get_folder_structure: 'diagnostics',
  refresh_index: 'diagnostics',
  get_all_entities: 'diagnostics',
  get_unlinked_mentions: 'diagnostics',
  vault_growth: 'diagnostics',
  vault_activity: 'diagnostics',
  flywheel_config: 'diagnostics',
  server_log: 'diagnostics',
  suggest_entity_merges: 'diagnostics',
  dismiss_merge_suggestion: 'diagnostics',
  vault_init: 'diagnostics',
  flywheel_doctor: 'diagnostics',
  flywheel_trust_report: 'diagnostics',
  flywheel_benchmark: 'diagnostics',
  vault_session_history: 'diagnostics',
  vault_entity_history: 'diagnostics',

};

// ============================================================================
// Server Instructions (dynamic, based on enabled categories)
// ============================================================================

export function generateInstructions(categories: Set<ToolCategory>, registry?: VaultRegistry | null): string {
  const parts: string[] = [];

  // Base instruction (always present)
  parts.push(`Flywheel provides tools to search, read, and write an Obsidian vault's knowledge graph.

Tool selection:
  1. "search" is the primary tool. Each result includes: frontmatter, tags, aliases,
     backlinks (with line numbers), outlinks (with line numbers and existence check),
     headings, content snippet or preview, entity category, hub score, and timestamps.
     This is usually enough to answer without reading any files.
  2. Escalate to "get_note_structure" only when you need the full markdown content
     or word count. Use "get_section_content" to read one section by heading name.
  3. Start with a broad search: just query text, no filters. Only add folder, tag,
     or frontmatter filters to narrow a second search if needed.`);

  // Onboarding hint: nudge init_semantic if embeddings aren't built
  if (!hasEmbeddingsIndex()) {
    parts.push(`
**Setup:** Run \`init_semantic\` once to build embeddings. This unlocks hybrid search (BM25 + semantic),
improves recall results, and enables similarity-based tools. Without it, search is keyword-only.`);
  }

  // Multi-vault instructions (when registry has multiple vaults)
  if (registry?.isMultiVault) {
    parts.push(`
## Multi-Vault

This server manages multiple vaults. Every tool has an optional "vault" parameter.
- "search" without vault searches ALL vaults and merges results (each result has a "vault" field).
- All other tools default to the primary vault when "vault" is omitted.
- Available vaults: ${registry.getVaultNames().join(', ')}`);
  }

  // Frontmatter guidance (always present -- impacts search, categorization, recall, and suggestions)
  parts.push(`
**Frontmatter matters more than content** for Flywheel's intelligence. When creating or updating notes, always set:
  - \`type:\` — drives entity categorization (person, project, technology). Without it, the category is guessed from the name alone and is often wrong.
  - \`aliases:\` — alternative names so the entity is found when referred to differently. Without it, the entity is invisible to searches using alternate names.
  - \`description:\` — one-line summary shown in search results and used by recall. Without it, search results and recall are degraded.
  - Tags — used for filtering, suggestion scoring, and schema analysis.
Good frontmatter is the highest-leverage action for improving suggestions, recall, and link quality.`);

  // Read category instructions
  if (categories.has('read')) {
    parts.push(`
## Read

Escalation: "search" (enriched metadata + content preview) → "get_note_structure"
(full content + word count) → "get_section_content" (single section).
"find_sections" finds headings across the vault by pattern.`);
  }

  // Write category instructions
  if (categories.has('write')) {
    parts.push(`
## Write

**Before writing, check for saved policies** with \`policy(action="list")\`. Policies ensure notes are
created with the correct structure and frontmatter for this vault. Use a matching policy instead of
raw write tools when one exists. Fall back to direct tools only when no policy fits.

**Every new note should have \`type\`, \`aliases\`, and \`description\` in frontmatter** — this is what powers
entity categorization, search ranking, and link suggestions. Notes without frontmatter are nearly invisible
to the intelligence layer.

Write to existing notes with "vault_add_to_section". Create new notes with "vault_create_note".
Update metadata with "vault_update_frontmatter". These are fallback tools — use them when no policy fits.
All writes auto-link entities — no manual [[wikilinks]] needed.
Use "vault_undo_last_mutation" to reverse the last write.

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
project frontmatter" — Claude authors the YAML, saves it to .claude/policies/, and runs it whenever
you say "run the weekly review for this week".`);
  }

  // Memory category instructions (agent workflow)
  if (categories.has('memory')) {
    parts.push(`
## Memory

Session workflow: call "brief" at conversation start for vault context (recent sessions, active entities, stored memories). Use "recall" before answering questions — it searches entities, notes, and memories with graph-boosted ranking. Use "memory" with action "store" to save observations, facts, or context that should persist across sessions (e.g. key decisions, user preferences, project status).`);
  }

  // Graph category instructions
  if (categories.has('graph')) {
    parts.push(`
## Graph

Use "get_backlinks" for per-backlink surrounding text (reads source files).
Use "get_forward_links" for resolved file paths and alias text.
Use "graph_analysis" for structural queries (hubs, orphans, dead ends).
Use "get_connection_strength" to measure link strength between two entities.
Use "get_link_path" to trace the shortest path between any two entities or notes.
Use "get_strong_connections" to find the strongest or most-connected relationships for an entity.`);
  }

  // Note-ops category instructions
  if (categories.has('note-ops')) {
    parts.push(`
## Note Operations

Use "vault_delete_note" to permanently remove a note from the vault.
Use "vault_move_note" to relocate a note to a different folder (updates all backlinks automatically).
Use "vault_rename_note" to change a note's title in place (updates all backlinks automatically).
Use "merge_entities" to consolidate two entity notes into one — adds aliases, merges content, rewires wikilinks, and deletes the source.`);
  }

  // Tasks category instructions
  if (categories.has('tasks')) {
    parts.push(`
## Tasks

Use "tasks" to query tasks across the vault (filter by status, due date, path). Use "vault_add_task" to create tasks and "vault_toggle_task" to complete them.`);
  }

  // Schema category instructions
  if (categories.has('schema')) {
    parts.push(`
## Schema

Use "vault_schema" before bulk operations to understand field types, values, and note type distribution.
Use "schema_conventions" to infer frontmatter conventions from folder usage patterns, find notes with incomplete metadata, or suggest field values.
Use "schema_validate" to validate frontmatter against explicit rules or find notes missing expected fields by folder.
Use "note_intelligence" for per-note analysis (completeness, quality, suggestions).`);
  }

  return parts.join('\n');
}
