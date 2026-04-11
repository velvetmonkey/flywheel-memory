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
  "preset-counts": "| Preset | Tools | Categories | Behaviour |\n|--------|-------|------------|-----------|\n| `agent` (default) | 21 | search, read, write, tasks, memory | Focused tier-1 surface — search, read, write, tasks, memory |\n| `power` | 46 | search, read, write, tasks, memory, wikilinks, corrections, note-ops, schema | Tier 1+2 — agent + wikilinks, corrections, note-ops, schema |\n| `full` | 65 | search, read, write, tasks, memory, wikilinks, corrections, note-ops, schema, graph, diagnostics, temporal | All categories visible at startup |\n| `auto` | 66 | search, read, write, graph, schema, wikilinks, corrections, tasks, memory, note-ops, temporal, diagnostics | All categories, progressive disclosure via `discover_tools` |",
  "category-reference": "| Category | Tools |\n|----------|-------|\n| `search` | find_similar, init_semantic, search |\n| `read` | find_notes, find_sections, get_note_structure, get_section_content |\n| `write` | edit_section, note, policy, vault_add_to_section, vault_create_note, vault_remove_from_section, vault_replace_in_section, vault_undo_last_mutation, vault_update_frontmatter |\n| `graph` | get_backlinks, get_common_neighbors, get_connection_strength, get_forward_links, get_link_path, get_strong_connections, graph, graph_analysis, list_entities |\n| `schema` | migrate_field_values, note_intelligence, rename_field, rename_tag, schema, schema_conventions, schema_validate, vault_schema |\n| `wikilinks` | discover_cooccurrence_gaps, discover_stub_candidates, link, suggest_entity_aliases, suggest_wikilinks, validate_links, wikilink_feedback |\n| `corrections` | absorb_as_alias, correct, vault_list_corrections, vault_record_correction, vault_resolve_correction |\n| `tasks` | tasks, vault_add_task, vault_toggle_task |\n| `memory` | brief, memory |\n| `note-ops` | entity, merge_entities, vault_delete_note, vault_move_note, vault_rename_note |\n| `temporal` | get_context_around_date, predict_stale_notes, track_concept_evolution |\n| `diagnostics` | flywheel_config, flywheel_doctor, insights, pipeline_status, refresh_index, server_log, vault_growth |",
  "preset-category-map": "| Category | `agent` | `power` | `full` | `auto` |\n|----------|:------:|:------:|:------:|:------:|\n| search | Yes | Yes | Yes | Yes |\n| read | Yes | Yes | Yes | Yes |\n| write | Yes | Yes | Yes | Yes |\n| graph |  |  | Yes | Yes |\n| schema |  | Yes | Yes | Yes |\n| wikilinks |  | Yes | Yes | Yes |\n| corrections |  | Yes | Yes | Yes |\n| tasks | Yes | Yes | Yes | Yes |\n| memory | Yes | Yes | Yes | Yes |\n| note-ops |  | Yes | Yes | Yes |\n| temporal |  |  | Yes | Yes |\n| diagnostics |  |  | Yes | Yes |",
  "claude-code-memory-note": "> **Claude Code note:** the `memory` merged tool is suppressed under Claude Code\n> (`CLAUDECODE=1`) because Claude Code ships its own memory plane. Agent preset\n> exposes 20 tools under Claude Code instead of 21; `brief` stays available.",
  "action-param-tools": "- `correct` — `action: record|list|resolve|undo`\n- `edit_section` — `action: add|remove|replace`\n- `entity` — `action: list|alias|suggest_aliases|merge|suggest_merges|dismiss_merge`\n- `graph` — `action: analyse|backlinks|forward_links|strong_connections|path|neighbors|strength|cooccurrence_gaps`\n- `insights` — `action: evolution|staleness|context|note_intelligence|growth`\n- `link` — `action: suggest|feedback|unlinked|validate|stubs|dashboard|unsuppress|timeline|layer_timeseries|snapshot_diff`\n- `memory` — `action: store|get|search|list|forget|summarize_session`\n- `note` — `action: create|move|rename|delete`\n- `policy` — `action: list|validate|preview|execute|author|revise`\n- `schema` — `action: overview|conventions|folders|rename_field|rename_tag|migrate|validate`",
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
