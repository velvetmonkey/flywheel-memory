# Carter Strategy

> Solo strategy consultant, 3 clients, 5 projects, $27K in invoices, and no assistant -- until now.

---

**You are**: A solo strategy consultant specializing in data migration and API architecture

**Your situation**: You juggle client work across Acme Corp, TechStart Inc, and GlobalBank. You have $12,000 in pending invoices, two active proposals worth $80K, and tasks scattered across 30 notes. Your challenge is tracking revenue, deadlines, and client relationships without anything slipping through the cracks.

## Vault map

```
carter-strategy/
├── clients/
│   ├── Acme Corp.md            ($300/hr, active)
│   ├── GlobalBank.md           ($350/hr, inactive)
│   └── TechStart Inc.md        ($250/hr, active)
├── projects/
│   ├── Acme Data Migration.md  ($75K budget, Phase 2)
│   ├── Beta Corp Dashboard.md  ($28K budget, understaffed)
│   ├── Cloud Strategy Template.md
│   ├── GlobalBank API Audit.md (completed, $52K)
│   └── TechStart MVP Build.md  (completed, $25K)
├── invoices/
│   ├── INV-2025-047.md         ($15,000 paid)
│   └── INV-2025-048.md         ($12,000 pending)
├── proposals/
│   ├── Acme Analytics Add-on.md    ($35K draft)
│   └── TechStart Phase 2.md       ($45K pending)
├── knowledge/
│   ├── API Security Checklist.md
│   ├── Data Migration Playbook.md
│   ├── Discovery Workshop Template.md
│   └── Rate Card.md
├── admin/
│   ├── Business Goals 2026.md
│   └── Quarterly Review Q4 2025.md
├── team/
│   └── Stacy Thompson.md      (40% utilization)
├── daily-notes/                (8 entries)
├── weekly-notes/               (2 entries)
└── monthly-notes/
    └── 2025-12.md
```

## Try it now

Ask Claude:

- **"How much have I billed Acme Corp?"** -- sums invoices via backlinks and frontmatter
- **"What's overdue this week?"** -- scans tasks with due dates across all notes
- **"Who's available for the Beta Corp Dashboard?"** -- cross-references team skills with project needs
- **"Summarize my Q4 2025"** -- pulls from Quarterly Review, monthly notes, and invoices
- **"What proposals need follow-up?"** -- checks proposal statuses and decision dates

## How it works

### Client revenue -- backlink traversal + frontmatter aggregation

```
You: "How much have I billed Acme Corp?"

● flywheel › get_backlinks
  path: "clients/Acme Corp.md"
  ← invoices/INV-2025-047.md
    invoices/INV-2025-048.md
    projects/Acme Data Migration.md
    proposals/Acme Analytics Add-on.md

┌─ CLAUDE THINKS ───────────────────────────────────────┐
│ Backlinks found 2 invoices. Pull frontmatter from     │
│ each to get amounts and payment status.                │
└───────────────────────────────────────────────────────┘

● flywheel › get_note_metadata
  path: "invoices/INV-2025-047.md"
  ← { amount: 15000, status: "paid", client: "Acme Corp" }

● flywheel › get_note_metadata
  path: "invoices/INV-2025-048.md"
  ← { amount: 12000, status: "pending", client: "Acme Corp" }

┌─ RESULT ──────────────────────────────────────────────┐
│ Acme Corp billing: $27,000 total                      │
│   Paid:    $15,000  (INV-2025-047, Nov 2025)          │
│   Pending: $12,000  (INV-2025-048, due Jan 15 2026)   │
│                                                        │
│ 4 tool calls, ~160 tokens read                         │
└───────────────────────────────────────────────────────┘
```

### Daily log -- write with auto-wikilinks

```
You: "Log that I finished the Acme strategy deck and prepped the TechStart proposal"

┌─ CLAUDE THINKS ───────────────────────────────────────┐
│ Write to today's daily note. Input mentions known      │
│ vault entities -- auto-wikilinks will connect them.    │
└───────────────────────────────────────────────────────┘

● flywheel › vault_add_to_section
  path: "daily-notes/2026-01-04.md"
  section: "Log"
  content: "finished the [[Acme Corp]] strategy deck and prepped the [[TechStart Phase 2]] proposal"

┌─ RESULT ──────────────────────────────────────────────┐
│ ## Log                                                 │
│ - 09:00 - Morning standup                              │
│ - 14:32 - finished the [[Acme Corp]] strategy deck     │
│   and prepped the [[TechStart Phase 2]] proposal  NEW  │
│                                                        │
│ "Acme Corp" and "TechStart Phase 2" auto-linked to     │
│ existing notes -- no manual wikilinks needed.           │
└───────────────────────────────────────────────────────┘
```

### Staffing gap -- graph query across team and projects

```
You: "Who could help with the Beta Corp Dashboard?"

● flywheel › get_note_metadata
  path: "projects/Beta Corp Dashboard.md"
  ← { skills_needed: ["React", "Dashboard", "Data Visualization"],
      staffing: "understaffed" }

● flywheel › search_notes
  query: { type: "person" }
  ← team/Stacy Thompson.md

● flywheel › get_note_metadata
  path: "team/Stacy Thompson.md"
  ← { skills: ["React", "TypeScript", "UX Design"], utilization: 40 }

┌─ RESULT ──────────────────────────────────────────────┐
│ Stacy Thompson is a strong fit:                        │
│   Skills match: React, UX Design                       │
│   Current utilization: 40% (24 hrs/week available)     │
│   Previous work: TechStart MVP Build, GlobalBank       │
│                                                        │
│ 3 tool calls, ~120 tokens read                         │
└───────────────────────────────────────────────────────┘
```

---

*30 notes across 10 folders. Just start asking questions.*

---

**Token savings**: Notes in this vault average ~120 lines (~1,800 tokens each). Flywheel graph queries return ~50-100 tokens of targeted metadata instead of reading full files -- **18-36x savings** per query, enabling hundreds of lookups in a single agentic workflow.
