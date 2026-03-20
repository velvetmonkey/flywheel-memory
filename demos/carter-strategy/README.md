# Carter Strategy

> Solo strategy consultant, 4 clients, 6 projects, 8 invoices, 6 team members, and no assistant -- until now.

---

**You are**: A solo strategy consultant specializing in data migration and API architecture

**Your situation**: You juggle client work across Acme Corp, TechStart Inc, GlobalBank, and newer clients Meridian Financial and Nexus Health. You have outstanding invoices, active proposals worth $80K+, and tasks scattered across 50 notes. Your challenge is tracking revenue, deadlines, team utilization, and client relationships without anything slipping through the cracks.

## Vault map

```
carter-strategy/
├── clients/
│   ├── Acme Corp.md              ($300/hr, active)
│   ├── GlobalBank.md             ($350/hr, inactive)
│   ├── Meridian Financial.md     (prospect)
│   ├── Nexus Health.md           (prospect)
│   └── TechStart Inc.md          ($250/hr, active)
├── projects/
│   ├── Acme Data Migration.md    ($75K budget, Phase 2)
│   ├── Beta Corp Dashboard.md    ($28K budget, understaffed)
│   ├── Cloud Strategy Template.md
│   ├── GlobalBank API Audit.md   (completed, $52K)
│   ├── TechStart MVP Build.md    (completed, $25K)
│   └── TechStart Phase 2.md
├── invoices/
│   ├── INV-2025-047.md           ($15,000 paid)
│   ├── INV-2025-048.md           ($12,000 pending)
│   ├── INV-2026-001.md through INV-2026-006.md
├── proposals/
│   ├── Acme Analytics Add-on.md                ($35K draft)
│   ├── Meridian Financial API Modernization.md
│   ├── Nexus Health Cloud Assessment.md
│   └── TechStart Phase 2.md                    ($45K pending)
├── knowledge/
│   ├── API Security Checklist.md
│   ├── Data Migration Playbook.md
│   ├── Discovery Workshop Template.md
│   ├── Rate Card.md
│   └── Subcontractor Management Guide.md
├── admin/
│   ├── Business Goals 2026.md
│   └── Quarterly Review Q4 2025.md
├── team/
│   ├── Dan Oliveira.md
│   ├── Leila Farouk.md
│   ├── Marcus Webb.md
│   ├── Priya Kapoor.md
│   ├── Sarah Mitchell.md
│   └── Stacy Thompson.md        (40% utilization)
├── daily-notes/                  (8 entries)
├── weekly-notes/                 (2 entries)
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

> Claude's exact tool path varies between runs. These traces show representative sessions.

### Client revenue -- one search, zero reads

```
You: "How much have I billed Acme Corp?"

● flywheel › search
  query: "Acme Corp billing invoice"
  → clients/Acme Corp.md
      frontmatter: { total_billed: 156000, rate: 300, status: "active" }
      backlinks: INV-2025-047.md, INV-2025-048.md, Acme Data Migration.md, +28
      outlinks: Sarah Mitchell, INV-2025-047, INV-2025-048, Acme Data Migration, +25
    invoices/INV-2025-048.md
      frontmatter: { amount: 12000, status: "pending", period: "December 2025" }
      backlinks: Acme Corp.md, Acme Data Migration.md, +10
    invoices/INV-2025-047.md
      frontmatter: { amount: 15000, status: "paid", period: "November 2025" }
      backlinks: Acme Corp.md, INV-2025-048.md, +8

┌─ RESULT ──────────────────────────────────────────────┐
│ Acme Corp: $156K total billed                         │
│                                                       │
│   Paid:    $15,000 — Acme Data Migration (Nov 2025)   │
│   Pending: $12,000 — Acme Data Migration (Dec 2025)   │
│                                                       │
│ Also: $35K pending proposal (Analytics Add-on)        │
└───────────────────────────────────────────────────────┘

One search returned everything — frontmatter, backlinks, outlinks.
Zero file reads needed. ~$0.03 / 19s
```

### Daily log -- write with auto-wikilinks

```
You: "Log that Stacy Thompson is starting on the Beta Corp Dashboard and reviewed the API Security Checklist"

┌─ CLAUDE THINKS ───────────────────────────────────────┐
│ Write to today's daily note. Input mentions known      │
│ vault entities -- auto-wikilinks will connect them.    │
└───────────────────────────────────────────────────────┘

● flywheel › vault_add_to_section
  path: "daily-notes/2026-01-04.md"
  section: "Log"
  content: "[[Stacy Thompson]] is starting on the [[Beta Corp Dashboard]] and reviewed the [[API Security Checklist]]"

┌─ RESULT ──────────────────────────────────────────────┐
│ ## Log                                                 │
│ - 09:00 - Morning standup                              │
│ - 14:32 - [[Stacy Thompson]] is starting on the        │
│   [[Beta Corp Dashboard]] and reviewed the              │
│   [[API Security Checklist]]                    NEW     │
│                                                        │
│ 3 entities auto-linked across team/, projects/, and    │
│ knowledge/ -- no manual wikilinks needed.               │
└───────────────────────────────────────────────────────┘
```

### Staffing gap -- search finds the match

```
You: "Who could help with the Beta Corp Dashboard?"

● flywheel › search
  query: "Beta Corp Dashboard"
  → projects/Beta Corp Dashboard.md
      frontmatter: { status: "active", skills_needed: ["React", "Dashboard", "Data Visualization"],
                     staffing: "understaffed" }
      outlinks: Beta Corp, Stacy Thompson, TechStart Inc, React, +8

    team/Stacy Thompson.md
      frontmatter: { skills: ["React", "TypeScript", "UX Design"], utilization: 0.4 }


┌─ RESULT ──────────────────────────────────────────────┐
│ Stacy Thompson is a strong fit:                        │
│   Skills match: React, UX Design                       │
│   Current utilization: 40% (24 hrs/week available)     │
│   Previous work: TechStart MVP Build, GlobalBank       │
└───────────────────────────────────────────────────────┘

Search returned team skills and project requirements together.
Zero file reads needed.
```

---

*50 notes across 10 folders. Just start asking questions.*

---

**Token savings**: Enriched search returns frontmatter, backlinks, outlinks, and headings — often answering the question in a single call with zero file reads.
