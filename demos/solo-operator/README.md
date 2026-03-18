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

- **"How's revenue looking?"** -- pulls MTD by stream from Revenue Tracker frontmatter
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

> Claude's exact tool path varies between runs. These traces show representative sessions.

### Check revenue (one search)

```
You: "How's revenue looking?"

● flywheel › search
  query: "revenue"
  → ops/Revenue Tracker.md
      frontmatter: { type: "tracker", mtd_total: 2388, target: 5000 }
      outlinks: AI Automation Course, Consulting Services, TechCorp

      snippet: "...Course: $1,188 (4 sales) | Consulting: $1,200 (4 hours) |
                Sponsors: $0. Total MTD: $2,388 / $5,000 target (48%)..."
    products/AI Automation Course.md
      frontmatter: { price: 297, total_sales: 51, total_revenue: 15147 }
    products/Consulting Services.md
      frontmatter: { rate: 300, hours_delivered: 22 }

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

Revenue breakdown visible in search snippets and frontmatter.
```

### Morning briefing (search + structure)

```
You: "Run my morning briefing"

● flywheel › search
  query: "morning briefing revenue subscribers"
  → ops/Morning Briefing.md

    ops/Revenue Tracker.md
      frontmatter: { mtd_total: 2388, target: 5000 }
    ops/Subscriber Metrics.md
      frontmatter: { subscribers: 2847, weekly_growth: 36 }

● flywheel › get_note_structure
  path: "ops/Morning Briefing.md" (include_content: true)
  → Briefing template with revenue, subscriber, content sections

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
```

### Analyze newsletter performance (search + read)

```
You: "Why did Tuesday's newsletter perform so well?"

● flywheel › search
  query: "AI Tools Weekly newsletter performance"
  → content/2026-01-07 AI Tools Weekly.md
      frontmatter: { open_rate: 0.42, click_rate: 0.091, issue: 48 }

      snippet: "...Subject: '5 Claude Code workflows that save me 10 hours/week'.
                Open rate: 42%, click rate: 9.1%. 47 replies for 'SYSTEM' CTA..."

┌─ CLAUDE THINKS ───────────────────────────────────┐
│ Metrics and subject line visible in search result.  │
│ Read the file for the "why" — notes and analysis.   │
└────────────────────────────────────────────────────┘

● read_file("content/2026-01-07 AI Tools Weekly.md")
  → 47 replies for "SYSTEM" CTA, best performing issue in Q4

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
```

---

*16 notes. Just start asking questions.*

---

**Token savings:** Enriched search returns revenue figures, subscriber counts, and performance metrics from frontmatter and snippets — often answering operational questions in a single call.
