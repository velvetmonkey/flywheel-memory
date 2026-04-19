# Tools

[← Back to docs](README.md)

Flywheel is easier to use if you start with the job, not the tool name. This guide is split into two parts:

- a quick chooser for common tasks
- a grouped reference covering every current tool and action

For presets and env vars, see [CONFIGURATION.md](CONFIGURATION.md).

- [What Should I Use?](#what-should-i-use)
- [How Tool Choice Works](#how-tool-choice-works)
- [Preset Chooser](#preset-chooser)
- [Tool Families](#tool-families)
- [Worked Examples](#worked-examples)
- [Current Tool Surface](#current-tool-surface)
- [Compatibility Notes](#compatibility-notes)
- [Retired Names You May Still See](#retired-names-you-may-still-see)

## What Should I Use?

| If you want to... | Start here | Why |
|---|---|---|
| Ask the vault a question | `search(action: "query")` | Returns a rich decision surface: frontmatter, snippets, backlinks, outlinks, dates, and section context |
| Find notes by folder, tags, or frontmatter | `find_notes` | Structural listing, not relevance-ranked search |
| Read one note or one section | `read` | Focused note reads after search narrows the target |
| Add or change content in a note | `edit_section` | Safest general write tool |
| Create, move, rename, or delete notes | `note` | File-level note operations |
| Work with tasks | `tasks` and `vault_add_task` | Query/toggle existing tasks or add new ones |
| Understand connections between notes | `graph` | Backlinks, paths, hubs, neighbors, and connection strength |
| Improve links and entity hygiene | `link`, `entity`, `correct` | Suggestions, merges, aliases, and correction tracking |
| Inspect schema or metadata conventions | `schema` | Validation, migrations, field usage, and tag/field cleanup |
| Check vault health or runtime config | `doctor` | Health, pipeline, stats, logs, and config |
| Build semantic search | `init_semantic` | Turns on hybrid retrieval and semantic similarity |
| Save reusable workflows | `policy` | Author, preview, validate, and execute atomic workflows |

## How Tool Choice Works

Tool choice has two layers:

1. **Preset visibility** decides which tool families are available at all.
2. **Routing and feedback** help clients pick among the visible tools.

Preset visibility is controlled by `FLYWHEEL_TOOLS` or `FLYWHEEL_PRESET`.

- `agent` is the focused default surface for everyday questions, note edits, tasks, memory, and diagnostics.
- `power` adds the common maintenance layer: links, corrections, schema work, and note operations.
- `full` exposes every category immediately.
- `auto` is compatibility-only. It behaves like `full` and may expose `discover_tools` for older workflows.

`discover_tools` is guidance, not activation. It can suggest which tool family to try next, but it does not reveal or unlock more tools mid-session.

`FLYWHEEL_TOOL_ROUTING` affects how Flywheel scores or suggests tools for a task. It helps with discovery and routing hints. It does **not** change preset visibility.

Feedback still matters after `T33`. Accepted and rejected suggestions improve reporting, calibration, and future routing analysis. What changed is that feedback no longer changes the visible tool surface during a session.

## Preset Chooser

| Preset | Choose it when... |
|---|---|
| `agent` | You want the focused default surface for day-to-day read/write work |
| `power` | You also want link management, schema cleanup, corrections, and note operations |
| `full` | You want every category visible immediately |
| `auto` | You need backward compatibility with older clients; it behaves like `full` plus `discover_tools` guidance |

The current preset counts are documented in [README.md](../README.md#optional-tool-presets) and [CONFIGURATION.md](CONFIGURATION.md#quick-start).

## Tool Families

### Search And Discovery

#### `search`
- Use when: you are asking a question, looking for concepts, or want notes related to a topic.
- Main actions:
  - `query` for normal retrieval
  - `similar` to find notes related to a known note
- What it returns: ranked results with frontmatter, snippets, section context, backlinks, outlinks, dates, and confidence.
- Reach for this first. Many questions stop here without a follow-up read.

#### `find_notes`
- Use when: you need lists by folder, tag, title, or frontmatter filters.
- Best for: dashboards, audits, enumerations, and “show me all notes where...” questions.

#### `init_semantic`
- Use when: you want hybrid retrieval and semantic similarity.
- What it does: builds the local embeddings index once; after that, search automatically uses it.

#### `discover_tools`
- Availability: compatibility helper in `auto` only.
- Use when: an older workflow expects a tool-discovery step.
- What it does now: returns suggested categories and tools for a natural-language task.
- What it does not do: it does not activate, reveal, or unlock tools.

### Read And Inspect

#### `read`
- `action: "structure"` for note outline, metadata, and optional section content
- `action: "section"` to read one heading by name
- `action: "sections"` to find matching headings across the vault
- Use when: search has found the note and you now need deeper, exact content.

### Write And Edit

#### `edit_section`
- `action: "add"` to append or prepend content under a heading
- `action: "remove"` to delete matching content
- `action: "replace"` to do targeted in-section replacement
- Best default write tool. Supports `dry_run`, `commit`, `skipWikilinks`, and `suggestOutgoingLinks`.

#### `note`
- `action: "create"` to create notes
- `action: "move"` or `action: "rename"` to reorganize notes while updating backlinks
- `action: "delete"` to remove notes with explicit confirmation
- Use when the change is about the note itself rather than one section inside it.

#### `vault_update_frontmatter`
- Use when: you need to set or merge metadata without touching body content.
- Best for: status, owner, dates, tags, type, aliases, and other structured fields.

### Tasks

#### `tasks`
- `action: "list"` to query tasks across a note, folder, or the vault
- `action: "toggle"` to check or uncheck an existing task
- Best for: open/completed filters, due-date audits, and tag-based task queries.

#### `vault_add_task`
- Use when: you want to add a new markdown task under a section.
- Good companion to `tasks(action: "list")` and daily-note workflows.

### Connections, Links, And Entities

#### `graph`
- Use when: the relationship between notes matters as much as the content.
- Main actions:
  - `analyse`
  - `backlinks`
  - `forward_links`
  - `strong_connections`
  - `path`
  - `neighbors`
  - `strength`
  - `cooccurrence_gaps`
  - `export`
- Best for: hub notes, paths between concepts, shared neighbors, structural analysis, and graph export.
- Export tip: use `graph(action: "export", format: "graphml")` for Gephi, yEd, or Cytoscape, or `format: "json"` for programmatic export. Scope large exports with `center_entity`, `depth`, or `max_nodes`.

#### `link`
- Use when: you want to improve or inspect the wikilink layer.
- Main actions:
  - `suggest`
  - `feedback`
  - `unlinked`
  - `validate`
  - `stubs`
  - `dashboard`
  - `unsuppress`
  - `timeline`
  - `layer_timeseries`
  - `snapshot_diff`
- Best for: suggestion workflows, broken-link cleanup, stub/prospect review, and understanding link behavior over time.

#### `entity`
- Use when: you are working at the entity layer rather than directly on note text.
- Main actions:
  - `list`
  - `alias`
  - `suggest_aliases`
  - `merge`
  - `suggest_merges`
  - `dismiss_merge`
  - `dismiss_prospect`
- Best for: alias management, deduplication, entity inventory, and rejecting prospect terms that should stop surfacing as active candidates.

#### `correct`
- Use when: the vault or model behavior needs a durable correction record.
- Main actions:
  - `record`
  - `list`
  - `resolve`
  - `undo`
- Best for: tracking known mistakes and reversing the last correction mutation.

### Schema, Structure, And Intelligence

#### `schema`
- Use when: you need vault-wide metadata discipline.
- Main actions:
  - `overview`
  - `field_values`
  - `conventions`
  - `folders`
  - `rename_field`
  - `rename_tag`
  - `migrate`
  - `validate`
- Best for: field audits, tag cleanup, and bulk metadata migrations.

#### `insights`
- Use when: the question is temporal, stale, or analytical.
- Main actions:
  - `evolution`
  - `staleness`
  - `context`
  - `note_intelligence`
  - `growth`
- Best for: “how has this changed?”, “what was happening around this date?”, and stale-note audits.

### Memory, Health, And Automation

#### `memory`
- Use when: you want lightweight memory separate from note bodies.
- Main actions:
  - `store`
  - `get`
  - `search`
  - `list`
  - `forget`
  - `summarize_session`
  - `brief`
- `memory(action: "brief")` is the current briefing entrypoint. Treat older standalone `brief()` references as legacy.

#### `doctor`
- Use when: you need health, pipeline, config, stats, or logs.
- Main actions:
  - `health`
  - `diagnosis`
  - `stats`
  - `pipeline`
  - `config`
  - `log`
- `doctor(action: "config")` replaces the old standalone config tool in the public interface.

## Worked Examples

### Daily note capture on `agent`

- Preset: `agent`
- Likely first tool: `search(action: "query")` if you need context, then `edit_section(action: "add")`
- Routing matters when the prompt is vague, such as "log this call and add any obvious links"
- Follow-up tool calls are often unnecessary because `edit_section` can write directly and optionally suggest outgoing links

### Note hygiene and cleanup on `power`

- Preset: `power`
- Likely first tool: `link(action: "validate")`, `entity(action: "suggest_merges")`, or `schema(action: "validate")`
- Routing matters when the task blends link cleanup, alias cleanup, and metadata cleanup
- Follow-up tool calls are common because hygiene work often moves from inspection to correction

### Graph or temporal investigation on `full`

- Preset: `full`
- Likely first tool: `search(action: "query")`, then `graph(action: "path" | "neighbors")` or `insights(action: "context" | "evolution")`
- Routing matters when the question is about relationships, change over time, or cross-note evidence
- Follow-up tool calls are normal because graph and temporal work usually starts with search, then drills into structure

#### `refresh_index`
- Use when: the vault index is stale or you made bulk changes outside the watcher.
- What it does: rebuilds the in-memory index and FTS layer from the current vault.

#### `policy`
- Use when: the workflow is multi-step and should be repeatable or atomic.
- Main actions:
  - `list`
  - `validate`
  - `preview`
  - `execute`
  - `author`
  - `revise`
- Best for: “search, then write” automations that you want saved and rerunnable.

## Current Tool Surface

| Category | Tools |
|---|---|
| Search | `search`, `find_notes`, `init_semantic`, `discover_tools` (`auto` compatibility only) |
| Read | `read` |
| Write | `edit_section`, `note`, `vault_update_frontmatter`, `policy` |
| Tasks | `tasks`, `vault_add_task` |
| Graph | `graph` |
| Wikilinks | `link` |
| Corrections | `correct` |
| Note ops | `entity` |
| Schema | `schema` |
| Temporal | `insights` |
| Memory | `memory` |
| Diagnostics | `doctor`, `refresh_index` |

## Compatibility Notes

- `auto` no longer performs progressive disclosure. It is a compatibility preset.
- `discover_tools` is informational only.
- `tool_tier_override` is still accepted in runtime config for compatibility, but it has no runtime effect.
- `doctor(action: "config")` is the supported config interface in current docs.

## Retired Names You May Still See

- `brief()` is now `memory(action: "brief")`
- `flywheel_config` is documented as merged into `doctor(action: "config")`
- other retired tools are listed in [CONFIGURATION.md](CONFIGURATION.md#retired-and-merged-names)
