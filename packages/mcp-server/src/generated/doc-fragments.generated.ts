/**
 * AUTO-GENERATED — do not edit manually.
 * Run: npm run generate:doc-fragments
 *
 * Canonical markdown fragments rendered from config.ts into docs/README/CLAUDE.md
 * via <!-- GENERATED:<id> START/END --> sentinels. The contract test in
 * test/docs/doc-fragments.test.ts diffs this against the current doc contents.
 */

/* eslint-disable */
// prettier-ignore
export const DOC_FRAGMENTS: Record<string, string> = {
  "preset-counts": "| Preset | Tools | Categories | Behaviour |\n|--------|-------|------------|-----------|\n| `agent` (default) | 14 | search, read, write, tasks, memory, diagnostics | Focused tier-1 surface — search, read, write, tasks, memory |\n| `power` | 18 | search, read, write, tasks, memory, diagnostics, wikilinks, corrections, note-ops, schema | Tier 1+2 — agent + wikilinks, corrections, note-ops, schema |\n| `full` | 20 | search, read, write, tasks, memory, diagnostics, wikilinks, corrections, note-ops, schema, graph, temporal | All categories visible at startup |\n| `auto` | 21 | search, read, write, graph, schema, wikilinks, corrections, tasks, memory, note-ops, temporal, diagnostics | Full surface + informational `discover_tools` helper |",
  "category-reference": "| Category | Tools |\n|----------|-------|\n| `search` | init_semantic, search |\n| `read` | find_notes, note_read, read |\n| `write` | edit_section, note, policy, vault_update_frontmatter |\n| `graph` | graph |\n| `schema` | schema |\n| `wikilinks` | link |\n| `corrections` | correct |\n| `tasks` | tasks, vault_add_task |\n| `memory` | memory |\n| `note-ops` | entity |\n| `temporal` | insights |\n| `diagnostics` | doctor, refresh_index |",
  "preset-category-map": "| Category | `agent` | `power` | `full` | `auto` |\n|----------|:------:|:------:|:------:|:------:|\n| search | Yes | Yes | Yes | Yes |\n| read | Yes | Yes | Yes | Yes |\n| write | Yes | Yes | Yes | Yes |\n| graph |  |  | Yes | Yes |\n| schema |  | Yes | Yes | Yes |\n| wikilinks |  | Yes | Yes | Yes |\n| corrections |  | Yes | Yes | Yes |\n| tasks | Yes | Yes | Yes | Yes |\n| memory | Yes | Yes | Yes | Yes |\n| note-ops |  | Yes | Yes | Yes |\n| temporal |  |  | Yes | Yes |\n| diagnostics | Yes | Yes | Yes | Yes |",
  "claude-code-memory-note": "> **Claude Code note:** the `memory` merged tool is suppressed under Claude Code\n> (`CLAUDECODE=1`) because Claude Code ships its own memory plane. Agent preset\n> exposes 13 tools under Claude Code instead of 14; `brief` stays available.",
  "action-param-tools": "- `correct` — `action: record|list|resolve|undo`\n- `doctor` — `action: health|diagnosis|stats|pipeline|config|log`\n- `edit_section` — `action: add|remove|replace`\n- `entity` — `action: list|alias|suggest_aliases|merge|suggest_merges|dismiss_merge`\n- `graph` — `action: analyse|backlinks|forward_links|strong_connections|path|neighbors|strength|cooccurrence_gaps`\n- `insights` — `action: evolution|staleness|context|note_intelligence|growth`\n- `link` — `action: suggest|feedback|unlinked|validate|stubs|dashboard|unsuppress|timeline|layer_timeseries|snapshot_diff`\n- `memory` — `action: store|get|search|list|forget|summarize_session|brief`\n- `note` — `action: create|move|rename|delete`\n- `note_read` — `action: structure|section|sections`\n- `policy` — `action: list|validate|preview|execute|author|revise`\n- `read` — `action: structure|section|sections`\n- `schema` — `action: overview|field_values|conventions|folders|rename_field|rename_tag|migrate|validate`\n- `search` — `action: query|similar`\n- `tasks` — `action: list|toggle`",
  "retired-tools": "- `dismiss_merge_suggestion`\n- `flywheel_benchmark`\n- `flywheel_calibration_export`\n- `flywheel_learning_report`\n- `flywheel_trust_report`\n- `get_all_entities`\n- `get_folder_structure`\n- `get_unlinked_mentions`\n- `get_vault_stats`\n- `health_check`\n- `semantic_analysis`\n- `suggest_entity_merges`\n- `temporal_summary`\n- `tool_selection_feedback`\n- `unlinked_mentions_report`\n- `vault_activity`\n- `vault_entity_history`\n- `vault_init`\n- `vault_session_history`",
};

/** Fragment IDs as a readonly tuple for exhaustiveness checks. */
export const DOC_FRAGMENT_IDS = [
  "preset-counts",
  "category-reference",
  "preset-category-map",
  "claude-code-memory-note",
  "action-param-tools",
  "retired-tools",
] as const;
