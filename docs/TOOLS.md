# Tools

The `agent` preset (default) provides search, read, write, tasks, and memory. Use `full` to expose the entire tool surface immediately, or `auto` for progressive disclosure including `discover_tools`. See [CONFIGURATION.md](CONFIGURATION.md) for presets.

- [At a Glance](#at-a-glance)
- [Find Anything](#find-anything)
  - [`search`](#search)
  - [`find_notes`](#find_notes)
  - [`discover_tools`](#discover_tools)
  - [`init_semantic`](#init_semantic)
- [Read Deeper](#read-deeper)
- [Write & Edit](#write--edit)
- [Tasks](#tasks)
  - [`tasks`](#tasks-1)
  - [Task mutations](#task-mutations)
- [Explore Connections](#explore-connections)
  - [`graph`](#graph)
- [Wikilinks & Linking](#wikilinks--linking)
- [Schema & Consistency](#schema--consistency)
  - [`schema`](#schema)
- [Corrections](#corrections)
  - [`correct`](#correct)
- [Organize Notes](#organize-notes)
- [Session Memory](#session-memory)
  - [`memory`](#memory)
  - `memory(action: brief)`
- [Temporal Analysis](#temporal-analysis)
- [Vault Health](#vault-health)
- [Automation](#automation)
  - [`policy`](#policy)

---

## At a Glance

| I want to... | Start here |
|---|---|
| [Ask my vault a question](#find-anything) | `search` |
| [List notes by folder, tag, or frontmatter](#find_notes) | `find_notes` |
| [Read a specific note](#read-deeper) | `read` |
| [Write or edit content](#write--edit) | `edit_section` |
| [Work with tasks](#tasks) | `tasks` |
| [Explore how notes connect](#explore-connections) | `search` (agent); `graph` (power/full) |
| [Improve my wikilinks](#wikilinks--linking) | `link` |
| [Clean up my schema](#schema--consistency) | `schema` |
| [Record corrections](#corrections) | `correct` |
| [Move, rename, or merge notes](#organize-notes) | `note(action: move)` |
| [Persistent memory](#session-memory) | `memory`, `brief` |
| [Analyze temporal patterns](#temporal-analysis) | `insights` |
| [Check vault health](#vault-health) | `doctor` |
| [Automate workflows](#automation) | `policy` |

---

## Find Anything

Start here. `search` is the only tool most questions need.

### `search`

**How it works:** You give it a query. It searches notes, entities, and memories, then *enriches* every result into a decision surface — section provenance, full section content, dates, bridges, confidence — all from an in-memory index and minimal file reads. Results are U-shaped interleaved so the most relevant land at the attention peaks (positions 1 and N). Your AI can reason across results without a single follow-up call.

Every search result includes:

| Field | What it is | Why it matters |
|-------|-----------|----------------|
| **frontmatter** | All YAML metadata (status, owner, amount, dates, etc.) | Answer "how much?" or "what status?" questions without opening the file. |
| **backlinks** | Top 10 notes that link TO this one, ranked by edge weight × recency. `backlink_count` gives the total. | See what references this note — invoices pointing to a client, tickets pointing to a user. |
| **outlinks** | Top 10 notes this one links TO, ranked by edge weight × recency. Includes existence check. `outlink_count` gives the total. | See what this note references — and whether targets exist. |
| **snippet** | Best-matching paragraph (~800 chars, section-aware) | See the relevant passage in context without reading the whole file. |
| **section** | Which heading in the note contains the match | Skip the full read — go straight to the relevant section. |
| **section_content** | Full section text around the match (up to 2,500 chars, top N results) | Read the complete section without a follow-up tool call. Includes heading for provenance. |
| **content_preview** | First ~300 chars of the note body (non-FTS matches) | When there's no snippet (entity/metadata match), you still get body text. |
| **tags, aliases** | Tags and alternative names | Understand categorization and find notes by alternate names. |
| **category, hub_score** | Entity type and graph importance | Know if this is a person, project, or concept — and how central it is in the vault. |
| **snippet_confidence** | How likely this result answers the query (0–1) | Skip low-value results without reading them. |
| **dates_mentioned** | Dates extracted from the matching content | Answer temporal questions without parsing. |
| **bridges** | Entities shared between this result and others | Multi-hop reasoning without follow-up searches. |
| **type** | note / entity / memory | Know what kind of result you're looking at. |

This is the key design: **one search call returns a decision surface — not file paths, but the full neighborhood of each result.** Top results include the full section content around the match, so the AI can reason about context without a follow-up read. That's why Claude can answer "How much have I billed [[Acme Corp]]?" from a single search — the client's frontmatter has the totals, the backlinks show every invoice, and the section content gives the surrounding narrative.

**How matching works** (always start with just a query, no filters):

1. **Full-text search (FTS5)** — BM25 ranking over note content. Handles stemming ("billing" matches "billed"), phrases, and boolean operators.
2. **Entity search** — Matches against the entity database (names, aliases, categories). If "Sarah Chen" is an alias for `users/sarah-chen.md`, it finds it.
3. **Hybrid ranking** — When semantic embeddings are built (via `init_semantic`), results from all three channels are merged using Reciprocal Rank Fusion. Notes can surface by meaning even without keyword overlap.

The enrichment step is the same regardless of how a note matched — every result gets its full frontmatter, backlinks, and outlinks attached. Top results (controlled by `detail_count`, default 5) get full metadata including section expansion (the complete `## Section` around the snippet match); remaining results get lightweight summaries (counts only). Results are U-shaped interleaved so the best items land at positions 1 and N — the attention peaks — while moderate results sit in the middle.

**Routing:**

- **Query present** → content search (FTS5 + semantic + entities, merged).
- **Structural/metadata enumeration** → use `find_notes` instead (folder, tags, frontmatter filters).
- **`prefix: true` + query** → entity autocomplete.

**Parameters:** `action` (`query` default, or `similar`), `query`, `modified_after`, `modified_before`, `limit`, `detail_count`, `sort_by`, `order`, `context_note`, `consumer`, `prefix`, `path` (for `action: similar`), `diversity` (for `action: similar`)

**`action: similar`** — "Show me notes like this one." Pass a `path` and it finds related notes by content overlap (BM25 + semantic when embeddings exist). Filters out notes already linked so only new connections surface. Use `diversity` (0..1, default 0.7) to control MMR diversity.

**Multi-vault behavior**

When the server is configured with `FLYWHEEL_VAULTS`, all tools gain an optional `vault` parameter:
- **No `vault` parameter** — searches all vaults, merges results by relevance. Each result includes a `vault` field.
- **`vault: "name"`** — searches only that vault.

Other tools default to the primary vault (first in `FLYWHEEL_VAULTS`) when `vault` is omitted.

**How ranking works**

FTS5 uses BM25 (Best Match 25) to rank results. Column weights control what matters most:

| Column | Weight | Effect |
|--------|--------|--------|
| frontmatter | 10x | A match in YAML values (status, type, owner) ranks highest |
| title | 5x | Matching the note title is a strong signal |
| content | 1x | Body text matches are the baseline |

This means `search({ query: "active" })` ranks a note with `status: active` in frontmatter 10x higher than a note that merely mentions "active" in body text. Frontmatter values are indexed as searchable text (keys are stripped — only values are searchable).

When semantic embeddings are built, ranking switches to **Reciprocal Rank Fusion** (RRF), which merges four ranked lists — FTS5, semantic similarity, entity matches, and edge-weight context — into a single ordering. A note that ranks well in multiple channels surfaces higher than one that ranks well in only one. Embeddings are enriched with contextual prefixes (note title + tags) so the vector carries document identity alongside content meaning.

**Snippets vs content previews**

Search results include body text in one of two forms:

| Field | When it appears | What it shows |
|-------|----------------|---------------|
| `snippet` | Content search (FTS5 match) | ~64 tokens around matching terms, with `<mark>` tags wrapping matches |
| `content_preview` | Entity or metadata match (no FTS5 hit) | First ~300 characters of the note body |

**Snippets** are contextual and section-aware — the pipeline scores paragraphs by keyword overlap, then re-ranks the top candidates by embedding similarity when semantic search is available. The result is the single best-matching paragraph (~800 chars) with its `## Section` heading for provenance. For top results, the full section content is also attached as `section_content` (up to 2,500 chars).

**Content previews** are positional — always the opening of the note body (after frontmatter — YAML is excluded). They appear when a note matched by entity name, metadata filter, or semantic similarity rather than keyword.

Between `snippet`, `section_content`, and frontmatter, most questions can be answered from the decision surface alone. Escalate to `read` only when you need content outside the matched section.

**What gets indexed**

The full-text index stores every markdown file in the vault, excluding internal directories (`.obsidian`, `.trash`, `.git`, `node_modules`, `templates`, `.claude`, `.flywheel`) and files over 5 MB. Each note is split into four searchable columns:

- **path** — file path (not used for ranking)
- **title** — filename without `.md`
- **frontmatter** — YAML values only (keys are stripped)
- **content** — the entire markdown body after the frontmatter block

The index uses Porter stemming, so "running" matches "run", "runs", and "ran". Rebuild happens automatically when the index is stale (>1 hour), or manually via `refresh_index`.

### `find_notes`

Enumerate notes by metadata — folder, tags, or frontmatter values. Use when you need a structural list, not relevance-ranked search. Returns lightweight note summaries (path, title, modified, frontmatter, tags). Does not perform full-text or semantic search — for concept search, use `search` instead.

**When to use `find_notes` vs `search`:**

| Goal | Tool |
|------|------|
| "What are all notes in folder X?" | `find_notes` |
| "All notes tagged #invoice" | `find_notes` |
| "Notes where status=active" | `find_notes` |
| "Find notes about billing" | `search` |
| "What does the vault say about Sarah?" | `search` |

**Parameters:**

| Parameter | Default | What it does |
|-----------|---------|-------------|
| `folder` | — | Restrict to a folder path (e.g. `"projects/"`) |
| `where` | — | Frontmatter filters as key/value pairs (e.g. `{"status": "active"}`) |
| `has_tag` | — | Notes must have this single tag |
| `has_any_tag` | — | Notes with any of these tags |
| `has_all_tags` | — | Notes with all of these tags |
| `include_children` | `true` | Include subfolder notes when `folder` is set |
| `title_contains` | — | Filter notes whose title contains this substring |
| `modified_after` | — | Only notes modified after this date (ISO 8601) |
| `modified_before` | — | Only notes modified before this date (ISO 8601) |
| `sort_by` | `"modified"` | Sort field: `"modified"`, `"title"`, `"path"` |
| `order` | `"desc"` | Sort order: `"asc"` or `"desc"` |
| `limit` | `50` | Maximum results to return |

### `discover_tools`

Only available in `auto`. Give it a natural-language task and it activates the specialised categories that match the request.

Use this when the fixed default surface is not enough and you want Flywheel to reveal graph, schema, temporal, wikilink, or diagnostic tools on demand.

### `init_semantic`

Builds a local embedding index for your vault. Once built, `search` automatically upgrades to hybrid mode (keywords + meaning) for both `action=query` and `action=similar`, and wikilink suggestions gain semantic scoring. Also enables `semantic_links` in `note_intelligence`.

No parameters — just run it once. Takes a few minutes on large vaults.

---

## Read Deeper

When search gives you the right note but you need more detail. Search already returns enriched metadata and content previews — escalate here only when you need full markdown content or word count.

| Tool | When to use it |
|------|---------------|
| `read` (action=structure) | See a note's heading outline, word count, and optionally its full content. Good after search identifies something interesting. |
| `read` (action=section) | Read just one section of a note by heading name. |
| `read` (action=sections) | Find every section across your vault matching a heading pattern (regex). "Where are all my ## Status sections?" |

---

## Write & Edit

Every write auto-links entities as wikilinks — both known entities (notes and aliases in the vault) and prospective entities detected via pattern matching (proper nouns, CamelCase, acronyms, quoted terms, ticket references). Every write can be previewed with `dry_run: true` and auto-committed to git.

| Tool | What it does |
|------|-------------|
| `edit_section(action: add)` | Append content to a section. Supports formats: plain, bullet, task, numbered, timestamp-bullet. |
| `edit_section(action: remove)` | Remove lines matching a pattern from a section. |
| `edit_section(action: replace)` | Find-and-replace within a section. |
| `vault_update_frontmatter` | Update frontmatter fields (merges with existing). |
| `note(action: create)` | Create a new note. Checks for similar notes and alias collisions before writing. |

**Shared write parameters:**

| Parameter | Default | What it does |
|-----------|---------|-------------|
| `dry_run` | `false` | Preview changes without writing. |
| `commit` | `false` | Auto-commit to git after writing (creates undo point). |
| `skipWikilinks` | `false` | Skip auto-wikilink application on content. |
| `suggestOutgoingLinks` | `false` | Append suggested related wikilinks (e.g., `→ [[React]], [[Migration Plan]]`). Off by default — set `true` for daily notes, journals, or capture-heavy contexts. |

---

## Tasks

### `tasks`

Query tasks across your vault or within a single note. Filter by status, due date, folder, or tag.

**Parameters:** `path`, `status` (open/completed/cancelled/all), `has_due_date`, `folder`, `tag`, `limit`

### Task mutations

| Tool | What it does |
|------|-------------|
| `tasks(action: toggle)` | Check or uncheck a task by matching its text. (Replaces retired `vault_toggle_task`) |
| `vault_add_task` | Add a new task to a section. Auto-links entities, validates content. |

---

## Explore Connections

Understand how your notes relate to each other.

### `graph`

Analyse and navigate the vault link graph. Pass `action` to select:

| Action | What it does |
|--------|-------------|
| `analyse` | Structural analysis: orphans, dead_ends, sources, hubs, stale, immature, emerging_hubs, centrality, cycles |
| `backlinks` | Notes that link to a given path |
| `forward_links` | Notes that a given path links to |
| `strong_connections` | Strongest peer connections for a path |
| `path` | Shortest link path between two notes |
| `neighbors` | Notes that both A and B link to |
| `strength` | Connection strength between two notes |
| `cooccurrence_gaps` | Entity pairs that co-occur but aren't linked |

---

## Wikilinks & Linking

Keep your vault's links accurate and discover missing connections.

### `link`

| Action | What it does |
|--------|-------------|
| `suggest` | Analyze text and suggest where wikilinks should go. |
| `validate` | Find broken links across your vault. |
| `feedback` | Report whether a wikilink suggestion was correct or wrong. |
| `stubs` | Find notes with minimal content that could be enriched. |
| `dashboard` | Overview of link health stats and coverage. |
| `unlinked` | Full report of entity mentions not yet linked as wikilinks. |

---

## Schema & Consistency

Understand and standardize your vault's frontmatter.

### `schema`

| Action | What it does |
|--------|-------------|
| `overview` | Map of every frontmatter field — types, frequency, examples. |
| `field_values` | All unique values for a specific field. |
| `conventions` | Auto-detect frontmatter patterns a folder uses. |
| `folders` | Folder-level schema summary. |
| `validate` | Check notes against expected schema. |
| `note_intelligence` | Deep analysis of a single note: prose patterns, frontmatter suggestions, semantic links. |
| `rename_field` | Rename a frontmatter field across your whole vault. Dry-run by default. |
| `rename_tag` | Rename a tag everywhere — frontmatter and inline. Dry-run by default. |
| `migrate` | Transform field values with a mapping. Dry-run by default. |

---

## Corrections

Record mistakes that should persist across sessions. Flywheel processes these into feedback that improves future suggestions.

### `correct`

| Action | What it does |
|--------|-------------|
| `record` | Record a correction — "that link was wrong", "that category is wrong." Saved permanently. |
| `list` | See pending corrections, optionally filtered by status or entity. |
| `resolve` | Mark a correction as applied or dismissed. |
| `undo` | Undo the last Flywheel write (git soft reset). No params required. |

---

## Organize Notes

Move, rename, delete, or merge — all backlinks update automatically.

### `note`

Move, rename, delete, or create notes — all backlinks update automatically.

| Action | What it does |
|--------|-------------|
| `create` | Create a new note. Checks for similar notes and alias collisions. |
| `move` | Move a note to a new folder. Every linking note updates its path. |
| `rename` | Rename a note in place. Backlinks update to match. |
| `delete` | Delete a note. Shows what links to it first. |

### `entity`

| Action | What it does |
|--------|-------------|
| `list` | Browse all entities grouped by category. |
| `alias` | Make one entity an alias of another — updates all references. |
| `merge` | Merge two notes into one — combines content, updates all wikilinks vault-wide. |
| `suggest_aliases` | Suggest alternative names for entities based on how they're referenced. |

---

## Session Memory

Persistent working memory across sessions. Included in the `agent` preset and always visible under `full`.

### `memory`

Store and retrieve facts, preferences, and observations. Each memory has a key, optional TTL, and confidence score.

| Action | What it does |
|--------|-------------|
| `store` | Save a fact, preference, or observation. Set `ttl_days` for auto-expiry. |
| `get` | Retrieve a specific memory by key. |
| `search` | Full-text search across stored memories. |
| `list` | List all memories. |
| `forget` | Delete a memory. |
| `summarize_session` | Store a session summary with topics and metadata. |

**`action: brief`** — Cold-start context for any session. Builds a token-budgeted summary of recent sessions, active entities, stored memories, pending corrections, and vault pulse. Parameters: `max_tokens`, `focus`.

---

## Temporal Analysis

Understand how your vault changes over time.

### `insights`

| Action | What it does |
|--------|-------------|
| `context` | Reconstruct vault activity around a specific date. |
| `staleness` | Multi-signal staleness prediction with importance scoring. |
| `evolution` | Entity timeline or period digest — link additions, feedback, category changes. |
| `growth` | Track vault size over time — snapshots, history, trends. |
| `note_intelligence` | Deep analysis of a single note (alias from schema). |

---

## Vault Health

Monitor, configure, and maintain your vault.

### `doctor`

| Action | What it does |
|--------|-------------|
| `health` | Run diagnostics and health summary. |
| `stats` | Vault statistics: total notes, links, entities, tags. |
| `pipeline` | Live pipeline activity: current step, progress, recent completions. |
| `config` | Read or update Flywheel configuration. |
| `log` | View recent server activity entries. |

Other diagnostic tools: `refresh_index` (force full index rebuild), `init_semantic` (build embedding index).

---

## Retired Tools

The following standalone tools were retired in T43 B3+ (v2.9.0) and replaced by merged action-param tools:

**Merged into `graph`:** `graph_analysis`, `get_connection_strength`, `get_link_path`, `get_common_neighbors`, `get_backlinks`, `get_forward_links`, `get_strong_connections`

**Merged into `link`:** `suggest_wikilinks`, `validate_links`, `link(action: feedback)`, `discover_stub_candidates`, `suggest_entity_aliases`, `discover_cooccurrence_gaps`

**Merged into `correct`:** `vault_record_correction`, `vault_list_corrections`, `vault_resolve_correction`, `vault_undo_last_mutation`

**Merged into `entity`:** `absorb_as_alias`, `merge_entities`, `list_entities`

**Merged into `schema`:** `vault_schema`, `schema_conventions`, `schema_validate`, `note_intelligence`, `rename_field`, `migrate_field_values`, `rename_tag`

**Merged into `edit_section`:** `vault_add_to_section`, `vault_remove_from_section`, `vault_replace_in_section`

**Merged into `note`:** `vault_create_note`, `vault_delete_note`, `vault_move_note`, `vault_rename_note`

**Merged into `insights`:** `track_concept_evolution`, `predict_stale_notes`, `get_context_around_date`, `vault_growth`

**Merged into `doctor`:** `flywheel_doctor`, `pipeline_status`, `flywheel_config`, `server_log`

**Merged into `memory`:** `brief` (now `memory(action: brief)`)

**Merged into `tasks`:** `vault_toggle_task` (now `tasks(action: toggle)`)

**Removed entirely:** `get_weighted_links`, `get_all_entities`, `vault_session_history`, `vault_entity_history`, `flywheel_benchmark`, `flywheel_calibration_export`, `flywheel_trust_report`, `flywheel_learning_report`, `vault_init`, `tool_selection_feedback`, `semantic_analysis`, `unlinked_mentions_report`

---

## Tool Selection Intelligence

Under `agent` (the default), only the fixed reduced surface is shown at startup (search, read, write, tasks, memory). Under `full`, the full surface is shown immediately.

Under `auto`, Flywheel progressively discloses tools across three tiers via `discover_tools`:

| Tier | Visibility | Categories |
|------|-----------|------------|
| 1 | Always visible | search, read, write, tasks, memory, discover_tools |
| 2 | Context-triggered | graph, wikilinks, temporal, corrections, diagnostics |
| 3 | On-demand | schema, note-ops, deep diagnostics |

`discover_tools` is only available in `auto` mode — call it with a natural-language query to find and activate specialised tools.

### How activation works

When you run `search` or `brief`, Flywheel scans the query for activation signals using two methods:

- **Pattern routing** — regex patterns detect intent keywords. A query mentioning "backlinks" or "hubs" activates the graph category; "schema" or "rename field" activates schema tools.
- **Semantic routing** — the query is embedded and compared against a pre-generated tool description manifest (cosine similarity ≥ 0.30). At most three categories are activated per query.

Both signal types are combined. The highest tier per category wins. Tools become visible for the remainder of the session once activated.

The routing mode is controlled by `FLYWHEEL_TOOL_ROUTING`:

| Mode | Behaviour |
|------|-----------|
| `pattern` | Regex activation only |
| `hybrid` (default when all categories loaded — `full` or `auto`) | Regex + semantic signals combined |
| `semantic` | Semantic-only for hybrid search calls; regex fallback elsewhere |

Semantic routing requires `init_semantic` to have been run. Custom `EMBEDDING_MODEL` users fall back to `pattern` unless the tool manifest was regenerated for that model.

### Feedback

`link(action: feedback)` records whether a wikilink suggestion was correct or wrong. Over time, this builds per-entity accuracy scores that inform suggestion ranking.

---

## Automation

### `policy`

Policies are for repeatable read→write workflows. Direct write tools handle one-off edits; `policy` handles structured multi-step operations that can search the vault and act on the results.

**Use this when:**
- You need to gather information from the vault and then create or update notes based on what you find
- You want a repeatable workflow you can run with different parameters (weekly reviews, invoice chasers, project scaffolds)
- You want to preview what would happen before committing any changes
- You need multiple writes to execute atomically (all succeed or all roll back)

Policies can include `vault_search` steps that query the vault mid-execution. Results are available to subsequent steps via `{{steps.<step_id>.results}}`. See the [Policies guide](POLICIES.md) for data flow details and walkthroughs.

| Action | What it does |
|--------|-------------|
| `list` | See all available policies. |
| `validate` | Check policy YAML against the schema. |
| `preview` | Dry-run showing what would happen. |
| `execute` | Run a policy with variables. |
| `author` | Generate policy YAML from a description. |
| `revise` | Modify an existing policy. |

[Policies guide ->](POLICIES.md) | [Examples catalog ->](POLICY_EXAMPLES.md)



See [CONFIGURATION.md](CONFIGURATION.md) for tool presets, composable bundles, and category mapping.
