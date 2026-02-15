# Tool Reference

39 tools across 15 categories. All enabled by default (`full` preset).

---

## Search & Discovery (1 tool)

### `search`

Unified search across metadata, content, and entities. The `scope` parameter controls what to search.

| Scope | Description |
|-------|-------------|
| `metadata` | Search frontmatter fields, tags, folders, titles. Use `where`, `has_tag`, `has_any_tag`, `has_all_tags`, `folder`, `title_contains` filters. |
| `content` | Full-text search using SQLite FTS5. Supports stemming, phrases (`"exact phrase"`), boolean operators (`term1 AND term2`), prefix matching (`prefix*`). |
| `entities` | Search vault entities (people, projects, technologies) with FTS5 Porter stemming. Supports `prefix` mode for autocomplete. |
| `all` | (default) Tries metadata first, falls back to content search. |

**Key parameters:** `query`, `scope`, `where` (frontmatter key-value filters), `has_tag`, `has_any_tag`, `has_all_tags`, `folder`, `title_contains`, `modified_after`, `modified_before`, `sort_by` (modified/created/title), `order` (asc/desc), `prefix` (entity autocomplete), `limit`

---

## Graph Navigation (2 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_backlinks` | Get all notes that link TO the specified note. Returns source paths and line numbers. | `path`, `include_context`, `include_bidirectional`, `limit`, `offset` |
| `get_forward_links` | Get all notes that this note links TO. Returns targets and whether they exist. | `path` |

---

## Graph Analysis (4 tools)

### `graph_analysis`

Analyze vault link graph structure. The `analysis` parameter selects the mode.

| Analysis | Description | Key Parameters |
|----------|-------------|----------------|
| `orphans` | Notes with no backlinks (disconnected content) | `folder`, `limit`, `offset` |
| `dead_ends` | Notes with backlinks but no outgoing links | `folder`, `min_backlinks`, `limit`, `offset` |
| `sources` | Notes with outgoing links but no backlinks | `folder`, `min_outlinks`, `limit`, `offset` |
| `hubs` | Highly connected notes sorted by total connections | `min_links`, `limit`, `offset` |
| `stale` | Important notes (by backlink count) not recently modified | `days` (required), `min_backlinks`, `limit` |

### Other graph tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_connection_strength` | Calculate connection strength between two notes based on various factors | `note_a`, `note_b` |
| `get_link_path` | Find the shortest path of links between two notes | `from`, `to`, `max_depth` |
| `get_common_neighbors` | Find notes that both specified notes link to | `note_a`, `note_b` |

---

## Note Structure (4 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `get_note_metadata` | Get metadata (frontmatter, tags, link counts) without reading full content | `path`, `include_word_count` |
| `get_note_structure` | Get heading structure, sections hierarchy, word count, line count | `path`, `include_content` |
| `get_section_content` | Get the content under a specific heading in a note | `path`, `heading`, `include_subheadings` |
| `find_sections` | Find all sections across vault matching a heading pattern (regex) | `pattern`, `folder`, `limit`, `offset` |

---

## Schema & Intelligence (5 tools)

### `vault_schema`

Analyze and validate vault frontmatter schema. The `analysis` parameter selects the mode.

| Analysis | Description | Key Parameters |
|----------|-------------|----------------|
| `overview` | Schema of all frontmatter fields across the vault | `limit` |
| `field_values` | All unique values for a specific field | `field` (required) |
| `inconsistencies` | Fields with multiple types across notes | |
| `validate` | Validate notes against a provided schema | `schema` (required), `folder` |
| `missing` | Find notes missing expected fields by folder | `folder_schemas` (required) |
| `conventions` | Auto-detect metadata conventions for a folder | `folder`, `min_confidence` |
| `incomplete` | Find notes missing expected fields (inferred from peers) | `folder`, `min_frequency`, `limit`, `offset` |
| `suggest_values` | Suggest values for a field based on usage | `field` (required), `folder`, `existing_frontmatter` |

### `note_intelligence`

Analyze a note for patterns, suggestions, and consistency. The `analysis` parameter selects the mode.

| Analysis | Description | Key Parameters |
|----------|-------------|----------------|
| `prose_patterns` | Find "Key: Value" or "Key: [[wikilink]]" patterns in prose | `path` (required) |
| `suggest_frontmatter` | Suggest YAML frontmatter from detected prose patterns | `path` (required) |
| `suggest_wikilinks` | Find frontmatter values that could be wikilinks | `path` (required) |
| `cross_layer` | Check consistency between frontmatter and prose references | `path` (required) |
| `compute` | Auto-compute derived fields (word_count, link_count, etc.) | `path` (required), `fields` |
| `all` | Run all analyses and return combined result | `path` (required), `fields` |

### Field migration tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `rename_field` | Bulk rename a frontmatter field across notes. Dry-run by default. | `old_name`, `new_name`, `folder`, `dry_run` |
| `migrate_field_values` | Bulk transform field values with mapping rules. Dry-run by default. | `field`, `mapping`, `folder`, `dry_run` |
| `rename_tag` | Bulk rename a tag across all notes (frontmatter and inline). Supports hierarchical rename. Dry-run by default. | `old_tag`, `new_tag`, `rename_children`, `folder`, `dry_run`, `commit` |

---

## Wikilinks (3 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `suggest_wikilinks` | Analyze text and suggest where wikilinks could be added. Finds mentions of existing note titles and aliases. | `text`, `limit`, `offset` |
| `validate_links` | Check wikilinks in a note (or all notes) and report broken links. Suggests fixes for typos. | `path` (optional, omit for all), `typos_only`, `limit`, `offset` |
| `wikilink_feedback` | Report and query wikilink accuracy feedback. Modes: report, list, stats. Auto-suppresses entities with >=30% false positive rate. | `mode` (report/list/stats), `entity`, `note_path`, `context`, `correct`, `limit` |

---

## Tasks (3 tools)

### `tasks`

Unified task query tool. Use `path` to scope to a single note, `has_due_date` to find tasks with due dates (sorted by date), or query vault-wide.

**Key parameters:** `path`, `status` (open/completed/cancelled/all), `has_due_date`, `folder`, `tag`, `limit`, `offset`

### Mutation tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `vault_toggle_task` | Toggle a task checkbox between checked and unchecked | `path`, `task` (text to match), `section`, `commit` |
| `vault_add_task` | Add a new task to a section. Supports auto-wikilinks, validation, and guardrails. | `path`, `section`, `task`, `position`, `completed`, `commit` |

---

## Content Mutations (3 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `vault_add_to_section` | Add content to a specific section. Set `create_if_missing=true` to auto-create the note from template. | `path`, `section`, `content`, `create_if_missing`, `position`, `format` (plain/bullet/task/numbered/timestamp-bullet), `commit` |
| `vault_remove_from_section` | Remove content matching a pattern from a section | `path`, `section`, `pattern`, `mode` (first/last/all), `useRegex`, `commit` |
| `vault_replace_in_section` | Replace content matching a pattern in a section | `path`, `section`, `search`, `replacement`, `mode` (first/last/all), `useRegex`, `commit` |

**Shared features:** Auto-wikilinks on every write, content validation and normalization, guardrail modes (warn/strict/off), list nesting preservation, outgoing link suggestions.

---

## Frontmatter (1 tool)

### `vault_update_frontmatter`

Update frontmatter fields in a note (merge with existing). Set `only_if_missing=true` to only add fields that don't already exist.

**Key parameters:** `path`, `frontmatter` (JSON object), `only_if_missing`, `commit`

---

## Note Management (4 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `vault_create_note` | Create a new note with optional frontmatter and content. Includes preflight checks for similar notes and alias collisions. | `path`, `content`, `frontmatter`, `overwrite`, `commit` |
| `vault_delete_note` | Delete a note. Shows backlink warnings before deletion. | `path`, `confirm` (required), `commit` |
| `vault_move_note` | Move a note to a new location. Updates all backlinks across the vault. | `oldPath`, `newPath`, `updateBacklinks`, `commit` |
| `vault_rename_note` | Rename a note in place. Updates all backlinks across the vault. | `path`, `newTitle`, `updateBacklinks`, `commit` |

---

## Vault Health (7 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `health_check` | Check MCP server health. Returns vault accessibility, index freshness, periodic note detection, config, last index rebuild info, and recommendations. | (none) |
| `get_vault_stats` | Comprehensive vault statistics: notes, links, tags, orphans, folders. Includes 7-day recent activity summary. | (none) |
| `get_folder_structure` | Get vault folder structure with note counts and subfolder counts. | (none) |
| `refresh_index` | Rebuild the vault index and FTS5 search index without restarting the server. | (none) |
| `get_all_entities` | Get all linkable entities (note titles and aliases). | `include_aliases`, `limit` |
| `get_unlinked_mentions` | Find places where an entity is mentioned but not linked. | `entity`, `limit` |
| `vault_growth` | Track vault growth over time. Modes: current (live snapshot), history (time series), trends (deltas), index_activity (rebuild history). | `mode` (current/history/trends/index_activity), `metric`, `days_back`, `limit` |

---

## Policy Automation (1 tool)

### `policy`

Manage vault policies. The `action` parameter selects the operation.

| Action | Description | Key Parameters |
|--------|-------------|----------------|
| `list` | List all available policies | (none) |
| `validate` | Validate policy YAML against the schema | `yaml` (required) |
| `preview` | Dry-run showing what a policy execution would do | `policy` (name or YAML), `variables` |
| `execute` | Run a policy with variables | `policy` (name or YAML), `variables`, `commit` |
| `author` | Generate policy YAML from a description | `name`, `description`, `steps`, `authorVariables`, `conditions`, `save` |
| `revise` | Modify an existing policy | `policy` (name), `changes`, `save` |

---

## Undo (1 tool)

### `vault_undo_last_mutation`

Undo the last git commit (typically the last Flywheel mutation). Performs a soft reset with safety checks to prevent undoing the wrong commit.

**Key parameters:** `confirm` (required), `hash` (optional, prevents undoing wrong commit)

---

## Category-to-Preset Mapping

| Category | Tools | Included in `full` | Included in `minimal` |
|----------|------:|:-------------------:|:---------------------:|
| search | 1 | Yes | Yes |
| backlinks | 2 | Yes | |
| orphans | 1 | Yes | |
| hubs | 1 | Yes | |
| paths | 2 | Yes | |
| schema | 5 | Yes | |
| structure | 4 | Yes | Yes |
| tasks | 3 | Yes | |
| health | 7 | Yes | |
| wikilinks | 3 | Yes | |
| append | 3 | Yes | Yes |
| frontmatter | 1 | Yes | Yes |
| notes | 4 | Yes | Yes |
| git | 1 | Yes | |
| policy | 1 | Yes | |
| **Total** | **39** | **39** | **13** |
