# Solo Operator

> Run your one-person business with an AI chief of staff.

---

**You are**: Jordan, a solopreneur running a content business

**Your situation**: You make ~$8K/month from:
- **Newsletter**: "AI Tools Weekly" (2,800 subscribers, 2x/week)
- **Digital product**: AI Automation Course ($297)
- **Consulting**: $300/hour for AI workflow design

Your challenge: doing everything yourself. Claude Code is your chief of staff - it handles ops, tracking, and automation while you focus on creating.

## Vault Map

```
┌─────────────────────────────────────────────────────────┐
│                    SOLO OPERATOR                        │
│                                                         │
│                   ┌─────────────┐                       │
│                   │ Reference   │ (context hub)         │
│                   └──────┬──────┘                       │
│          ┌───────────────┼───────────────┐             │
│          ▼               ▼               ▼             │
│   ┌────────────┐  ┌────────────┐  ┌────────────┐       │
│   │  Revenue   │  │ Subscriber │  │  Content   │       │
│   │  Tracker   │  │  Tracker   │  │  Calendar  │       │
│   └──────┬─────┘  └──────┬─────┘  └──────┬─────┘       │
│          │               │               │             │
│          └───────────────┼───────────────┘             │
│                    updates│                            │
│                          ▼                             │
│                  ┌─────────────┐                       │
│                  │ Daily Notes │                       │
│                  └─────────────┘                       │
└─────────────────────────────────────────────────────────┘
```

---

## Try it now

Open this vault with Flywheel MCP connected, then ask Claude:

```
"Run my morning briefing"
"How's revenue this month?"
"What content is due this week?"
"Show me subscriber growth"
"How am I doing this month?"
```

---

## What you'll discover

- **Automation handles daily ops** - briefings, tracking, alerts
- **Track multiple revenue streams** in one place
- **Connect content calendar** to actual writing workflow
- **Track your wins** automatically from daily logs

---

## Quick Setup

### 1. Configure MCP

Create `.mcp.json` in this folder with your platform config:

**Windows (PowerShell/cmd)**:
```json
{
  "mcpServers": {
    "flywheel": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "C:/Users/YOU/path/to/solo-operator"
      }
    }
  }
}
```

**macOS/Linux**:
```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/solo-operator"
      }
    }
  }
}
```

### 2. Open in Claude Code

```bash
cd demos/solo-operator
claude
```

### 3. Start operating

Try: "Run my morning briefing"

---

## How it works

When you ask Claude questions or request changes, here's the flow:

### Check revenue (metadata only)

```
You: "How's revenue this month?"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Get current month revenue breakdown         │
│ Strategy: Read tracker frontmatter only             │
│ Tools: mcp__flywheel__get_note_metadata             │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__get_note_metadata("ops/Revenue...")  │
│   → revenue_mtd: 2888                               │
│   → target: 8000                                    │
│   → course_sales: 1188                              │
│   → consulting: 1200                                │
│   → sponsors: 500                                   │
│                                                     │
│ Total: ~60 tokens (vs ~800 reading full file)       │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE SYNTHESIZES ────────────────────────────────┐
│ Frontmatter has all metrics - no file read needed   │
│ Calculate percentage, format dashboard              │
└─────────────────────────────────────────────────────┘

Revenue Dashboard (January 2026)
================================
Course Sales: $1,188 (4 sales)
Consulting: $1,200 (4 hours)
Newsletter Sponsors: $500/mo
--------------------------------
Total MTD: $2,888 / $8,000 (36%)
```

### Morning briefing (multi-source + file read)

```
You: "Run my morning briefing"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Compile yesterday + today + alerts          │
│ Strategy: Multiple metadata queries + content read  │
│ Tools: mcp__flywheel__get_note_metadata (×3),       │
│        Read for yesterday's log content             │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__get_note_metadata("ops/Revenue...")  │
│   → revenue_mtd, target (for alerts)                │
│                                                     │
│ mcp__flywheel__get_note_metadata("ops/Subscriber..")│
│   → subscribers: 2847, growth_this_month: 47        │
│                                                     │
│ mcp__flywheel__get_tasks_with_due_dates             │
│   → content/: 2 tasks due this week                 │
│                                                     │
│ Total: ~120 tokens                                  │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE DECIDES: NEED YESTERDAY'S DETAILS ──────────┐
│ Metadata shows metrics, but briefing needs          │
│ yesterday's actual activities from ## Log           │
└─────────────────────────────────────────────────────┘

┌─ SELECTIVE FILE READ ───────────────────────────────┐
│ Read("daily-notes/2026-01-06.md")                   │
│   → ## Log section with activities                  │
│                                                     │
│ Total: ~200 tokens (1 daily note)                   │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE SYNTHESIZES ────────────────────────────────┐
│ Combines: yesterday's log + tracker metrics +       │
│ content calendar tasks → structured briefing        │
└─────────────────────────────────────────────────────┘

## Briefing

**Yesterday:**
- 2 course sales ($594)
- Newsletter outline completed
- Identified subscriber growth concern

**Today:**
- Draft next newsletter (due Thu)
- TechCorp consulting session (2pm)

**Alerts:**
- [yellow] Subscriber growth below target (-28%)
```

### Add a log entry (write operation)

```
You: "log sent newsletter, 42% open rate"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Append to today's log section               │
│ Strategy: Direct write - no reads needed            │
│ Tools: mcp__flywheel__vault_add_to_section    │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL WRITES ──────────────────────────────────────┐
│ mcp__flywheel__vault_add_to_section           │
│   path: "daily-notes/2026-01-07.md"                 │
│   section: "Log"                                    │
│   content: "sent newsletter, 42% open rate"         │
│   format: "timestamp-bullet"                        │
└─────────────────────────────────────────────────────┘

## Log
- 09:00 Morning review
- 10:30 sent newsletter, 42% open rate             ← NEW
```

### Analyze a newsletter (requires file read)

```
You: "Why did Tuesday's newsletter perform so well?"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Understand what drove high performance      │
│ Strategy: Get metadata first, then read content     │
│ Tools: mcp__flywheel__search_notes, then Read       │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__search_notes("Tuesday newsletter")   │
│   → content/2026-01-07 AI Tools Weekly.md           │
│                                                     │
│ mcp__flywheel__get_note_metadata("content/2026...") │
│   → open_rate: 0.42, click_rate: 0.091              │
│   → course_sales: 1                                 │
│                                                     │
│ Total: ~80 tokens                                   │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE DECIDES: NEED CONTENT ANALYSIS ─────────────┐
│ Metrics show it performed well, but "why" requires  │
│ reading the subject line, content, and notes        │
└─────────────────────────────────────────────────────┘

┌─ SELECTIVE FILE READ ───────────────────────────────┐
│ Read("content/2026-01-07 AI Tools Weekly.md")       │
│   → Subject line, content structure, ## Notes       │
│                                                     │
│ Total: ~400 tokens (1 file)                         │
└─────────────────────────────────────────────────────┘

Claude: "Tuesday's 42% open rate (best in Q4) likely
came from: 1) Number + specific outcome subject line
('5 workflows that save me 10 hours/week'), 2) Reply
CTA ('Reply SYSTEM') drove 47 replies - high engagement
signals boost deliverability."
```

---

## Vault structure

```
solo-operator/
├── daily-notes/        # Daily operations log
├── weekly-notes/       # AI-generated weekly summaries
├── content/            # Newsletter and content calendar
├── products/           # Course and consulting tracking
├── ops/                # Revenue and subscriber metrics
├── automations/        # Playbooks for recurring workflows
├── Reference.md        # Personal context for AI
└── .claude/            # Custom commands and config
```

---

## The pattern

This vault demonstrates the "AI-first operator" pattern:

1. **Reference.md** gives Claude context about you
2. **Daily notes** capture everything with `## Log`
3. **Tracker notes** aggregate data with queryable frontmatter
4. **Automation notes** define recurring workflows
5. **`.claude/commands/`** provides quick triggers

The result: Claude operates as your chief of staff, handling the operational overhead while you focus on creating value.

---

*22 notes. Just start asking questions.*

---

**Token savings:** Each note in this vault averages ~140 lines (~2,100 tokens).
With Flywheel, graph queries cost ~50-100 tokens instead of reading full files.
That's **21-42x savings** per query—enabling hundreds of queries in agentic workflows.
