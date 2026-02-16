# Cookbook

Example prompts organized by use case. Copy these directly into Claude Code or Claude Desktop.

All examples assume Flywheel is connected to your vault. See [SETUP.md](SETUP.md) if you haven't configured it yet.

---

## Daily Capture

Quick logging and task management for daily notes.

### Log an entry

> "Log my meeting notes to today's daily note under ## Log"

> "Add to today's daily note under ## Log: Finished the quarterly review with Sarah"

Flywheel appends to the section and auto-links any entities it recognizes (e.g., `Sarah` becomes `[[Sarah Mitchell]]` if that note exists).

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

`find_similar` combines keyword and semantic matching when the semantic index is built, surfacing conceptually related notes even if they don't share keywords.

### Discover semantic bridges

> "Find notes that are conceptually related but have no link between them"

Uses `graph_analysis({ analysis: "semantic_bridges" })` to discover high-value missing connections. Great for finding notes that *should* be linked but aren't.

### Cluster by meaning

> "Group my notes by semantic similarity instead of folder structure"

Uses `graph_analysis({ analysis: "semantic_clusters" })` to organize notes by what they're about, not where they live.

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

> "Create a note at people/Alex Rivera.md with role: engineer, company: Acme Corp, and sections for ## Background and ## Interactions"

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

> "Analyze this text and suggest where I should add wikilinks: 'Met with Sarah about the data migration project and discussed the React codebase'"

### Find immature notes

> "Find immature notes in my vault that need attention"

> "Show me the least mature notes in the projects/ folder -- which ones need more content, links, or metadata?"

### Check for contradictions

> "Check for contradictions in frontmatter across my vault"

> "Are there conflicting frontmatter values across notes that reference [[Project Alpha]]?"

### Note intelligence

> "Analyze projects/Website Redesign.md -- check for prose patterns that should be frontmatter, suggest wikilinks, and check cross-layer consistency"

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

> "Create a policy that adds a 'reviewed' date to all project notes that are marked as complete"

> "Preview what the weekly-review policy would do, then execute it"

---

## Tips

- **Start broad, then narrow.** Use `search` first to find relevant notes, then `get_backlinks` or `get_note_metadata` for details. This keeps token usage low.
- **Use sections.** Flywheel works best when notes have clear heading structure. `vault_add_to_section` targets specific sections, avoiding accidental overwrites.
- **Let auto-wikilinks work.** When writing through Flywheel, entity mentions are linked automatically. Write naturally -- don't add `[[brackets]]` yourself.
- **Check before deleting.** `vault_delete_note` shows backlink warnings before deletion. If a note has backlinks, consider moving or renaming instead.
- **Dry-run bulk changes.** `rename_field` and `migrate_field_values` default to dry-run mode. Always preview before committing.
- **Build the semantic index once** — `init_semantic` now builds both note embeddings (for hybrid search) and entity embeddings (for semantic wikilink scoring). Takes ~2-3 minutes for 500 entities. After that, wikilink suggestions gain semantic understanding, and new analyses unlock: `semantic_clusters`, `semantic_bridges`, `semantic_links`.
