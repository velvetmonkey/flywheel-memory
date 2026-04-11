# Cookbook

[← Back to docs](README.md)

Example prompts organized by use case. Copy these directly into Claude Code or Claude Desktop.

All examples assume Flywheel is connected to your vault. See [SETUP.md](SETUP.md) if you haven't configured it yet.

- [Daily Capture](#daily-capture)
  - [Log an entry](#log-an-entry)
  - [Add a task](#add-a-task)
  - [Complete a task](#complete-a-task)
  - [Check today's tasks](#check-todays-tasks)
- [Research](#research)
  - [Search by topic](#search-by-topic)
  - [Explore connections](#explore-connections)
  - [Discover related content](#discover-related-content)
  - [Find hubs](#find-hubs)
  - [Track graph evolution](#track-graph-evolution)
  - [Visualize your knowledge graph](#visualize-your-knowledge-graph)
- [Multi-Vault](#multi-vault)
  - [Search across all vaults](#search-across-all-vaults)
  - [Search one vault](#search-one-vault)
  - [Target a specific vault for writes](#target-a-specific-vault-for-writes)
  - [Identify which vault a result came from](#identify-which-vault-a-result-came-from)
- [Semantic Search](#semantic-search)
  - [Enable hybrid search](#enable-hybrid-search)
  - [Search by concept](#search-by-concept)
  - [Find similar notes](#find-similar-notes)
  - [Find missing connections](#find-missing-connections)
  - [Find semantic links for a note](#find-semantic-links-for-a-note)
  - [Inspect semantic scoring](#inspect-semantic-scoring)
- [Maintenance](#maintenance)
  - [Find orphans](#find-orphans)
  - [Validate links](#validate-links)
  - [Check vault health](#check-vault-health)
  - [Rebuild index](#rebuild-index)
- [Creation](#creation)
  - [Project notes](#project-notes)
  - [Notes with structure](#notes-with-structure)
  - [Notes from templates](#notes-from-templates)
- [Analysis](#analysis)
  - [Schema analysis](#schema-analysis)
  - [Find incomplete notes](#find-incomplete-notes)
  - [Wikilink suggestions](#wikilink-suggestions)
  - [Find immature notes](#find-immature-notes)
  - [Check for contradictions](#check-for-contradictions)
- [Inspecting the Algorithm](#inspecting-the-algorithm)
  - [Score breakdown](#score-breakdown)
  - [Suppressed entities](#suppressed-entities)
  - [Hub notes](#hub-notes)
  - [Tracing a suggestion](#tracing-a-suggestion)
- [Bulk Operations](#bulk-operations)
  - [Rename a field](#rename-a-field)
  - [Migrate values](#migrate-values)
  - [Policy automation](#policy-automation)
- [Tips](#tips)

---

## Daily Capture

Quick logging and task management for daily notes.

### Log an entry

> "Log my meeting notes to today's daily note under ## Log"

> "Add to today's daily note under ## Log: Finished the quarterly review with Sarah"

Flywheel appends to the section and auto-links any entities it recognizes -- full entity names like `Stacy Thompson` become `[[Stacy Thompson]]` if a matching note exists.

### Add a task

> "Add a task to today's note: Review Q1 reports"

> "Add a task to daily-notes/2026-02-15.md under ## Tasks: Follow up with Acme Corp about the proposal"

### Complete a task

> "Mark the 'Review Q1 reports' task as done in today's daily note"

### Check today's tasks

> "What tasks are open in today's daily note?"

> "Show me all overdue tasks across the vault"

---

## Research

Find connections and navigate the knowledge graph.

### Search by topic

> "Find all notes about machine learning"

> "Search for notes tagged #project and #active"

> "Find notes in the research/ folder modified in the last week"

### Explore connections

> "What notes link to [[Project Alpha]]?"

> "Show me the backlinks and forward links for my note on React migration"

> "What's the shortest path between [[Alice Chen]] and [[Project Omega]] in my vault?"

### Discover related content

> "What do [[React Migration]] and [[Performance Audit]] have in common? Show their common neighbors."

> "Find notes that mention 'TypeScript' but don't have a wikilink to the TypeScript note"

> "Find notes similar to projects/alpha.md that I haven't linked yet"

### Find hubs

> "What are the most connected notes in my vault?"

> "Show me hub notes with more than 10 connections"

### Track graph evolution

> "How has my vault's graph structure changed over the last 30 days?"

> "Which notes are emerging as new hubs? Show me entities growing fastest in connections"

### Visualize your knowledge graph

Export your vault as a graph file and open it in professional visualization tools.

> "Export my vault graph as GraphML so I can open it in Gephi"

> "Export the knowledge graph as JSON, include co-occurrence edges"

> "Export the graph but only include edges with weight above 2.0"

**How to use the export:**

1. **Gephi** (gephi.org) — Open-source graph visualization. File → Open → select the .graphml file. Apply Force Atlas 2 layout. Color nodes by `category` attribute.
2. **yEd** (yworks.com/yed) — Free graph editor. File → Open → GraphML. Use hierarchical or organic layout.
3. **Cytoscape** (cytoscape.org) — Network analysis platform. File → Import → Network from File. Map `hub_score` to node size.
4. **NetworkX** (Python) — `import networkx as nx; G = nx.read_graphml('vault.graphml')`
5. **JSON format** — Use `format: "json"` for programmatic analysis. Parse with any language.

**What's in the export:**
- **Nodes**: Every note (title, modified date, tags, frontmatter type) + every entity (category, hub score, aliases)
- **Edges**: Wikilinks (note→note), weighted connections (from feedback learning), co-occurrence relationships (entity↔entity)

---

## Multi-Vault

When Flywheel is configured with `FLYWHEEL_VAULTS`, all tools gain an optional `vault` parameter. These examples assume a two-vault setup: `personal` and `work`.

### Search across all vaults

> "Find all notes about quarterly planning"

When `vault` is omitted, `search` automatically queries every configured vault and merges the results. Each result includes a `vault` field so you can see where it came from.

### Search one vault

> "Search my work vault for notes about the API redesign"

> "Find notes tagged #meeting in my personal vault only"

Passing `vault: "work"` or `vault: "personal"` restricts the search to that vault.

### Target a specific vault for writes

> "Add a task to today's daily note in my work vault: Follow up on the deployment issue"

> "Create a new project note in my personal vault at projects/Garden Redesign.md"

Non-search tools default to the primary vault (first in the list). Pass `vault: "work"` to target a different one.

### Identify which vault a result came from

> "Search for 'budget review' and tell me which vault each result is from"

Cross-vault search results include a `vault` field on every result. Ask Claude to surface it when you need to disambiguate.

---

## Semantic Search

Hybrid search that combines keyword matching with conceptual similarity.

### Enable hybrid search

> "Build the semantic search index for my vault"

Runs locally, no API keys needed. Only needs to be done once — all subsequent searches automatically upgrade to hybrid ranking.

### Search by concept

> "Search for notes conceptually related to 'knowledge management'"

When embeddings exist, search automatically uses hybrid ranking (keyword + semantic) -- no extra parameters needed.

### Find similar notes

> "Find notes similar to projects/alpha.md using semantic similarity"

`search({ action: "similar", path: "projects/alpha.md" })` combines keyword and semantic matching when the semantic index is built, surfacing conceptually related notes even if they don't share keywords.

### Find missing connections

> "Find pairs of entities I write about together that don't have a link between them"

Uses `graph({ action: "cooccurrence_gaps" })` to surface entity pairs that co-occur in notes but lack a direct link — concrete candidates for new connections, backed by the evidence notes.

### Find semantic links for a note

> "What entities are semantically related to projects/AI-Agent.md but not linked?"

Uses `note_intelligence({ path: "projects/AI-Agent.md", analysis: "semantic_links" })` to find conceptually relevant entities that should be linked.

### Inspect semantic scoring

> "Show me the detailed score breakdown for wikilink suggestions — I want to see the semantic boost"

Use `suggest_wikilinks` with `detail: true` to see `semanticBoost` in the score breakdown for each suggestion. This reveals which suggestions were found purely through semantic similarity vs keyword matching.

---

## Maintenance

Keep your vault clean and well-linked.

### Find orphans

> "Show me orphan notes that have no backlinks"

> "Find dead-end notes -- notes that have backlinks but don't link to anything else"

### Validate links

> "Find broken wikilinks in my vault"

> "Check for broken links and suggest fixes for any typos"

### Check vault health

> "Run a health check on my vault"

> "Show me vault statistics -- how many notes, links, tags, and orphans do I have?"

### Rebuild index

> "Refresh the vault index"

Use this if search results seem stale or after bulk-editing files outside of Flywheel.

---

## Creation

Create well-structured notes with proper metadata.

### Project notes

> "Create a project note at projects/Website Redesign.md with tags project and active, status in-progress, and a summary section"

> "Create a meeting note for today's standup at meetings/2026-02-15-standup.md with attendees Sarah and James in frontmatter"

### Notes with structure

> "Create a note at people/[[Alex Chen|Alex]] Rivera.md with role: engineer, company: Acme Corp, and sections for ## Background and ## Interactions"

### Notes from templates

> "Add a new entry to today's daily note. If the note doesn't exist, create it with ## Log, ## Tasks, and ## Notes sections"

The `create_if_missing` parameter on `vault_add_to_section` handles this -- Claude knows to use it when the daily note might not exist yet.

---

## Analysis

Understand your vault's structure and consistency.

### Schema analysis

> "What frontmatter fields are used across my vault? Show me the schema overview"

> "Find notes with inconsistent frontmatter -- fields that have different types across notes"

> "What are the conventions in my projects/ folder? What fields do most project notes have?"

### Find incomplete notes

> "Show me project notes that are missing fields their peers have"

> "Find notes in people/ that are missing the 'role' or 'company' field"

### Wikilink suggestions

> "Analyze this text and suggest where I should add wikilinks: '[[Acme Data Migration]] testing done, Stacy Thompson starting [[Beta Corp Dashboard]]'"

### Find immature notes

> "Find immature notes in my vault that need attention"

> "Show me the least mature notes in the projects/ folder -- which ones need more content, links, or metadata?"

### Check for contradictions

> "Check for contradictions in frontmatter across my vault"

> "Are there conflicting frontmatter values across notes that reference [[Project Alpha]]?"

---

## Inspecting the Algorithm

Understand how auto-wikilinks decides what to link and why.

### Score breakdown

> "Show me the score breakdown for wikilink suggestions in my last daily note"

> "Why did Flywheel link 'migration' to [[Database Migration]] instead of [[Bird Migration]]?"

### Suppressed entities

> "What entities has Flywheel suppressed, and why?"

> "Show me all suppressed wikilink suggestions for projects/Website Redesign.md"

### Hub notes

> "What are the hub notes in my vault? Which entities appear most often?"

### Tracing a suggestion

> "Trace the wikilink suggestion for 'Alex' in today's daily note -- show me every scoring layer"

For the full specification of the scoring algorithm, see [ALGORITHM.md](ALGORITHM.md).

---

## Bulk Operations

Manage vault-wide changes.

### Rename a field

> "Rename the frontmatter field 'assignee' to 'owner' across all notes -- do a dry run first"

### Migrate values

> "Change all frontmatter status values from 'wip' to 'in-progress' -- preview the changes first"

### Policy automation

> "List available policies"

> "Create a policy that finds all notes tagged #meeting from this week and creates a summary in today's daily note"

> "Create a policy that adds a 'reviewed' date to all project notes that are marked as complete"

> "Preview what the weekly-review policy would do, then execute it"

> "Revise the overdue-invoice-chaser policy to also update each invoice's frontmatter with a chased_at date"

> "Run the weekly-review policy for week 2026-W14"

> "Instead of doing these three write calls every morning, save them as a policy I can reuse"

---

## Tips

- **Start broad, then narrow.** Use `search` first — it returns enriched results with frontmatter, backlinks, outlinks, and content previews. Escalate to `get_note_structure` only when you need full content.
- **Use sections.** Flywheel works best when notes have clear heading structure. `vault_add_to_section` targets specific sections, avoiding accidental overwrites.
- **Let auto-wikilinks work.** When writing through Flywheel, entity mentions are linked automatically. Write naturally -- don't add `[[brackets]]` yourself.
- **Check before deleting.** `vault_delete_note` shows backlink warnings before deletion. If a note has backlinks, consider moving or renaming instead.
- **Dry-run any write.** All write tools accept `dry_run: true` to preview changes without modifying files. Bulk tools (`rename_field`, `migrate_field_values`) default to dry-run mode.
- **Build the semantic index once** — `init_semantic` builds both note embeddings (for hybrid search via `search` — both `action=query` and `action=similar`) and entity embeddings (for semantic wikilink scoring). Takes ~2-3 minutes for 500 entities. After that, wikilink suggestions gain semantic understanding and the `semantic_links` mode in `note_intelligence` becomes available.
