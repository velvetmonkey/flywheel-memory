# Set Up Your Own Vault

After trying the [demo vaults](../demos/), point Flywheel at your own Obsidian vault.

---

## Prerequisites

- **Node.js 18+** -- check with `node --version`
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

Flywheel ships 36 tools. Loading all of them works, but fewer tools means Claude picks the right one faster.

| Preset | Tools | ~Tokens | Best for |
|--------|-------|---------|----------|
| `minimal` | 13 | ~3,800 | Daily note-taking, simple queries |
| `minimal,graph` | 19 | ~5,650 | + backlinks, orphans, hubs, paths |
| `minimal,graph,tasks` | 22 | ~6,575 | + task queries and mutations |
| `minimal,graph,analysis` | 25 | ~7,500 | + schema intelligence, wikilink validation |
| `full` (default) | 36 | ~11,100 | Everything |

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

## Step 5: Add a Persona (Optional)

Create a `CLAUDE.md` file in your vault root to tell Claude how your vault is organized. This helps Claude pick the right tools and navigate your structure.

Example:

```markdown
# My Vault

## Structure
- `projects/` -- one note per project with status, client, and deadline in frontmatter
- `people/` -- one note per person with role and company
- `daily-notes/` -- daily journal with ## Log and ## Tasks sections
- `meetings/` -- meeting notes linked to projects and people

## Conventions
- Tasks use `- [ ]` format under ## Tasks sections
- Frontmatter always includes `tags`, `created`, and `status`
- Project notes link to their client via `[[Client Name]]`
```

See the [demo vaults](../demos/) for full examples (e.g., [carter-strategy/CLAUDE.md](../demos/carter-strategy/CLAUDE.md)).

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

## Next Steps

- **[COOKBOOK.md](COOKBOOK.md)** -- Example prompts organized by use case
- **[TOOLS.md](TOOLS.md)** -- Full reference for all 36 tools
- **[CONFIGURATION.md](CONFIGURATION.md)** -- All environment variables and advanced options
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** -- Error recovery and diagnostics
