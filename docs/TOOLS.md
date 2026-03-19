# Tools

64 tools. Most questions only need one: **search**.

---

## At a Glance

| I want to... | Start here | Tools |
|---|---|--:|
| [Ask my vault a question](#find-anything) | `search` | 3 |
| [Read a specific note](#read-deeper) | `get_note_structure` | 3 |
| [Write or edit content](#write--edit) | `vault_add_to_section` | 5 |
| [Work with tasks](#tasks) | `tasks` | 3 |
| [Explore how notes connect](#explore-connections) | `get_backlinks`, `graph_analysis`, `semantic_analysis` | 10 |
| [Improve my wikilinks](#wikilinks--linking) | `suggest_wikilinks` | 7 |
| [Clean up my schema](#schema--consistency) | `vault_schema`, `schema_conventions`, `schema_validate` | 7 |
| [Record corrections](#corrections) | `vault_record_correction` | 4 |
| [Move, rename, or merge notes](#organize-notes) | `vault_move_note` | 4 |
| [Build an autonomous agent](#agent-memory) | `memory`, `recall`, `brief` | 3 |
| [Check vault health](#vault-health) | `health_check` | 13 |
| [Automate workflows](#automation) | `policy` | 2 |

---

## Find Anything

Start here. `search` is the only tool most questions need.

### `search`

**How it works:** You give it a query. It finds matching notes, then *enriches* every result with the note's full graph context — all from an in-memory index, with zero file reads.

Every search result includes:

| Field | What it is | Why it matters |
|-------|-----------|----------------|
| **frontmatter** | All YAML metadata (status, owner, amount, dates, etc.) | Answer "how much?" or "what status?" questions without opening the file. |
| **backlinks** | Top 10 notes that link TO this one, ranked by edge weight × recency. `backlink_count` gives the total. | See what references this note — invoices pointing to a client, tickets pointing to a user. Use `get_backlinks` for the full list. |
| **outlinks** | Top 10 notes this one links TO, ranked by edge weight × recency. Includes existence check. `outlink_count` gives the total. | See what this note references — and whether targets exist. |
| **snippet** | The passage that matched your query (content search) | See the relevant paragraph in context without reading the whole file. |
| **content_preview** | First ~300 chars of the note body (non-FTS matches) | When there's no snippet (entity/metadata match), you still get body text. |
| **tags, aliases** | Tags and alternative names | Understand categorization and find notes by alternate names. |
| **category, hub_score** | Entity type and graph importance | Know if this is a person, project, or concept — and how central it is in the vault. |

This is the key design: **one search call returns not just file paths, but the full neighborhood of each result.** That's why Claude can answer "How much have I billed Acme Corp?" from a single search — the client's frontmatter has the totals, and the backlinks show every invoice.

**How matching works** (always start with just a query, no filters):

1. **Full-text search (FTS5)** — BM25 ranking over note content. Handles stemming ("billing" matches "billed"), phrases, and boolean operators.
2. **Entity search** — Matches against the entity database (names, aliases, categories). If "Sarah Chen" is an alias for `users/sarah-chen.md`, it finds it.
3. **Hybrid ranking** — When semantic embeddings are built (via `init_semantic`), results from all three channels are merged using Reciprocal Rank Fusion. Notes can surface by meaning even without keyword overlap.

The enrichment step is the same regardless of how a note matched — every result gets its full frontmatter, backlinks, and outlinks attached. Top results (controlled by `detail_count`, default 5) get full metadata; remaining results get lightweight summaries (counts only).

**Routing:**

- **Query present** → content search (FTS5 + semantic + entities, merged). Add `folder` to post-filter results.
- **No query, filters only** → metadata search (frontmatter, tags, folder, dates).
- **`prefix: true` + query** → entity autocomplete.

**Common parameters:** `query`, `where` (frontmatter filters), `has_tag`, `folder`, `modified_after`, `sort_by`, `limit`, `detail_count`, `context_note`

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

When semantic embeddings are built, ranking switches to **Reciprocal Rank Fusion** (RRF), which merges four ranked lists — FTS5, semantic similarity, entity matches, and edge-weight context — into a single ordering. A note that ranks well in multiple channels surfaces higher than one that ranks well in only one.

**Snippets vs content previews**

Search results include body text in one of two forms:

| Field | When it appears | What it shows |
|-------|----------------|---------------|
| `snippet` | Content search (FTS5 match) | ~64 tokens around matching terms, with `<mark>` tags wrapping matches |
| `content_preview` | Entity or metadata match (no FTS5 hit) | First ~300 characters of the note body |

**Snippets** are contextual — FTS5 finds the passage where your query terms appear and extracts a window around them. A 10,000-word note produces a snippet of ~50–80 words focused on the match. Multiple disjoint matches are separated by `...`.

**Content previews** are positional — always the opening of the note body (after frontmatter — YAML is excluded). They appear when a note matched by entity name, metadata filter, or semantic similarity rather than keyword. Both are read from SQLite with zero filesystem I/O.

Neither field shows the full document. To read the complete note, escalate to `get_note_structure`.

**What gets indexed**

The full-text index stores every markdown file in the vault, excluding internal directories (`.obsidian`, `.trash`, `.git`, `node_modules`, `templates`, `.claude`, `.flywheel`) and files over 5 MB. Each note is split into four searchable columns:

- **path** — file path (not used for ranking)
- **title** — filename without `.md`
- **frontmatter** — YAML values only (keys are stripped)
- **content** — the entire markdown body after the frontmatter block

The index uses Porter stemming, so "running" matches "run", "runs", and "ran". Rebuild happens automatically when the index is stale (>1 hour), or manually via `refresh_index`.

### `find_similar`

"Show me notes like this one." Give it a note path, and it finds related notes by content overlap. Filters out notes already linked to it, so you only see new connections.

**Parameters:** `path`, `limit`, `exclude_linked`

### `init_semantic`

Builds a local embedding index for your vault. Once built, `search` and `find_similar` automatically upgrade to hybrid mode (keywords + meaning), and wikilink suggestions gain semantic scoring. Also unlocks `semantic_analysis` (clusters, bridges) and `semantic_links` in `note_intelligence`.

No parameters — just run it once. Takes a few minutes on large vaults.

---

## Read Deeper

When search gives you the right note but you need more detail. Search already returns enriched metadata and content previews — escalate here only when you need full markdown content or word count.

| Tool | When to use it |
|------|---------------|
| `get_note_structure` | See a note's heading outline, word count, and optionally its full content. Good after search identifies something interesting. |
| `get_section_content` | Read just one section of a note by heading name. |
| `find_sections` | Find every section across your vault matching a heading pattern (regex). "Where are all my ## Status sections?" |

---

## Write & Edit

Every write auto-links known entities as wikilinks. Every write can be previewed with `dry_run: true` and auto-committed to git.

| Tool | What it does |
|------|-------------|
| `vault_add_to_section` | Append content to a section. Set `create_if_missing: true` to create the note from a template if it doesn't exist — one call to capture a daily log entry. Supports formats: plain, bullet, task, numbered, timestamp-bullet. |
| `vault_remove_from_section` | Remove lines matching a pattern from a section. |
| `vault_replace_in_section` | Find-and-replace within a section. If the target isn't found, the error includes closest matches and suggestions. |
| `vault_update_frontmatter` | Update frontmatter fields (merges with existing). Set `only_if_missing: true` to only fill in gaps. |
| `vault_create_note` | Create a new note. Checks for similar notes and alias collisions before writing. With semantic embeddings, also warns about potential duplicates. |

**Shared write parameters:**

| Parameter | Default | What it does |
|-----------|---------|-------------|
| `dry_run` | `false` | Preview changes without writing. |
| `commit` | `true` | Auto-commit to git after writing. |

---

## Tasks

### `tasks`

Query tasks across your vault or within a single note. Filter by status, due date, folder, or tag.

**Parameters:** `path`, `status` (open/completed/cancelled/all), `has_due_date`, `folder`, `tag`, `limit`

### Task mutations

| Tool | What it does |
|------|-------------|
| `vault_toggle_task` | Check or uncheck a task by matching its text. |
| `vault_add_task` | Add a new task to a section. Auto-links entities, validates content. |

---

## Explore Connections

Understand how your notes relate to each other.

### `graph_analysis`

Run different analyses on your vault's link graph:

| Analysis | What it finds |
|----------|--------------|
| `orphans` | Notes nothing links to — disconnected content. |
| `dead_ends` | Notes with incoming links but no outgoing ones. |
| `sources` | Notes that link out but nothing links to them. |
| `hubs` | The most-connected notes in your vault. |
| `stale` | Important notes (many backlinks) that haven't been updated recently. |
| `immature` | Thin notes — low word count, few links, sparse frontmatter. |
| `emerging_hubs` | Entities gaining connections fastest. |

### `semantic_analysis`

Embedding-based vault analysis (requires `init_semantic`).

| Type | What it finds |
|------|--------------|
| `clusters` | Groups of notes that are about similar topics. |
| `bridges` | Notes that are semantically similar but have no link path between them. |

### Link detail tools

| Tool | When to use it |
|------|---------------|
| `get_backlinks` | Every note that links TO this one — with per-backlink surrounding text (reads source files). |
| `get_forward_links` | Every note this one links TO — with resolved file paths and alias text. |

### Other graph tools

| Tool | When to use it |
|------|---------------|
| `list_entities` | Browse all entities with filtering by category, folder, or search term. |
| `get_connection_strength` | How strongly are two notes connected? Considers links, shared neighbors, co-occurrence. |
| `get_link_path` | Shortest path between two notes through the link graph. |
| `get_common_neighbors` | Notes that both A and B link to — find what they have in common. |
| `get_weighted_links` | Outgoing links ranked by connection strength. |
| `get_strong_connections` | Bidirectional connections ranked by combined weight. |

---

## Wikilinks & Linking

Keep your vault's links accurate and discover missing connections.

| Tool | What it does |
|------|-------------|
| `suggest_wikilinks` | Analyze text and suggest where wikilinks should go. With semantic embeddings, finds conceptual matches even without keyword overlap. |
| `validate_links` | Find broken links across your vault. Suggests fixes for typos. |
| `wikilink_feedback` | Report whether a wikilink suggestion was correct or wrong. The system learns from feedback and auto-suppresses entities with high false-positive rates. |
| `discover_stub_candidates` | Find notes with minimal content that could be enriched. |
| `discover_cooccurrence_gaps` | Entity pairs that appear together often but aren't linked yet. |
| `suggest_entity_aliases` | Suggest alternative names for entities based on how they're referenced. |
| `unlinked_mentions_report` | Full report of entity mentions that aren't linked as wikilinks. |

---

## Schema & Consistency

Understand and standardize your vault's frontmatter.

### `vault_schema`

Inspect vault frontmatter schema:

| Analysis | What it does |
|----------|-------------|
| `overview` | Map of every frontmatter field across your vault — types, frequency, examples. |
| `field_values` | All unique values for a specific field. "What statuses are people using?" |
| `inconsistencies` | Fields where different notes use different types (string vs number, etc.). |
| `contradictions` | Conflicting frontmatter across notes referencing the same entity. |

### `schema_conventions`

Infer frontmatter conventions from usage patterns:

| Analysis | What it does |
|----------|-------------|
| `conventions` | Auto-detect what frontmatter patterns a folder uses. |
| `incomplete` | Notes missing fields their peers have. |
| `suggest_values` | Suggest values for a field based on what's already in use. |

### `schema_validate`

Validate frontmatter against rules:

| Analysis | What it does |
|----------|-------------|
| `validate` | Check notes against a schema you provide. |
| `missing` | Find notes missing expected fields for their folder. |

### `note_intelligence`

Deep analysis of a single note:

| Analysis | What it does |
|----------|-------------|
| `prose_patterns` | Find "Key: Value" patterns buried in prose that should be frontmatter. |
| `suggest_frontmatter` | Generate frontmatter YAML from detected patterns. |
| `suggest_wikilinks` | Find frontmatter values that could link to existing notes. |
| `cross_layer` | Check consistency between frontmatter and what the prose says. |
| `compute` | Auto-compute derived fields (word_count, link_count, etc.). |
| `semantic_links` | Find semantically related entities not yet linked (requires embeddings). |
| `all` | Run everything at once. |

### Bulk migrations

| Tool | What it does |
|------|-------------|
| `rename_field` | Rename a frontmatter field across your whole vault. Dry-run by default. |
| `migrate_field_values` | Transform field values with a mapping (e.g., "active" → "in-progress"). Dry-run by default. |
| `rename_tag` | Rename a tag everywhere — frontmatter and inline. Supports hierarchical rename. Dry-run by default. |

---

## Corrections

Record mistakes that should persist across sessions. Flywheel processes these into feedback that improves future suggestions.

| Tool | What it does |
|------|-------------|
| `vault_record_correction` | "That link was wrong" or "That category is wrong." Saved permanently. |
| `vault_list_corrections` | See pending corrections, optionally filtered by status or entity. |
| `vault_resolve_correction` | Mark a correction as applied or dismissed. |
| `absorb_as_alias` | Make one entity an alias of another — updates all references and deprecates the source note. |

---

## Organize Notes

Move, rename, delete, or merge — all backlinks update automatically.

| Tool | What it does |
|------|-------------|
| `vault_move_note` | Move a note to a new folder. Every note linking to it updates its path. |
| `vault_rename_note` | Rename a note in place. Backlinks update to match. |
| `vault_delete_note` | Delete a note. Shows you what links to it first. |
| `merge_entities` | Merge two notes into one — combines content, merges aliases, updates all wikilinks vault-wide. |

---

## Agent Memory

For autonomous agents that need persistent working memory across sessions.

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

### `recall`

One-stop knowledge retrieval. Searches entities, notes, and memories simultaneously, then ranks everything using text relevance, recency, co-occurrence, feedback, and semantic similarity.

**Parameters:** `query`, `limit`

### `brief`

Cold-start context for agents. Builds a token-budgeted summary of recent sessions, active entities, stored memories, pending corrections, and vault pulse — so an agent can pick up where it left off without reading the whole vault.

**Parameters:** `token_budget`, `sections`

---

## Vault Health

Monitor, configure, and maintain your vault.

| Tool | What it does |
|------|-------------|
| `health_check` | Is the server healthy? Vault accessibility, index freshness, recommendations. |
| `get_vault_stats` | How big is your vault? Notes, links, tags, orphans, recent activity. |
| `get_folder_structure` | Folder tree with note counts. |
| `refresh_index` | Force a full index rebuild without restarting. |
| `get_all_entities` | Every linkable entity (note titles + aliases). |
| `get_unlinked_mentions` | Where is an entity mentioned but not linked? |
| `vault_growth` | Track vault size over time — snapshots, history, trends. |
| `vault_activity` | Which tools are being called? Which notes get queried most? |
| `flywheel_config` | Read or update Flywheel configuration. |
| `server_log` | View recent server activity entries. |
| `suggest_entity_merges` | Find duplicate entities by name similarity and shared backlinks. |
| `dismiss_merge_suggestion` | "Those aren't duplicates" — dismiss a merge suggestion permanently. |
| `vault_init` | First-time setup. Scans notes with zero wikilinks and applies entity links. Safe to re-run. |

---

## Automation

### `policy`

Define repeatable workflows as YAML policies, then execute them.

| Action | What it does |
|--------|-------------|
| `list` | See all available policies. |
| `validate` | Check policy YAML against the schema. |
| `preview` | Dry-run showing what would happen. |
| `execute` | Run a policy with variables. |
| `author` | Generate policy YAML from a description. |
| `revise` | Modify an existing policy. |

### `vault_undo_last_mutation`

Undo the last Flywheel write (git soft reset). Safety checks prevent undoing the wrong commit.

**Parameters:** `confirm` (required), `hash` (optional safety check)

---

See [CONFIGURATION.md](CONFIGURATION.md) for tool presets, composable bundles, and category mapping.
