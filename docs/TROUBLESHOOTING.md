# Troubleshooting

[← Back to docs](README.md)

Error recovery and diagnostics for Flywheel Memory.

**Safety model:** Your markdown files are the source of truth. Everything in `.flywheel/` is derived data and can be safely deleted -- Flywheel rebuilds it on next startup.

- [Server Startup Timeout](#server-startup-timeout)
- [Undoing a Mutation](#undoing-a-mutation)
  - [`vault_undo_last_mutation`](#vault_undo_last_mutation)
  - [Going further back](#going-further-back)
  - [Vault not a git repository](#vault-not-a-git-repository)
- [StateDb Corruption](#statedb-corruption)
  - [Automatic Protection](#automatic-protection)
  - [Files in `.flywheel/`](#files-in-flywheel)
  - [StateDb Corruption: Symptoms](#symptoms)
  - [StateDb Corruption: Recovery](#recovery)
  - [StateDb Corruption: Diagnostics](#diagnostics)
  - [StateDb Corruption: Prevention](#prevention)
- [Git Lock Contention](#git-lock-contention)
  - [Git Lock Contention: Symptoms](#symptoms-1)
  - [Git Lock Contention: Recovery](#recovery-1)
  - [Git Lock Contention: Prevention](#prevention-1)
- [Windows](#windows)
  - [Server silently fails to start](#server-silently-fails-to-start)
  - [Edits in Obsidian don't appear in search](#edits-in-obsidian-dont-appear-in-search)
  - [VAULT_PATH on Windows vs WSL](#vault_path-on-windows-vs-wsl)
  - [Multi-vault drive letter paths](#multi-vault-drive-letter-paths)
- [Index Rebuild](#index-rebuild)
  - [When to use `refresh_index`](#when-to-use-refresh_index)
  - [What it does](#what-it-does)
  - [Full reset](#full-reset)
- [Common Errors](#common-errors)
  - ["Vault not found"](#vault-not-found)
  - ["Path traversal blocked"](#path-traversal-blocked)
  - ["Note not found" / "Section not found"](#note-not-found--section-not-found)
  - ["Failed to parse frontmatter"](#failed-to-parse-frontmatter)
  - ["FTS5 index stale" / search returns outdated results](#fts5-index-stale--search-returns-outdated-results)
  - [Write operation returns "no changes"](#write-operation-returns-no-changes)
  - ["Too many tools" warning from Claude](#too-many-tools-warning-from-claude)
- [Diagnostics](#diagnostics-1)
  - [Health check](#health-check)
  - [Vault stats](#vault-stats)
  - [Server logs](#server-logs)
- [Getting Help](#getting-help)

---

## Server Startup Timeout

**Symptom:** Your MCP client reports "connection timed out" or "server failed to start."

**What happened:** The client killed the Flywheel process before the graph index finished building. On a cold start with a large vault (1k+ notes), index building can take 10-90 seconds. The MCP handshake itself completes in <1 second, but some clients wait for the first successful tool response before considering the server "ready."

**Fix:** Increase the client's startup timeout. See [Startup Times](SETUP.md#startup-times) for client-specific settings.

**What happens to the server:** When a client times out, it closes the stdio pipes. The Flywheel process receives SIGPIPE (or EPIPE on the next write attempt) and terminates. No data is lost — `.flywheel/state.db` is always in a consistent state, and any partial index build is discarded and rebuilt on next startup.

**Prevention:** After the first successful startup, Flywheel caches the graph index in StateDb. Subsequent starts load from cache in <100ms, avoiding the timeout entirely.

---

## Undoing a Mutation

### `vault_undo_last_mutation`

Every write tool records a git-backed snapshot. The undo tool performs a soft git reset (`git reset --soft HEAD~1`), which:

- Reverts the last commit
- Preserves your file changes in the working tree (staged, not lost)
- Lets you inspect what changed before deciding what to keep

**Usage:**

> "Undo the last mutation"

The tool requires explicit confirmation and optionally accepts a commit hash to prevent undoing the wrong commit.

### Going further back

For changes older than the last commit, use standard git commands on your vault:

```bash
git log --oneline -10          # see recent commits
git diff HEAD~3                # see what changed in last 3 commits
git checkout HEAD~1 -- path.md # restore a specific file
```

Flywheel commits use the prefix `[Flywheel:*]` so they're easy to identify in the log.

### Vault not a git repository

If your vault isn't initialized with git, the undo tool won't work. Flywheel's write tools skip git commits silently when git isn't available. To enable undo support:

```bash
cd /path/to/your/vault
git init
git add -A && git commit -m "Initial vault snapshot"
```

---

## StateDb Corruption

The StateDb at `.flywheel/state.db` stores everything Flywheel learns about your vault — feedback on which links are good/bad, suppression data, edge weights, agent memories, session summaries, and corrections. While notes and entities can be rebuilt from markdown in seconds, **these accumulated signals take weeks of use to develop and cannot be regenerated**. Protecting them is critical.

### Automatic Protection

Flywheel has four layers of protection:

1. **Rotated WAL-safe backups** — After each successful startup (and every 6 hours during operation), Flywheel creates a backup using SQLite's backup API, which is safe even during active WAL writes. Three rotated copies are kept: `state.db.backup` (most recent), `.backup.1`, `.backup.2`, `.backup.3`. This means even if the most recent backup is bad, older ones are available.

2. **Integrity checks** — `PRAGMA quick_check` runs after every startup and every 6 hours in the watcher pipeline. If corruption is detected, recovery triggers immediately.

3. **Automatic feedback salvage** — When corruption forces a fresh database, Flywheel automatically recovers feedback data by merging rows from all available sources (newest first): `.backup`, `.backup.1`, `.backup.2`, `.backup.3`, `.corrupt`. Each source fills in rows the previous ones didn't cover. The 9 salvaged tables are: `wikilink_feedback`, `wikilink_applications`, `suggestion_events`, `wikilink_suppressions`, `note_links`, `note_link_history`, `memories`, `session_summaries`, `corrections`.

4. **Zero-byte guard** — If `state.db` is 0 bytes (e.g., native module compilation failure), it's deleted and rebuilt.

### Files in `.flywheel/`

| File | Purpose |
|------|---------|
| `state.db` | Active database |
| `state.db-wal` | Write-ahead log (normal, auto-managed) |
| `state.db-shm` | Shared memory (normal, auto-managed) |
| `state.db.backup` | Most recent verified-good backup |
| `state.db.backup.1` | Previous backup |
| `state.db.backup.2` | Two backups ago |
| `state.db.backup.3` | Oldest backup (dropped on next rotation) |
| `state.db.corrupt` | Last corrupted file (preserved for forensics) |

### Symptoms

- Search returns no results or errors
- Entity auto-linking stops working
- Server startup fails with SQLite errors
- "database disk image is malformed" errors

### Recovery

**Most cases: Flywheel recovers automatically.** On startup, if corruption is detected, Flywheel preserves the corrupt file, creates a fresh database, and salvages feedback from backups. Check the server logs for `[vault-core] Salvaged N rows from ...` to confirm.

**Manual Option 1: Restore from a specific backup** (if automatic recovery missed something)

```bash
# Stop the MCP server first
# List available backups (newest first)
ls -lt /path/to/vault/.flywheel/state.db.backup*

# Restore the one you want
cp /path/to/vault/.flywheel/state.db.backup /path/to/vault/.flywheel/state.db
rm -f /path/to/vault/.flywheel/state.db-wal /path/to/vault/.flywheel/state.db-shm
# Restart
```

**Manual Option 2: Full rebuild** (last resort — loses learned signals)

```bash
rm -rf /path/to/vault/.flywheel/
# Restart — rebuilds everything from markdown files
```

This loses all accumulated signals. Only use if all backups are also corrupted.

### Diagnostics

- **`health_check`** — Runs `PRAGMA quick_check` to verify database integrity. Reports `healthy`, `degraded`, or `unhealthy` with recommendations.
- **`flywheel_doctor`** — Comprehensive 12-check diagnostic including database integrity, schema version, index freshness, and more.

### Prevention

- Don't modify `.flywheel/state.db` directly
- If running multiple MCP clients pointing at the same vault, be aware of potential SQLite lock contention (WAL mode handles most concurrent reads, but simultaneous writes can conflict)
- The `.flywheel/` directory is safe to add to `.gitignore` — it's entirely regenerable (but the backup files within it protect your accumulated data, so don't delete them unless you're doing a full reset)

---

## Git Lock Contention

### Symptoms

```
fatal: Unable to create '/path/to/vault/.git/index.lock': File exists.
```

This happens when a previous git operation was interrupted (crash, forced kill, timeout) and left a lock file behind.

### Recovery

1. Check if another process is actually using git:

```bash
ps aux | grep git
```

2. If no git processes are running, the lock is stale. Remove it:

```bash
rm /path/to/your/vault/.git/index.lock
```

3. Retry the operation.

### Prevention

- Avoid force-killing Claude Code or the MCP server during write operations
- If you see this error frequently, check if another tool (Obsidian git plugin, cron job, etc.) is running git commands on the same vault

---

## Windows

### Server silently fails to start

**Symptom:** MCP client shows "Connection closed" or Flywheel never appears in the server list. No error message.

**Cause:** Windows installs `npx` as `npx.cmd` (a batch script). MCP clients use `spawn()` which cannot execute `.cmd` files directly.

**Fix:** Use `cmd /c` as the command wrapper:

```json
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@velvetmonkey/flywheel-memory"],
  "env": {
    "VAULT_PATH": "C:\\Users\\you\\obsidian\\MyVault",
    "FLYWHEEL_WATCH_POLL": "true"
  }
}
```

See [CONFIGURATION.md](CONFIGURATION.md#windows) for the full client config.

### Edits in Obsidian don't appear in search

**Symptom:** Flywheel starts successfully and initial searches work, but notes you edit or create in Obsidian don't appear in search results until you restart the server.

**Cause:** Native Windows file system events (`ReadDirectoryChangesW`) are unreliable. Flywheel's file watcher misses changes.

**Fix:** Add `"FLYWHEEL_WATCH_POLL": "true"` to your MCP config `env` block. This switches to polling mode, which reliably detects changes with a small delay (~10 seconds by default, configurable via `FLYWHEEL_POLL_INTERVAL`).

### VAULT_PATH on Windows vs WSL

| Context | Path format | Example |
|---------|------------|---------|
| Native Windows | Windows backslash path | `C:\\Users\\you\\obsidian\\MyVault` |
| Flywheel inside WSL | Linux path | `/home/you/obsidian/MyVault` |
| Windows Obsidian opening a WSL vault | `\\wsl$\\...` (for Obsidian/Explorer only — not for `VAULT_PATH`) | `\\wsl$\Ubuntu\home\you\obsidian\MyVault` |

The `\\wsl$` network share lets Windows Obsidian access files on the WSL filesystem, but Flywheel running inside WSL must use the native Linux path. See [SETUP.md > WSL2](SETUP.md#wsl2-keep-your-vault-on-the-linux-filesystem) for the recommended setup.

### Multi-vault drive letter paths

Windows drive letters create ambiguity with the `name:path` separator in `FLYWHEEL_VAULTS`. A single-character vault name followed by `:\` looks like a drive letter:

```
# Ambiguous — is "C" a vault name or a drive letter?
FLYWHEEL_VAULTS="C:\Users\you\obsidian\MyVault"
```

**Fix:** Always use descriptive vault names:

```
FLYWHEEL_VAULTS="personal:C:\Users\you\obsidian\Personal,work:D:\Users\you\obsidian\Work"
```

See [CONFIGURATION.md](CONFIGURATION.md#multi-vault) for all multi-vault options.

---

## Index Rebuild

### When to use `refresh_index`

The vault index is built at startup and updated via file watcher. Use `refresh_index` when:

- Search results seem stale after editing files outside Flywheel (e.g., directly in Obsidian or a text editor)
- You bulk-imported or deleted many files
- The file watcher missed changes (rare, but possible on network drives)

**Usage:**

> "Refresh the vault index"

### What it does

1. Rescans all `.md` files in the vault
2. Rebuilds the in-memory VaultIndex (notes, backlinks, entities, tags)
3. Rebuilds the FTS5 full-text search index
4. Updates the index cache in StateDb

This takes a few seconds for most vaults. For 10k+ notes, it may take 30-60 seconds.

### Full reset

If `refresh_index` doesn't resolve the issue, delete `.flywheel/` and restart:

```bash
rm -rf /path/to/your/vault/.flywheel/
```

This forces a complete rebuild from scratch including the StateDb schema.

---

## Common Errors

### "Vault not found"

Flywheel detects the vault root by walking up from the working directory, looking for `.obsidian/` or `.claude/`.

**Fixes:**
- **Claude Code:** Run `cd /path/to/your/vault && claude`
- **Claude Desktop:** Set `VAULT_PATH` in `claude_desktop_config.json`
- Verify the vault directory contains `.obsidian/` or `.claude/`

### "Path traversal blocked"

Flywheel rejects file operations that reference paths outside the vault root. This is a security measure.

**Example:** A path like `../../etc/passwd` or an absolute path outside the vault will be blocked.

**Fix:** Use paths relative to the vault root (e.g., `projects/My Note.md`, not `/home/user/vault/projects/My Note.md`).

### "Note not found" / "Section not found"

- Check the exact file path (case-sensitive on Linux)
- Use `search` to find the correct path if unsure
- For sections, check the exact heading text with `get_note_structure`

### "Failed to parse frontmatter"

Usually caused by malformed YAML in the note's frontmatter block. Common issues:

- Unquoted strings containing colons (e.g., `title: My Note: Part 2` should be `title: "My Note: Part 2"`)
- Tabs instead of spaces in YAML
- Missing `---` delimiters

**Fix:** Edit the note's frontmatter manually to fix the YAML syntax, then retry.

### "FTS5 index stale" / search returns outdated results

The FTS5 index auto-rebuilds when stale (>1 hour since last rebuild). To force an immediate rebuild:

> "Refresh the vault index"

Or delete `.flywheel/state.db` and restart.

### Write operation returns "no changes"

The write tools detect when the content would be identical after the operation and skip the write. This is intentional -- it prevents unnecessary git commits.

### "Too many tools" warning from Claude

You're loading more tools than Claude needs. Switch to the `agent` preset, which exposes a fixed reduced set:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "agent"
  }
}
```

See [CONFIGURATION.md](CONFIGURATION.md) for preset details.

---

## Diagnostics

### Health check

> "Run a health check"

Returns: vault accessibility, index freshness, periodic note detection, configuration, and recommendations.

### Vault stats

> "Show me vault statistics"

Returns: note count, link count, tag count, orphan count, folder structure, and 7-day activity summary.

### Server logs

Flywheel logs to stderr. In Claude Code, MCP server output appears in the debug panel. Look for:

- `[Flywheel]` prefixed messages for server lifecycle events
- `[FTS5]` for search index operations
- `[Watcher]` for file watcher events

---

## Getting Help

- **GitHub Issues:** [github.com/velvetmonkey/flywheel-memory/issues](https://github.com/velvetmonkey/flywheel-memory/issues)
- **Documentation:** [docs/README.md](README.md)
