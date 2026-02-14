# Flywheel Demos

> Open any demo folder in Claude Code and start asking questions.

---

## 🎬 Quick Demo (VHS Recording)

Want to see Flywheel in action first? Check out the [**flywheel-demo.gif**](./flywheel-demo.gif) showcasing:
- **Hub finder:** Identify your most connected notes
- **Backlink analysis:** See what links to a specific note
- **Quick navigation:** Open notes directly from queries

**Regenerate the demo:**
```bash
cd /path/to/flywheel-memory
vhs demos/flywheel-demo.tape
```

*Requires [VHS](https://github.com/charmbracelet/vhs) and ffmpeg. The demo script simulates Claude Code interactions with realistic terminal output.*

---

## Pick a Demo (ordered by complexity)

| Demo | You Are | Ask Claude |
|------|---------|------------|
| [**Carter Strategy**](./carter-strategy/) | Solo strategy consultant | "What's overdue this week?" |
| [**Artemis Rocket**](./artemis-rocket/) | Chief Engineer at a rocket startup | "What's the propulsion system status?" |
| [**Startup Ops**](./startup-ops/) | Co-founder of a SaaS startup | "Walk me through onboarding a customer" |
| [**Nexus Lab**](./nexus-lab/) | PhD researcher in computational biology | "How does AlphaFold connect to my experiment?" |

---

## Getting Started

1. Navigate to a demo vault:
```bash
cd demos/carter-strategy
```

2. Create `.mcp.json` with Flywheel configuration:
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

3. Start Claude Code and verify connection:
```
mcp__flywheel__health_check()
```

Then start asking questions about the business.

---

## Why Flywheel Saves Tokens

**The problem:** LLMs like Claude have no persistent memory between queries. Every time you ask "What's blocking propulsion?", Claude must:

1. **Read the relevant files** into its context window
2. **Process the content** to find the answer
3. **Discard everything** when the response is complete

Ask a follow-up question? Claude reads the files again. Run an agentic workflow with 50 queries? That's 50 file reads.

```
Without Flywheel (3 related queries):
┌──────────────────────────────────────────────────────────┐
│ Query 1: "What's blocking propulsion?"                   │
│   Read: propulsion.md (2,500 tokens)                     │
│   Read: turbopump.md (1,800 tokens)                      │
│   Read: supplier.md (1,200 tokens)                       │
│   Total: 5,500 tokens                                    │
│                                                          │
│ Query 2: "Who owns the turbopump work?"                  │
│   Read: turbopump.md (1,800 tokens) ← AGAIN              │
│   Read: team-roster.md (900 tokens)                      │
│   Total: 2,700 tokens                                    │
│                                                          │
│ Query 3: "What decisions affect turbopump?"              │
│   Read: turbopump.md (1,800 tokens) ← AGAIN              │
│   Read: decisions/DR-003.md (600 tokens)                 │
│   Read: decisions/DR-007.md (550 tokens)                 │
│   Total: 2,950 tokens                                    │
│                                                          │
│ Session total: 11,150 tokens                             │
└──────────────────────────────────────────────────────────┘

With Flywheel (same 3 queries):
┌──────────────────────────────────────────────────────────┐
│ Query 1: mcp__flywheel__get_note_metadata (×3)           │
│   → frontmatter only: ~120 tokens                        │
│                                                          │
│ Query 2: mcp__flywheel__get_backlinks + metadata         │
│   → link data only: ~80 tokens                           │
│                                                          │
│ Query 3: mcp__flywheel__search_notes + metadata          │
│   → index results: ~100 tokens                           │
│                                                          │
│ Session total: ~300 tokens (37x savings)                 │
└──────────────────────────────────────────────────────────┘
```

**The key insight:** Most queries don't need full file content. Flywheel returns just the metadata, links, and structure—letting Claude answer from the index instead of re-reading files.

When Claude *does* need full content (explaining "why" or reading detailed notes), it does a **selective file read** of just that one file, not the entire vault.
