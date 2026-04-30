---
name: flywheel
description: Install and use the Flywheel MCP server to give an agent grounded memory over an Obsidian vault or any folder of plain Markdown notes — search, read, and safely write through bounded tool calls instead of raw Read/Grep/Edit.
when_to_use: |
  Use when the user wants AI memory over their Markdown notes. Trigger phrases:
  "memory for my vault", "search my notes", "second brain for AI",
  "let Claude (or Codex) work over my Obsidian", "Obsidian + agent",
  "give my agent my notes". Do not use for code repositories, non-Markdown
  directories, or when the user explicitly wants raw filesystem reads.
---

Flywheel turns a folder of `.md` files into a queryable knowledge layer over MCP. This skill walks the agent through registering the MCP server, restarting the client, and using the bounded read/write surface that follows.

## When to use this skill

Apply when:

- The current directory (or a directory the user names) is a folder of Markdown notes — Obsidian-managed or not.
- The user wants the agent to *answer from* their notes, *cite* them, or *append* to them.
- The user asks for "memory", "second brain", or "search my vault".

Do **not** apply for:

- Code repositories (use `Read`/`Grep`/`Edit`).
- One-shot file edits where the agent already knows the path.
- Non-Markdown content (HTML, code, binary files).

## Compatibility

| Runtime | How the skill loads |
|---|---|
| Claude Code | Auto-discovered from `<vault>/.claude/skills/flywheel/SKILL.md` after the install script runs. |
| Codex CLI | Copy `SKILL.md` to `~/.codex/skills/flywheel/SKILL.md` manually, or have the install script do it (`--codex` flag). |
| ChatGPT (Custom GPT) | Paste the body of this `SKILL.md` into the GPT instruction set. The MCP install path (`.mcp.json`) does not apply. |

The `.mcp.json` register step works in any client that speaks the Model Context Protocol — Claude Code, Codex CLI, Cursor, Windsurf, VS Code with MCP extensions, etc. See the project README's [client setup guide](../../docs/SETUP.md) for client-specific config differences.

## Prerequisites

Before installing, confirm:

1. **Node ≥ 18** is on PATH. `node --version` should print `v18` or higher. The MCP server runs via `npx`; npx is bundled with npm.
2. **A folder of `.md` files.** It does not need to be a fully-fledged Obsidian vault — Flywheel works on plain Markdown directories.
3. **Write access** to the vault directory. Flywheel keeps a local index at `<vault>/.flywheel/state.db` and (when run via the install script) copies this skill into `<vault>/.claude/skills/flywheel/`.

If any prerequisite is missing, stop and tell the user what to install before continuing.

## Install (one-time, per vault) — STOP after this step

The MCP server registration only takes effect on the **next** client launch. Do not call any `mcp__flywheel__*` tool until the user has restarted their client.

### Automated install (recommended)

From the vault directory:

**POSIX (macOS/Linux/WSL):**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/velvetmonkey/flywheel-memory/main/skills/flywheel/scripts/install.sh)
```

Or, if the user already has the `flywheel-memory` repo cloned:

```bash
bash /path/to/flywheel-memory/skills/flywheel/scripts/install.sh
```

**Windows (PowerShell):**

```powershell
iex (irm https://raw.githubusercontent.com/velvetmonkey/flywheel-memory/main/skills/flywheel/scripts/install.ps1)
```

The script:

1. Writes (or merges) `.mcp.json` in the current directory with the canonical Flywheel snippet.
2. Copies this `SKILL.md` to `<vault>/.claude/skills/flywheel/SKILL.md` so Claude Code auto-discovers it next session.
3. Prints the restart instruction.

### Manual install

Add to the vault's `.mcp.json`:

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

Windows users: replace `"command": "npx"` with `"command": "cmd"` and prepend `"/c", "npx"` to args, plus set `FLYWHEEL_WATCH_POLL: "true"`. See the project README's Windows section.

### After install — restart the client

```text
1. Exit your current client session (Ctrl+D / `exit` / close the window).
2. Re-launch from the vault directory: `claude` or `codex`.
3. The Flywheel MCP server starts on first tool call (≈3-5s warmup via npx).
```

**Stop here on first install.** Tell the user: *"`.mcp.json` is written. Exit and re-launch `claude` (or `codex`) from this directory, then ask me again."* Do not attempt to call Flywheel tools in the same session — they are only registered at client startup.

## Pick a preset before querying

Flywheel exposes three preset tiers. The default `agent` preset is narrow — pick the right tier *before* attempting a query so the right tool is available.

| Preset | When to use | How to set |
|---|---|---|
| `agent` (default, 12-13 tools) | First-time use, simple search + write workflows. | Default — no config change. |
| `power` (17 tools) | Wikilink work, alias hygiene, corrections, schema renames. | Add `"env": { "FLYWHEEL_TOOLS": "power" }` under the server config in `.mcp.json`. |
| `full` (19 tools) | Graph traversal, temporal analysis, cross-vault, advanced diagnostics. | Set `FLYWHEEL_TOOLS` to `full`. |
| `auto` (20 tools) | Full surface plus runtime tool discovery via `discover_tools`. | Set `FLYWHEEL_TOOLS` to `auto`. |

Under Claude Code (`CLAUDECODE=1`), the `memory` tool is suppressed because Claude Code ships its own memory plane — the agent preset exposes 12 tools instead of 13. The briefing entrypoint still works via `memory(action: "brief")` if explicitly required.

## Tool surface (agent preset)

Once the MCP is live, prefer these tools over raw filesystem operations:

| Tool | Purpose | Idiom |
|---|---|---|
| `mcp__flywheel__search` | Hybrid BM25 + semantic search across the vault. | First call for any "find X" / "what do I know about X" question. |
| `mcp__flywheel__read` | Note structure (`action: structure`), one section (`action: section`), or vault-wide heading search (`action: sections`). | After `search`, when the snippet is not enough. |
| `mcp__flywheel__find_notes` | Enumerate notes by folder, tag, or frontmatter. | Structural listing — not relevance-ranked search. |
| `mcp__flywheel__edit_section` | Bounded write to a named section (`action: add` / `remove` / `replace`). | Use instead of `Edit` for any vault write. Single section target = high reliability. |
| `mcp__flywheel__note` | Create / move / rename / delete a note. | Whole-note operations only. |
| `mcp__flywheel__memory` | Cross-session memory store (`action: store` / `get` / `search` / `brief`). | Suppressed under Claude Code; do not call here. |
| `mcp__flywheel__tasks` | List or toggle tasks (`action: list` / `toggle`). | Task-frontmatter aware. |

Full tool reference: [docs/TOOLS.md](../../docs/TOOLS.md). Browse with `mcp__flywheel__doctor` (`action: pipeline` / `health` / `stats`) when a query returns unexpected results.

## Read/write idiom

The shape Flywheel rewards:

1. **Search first.** Issue `search(query: "...")` with the user's natural language. The result includes ranked snippets, section provenance, frontmatter, backlinks, and outlinks — usually enough to answer without reading full files.
2. **Cite, don't paraphrase.** When answering, name the path and quote the section so the user can verify in their vault.
3. **Read on escalation.** If the snippet is insufficient, call `read(action: structure, path: "...")` for the outline plus metadata, or `read(action: section, path: "...", heading: "...")` for one section's full text.
4. **Write through `edit_section`.** Never use `Edit` to modify vault files — the bounded `edit_section(action: add)` preserves Markdown structure, supports rollback via the local Git mirror, and triggers the wikilink suggestion pipeline. Target a single named section.

## Verification (run on a fresh install)

After the user restarts the client and asks a vault question:

1. **Tool registration check.** Before the first user query, confirm `mcp__flywheel__search` appears in the available tool list. If not, the MCP server failed to register — re-check `.mcp.json` and tell the user to fully exit (not just `/clear`) and relaunch.
2. **Search smoke test.** Run a known-good query that should hit something in the vault (e.g., the user's own name from a daily note). Confirm the result is grounded in their actual files (paths returned should exist on disk).
3. **Bounded write smoke test.** Pick a note with at least one `## ` section. Run `edit_section(action: add, path: <note>, section: <heading>, content: "Status: paid")`. Confirm the file on disk now contains that line under that section, with surrounding content intact.

If any of the three fails, do not proceed with the user's actual task — surface the failure first.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `mcp__flywheel__*` tools missing from tool list | MCP not registered, or client not restarted after `.mcp.json` write. | `cat .mcp.json` → confirm the `flywheel` block exists. Fully exit the client and relaunch. |
| Search returns empty | Index not yet built, or wrong directory. | Wait 5-10s for the watcher to ingest, or run `mcp__flywheel__refresh_index`. Confirm `pwd` is the vault root. |
| Stale results after editing files | Watcher missed an event (common on Windows / network drives). | Run `mcp__flywheel__refresh_index` to force a full rescan. As last resort: delete `.flywheel/state.db` and let Flywheel rebuild. |
| Write succeeds but section content looks wrong | `section` heading text didn't match the file's heading. | Call `read(action: structure, path: ...)` first to confirm the exact heading text, then retry the write. |

## Reference

- Project README and full tool reference: `../../README.md`, `../../docs/TOOLS.md`.
- Multi-vault config: `../../docs/CONFIGURATION.md#multi-vault`.
- Client-specific setup (Cursor, VS Code, Windsurf, etc.): `../../docs/SETUP.md`.
- Demo prompts that exercise this skill: [examples/carter-strategy-queries.md](examples/carter-strategy-queries.md).
