# OpenClaw Integration

[← Back to docs](README.md)

Use this when you want Flywheel to be the vault-memory layer behind an OpenClaw bot.

- [What This Setup Does](#what-this-setup-does)
- [Recommended Pattern](#recommended-pattern)
- [Step 1: Add Flywheel to OpenClaw MCP](#step-1-add-flywheel-to-openclaw-mcp)
- [Step 2: Put It on a Dedicated Agent](#step-2-put-it-on-a-dedicated-agent)
- [Step 3: Bind Channels to That Agent](#step-3-bind-channels-to-that-agent)
- [Step 4: Choose the Right Flywheel Preset](#step-4-choose-the-right-flywheel-preset)
- [Step 5: Prompting and Workflow Pattern](#step-5-prompting-and-workflow-pattern)
- [Hooks vs Agent Turns](#hooks-vs-agent-turns)
- [ACP Note](#acp-note)
- [Complete Example](#complete-example)
- [References](#references)

---

## What This Setup Does

OpenClaw owns the chat surface: channels, routing, session state, safety, and agent runtime.

Flywheel owns the vault surface: indexing, retrieval, graph traversal, structured note mutations, tasks, and persistent vault memory.

That split is the useful one. OpenClaw should not be asked to "be the vault." It should call Flywheel when the conversation needs grounded vault context or a vault write.

---

## Recommended Pattern

For most deployments:

- Keep your OpenClaw workspace separate from your Obsidian vault.
- Point Flywheel at the vault with `VAULT_PATH`.
- Route the channels that should have vault access to a dedicated OpenClaw agent.
- Let that agent use Flywheel as an MCP server plus OpenClaw's own built-in tools.

Why separate the workspace from the vault:

- OpenClaw workspace files (`AGENTS.md`, session/bootstrap files, generated artifacts) stay out of your notes.
- Flywheel indexes only the vault you intend it to index.
- You can give one OpenClaw agent vault access without making every agent share the same note-writing surface.

If you intentionally want the OpenClaw workspace and the Obsidian vault to be the same folder, that also works, but it is a different tradeoff.

---

## Step 1: Add Flywheel to OpenClaw MCP

Add Flywheel to `~/.openclaw/openclaw.json`:

```json
{
  "mcp": {
    "servers": {
      "flywheel": {
        "command": "npx",
        "args": ["-y", "@velvetmonkey/flywheel-memory"],
        "env": {
          "VAULT_PATH": "/path/to/your/vault"
        }
      }
    }
  }
}
```

This is the minimum useful integration:

- `VAULT_PATH` points Flywheel at the Obsidian vault you want the bot to use
- Flywheel defaults to the `agent` tool surface. Set `FLYWHEEL_TOOLS` to expand it (see Step 4).

Restart OpenClaw after editing the config.

---

## Step 2: Put It on a Dedicated Agent

OpenClaw works best when vault-backed conversations have their own agent config instead of sharing the default agent with everything else.

Example:

```json
{
  "agents": {
    "list": [
      {
        "id": "vault",
        "name": "Vault Agent",
        "workspace": "~/.openclaw/workspace-vault",
        "tools": {
          "profile": "full"
        }
      }
    ]
  }
}
```

Why `tools.profile: "full"` here:

- In OpenClaw, `tools.profile` controls the base allowlist for OpenClaw's own tools.
- `full` means "no restriction" in OpenClaw's current docs.
- That gives the agent access to OpenClaw's built-in tools alongside Flywheel's MCP tools.

If you want a tighter OpenClaw tool policy, start from `coding` or `messaging` and explicitly allow what you need. That is separate from Flywheel's own `FLYWHEEL_TOOLS` preset.

---

## Step 3: Bind Channels to That Agent

Once the dedicated agent exists, bind the channels that should have vault access to it.

Example:

```json
{
  "bindings": [
    {
      "agentId": "vault",
      "match": {
        "channel": "telegram",
        "accountId": "default"
      }
    }
  ]
}
```

That pattern scales well:

- one agent for personal note capture
- another for work knowledge
- another with no vault access at all

OpenClaw's `bindings[]` model is the right place to decide which conversations get Flywheel-backed memory.

---

## Step 4: Choose the Right Flywheel Preset

`FLYWHEEL_TOOLS` is the main Flywheel-side control.

| Preset | When to use it | What you get |
|--------|----------------|--------------|
| `agent` (default) | Best starting point for most OpenClaw bots | search, read, write, tasks, memory |
| `agent,graph,wikilinks` | Good middle ground for assistant-style bots that need richer graph context | agent plus graph and linking tools |
| `full` | When the bot needs the entire vault surface immediately | All tools visible up front |

Recommended starting point:

- The default (`agent`) covers note capture, search, task updates, and general vault Q&A.
- Add bundles for specific capabilities (e.g. `agent,graph` for graph analysis).
- Use `full` when you want graph analysis, schema tools, diagnostics, temporal tools, and policy authoring without revisiting the config.

The important distinction:

- OpenClaw `tools.profile` controls OpenClaw's built-in tools
- Flywheel `FLYWHEEL_TOOLS` controls Flywheel's MCP surface

You usually want to think about both.

---

## Step 5: Prompting and Workflow Pattern

The pattern that works well in OpenClaw is:

1. Use `search` first for almost every vault question.
2. Use `memory(action: "brief")` to cold-start a long-running agent that should remember recent vault state.
3. Use `memory` for durable bot-side observations or handoff notes that should survive session resets.
4. Use `edit_section(action: add)`, `vault_add_task`, and related write tools for structured capture.
5. Use `suggestOutgoingLinks: true` for chat-to-note or voice-to-note capture flows where graph growth matters.

In practice that means:

- "What did we agree with Acme last week?" -> `search`
- "Pick up where we left off" -> `memory(action: "brief")`
- "Remember that Sarah prefers Tuesday reviews" -> `memory`
- "Log this meeting note into today's daily note" -> `edit_section(action: add)`

For capture-heavy bots, ask the model to prefer structured writes over raw file dumping. Flywheel is strongest when the bot writes to known sections, updates tasks explicitly, and lets auto-wikilinks densify the graph.

---

## Hooks vs Agent Turns

This distinction matters:

- **Agent-turn integration**: OpenClaw exposes Flywheel to the model as MCP tools during a normal agent run.
- **Hook integration**: OpenClaw runs hook code on gateway events like inbound messages, transcriptions, resets, and startup.

OpenClaw's current hooks docs list message-level events including:

- `message:received`
- `message:transcribed`
- `message:preprocessed`
- `message:sent`

So there is not a "missing per-message hook" problem in OpenClaw itself.

The actual boundary is this:

- adding Flywheel under `mcp.servers` makes Flywheel available during agent turns
- it does **not** automatically make Flywheel run on every inbound message before the model turn

If you want deterministic per-message ingestion, such as "every voice note gets written to the vault even if the agent would not have chosen to do it," that is a **custom hook** design, not just MCP wiring.

Recommended documentation stance:

- start with normal agent-turn integration first
- use hooks only when you specifically want guaranteed event-driven behavior on every message

That keeps the base setup simple while still matching OpenClaw's actual capabilities.

---

## ACP Note

If you use OpenClaw ACP sessions, configure Flywheel on the OpenClaw gateway or agent, not per ACP session.

OpenClaw's current ACP docs explicitly say per-session `mcpServers` are unsupported in bridge mode. The recommended pattern is:

- configure Flywheel in OpenClaw config
- route the ACP session to the agent that already has Flywheel available

That matters for Codex, Claude Code, and other ACP-backed sessions launched from OpenClaw.

---

## Complete Example

```json
{
  "mcp": {
    "servers": {
      "flywheel": {
        "command": "npx",
        "args": ["-y", "@velvetmonkey/flywheel-memory"],
        "env": {
          "VAULT_PATH": "/home/you/obsidian/WorkVault"
        }
      }
    }
  },
  "agents": {
    "list": [
      {
        "id": "vault",
        "workspace": "~/.openclaw/workspace-vault",
        "tools": {
          "profile": "full"
        }
      }
    ]
  },
  "bindings": [
    {
      "agentId": "vault",
      "match": {
        "channel": "telegram",
        "accountId": "default"
      }
    }
  ]
}
```

From there:

- the Telegram bot talks to the `vault` agent
- the `vault` agent can call Flywheel
- Flywheel indexes and mutates the Obsidian vault at `VAULT_PATH`

---

## References

- OpenClaw configuration: <https://docs.openclaw.ai/gateway/configuration>
- OpenClaw configuration reference: <https://docs.openclaw.ai/gateway/configuration-reference>
- OpenClaw tools and tool profiles: <https://docs.openclaw.ai/tools>
- OpenClaw hooks and message events: <https://docs.openclaw.ai/automation/hooks>
- OpenClaw ACP note on MCP placement: <https://docs.openclaw.ai/tools/acp-agents>
