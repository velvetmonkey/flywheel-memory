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
//   default    - Note-taking essentials: search, read, write, tasks, memory (18 tools)
//   full       - All tools, all categories (76 tools, tiered visibility)
//
// Composable bundles (combine with presets or each other):
//   graph       - Structural analysis + link detail + semantic + export (11 tools)
//   schema      - Schema intelligence + migrations: vault_schema, schema_conventions, schema_validate, note_intelligence, rename_field, migrate_field_values, rename_tag (7 tools)
//   wikilinks   - Wikilink suggestions, validation, discovery (7 tools)
//   corrections - Correction recording + resolution (4 tools)
//   tasks       - Task queries and mutations (3 tools)
//   memory      - Session memory + brief (2 tools)
//   note-ops    - File management: delete, move, rename, merge (4 tools)
//   temporal    - Time-based vault intelligence (4 tools)
//   diagnostics - Vault health, stats, config, activity, merges, doctor, trust, benchmark, session/entity history, learning report, calibration export, pipeline status (21 tools)
//
// Examples:
//   FLYWHEEL_TOOLS=default                    # 18 tools
//   FLYWHEEL_TOOLS=default,graph              # 29 tools
//   FLYWHEEL_TOOLS=default,graph,wikilinks    # 36 tools
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

export const ALL_CATEGORIES: ToolCategory[] = [
  'search', 'read', 'write',
  'graph', 'schema', 'wikilinks', 'corrections',
  'tasks', 'memory', 'note-ops',
  'temporal', 'diagnostics',
];

export const PRESETS: Record<string, ToolCategory[]> = {
  // Presets
  default: ['search', 'read', 'write', 'tasks', 'memory'],
  full: [...ALL_CATEGORIES],

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
  agent: 'default',      // agent merged into default — memory now included
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

  // memory (2 tools) -- session memory
  memory: 'memory',
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

  // diagnostics (21 tools) -- vault health, stats, config, activity, merges, doctor, trust, benchmark, history, learning report, calibration export, pipeline status
  health_check: 'diagnostics',
  pipeline_status: 'diagnostics',
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
  flywheel_learning_report: 'diagnostics',
  flywheel_calibration_export: 'diagnostics',

};

export const TOOL_TIER: Record<string, ToolTier> = {
  // Tier 1 — always visible (= default preset, 18 tools)
  search: 1,
  init_semantic: 1,
  find_similar: 1,
  get_note_structure: 1,
  get_section_content: 1,
  find_sections: 1,
  vault_add_to_section: 1,
  vault_remove_from_section: 1,
  vault_replace_in_section: 1,
  vault_update_frontmatter: 1,
  vault_create_note: 1,
  vault_undo_last_mutation: 1,
  policy: 1,
  tasks: 1,
  vault_toggle_task: 1,
  vault_add_task: 1,
  memory: 1,
  brief: 1,

  // Tier 2 — context-triggered categories + core diagnostics (33 tools)
  graph_analysis: 2,
  semantic_analysis: 2,
  get_backlinks: 2,
  get_forward_links: 2,
  get_connection_strength: 2,
  list_entities: 2,
  get_link_path: 2,
  get_common_neighbors: 2,
  get_weighted_links: 2,
  get_strong_connections: 2,
  export_graph: 2,
  suggest_wikilinks: 2,
  validate_links: 2,
  wikilink_feedback: 2,
  discover_stub_candidates: 2,
  discover_cooccurrence_gaps: 2,
  suggest_entity_aliases: 2,
  unlinked_mentions_report: 2,
  vault_record_correction: 2,
  vault_list_corrections: 2,
  vault_resolve_correction: 2,
  absorb_as_alias: 2,
  get_context_around_date: 2,
  predict_stale_notes: 2,
  track_concept_evolution: 2,
  temporal_summary: 2,
  health_check: 2,
  pipeline_status: 2,
  get_vault_stats: 2,
  refresh_index: 2,
  flywheel_config: 2,
  server_log: 2,
  flywheel_doctor: 2,

  // Tier 3 — explicit or advanced operations (25 tools)
  vault_schema: 3,
  schema_conventions: 3,
  schema_validate: 3,
  note_intelligence: 3,
  rename_field: 3,
  migrate_field_values: 3,
  rename_tag: 3,
  vault_delete_note: 3,
  vault_move_note: 3,
  vault_rename_note: 3,
  merge_entities: 3,
  get_folder_structure: 3,
  get_all_entities: 3,
  get_unlinked_mentions: 3,
  vault_growth: 3,
  vault_activity: 3,
  suggest_entity_merges: 3,
  dismiss_merge_suggestion: 3,
  vault_init: 3,
  flywheel_trust_report: 3,
  flywheel_benchmark: 3,
  vault_session_history: 3,
  vault_entity_history: 3,
  flywheel_learning_report: 3,
  flywheel_calibration_export: 3,
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
    if (PRESETS.default.includes(category)) return true;
    return activeTierCategories.has(category);
  };

  // Base instruction (always present)
  parts.push(`Flywheel provides tools to search, read, and write an Obsidian vault's knowledge graph.

Tool selection:
  1. "search" is the primary tool for content lookup. One call searches notes,
     entities, and memories. Each result carries: type (note/entity/memory),
     frontmatter, tags, aliases, backlinks (ranked by edge weight × recency),
     outlinks (existence-checked), section provenance, extracted dates, entity
     bridges, confidence scores, content snippet or preview, entity category,
     hub score, and timestamps.
     This is a decision surface — usually enough to answer without reading any files.
  2. For structural, temporal, wikilink, or diagnostic questions, use the
     specialized tools in those categories instead of search with filters.
     See the category sections below.
  3. Escalate to "get_note_structure" only when you need the full markdown content
     or word count. Use "get_section_content" to read one section by heading name.
  4. Start with a broad search: just query text, no filters. Only add folder, tag,
     or frontmatter filters to narrow a second search if needed.`);

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
- "search" without vault searches ALL vaults and merges results (each result has a "vault" field).
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

Escalation: "search" (enriched metadata + content preview) → "get_note_structure"
(full content + word count) → "get_section_content" (single section).
"find_sections" finds headings across the vault by pattern.`);
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

  // Memory category instructions
  if (isCategoryVisible('memory')) {
    parts.push(`
## Memory

"brief" delivers startup context (recent sessions, active entities, stored memories) — call it at
conversation start. "search" finds everything — notes, entities, and memories in one call. "memory"
with action "store" persists observations, facts, or preferences across sessions (e.g. key decisions,
user preferences, project status).`);
  }

  // Graph category instructions
  if (isCategoryVisible('graph')) {
    parts.push(`
## Graph

Use "get_backlinks" for per-backlink surrounding text (reads source files).
Use "get_forward_links" for resolved file paths and alias text.
Use "graph_analysis" for structural queries (hubs, orphans, dead ends).
Use "get_connection_strength" to measure link strength between two entities.
Use "get_link_path" to trace the shortest path between any two entities or notes.
Use "get_strong_connections" to find the strongest or most-connected relationships for an entity.`);
  }
  else if (tieringActive && categories.has('graph')) {
    parts.push(`
**More tools available:** Ask about graph connections, backlinks, hubs, clusters, or paths to unlock graph analysis tools.`);
  }

  // Note-ops category instructions
  if (isCategoryVisible('note-ops')) {
    parts.push(`
## Note Operations

Use "vault_delete_note" to permanently remove a note from the vault.
Use "vault_move_note" to relocate a note to a different folder (updates all backlinks automatically).
Use "vault_rename_note" to change a note's title in place (updates all backlinks automatically).
Use "merge_entities" to consolidate two entity notes into one — adds aliases, merges content, rewires wikilinks, and deletes the source.`);
  }

  // Tasks category instructions
  if (isCategoryVisible('tasks')) {
    parts.push(`
## Tasks

Use "tasks" to query tasks across the vault (filter by status, due date, path). Use "vault_add_task" to create tasks and "vault_toggle_task" to complete them.`);
  }

  // Schema category instructions
  if (isCategoryVisible('schema')) {
    parts.push(`
## Schema

Use "vault_schema" before bulk operations to understand field types, values, and note type distribution.
Use "schema_conventions" to infer frontmatter conventions from folder usage patterns, find notes with incomplete metadata, or suggest field values.
Use "schema_validate" to validate frontmatter against explicit rules or find notes missing expected fields by folder.
Use "note_intelligence" for per-note analysis (completeness, quality, suggestions).`);
  }
  else if (tieringActive && categories.has('schema')) {
    parts.push(`
**Advanced tools:** Ask to unlock schema tools for conventions, validation, migrations, and bulk metadata analysis.`);
  }

  if (isCategoryVisible('wikilinks')) {
    parts.push(`
## Wikilinks

Use "suggest_wikilinks" to analyze draft text for existing entities that should be linked.
Use "validate_links" to find broken or suspicious wikilinks.
Use "discover_stub_candidates", "discover_cooccurrence_gaps", and "unlinked_mentions_report" to surface missing concept notes and high-ROI linking opportunities.`);
  }
  else if (tieringActive && categories.has('wikilinks')) {
    parts.push(`
**More tools available:** Ask about wikilinks, suggestions, stubs, or unlinked mentions to unlock wikilink tools.`);
  }

  if (isCategoryVisible('corrections')) {
    parts.push(`
## Corrections

Use "vault_record_correction" to store a persistent correction when Flywheel made a bad link or edit.
Use "vault_list_corrections" and "vault_resolve_correction" to review or close correction records.
Use "absorb_as_alias" when two names should resolve to the same entity without merging note bodies.`);
  }
  else if (tieringActive && categories.has('corrections')) {
    parts.push(`
**More tools available:** Ask about errors, wrong links, or fixes to unlock correction tools.`);
  }

  if (isCategoryVisible('temporal')) {
    parts.push(`
## Temporal

Use "get_context_around_date" to reconstruct vault activity around a specific date.
Use "predict_stale_notes" to identify important notes that likely need review.
Use "track_concept_evolution" and "temporal_summary" for history, momentum, and review-period summaries.`);
  }
  else if (tieringActive && categories.has('temporal')) {
    parts.push(`
**More tools available:** Ask about time, history, evolution, or stale notes to unlock temporal tools.`);
  }

  if (isCategoryVisible('diagnostics')) {
    parts.push(`
## Diagnostics

Use "health_check", "flywheel_doctor", and "pipeline_status" to inspect server and indexing health.
Use "get_vault_stats", "refresh_index", and "server_log" for operational visibility.
Use "flywheel_config" to inspect runtime configuration and set "tool_tier_override" to "auto", "full", or "minimal" for this vault.`);
  }
  else if (tieringActive && categories.has('diagnostics')) {
    parts.push(`
**More tools available:** Ask about vault health, indexing, status, or configuration to unlock diagnostic tools.
**Advanced tools:** Ask to unlock note operations or deep diagnostics for note mutations, benchmarks, history, graph exports, and learning reports.`);
  }

  // Temporal category instructions
  if (categories.has('temporal')) {
    parts.push(`
## Temporal

Search date filters (modified_after/modified_before) find content within a date range.
Temporal tools analyze *patterns and changes* over time — use them for "what changed" not "what exists":

- "What happened last week/month?" → temporal_summary (activity + entity momentum + maintenance alerts)
- "How has X changed/evolved?" → track_concept_evolution (entity timeline: links, feedback, category shifts)
- "What was I working on around March 15?" → get_context_around_date (notes, entities, activity in a window)
- "What notes need attention?" → predict_stale_notes (importance × staleness → archive/update/review)

temporal_summary composes the other three — use it for weekly/monthly reviews.`);
  }

  // Wikilinks category instructions
  if (categories.has('wikilinks')) {
    parts.push(`
## Wikilinks

Link quality and discovery — not for finding content (use search for that).

- "What should be linked?" → unlinked_mentions_report (vault-wide linking opportunities)
- "Suggest links for this note" → suggest_wikilinks (per-note entity mention analysis)
- "Are any links broken?" → validate_links (dead links + fix suggestions)
- "What topics need their own notes?" → discover_stub_candidates (frequently-linked but non-existent)
- "What entities appear together?" → discover_cooccurrence_gaps (co-occurring but unlinked pairs)
- "Was that link correct?" → wikilink_feedback (accept/reject, improves future suggestions)
- "What aliases am I missing?" → suggest_entity_aliases (acronyms, short forms, alternate names)`);
  }

  // Corrections category instructions
  if (categories.has('corrections')) {
    parts.push(`
## Corrections

When the user says something is wrong — a bad link, wrong entity, wrong category:

"vault_record_correction" persists a correction for future sessions.
"vault_list_corrections" shows pending/applied/dismissed corrections.
"vault_resolve_correction" marks a correction as applied or dismissed.
"absorb_as_alias" fixes a duplicate by absorbing one name as an alias of another (rewrites all links).`);
  }

  // Diagnostics category instructions
  if (categories.has('diagnostics')) {
    parts.push(`
## Diagnostics

- Triage: "health_check" (quick status) → "flywheel_doctor" (active problem detection) → "server_log" (event timeline)
- Stats: "get_vault_stats" (counts), "vault_growth" (trends over time), "get_folder_structure" (organization)
- Activity: "vault_activity" (tool usage), "vault_session_history" (session detail), "vault_entity_history" (entity timeline)
- System: "flywheel_trust_report" (config + boundaries), "flywheel_benchmark" (performance), "flywheel_learning_report" (auto-linking effectiveness)
- Entities: "suggest_entity_merges" (duplicates), "get_all_entities" (full list), "get_unlinked_mentions" (linking opportunities)
- Maintenance: "refresh_index" (rebuild), "flywheel_config" (settings), "vault_init" (first-time setup)`);
  }

  return parts.join('\n');
}
