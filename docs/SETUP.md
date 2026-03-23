# Set Up Your Own Vault

After trying the [demo vaults](../demos/), point Flywheel at your own Obsidian vault.

---

## Prerequisites

- **Node.js 18–22** -- check with `node --version`. Node 24 does not ship prebuilt `better-sqlite3` binaries and will fail to install.
- **An Obsidian vault** -- any folder with `.md` files works, but Flywheel detects Obsidian conventions (`.obsidian/` folder, periodic notes, templates)
- **An MCP-compatible client** -- Claude Code, Claude Desktop, Cursor, Windsurf, VS Code + GitHub Copilot, Continue, or any Streamable HTTP client

---

## Windows

On Windows, the MCP config differs from macOS/Linux in three ways:

1. **`cmd /c` wrapper** — use `"command": "cmd"` with `"args": ["/c", "npx", ...]` instead of `"command": "npx"`. Windows installs npx as a batch script (`npx.cmd`) which MCP clients can't execute directly — without this wrapper the server silently fails.
2. **`VAULT_PATH`** — set to your vault's Windows path (e.g. `C:\Users\you\obsidian\MyVault`)
3. **`FLYWHEEL_WATCH_POLL=true`** — native file events are unreliable on Windows

See [CONFIGURATION.md](CONFIGURATION.md#windows) for the full config example.

> **Alternative:** You can also use HTTP transport on Windows — start the server in a terminal with `FLYWHEEL_TRANSPORT=http` and connect from your editor via HTTP URL. See the [HTTP clients](#http-clients-cursor-windsurf-vs-code-continue) section below.

---

## Step 1: Configure Your Client

### Claude Code (stdio)

Create `.mcp.json` in your vault root:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "FLYWHEEL_TOOLS": "default"
      }
    }
  }
}
```

Launch:

```bash
cd /path/to/your/vault && claude
```

### Claude Desktop (stdio)

Edit `claude_desktop_config.json` (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault",
        "FLYWHEEL_TOOLS": "default"
      }
    }
  }
}
```

Claude Desktop requires `VAULT_PATH` because it doesn't launch from the vault directory. Claude Code auto-detects the vault root from the working directory.

Restart Claude Desktop after editing the config. Flywheel appears in the MCP server list.

### HTTP Clients (Cursor, Windsurf, VS Code, Continue)

HTTP clients connect to a running Flywheel server. Start it first:

```bash
VAULT_PATH=/path/to/your/vault FLYWHEEL_TRANSPORT=http npx -y @velvetmonkey/flywheel-memory
```

Verify it's running:

```bash
curl http://localhost:3111/health
```

**HTTP server options:**

| Variable | Default | Description |
|----------|---------|-------------|
| `FLYWHEEL_TRANSPORT` | `stdio` | Set to `http` for HTTP-only, or `both` to run stdio + HTTP simultaneously |
| `FLYWHEEL_HTTP_PORT` | `3111` | Port the HTTP server listens on |
| `FLYWHEEL_HTTP_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` to accept connections from other machines |

Example with custom port:

```bash
VAULT_PATH=/path/to/your/vault FLYWHEEL_TRANSPORT=http FLYWHEEL_HTTP_PORT=8080 npx -y @velvetmonkey/flywheel-memory
```

Update the URLs in your client config to match (e.g. `http://localhost:8080/mcp`).

Keep the server running in a terminal tab, tmux session, or as a systemd service.
Then configure your client below.

#### Cursor (HTTP)

```json
// .cursor/mcp.json (project) or ~/.cursor/mcp.json (global)
{
  "mcpServers": {
    "flywheel": {
      "url": "http://localhost:3111/mcp"
    }
  }
}
```

#### Windsurf (HTTP)

```json
// ~/.codeium/windsurf/mcp_config.json
{
  "mcpServers": {
    "flywheel": {
      "serverUrl": "http://localhost:3111/mcp"
    }
  }
}
```

#### VS Code + GitHub Copilot (HTTP)

Note: VS Code uses `"servers"` not `"mcpServers"`.

```json
// .vscode/mcp.json
{
  "servers": {
    "flywheel": {
      "type": "http",
      "url": "http://localhost:3111/mcp"
    }
  }
}
```

#### Continue (HTTP)

Each server gets its own file:

```yaml
# .continue/mcpServers/flywheel.yaml
name: flywheel
type: streamable-http
url: http://localhost:3111/mcp
```

#### Other HTTP Clients

Any client that speaks Streamable HTTP can connect to `http://localhost:3111/mcp`.

**MCP endpoint:** `POST /mcp` — accepts `application/json` and `text/event-stream`.

**List available tools:**

```bash
curl -X POST http://localhost:3111/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**Search your vault:**

```bash
curl -X POST http://localhost:3111/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"query":"meeting notes"}}}'
```

**Multi-vault setup:**

```bash
FLYWHEEL_VAULTS="personal:/home/user/obsidian/Personal,work:/home/user/obsidian/Work" \
  FLYWHEEL_TRANSPORT=http npx @velvetmonkey/flywheel-memory
```

When multi-vault is active, every tool gains an optional `vault` parameter. The `search` tool automatically searches all vaults when `vault` is omitted, merging results with a `vault` field on each. Other tools default to the primary vault (first in list). The health endpoint reports all vault names.

See [CONFIGURATION.md](CONFIGURATION.md#multi-vault) for all multi-vault options.

On first run, Flywheel creates a `.flywheel/` directory containing its SQLite index. Add `.flywheel/` to your `.gitignore` if your vault is version-controlled.

> **Proactive linking is on by default.** Flywheel's file watcher monitors your vault for changes and automatically inserts high-confidence wikilinks into notes you edit -- even outside of Claude. Only strong matches are applied (score >= 20, max 3 per file). This is the core flywheel: edits you make in Obsidian get linked without you asking. If you prefer links only through explicit Claude tool calls, disable it:
>
> ```
> flywheel_config({ mode: "set", key: "proactive_linking", value: false })
> ```
>
> See [CONFIGURATION.md](CONFIGURATION.md#wikilink-behavior) for fine-tuning the score threshold and per-file limit.

---

## Step 2: First 5 Commands to Try

Start with these to see Flywheel in action on your vault:

### 1. Search your vault

> "Search for notes about [topic]"

This uses full-text search. Results return in under 10ms with highlighted snippets.

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

Flywheel auto-links any mentions of existing notes. If your vault has `Stacy Thompson.md`, the output becomes `[[Stacy Thompson]] reviewed the [[API Security Checklist]]`.

---

## Step 3: Choose a Tool Preset

Flywheel defaults to the `default` preset (16 tools: search, read, write, tasks).
Add bundles for graph analysis, wikilinks, memory, or other capabilities:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "default,graph,tasks"
  }
}
```

See [CONFIGURATION.md](CONFIGURATION.md) for all presets, composable bundles, and categories.

---

## Step 4: Configure Claude for Your Vault

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

### Iteration

Start simple and build up:

1. **Week 1:** Add `CLAUDE.md` with just your folder structure
2. **Week 2:** Add frontmatter conventions after you see Claude creating notes with wrong metadata
3. **Week 3:** Add `.claude/rules/` files for note types where Claude keeps getting the format wrong
4. **Ongoing:** Add quick commands and workflows as you discover patterns you repeat

---

## Step 5: Enable Semantic Intelligence (Optional)

Flywheel supports deep semantic integration that goes far beyond keyword search. To enable it:

> "Build the semantic search index for my vault"

This runs `init_semantic`, which builds **two** indexes:

### Note Embeddings (Hybrid Search)
- Embeds all vault notes using a local model (23 MB, downloaded once)
- After build: `search` and `find_similar` automatically combine keyword and semantic matching
- No configuration changes needed — hybrid mode activates automatically

### Entity Embeddings (Semantic Wikilinks + Graph Analysis)
- Embeds all vault entities (note titles, aliases, categories)
- After build: wikilink suggestions gain **semantic scoring** — content about "deployment automation" can suggest `[[CI/CD]]` without keyword matches
- Unlocks `semantic_analysis` tool (clusters, bridges) and `semantic_links` in `note_intelligence`

### Build Details

| | |
|---|---|
| **Build time** | ~2-3 minutes for 500 entities |
| **Memory** | ~768 KB for 500 entities (loaded into memory at startup) |
| **Model** | Local model, 23 MB (runs entirely on your machine) |
| **Incremental** | File watcher keeps embeddings current as you edit |
| **Runs once** | Subsequent startups load from cache |

### What Unlocks

After building semantic embeddings:

- **Wikilink suggestions**: Semantic scoring finds conceptual links that keyword matching misses
- **Semantic bridges**: `semantic_analysis({ type: "bridges" })` — find notes that should be connected but aren't
- **Semantic clusters**: `semantic_analysis({ type: "clusters" })` — group notes by meaning, not folder
- **Semantic links**: `note_intelligence({ analysis: "semantic_links" })` — find missing entity links for a specific note
- **Preflight checks**: `vault_create_note` warns when a semantically similar note already exists
- **Broken link recovery**: `validate_links` suggests fixes via semantic similarity when exact matches fail

---

## Common Issues

### "Vault not found"

Flywheel looks for a vault root by walking up from the working directory, checking for `.obsidian/` or `.claude/`. If neither exists:

- **Claude Code:** Make sure you `cd` into your vault before running `claude`
- **Claude Desktop:** Set `VAULT_PATH` explicitly in the config

### "Too many tools" / Claude picks the wrong tool

Reduce the tool set. Switch from `full` to `default` or a specific bundle combination. Fewer tools = better tool selection by Claude.

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
- **[TOOLS.md](TOOLS.md)** -- Full reference for all 69 tools
- **[CONFIGURATION.md](CONFIGURATION.md)** -- All environment variables and advanced options
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** -- Error recovery and diagnostics
