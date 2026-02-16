# Set Up Your Own Vault

After trying the [demo vaults](../demos/), point Flywheel at your own Obsidian vault.

---

## Prerequisites

- **Node.js 18–22** -- check with `node --version`. Node 24 does not ship prebuilt `better-sqlite3` binaries and will fail to install.
- **An Obsidian vault** -- any folder with `.md` files works, but Flywheel detects Obsidian conventions (`.obsidian/` folder, periodic notes, templates)
- **Claude Code** or **Claude Desktop** -- any MCP-compatible client works

---

## Step 1: Add MCP Config

### Claude Code

Create `.mcp.json` in your vault root:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "FLYWHEEL_TOOLS": "minimal"
      }
    }
  }
}
```

### Claude Desktop

Edit `claude_desktop_config.json` (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault",
        "FLYWHEEL_TOOLS": "minimal"
      }
    }
  }
}
```

Claude Desktop requires `VAULT_PATH` because it doesn't launch from the vault directory. Claude Code auto-detects the vault root from the working directory.

---

## Step 2: Launch

### Claude Code

```bash
cd /path/to/your/vault && claude
```

### Claude Desktop

Restart Claude Desktop after editing the config. Flywheel appears in the MCP server list.

On first run, Flywheel creates a `.flywheel/` directory containing its SQLite index. Add `.flywheel/` to your `.gitignore` if your vault is version-controlled.

---

## Step 3: First 5 Commands to Try

Start with these to see Flywheel in action on your vault:

### 1. Search your vault

> "Search for notes about [topic]"

This uses FTS5 full-text search. Results return in under 10ms with highlighted snippets.

### 2. Explore connections

> "What links to my note about [topic]?"

Flywheel returns backlinks instantly from its pre-built graph -- no file scanning needed.

### 3. Check vault health

> "Run a health check on my vault"

Returns vault stats, index freshness, detected periodic note folders, and recommendations.

### 4. Read note structure

> "Show me the structure of [note name]"

Returns the heading hierarchy, word count, and sections without reading the full file content.

### 5. Write with auto-wikilinks

> "Add a note to today's daily note under ## Log: Met with [person name] about [topic]"

Flywheel auto-links any mentions of existing notes. If "Sarah Mitchell" has a note, the output becomes `Met with [[Sarah Mitchell]] about [[Project Alpha]]`.

---

## Step 4: Choose a Tool Preset

Flywheel ships 42 tools. Loading all of them works, but fewer tools means Claude picks the right one faster.

| Preset | Tools | ~Tokens | Best for |
|--------|-------|---------|----------|
| `minimal` | 13 | ~3,800 | Daily note-taking, simple queries |
| `minimal,graph` | 19 | ~5,650 | + backlinks, orphans, hubs, paths |
| `minimal,graph,tasks` | 22 | ~6,575 | + task queries and mutations |
| `minimal,graph,analysis` | 25 | ~7,500 | + schema intelligence, wikilink validation |
| `full` (default) | 42 | ~12,400 | Everything |

**Recommendation:** Start with `minimal`. If you find yourself needing graph navigation or task management, add those bundles. You can always switch by editing the `FLYWHEEL_TOOLS` value in your `.mcp.json`.

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "minimal,graph,tasks"
  }
}
```

See [CONFIGURATION.md](CONFIGURATION.md) for all presets, bundles, and individual categories.

---

## Step 5: Configure Claude for Your Vault

Flywheel gives Claude the tools. Configuration tells Claude *how to think about your vault* -- which folders matter, what frontmatter means, and how notes should be formatted.

There are three layers, each optional:

```
.mcp.json          → Which tools Claude can use (Step 1 already did this)
CLAUDE.md          → How Claude should think about your vault
.claude/rules/     → Format rules for specific note types
```

Start with just `CLAUDE.md`. Add rules files later as you notice Claude getting formats wrong.

### CLAUDE.md: Your Vault Persona

Create a `CLAUDE.md` file in your vault root. This is the single most impactful thing you can do -- it transforms Claude from a generic assistant into one that understands your specific system.

Here's what to include and why:

**Vault structure** -- folder layout with what each folder holds. Claude uses this to pick the right tool arguments (folder filters, path construction). Without it, Claude guesses folder names.

**Frontmatter conventions** -- field names, allowed values, which folders use which fields. Claude uses this to construct correct `where` filters and to create notes with proper metadata.

**Section conventions** -- what headings your notes use (`## Log`, `## Tasks`, etc.). Claude uses this to target `vault_add_to_section` correctly instead of appending to the wrong place.

**Key hubs** -- notes that serve as connection points (e.g., a "Team Roster" or "Project Index"). Claude checks backlinks on these first when answering broad questions.

**Quick commands** (optional) -- natural language shortcuts mapped to what you want. These prime Claude to respond to shorthand like "what's overdue" with the right multi-tool workflow.

**Workflows** (optional) -- multi-step tool chains for common tasks. These show Claude the optimal tool sequence so it doesn't have to figure it out each time.

#### Starter Template

```markdown
# My Vault

## Structure

- `daily-notes/` -- daily journal entries with ## Log and ## Tasks sections
- `projects/` -- one note per project, status tracked in frontmatter
- `people/` -- one note per person, role and company in frontmatter
- `meetings/` -- meeting notes linked to projects and people

## Frontmatter

| Field | Used in | Values |
|-------|---------|--------|
| `status` | projects | active, completed, on-hold |
| `tags` | all | free-form |
| `created` | all | YYYY-MM-DD |

## Sections

- Daily notes: `## Log` for entries, `## Tasks` for action items
- Meeting notes: `## Attendees`, `## Notes`, `## Action Items`

## Key Hubs

- `projects/Project Index.md` -- links to all active projects
- `people/Team.md` -- links to all team members
```

The demo vaults show fully fleshed-out examples with quick commands and workflows:
- [carter-strategy/CLAUDE.md](../demos/carter-strategy/CLAUDE.md) -- consulting practice with invoicing
- [artemis-rocket/CLAUDE.md](../demos/artemis-rocket/CLAUDE.md) -- engineering project with dependency tracking
- [nexus-lab/CLAUDE.md](../demos/nexus-lab/CLAUDE.md) -- research lab with experiment protocols

### `.claude/rules/`: Format Rules for Note Types

Claude Code supports [rules files](https://docs.anthropic.com/en/docs/claude-code/memory#project-level-memory) in `.claude/rules/` with `paths:` frontmatter for folder-scoped activation. These are ideal for format constraints that only apply to certain note types.

Use them for:
- Required frontmatter fields for a folder
- Naming conventions (e.g., `INV-###` for invoices)
- Section structure (required headings, ordering)
- Time/date formats

**Example: daily notes rule** (`.claude/rules/daily-notes.md`)

```markdown
---
paths: "daily-notes/**/*.md"
alwaysApply: false
---

# Daily Notes Format

## Log Section

Format log entries as continuous bullets:

## Log

- 09:00 - [[Client Name]] - Activity description
- 10:30 - [[Client Name]] - Activity description
- 14:00 - Admin - Non-billable activity

## Time Format

- Use 24-hour time: `09:00`, `14:30`
- Include client wikilink when billable
```

Every demo vault ships an `obsidian-syntax.md` rule that prevents common Obsidian rendering issues (broken wikilinks, angle brackets). Copy it from any demo or create your own.

See the [demo vaults](../demos/) for more rule examples:
- `carter-strategy/.claude/rules/` -- invoice format, client notes, daily notes
- `artemis-rocket/.claude/rules/` -- decision records, system notes, daily notes
- `nexus-lab/.claude/rules/` -- experiment format, literature notes, daily notes

### Iteration

Start simple and build up:

1. **Week 1:** Add `CLAUDE.md` with just your folder structure
2. **Week 2:** Add frontmatter conventions after you see Claude creating notes with wrong metadata
3. **Week 3:** Add `.claude/rules/` files for note types where Claude keeps getting the format wrong
4. **Ongoing:** Add quick commands and workflows as you discover patterns you repeat

---

## Step 6: Enable Semantic Intelligence (Optional)

Flywheel supports deep semantic integration that goes far beyond keyword search. To enable it:

> "Build the semantic search index for my vault"

This runs `init_semantic`, which builds **two** indexes:

### Note Embeddings (Hybrid Search)
- Embeds all vault notes using the `all-MiniLM-L6-v2` model (23 MB, downloaded once to `~/.cache/huggingface/`)
- After build: `search` and `find_similar` auto-upgrade to hybrid ranking (BM25 + semantic via Reciprocal Rank Fusion)
- No configuration changes needed — hybrid mode activates automatically

### Entity Embeddings (Semantic Wikilinks + Graph Analysis)
- Embeds all vault entities (note titles, aliases, categories)
- After build: wikilink suggestions gain **Layer 9 semantic scoring** — content about "deployment automation" can suggest `[[CI/CD]]` without keyword matches
- Unlocks new analysis modes: `semantic_clusters`, `semantic_bridges`, `semantic_links`

### Build Details

| | |
|---|---|
| **Build time** | ~2-3 minutes for 500 entities |
| **Memory** | ~768 KB for 500 entities (loaded into memory at startup) |
| **Model** | `all-MiniLM-L6-v2` (384 dimensions, runs locally) |
| **Incremental** | File watcher keeps embeddings current as you edit |
| **Runs once** | Subsequent startups load from cache |

### What Unlocks

After building semantic embeddings:

- **Wikilink suggestions**: Layer 9 semantic scoring finds conceptual links that keyword matching misses
- **Semantic bridges**: `graph_analysis({ analysis: "semantic_bridges" })` — find notes that should be connected but aren't
- **Semantic clusters**: `graph_analysis({ analysis: "semantic_clusters" })` — group notes by meaning, not folder
- **Semantic links**: `note_intelligence({ analysis: "semantic_links" })` — find missing entity links for a specific note
- **Preflight checks**: `vault_create_note` warns when a semantically similar note already exists
- **Broken link recovery**: `validate_links` suggests fixes via semantic similarity when exact matches fail

---

## Common Issues

### "Vault not found"

Flywheel looks for a vault root by walking up from the working directory, checking for `.obsidian/` or `.mcp.json`. If neither exists:

- **Claude Code:** Make sure you `cd` into your vault before running `claude`
- **Claude Desktop:** Set `VAULT_PATH` explicitly in the config

### "Too many tools" / Claude picks the wrong tool

Reduce the tool set. Switch from `full` to `minimal` or a specific bundle combination. Fewer tools = better tool selection by Claude.

### "Permission denied" on file writes

Flywheel writes to files in your vault directory and creates `.flywheel/` for its index. Make sure the user running Claude has write access to the vault folder.

### Stale search results

The index rebuilds automatically via file watcher, but if results seem stale:

1. Ask Claude to "refresh the index" (uses the `refresh_index` tool)
2. Or delete `.flywheel/` and restart -- it rebuilds in seconds

### Git-related errors

Flywheel's write tools optionally auto-commit changes. If your vault isn't a git repository, commits are silently skipped. If you see git errors:

- Make sure git is installed and the vault is initialized (`git init`)
- Check for stale `.git/index.lock` files (see [TROUBLESHOOTING.md](TROUBLESHOOTING.md))

---

## Git Integration (Optional)

Flywheel's write tools can auto-commit changes to git, giving you undo support and change history.

### Setup

```bash
cd /path/to/vault
git init
echo ".flywheel/" >> .gitignore
git add -A && git commit -m "initial commit"
```

### How it works

- Every write tool has a `commit` parameter (default: `false`)
- Set `commit: true` to auto-commit each mutation
- Use `vault_undo_last_mutation` to reverse the last commit
- If the vault isn't a git repo, commits are silently skipped -- mutations still work

### No git? No problem.

All vault operations work without git. You just won't have undo or commit history. Git is never required.

---

## Next Steps

- **[COOKBOOK.md](COOKBOOK.md)** -- Example prompts organized by use case
- **[TOOLS.md](TOOLS.md)** -- Full reference for all 42 tools
- **[CONFIGURATION.md](CONFIGURATION.md)** -- All environment variables and advanced options
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** -- Error recovery and diagnostics
