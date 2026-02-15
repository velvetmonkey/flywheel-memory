# Tool Reference

76 tools across 18 categories. All enabled by default (`full` preset).

---

## Search (3 tools)

| Tool | Description |
|------|-------------|
| `search_notes` | Search notes by frontmatter fields, tags, folders, or title. Covers ~80% of Dataview use cases. |
| `full_text_search` | Search note content using SQLite FTS5. Supports stemming, phrases, boolean operators, prefix matching. |
| `search_entities` | Search vault entities (people, projects, technologies) using FTS5 with Porter stemming. |

**Key parameters:**

- `search_notes` -- `where` (frontmatter filters), `has_tag`, `has_any_tag`, `has_all_tags`, `folder`, `title_contains`, `sort_by`, `order`, `limit`
- `full_text_search` -- `query` (FTS5 syntax: `"exact phrase"`, `term1 AND term2`, `prefix*`), `limit`
- `search_entities` -- `query`, `limit`, `prefix` (enable autocomplete mode)

---

## Backlinks (3 tools)

| Tool | Description |
|------|-------------|
| `get_backlinks` | Get all notes that link TO the specified note. Returns source paths and line numbers. |
| `get_forward_links` | Get all notes that this note links TO. Returns targets and whether they exist. |
| `find_bidirectional_links` | Find pairs of notes that link to each other (mutual links). |

---

## Orphans (3 tools)

| Tool | Description |
|------|-------------|
| `find_orphan_notes` | Find notes with no backlinks (disconnected content). |
| `find_dead_ends` | Find notes with backlinks but no outgoing links. |
| `find_sources` | Find notes with outgoing links but no backlinks. |

---

## Hubs (2 tools)

| Tool | Description |
|------|-------------|
| `find_hub_notes` | Find highly connected notes sorted by total connections. |
| `get_connection_strength` | Calculate connection strength between two notes. |

---

## Paths (2 tools)

| Tool | Description |
|------|-------------|
| `get_link_path` | Find the shortest path of links between two notes. |
| `get_common_neighbors` | Find notes that both specified notes link to. |

---

## Temporal (5 tools)

| Tool | Description |
|------|-------------|
| `get_stale_notes` | Find important notes (by backlink count) not modified recently. |
| `get_notes_in_range` | Get all notes modified within a date range. |
| `get_notes_modified_on` | Get all notes modified on a specific date. |
| `get_contemporaneous_notes` | Find notes edited around the same time as a given note. |
| `get_activity_summary` | Get a summary of vault activity over a period. |

---

## Periodic (1 tool)

| Tool | Description |
|------|-------------|
| `detect_periodic_notes` | Detect where the vault keeps daily/weekly/monthly notes. Zero-config convention discovery. |

---

## Schema (13 tools)

| Tool | Description |
|------|-------------|
| `get_frontmatter_schema` | Analyze all frontmatter fields used across the vault. |
| `get_field_values` | Get all unique values for a specific frontmatter field. |
| `find_frontmatter_inconsistencies` | Find fields with multiple types across notes. |
| `validate_frontmatter` | Validate notes against a schema (missing fields, wrong types, invalid values). |
| `find_missing_frontmatter` | Find notes missing expected frontmatter fields by folder. |
| `infer_folder_conventions` | Auto-detect field conventions from vault patterns. |
| `find_incomplete_notes` | Find notes missing fields expected for their folder. |
| `suggest_field_values` | Suggest values for frontmatter fields based on context. |
| `detect_prose_patterns` | Detect extractable patterns in note prose content. |
| `suggest_frontmatter_from_prose` | Suggest frontmatter fields from prose patterns. |
| `suggest_wikilinks_in_frontmatter` | Suggest wikilink values for frontmatter fields. |
| `validate_cross_layer` | Cross-validate frontmatter against prose content. |
| `compute_frontmatter` | Auto-compute derived fields from note content. |

**Field migration tools (also in schema category):**

| Tool | Description |
|------|-------------|
| `rename_field` | Bulk rename a frontmatter field across the vault. Dry-run by default. |
| `migrate_field_values` | Bulk transform field values with mapping rules. Dry-run by default. |

---

## Structure (4 tools)

| Tool | Description |
|------|-------------|
| `get_note_structure` | Get the heading structure and sections of a note. |
| `get_headings` | Get all headings from a note (lightweight). |
| `get_section_content` | Get the content under a specific heading in a note. |
| `find_sections` | Find all sections across vault matching a heading pattern. |

---

## Tasks (Read) (4 tools)

| Tool | Description |
|------|-------------|
| `get_all_tasks` | Get all tasks with filtering by status, folder, and tag. |
| `get_tasks_from_note` | Get all tasks from a specific note. |
| `get_tasks_with_due_dates` | Get tasks that have due dates, sorted by date. |
| `get_incomplete_tasks` | Get all incomplete (open) tasks. Simpler interface. |

---

## Health (10 tools)

| Tool | Description |
|------|-------------|
| `health_check` | Check MCP server health status. Returns vault accessibility, index freshness, recommendations. |
| `get_vault_stats` | Comprehensive vault statistics: notes, links, tags, orphans, folders. |
| `get_folder_structure` | Get vault folder structure with note counts. |
| `refresh_index` | Rebuild the vault index without restarting the server. |
| `rebuild_search_index` | Manually rebuild the FTS5 full-text search index. |
| `get_note_metadata` | Get metadata about a note without reading full content. |
| `get_all_entities` | Get all linkable entities (note titles and aliases). |
| `get_unlinked_mentions` | Find places where an entity is mentioned but not linked. |
| `get_recent_notes` | Get notes modified within the last N days. |
| `find_broken_links` | Find wikilinks that appear to be typos (similar note exists). |

---

## Wikilinks (2 tools)

| Tool | Description |
|------|-------------|
| `suggest_wikilinks` | Analyze text and suggest where wikilinks could be added. |
| `validate_links` | Check wikilinks in a note (or all notes) and report broken links. |

---

## Append (3 tools)

| Tool | Description |
|------|-------------|
| `vault_add_to_section` | Add content to a specific section. Supports formats: plain, bullet, task, numbered, timestamp-bullet. |
| `vault_remove_from_section` | Remove content matching a pattern from a section. |
| `vault_replace_in_section` | Replace content matching a pattern in a section. |

**Key features:** Auto-wikilinks on every write, content validation and normalization, guardrail modes (warn/strict/off), list nesting preservation, outgoing link suggestions.

---

## Frontmatter (2 tools)

| Tool | Description |
|------|-------------|
| `vault_update_frontmatter` | Update frontmatter fields (merge with existing). |
| `vault_add_frontmatter_field` | Add a new frontmatter field (only if it doesn't exist). |

---

## Sections (1 tool)

| Tool | Description |
|------|-------------|
| `vault_list_sections` | List all sections (headings) in a note. Filterable by heading level. |

---

## Notes (4 tools)

| Tool | Description |
|------|-------------|
| `vault_create_note` | Create a new note with optional frontmatter and content. |
| `vault_delete_note` | Delete a note (requires explicit confirmation). |
| `vault_move_note` | Move a note to a new location. Updates all backlinks across the vault. |
| `vault_rename_note` | Rename a note. Updates all backlinks across the vault. |

---

## Git (1 tool)

| Tool | Description |
|------|-------------|
| `vault_undo_last_mutation` | Undo the last git commit (soft reset). Safety checks prevent undoing wrong commit. |

---

## Policy (9 tools)

| Tool | Description |
|------|-------------|
| `policy_validate` | Validate a policy YAML against the schema. |
| `policy_preview` | Dry-run showing what a policy execution would do. |
| `policy_execute` | Run a policy with variables. |
| `policy_author` | Generate policy YAML from a natural language description. |
| `policy_revise` | Modify an existing policy. |
| `policy_list` | List available policies. |
| `policy_diff` | Compare two policy versions. |
| `policy_export` | Export a policy for sharing. |
| `policy_import` | Import a shared policy. |

---

## Tasks (Write) (2 tools)

| Tool | Description |
|------|-------------|
| `vault_toggle_task` | Toggle a task checkbox between checked and unchecked. |
| `vault_add_task` | Add a new task to a section. Supports auto-wikilinks, validation, and guardrails. |

---

## Tool Count by Category

| Category | Count | Type |
|----------|-------|------|
| search | 3 | Read |
| backlinks | 3 | Read |
| orphans | 3 | Read |
| hubs | 2 | Read |
| paths | 2 | Read |
| temporal | 5 | Read |
| periodic | 1 | Read |
| schema | 15 | Read |
| structure | 4 | Read |
| tasks | 6 | Read + Write |
| health | 10 | Read |
| wikilinks | 2 | Read |
| append | 3 | Write |
| frontmatter | 2 | Write |
| sections | 1 | Write |
| notes | 4 | Write |
| git | 1 | Write |
| policy | 9 | Write |
| **Total** | **76** | |
