# Troubleshooting

Error recovery and diagnostics for Flywheel Memory.

**Safety model:** Your markdown files are the source of truth. Everything in `.flywheel/` is derived data and can be safely deleted -- Flywheel rebuilds it on next startup.

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

The StateDb at `.flywheel/state.db` stores the FTS5 search index, entity index, index cache, and configuration. It is entirely derived from your markdown files.

### Symptoms

- Search returns no results or errors
- Entity auto-linking stops working
- Server startup fails with SQLite errors
- "database disk image is malformed" errors

### Recovery

Delete the `.flywheel/` directory and restart the server:

```bash
rm -rf /path/to/your/vault/.flywheel/
```

Flywheel recreates `.flywheel/state.db` on next startup by scanning your vault. For a vault with a few thousand notes, this takes a few seconds.

### Prevention

- Don't modify `.flywheel/state.db` directly
- If running multiple MCP clients pointing at the same vault, be aware of potential SQLite lock contention (WAL mode handles most concurrent reads, but simultaneous writes can conflict)

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

Flywheel detects the vault root by walking up from the working directory, looking for `.obsidian/` or `.mcp.json`.

**Fixes:**
- **Claude Code:** Run `cd /path/to/your/vault && claude`
- **Claude Desktop:** Set `VAULT_PATH` in `claude_desktop_config.json`
- Verify the vault directory contains `.obsidian/` or `.mcp.json`

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

You're loading more tools than Claude needs. Switch to a smaller preset:

```json
{
  "env": {
    "FLYWHEEL_TOOLS": "minimal"
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
