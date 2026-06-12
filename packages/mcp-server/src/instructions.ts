/**
 * Server instruction generation (arch-review S12 — extracted verbatim from
 * config.ts).
 *
 * Lives apart from config.ts because generateInstructions has a runtime edge:
 * it calls the DB-backed hasEmbeddingsIndex() to decide whether to emit the
 * init_semantic onboarding hint. config.ts stays pure configuration.
 *
 * Output is pinned byte-for-byte by test/catalog/initialize-freeze.test.ts —
 * do not alter the assembled prose here without regenerating those fixtures.
 */

import { hasEmbeddingsIndex } from './core/read/embeddings.js';
import { PRESETS, type ToolCategory } from './config.js';
import type { VaultRegistry } from './vault-registry.js';

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
created with the correct structure and frontmatter for this vault. This matters most for *structured
work items* — tickets, project notes, formal vault entries — where a policy carries integrations and
audit trail (e.g. \`create-cherwell\` for Cherwell tickets). Use a matching policy via \`policy(action="execute")\`
instead of raw write tools when one exists. Fall back to direct tools only when no policy fits.

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
tasks) into live-write workflows with compensating rollback on failure. Successful runs can optionally
be committed as a single git commit.

Actions: "list" saved policies (do this first), "execute" with variables, "author" a policy
from a description, "validate" the YAML, "preview" (dry-run), "revise" to modify.

Key capabilities:
  - **Variables** — parameterize policies (string, number, boolean, array, enum with defaults).
  - **Conditions** — branch on file/section/frontmatter state (skip steps, don't abort).
  - **Templates** — interpolate variables, builtins ({{today}}, {{now}}), and prior step outputs.
  - **Rollback semantics** — failures trigger compensating rollback; rollback failure is reported explicitly.
  - **Single commit option** — successful executions can be committed as one git commit.

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
**More tools available:** Call \`discover_tools({ query: "your need" })\` to find specialized tools for graph analysis, wikilinks, diagnostics, schema, temporal analysis, note operations, and more. It is informational only and does not activate or reveal anything beyond the currently registered tool surface.`);
  }

  return parts.join('\n');
}
