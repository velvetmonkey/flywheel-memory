# Solo Operator

> One person, three revenue streams, and 16 notes running the whole business.

---

**You are**: Jordan, a solopreneur running a content business

**Your situation**: You publish "AI Tools Weekly" to 2,847 subscribers, sell an AI Automation Course ($297), and do consulting at $300/hour. January MTD revenue is $2,388 against a $5K/month target. You need an AI chief of staff that tracks revenue, subscribers, and content schedules while you stay in creative mode.

## Vault Map

```
solo-operator/
├── ops/
│   ├── Morning Briefing.md         # Daily briefing automation
│   ├── Revenue Tracker.md          # $2,388 MTD, 3 streams
│   └── Subscriber Metrics.md       # 2,847 subs, 38% open rate
├── products/
│   ├── AI Automation Course.md     # $297, 51 sales, $15,147 total
│   └── Consulting Services.md      # $300/hr, 22 hours delivered
├── content/
│   ├── 2026-01-07 AI Tools Weekly.md  # Issue #48, 42% open rate
│   ├── Content Calendar.md         # Tue/Thu newsletter schedule
│   └── Newsletter Archive.md       # Performance tracking
├── automations/
│   ├── Monthly Review.md           # End-of-month review playbook
│   └── Weekly Newsletter Prep.md   # Newsletter prep automation
├── daily-notes/                    # 4 daily operations logs
├── weekly-notes/
│   └── 2026-W01.md                 # Week 1 summary
└── Reference.md                    # Jordan's context, voice, goals
```

## Try it now

Ask Claude:

- **"How's revenue this month?"** -- pulls MTD by stream from Revenue Tracker frontmatter
- **"Run my morning briefing"** -- aggregates yesterday's log, revenue, and content due today
- **"Show me subscriber growth"** -- current count, weekly trend, and engagement metrics
- **"Prep the next newsletter"** -- gathers research, past issues, and drafts an outline
- **"Why did Tuesday's newsletter perform so well?"** -- analyzes issue #48's 42% open rate

## What you'll discover

- Track three revenue streams from frontmatter without spreadsheets
- Run automated briefings and newsletter prep playbooks
- Trace how subscriber growth drives course sales and revenue

---

## How it works

When you ask Claude questions or request changes, here's the flow:

### Check revenue (metadata only)

```
You: "How's revenue this month?"

● flywheel › get_note_metadata
  path: "ops/Revenue Tracker.md"
  → type: tracker, updated: 2026-01-07

● read_file
  path: "ops/Revenue Tracker.md"
  → Course: $1,188 | Consulting: $1,200 | Sponsors: $0
  → Total MTD: $2,388 / $5,000 target (48%)

┌─ RESULT ──────────────────────────────────────────┐
│ Revenue Dashboard (January 2026)                   │
│                                                    │
│ AI Automation Course:  $1,188 (4 sales)            │
│ Consulting Services:   $1,200 (4 hours, TechCorp)  │
│ Newsletter Sponsors:   $0 (paid mid-month)          │
│ ───────────────────────────────────────────         │
│ Total MTD: $2,388 / $5,000 (48%)                   │
│                                                    │
│ Pipeline: TechCorp 4-session expansion ($2,400)    │
└────────────────────────────────────────────────────┘

~400 tokens (1 tracker file)
```

### Morning briefing (multi-source aggregation)

```
You: "Run my morning briefing"

● flywheel › get_note_metadata
  path: "ops/Revenue Tracker.md"
  → revenue_mtd data for alerts

● flywheel › get_note_metadata
  path: "ops/Subscriber Metrics.md"
  → subscribers: 2847, weekly_growth: +36

● flywheel › get_section_content
  path: "daily-notes/2026-01-06.md"
  section: "Log"
  → Yesterday's activities

● flywheel › get_note_metadata
  path: "content/Content Calendar.md"
  → Today's scheduled content

┌─ CLAUDE THINKS ───────────────────────────────────┐
│ Combine yesterday's log + tracker metrics +        │
│ content calendar into structured briefing.          │
└────────────────────────────────────────────────────┘

┌─ RESULT ──────────────────────────────────────────┐
│ Morning Briefing                                   │
│                                                    │
│ Yesterday:                                         │
│   - 2 course sales ($594) from newsletter CTA      │
│   - Newsletter outline completed                   │
│                                                    │
│ Today:                                             │
│   - Newsletter: "5 Claude Code Workflows" (send)   │
│   - TechCorp consulting session (2pm)              │
│                                                    │
│ Alerts:                                            │
│   [green] Course sales on track                    │
│   [yellow] Subscriber growth below target (-28%)   │
└────────────────────────────────────────────────────┘

~200 tokens (metadata + 1 section read)
```

### Analyze newsletter performance (metadata + selective read)

```
You: "Why did Tuesday's newsletter perform so well?"

● flywheel › search_notes
  query: "AI Tools Weekly"
  → content/2026-01-07 AI Tools Weekly.md

● flywheel › get_note_metadata
  path: "content/2026-01-07 AI Tools Weekly.md"
  → open_rate: 0.42, click_rate: 0.091, issue: 48

┌─ CLAUDE THINKS ───────────────────────────────────┐
│ Metrics show high performance, but "why" needs     │
│ the subject line, content structure, and notes.     │
└────────────────────────────────────────────────────┘

● read_file
  path: "content/2026-01-07 AI Tools Weekly.md"
  → Subject: "5 Claude Code workflows that save me 10 hours/week"
  → 47 replies for "SYSTEM" CTA
  → Best performing issue in Q4

┌─ RESULT ──────────────────────────────────────────┐
│ Issue #48: 42% open rate (best in Q4)              │
│                                                    │
│ Why it worked:                                     │
│ 1. Subject line: number + specific outcome         │
│    "5 Claude Code workflows that save 10 hrs/week" │
│ 2. Reply CTA ("Reply SYSTEM") drove 47 replies     │
│    -- high engagement boosts deliverability         │
│ 3. Practical numbered list resonated               │
│                                                    │
│ Insight: 47 "SYSTEM" replies validate the          │
│ lead magnet idea for subscriber growth.             │
└────────────────────────────────────────────────────┘

~450 tokens (metadata + 1 file read)
```

---

*16 notes. Just start asking questions.*

---

**Token savings:** Each note in this vault averages ~100 lines (~1,500 tokens).
With Flywheel, graph queries cost ~50-100 tokens instead of reading full files.
That's **15-30x savings** per query--enabling hundreds of queries in agentic workflows.
