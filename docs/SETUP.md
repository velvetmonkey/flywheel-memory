# Setup

[← Back to docs](README.md)

This guide is the practical setup path for real clients. Use it when you want Flywheel running against your own vault with the right preset and a sane first-run workflow.

- [Choose A Client](#choose-a-client)
- [Claude Code](#claude-code)
- [Codex](#codex)
- [Claude Desktop](#claude-desktop)
- [HTTP Clients](#http-clients)
- [First 5 Things To Try](#first-5-things-to-try)
- [Choose A Preset](#choose-a-preset)
- [Add Vault Instructions](#add-vault-instructions)
- [Multi-Vault](#multi-vault)
- [Platform Notes](#platform-notes)

## Choose A Client

| Client | Best when |
|---|---|
| Claude Code | You want stdio MCP inside the vault and the smoothest local workflow |
| Codex | You want Flywheel available from your repo-level Codex setup |
| Claude Desktop | You want Flywheel inside the desktop app |
| Cursor / Windsurf / VS Code / Continue | You prefer HTTP MCP to a long-running local Flywheel server |

## Claude Code

Create `.mcp.json` in your vault root:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"]
    }
  }
}
```

Then:

```bash
cd /path/to/your/vault
claude
```

`agent` is the default preset. Add `FLYWHEEL_TOOLS` only if you want `power`, `full`, or explicit bundles.

## Codex

Add Flywheel to `.codex/config.toml`:

```toml
[mcp_servers.flywheel]
command = "npx"
args = ["-y", "@velvetmonkey/flywheel-memory@latest"]
cwd = "/path/to/project"
startup_timeout_sec = 120
tool_timeout_sec = 120
env = { FLYWHEEL_VAULTS = "personal:/path/to/vault", FLYWHEEL_TOOLS = "power" }
```

Codex does not read `.mcp.json`, so keep Flywheel in `.codex/config.toml`.

## Claude Desktop

Add Flywheel to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault"
      }
    }
  }
}
```

Claude Desktop usually needs `VAULT_PATH` because it is not launched inside the vault directory.

## HTTP Clients

Start Flywheel first:

```bash
VAULT_PATH=/path/to/vault FLYWHEEL_TRANSPORT=http npx -y @velvetmonkey/flywheel-memory
```

Health check:

```bash
curl http://localhost:3111/health
```

### Cursor

```json
{
  "mcpServers": {
    "flywheel": {
      "url": "http://localhost:3111/mcp"
    }
  }
}
```

### Windsurf

```json
{
  "mcpServers": {
    "flywheel": {
      "serverUrl": "http://localhost:3111/mcp"
    }
  }
}
```

### VS Code

```json
{
  "servers": {
    "flywheel": {
      "type": "http",
      "url": "http://localhost:3111/mcp"
    }
  }
}
```

### Continue

```yaml
name: flywheel
type: streamable-http
url: http://localhost:3111/mcp
```

## First 5 Things To Try

1. Ask a plain-language question with `search`.
   Example: "What do my notes say about Acme?"
2. Read the winning note or section.
   Example: "Show me the Status section of Project X."
3. Write one safe change.
   Example: "Add this to today's log..."
4. Inspect vault health.
   Example: `doctor(action: "health")`
5. Check runtime config.
   Example: `doctor(action: "config", mode: "get")`

## Choose A Preset

| Preset | Use it when |
|---|---|
| `agent` | You want the focused default surface |
| `power` | You want everyday maintenance tools too |
| `full` | You want all categories visible immediately |
| `auto` | You need compatibility with older discovery-first prompts |

Examples:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "agent,graph"
  }
}
```

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "full"
  }
}
```

`auto` is no longer progressive disclosure. It behaves like `full` plus an informational `discover_tools` helper.

## Add Vault Instructions

Flywheel gives the model tools. Your vault instructions tell it how to use them well.

The useful stack is:

```text
.mcp.json or .codex/config.toml   -> which tools exist
CLAUDE.md / AGENTS.md             -> how to think about the vault
.claude/rules/                    -> format and workflow rules for specific note types
```

Good vault instructions usually cover:
- folder structure
- frontmatter conventions
- common sections like `## Log` or `## Tasks`
- preferred write habits
- any required note templates or policies

## Multi-Vault

Use `FLYWHEEL_VAULTS` instead of `VAULT_PATH`:

```text
FLYWHEEL_VAULTS="personal:/home/you/obsidian/Personal,work:/home/you/obsidian/Work"
```

Rules:
- the first vault is primary
- `search` without `vault` searches across all vaults
- most other tools default to the primary vault
- each vault keeps separate index, watcher, and config state

## Platform Notes

### Windows

Use:
- `cmd /c npx`
- explicit `VAULT_PATH`
- `FLYWHEEL_WATCH_POLL=true`

Without polling, Obsidian edits may not show up reliably.

### Semantic Search

If you want hybrid retrieval, run `init_semantic` once after setup. That builds the local embeddings index and search uses it automatically afterward.

### Runtime Config Examples

Disable proactive linking:

```text
doctor({
  action: "config",
  mode: "set",
  key: "proactive_linking",
  value: false
})
```

Add custom `type:` categories:

```text
doctor({
  action: "config",
  mode: "set",
  key: "custom_categories",
  value: {
    "work-ticket": { "type_boost": 2 },
    "recipe": { "type_boost": 1 }
  }
})
```
