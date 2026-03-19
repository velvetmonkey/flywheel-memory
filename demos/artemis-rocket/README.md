# Artemis Rocket

> You're Chief Engineer at a 15-person aerospace startup building a small launch vehicle. 63 notes track propulsion, avionics, GNC, structures, suppliers, decisions, and your team -- Flywheel connects them all.

---

## Vault Map

```
artemis-rocket/
├── daily-notes/           # 11 standup logs (## Log with timestamps)
│   ├── 2025-12-23.md
│   ├── ...
│   └── 2026-01-02.md
├── decisions/             # 5 Architecture Decision Records
│   ├── ADR-001 Propellant Selection.md
│   ├── ADR-002 Flight Computer.md
│   ├── ADR-003 Landing Strategy.md
│   ├── ADR-004 Test Campaign.md
│   └── ADR-005 Telemetry Protocol.md
├── meetings/              # 6 meeting notes
│   ├── 2025-12-18 PDR Review.md
│   ├── 2025-12-23 Propulsion Standup.md
│   ├── 2025-12-30 Year End Review.md
│   ├── 2026-01-02 Sprint Planning.md
│   ├── CDR Preparation Notes.md
│   └── Vendor Meeting Acme Aerospace.md
├── project/               # Roadmap + Risk Register
│   ├── Project Roadmap.md
│   └── Risk Register.md
├── suppliers/             # 2 vendor files
│   ├── Acme Aerospace.md
│   └── Precision Components Inc.md
├── systems/
│   ├── propulsion/        # 9 files — status: testing, owner: Marcus Johnson
│   │   ├── Propulsion System.md      # Hub — 45kN thrust, 3 hot fires complete
│   │   ├── Turbopump.md              # status: delayed — Acme Aerospace CNC mill failure
│   │   ├── Engine Design.md
│   │   ├── Cooling System.md
│   │   ├── Engine Controller.md
│   │   ├── Fuel Tanks.md
│   │   ├── Ignition Sequence.md
│   │   ├── Oxidizer System.md
│   │   └── Thrust Vector Control.md
│   ├── avionics/          # 8 files — status: on-track, owner: Elena Rodriguez
│   │   ├── Avionics System.md        # Hub — triple-redundant flight computers
│   │   ├── Flight Computer.md
│   │   ├── Flight Software.md
│   │   ├── Communications.md
│   │   ├── Power Distribution.md
│   │   ├── Redundancy Architecture.md
│   │   ├── Sensor Suite.md
│   │   └── Telemetry.md
│   ├── gnc/               # 5 files — status: at-risk, owner: Elena Rodriguez
│   │   └── GNC System.md            # Hub — landing algorithm 60% complete
│   └── structures/        # 6 files — status: on-track, owner: James Park
│       └── Structures System.md     # Hub — carbon fiber, 1240kg dry mass
├── team/
│   ├── Team Roster.md     # 15 FTE + 8 contractors
│   └── Onboarding Guide.md
├── tests/                 # 5 test files
│   ├── Test Campaign Overview.md
│   ├── Engine Hot Fire Results.md    # 3 tests complete (30s, 60s, 120s)
│   ├── Avionics Integration Test.md
│   ├── Thrust Validation.md
│   └── Upcoming Tests.md
└── weekly-notes/          # 2 weekly summaries
    ├── 2025-W52.md
    └── 2026-W01.md
```

## Try It

Ask Claude:

- **"What's blocking the propulsion milestone?"** -- traces Turbopump delay to Acme Aerospace CNC mill failure
- **"Who owns what?"** -- pulls owner fields from all four subsystem hubs
- **"Why did we pick LOX/RP-1?"** -- finds ADR-001 Propellant Selection and explains the rationale
- **"What are the top risks?"** -- reads Risk Register, shows R-003 (turbopump, score 15) through R-019 (funding, score 10)
- **"Prep standup"** -- pulls yesterday's daily note, overdue tasks, and current blockers

## How It Works

When you ask questions, Claude calls Flywheel tools to read your vault's graph -- metadata, backlinks, sections -- instead of reading entire files.

> Claude's exact tool path varies between runs. These traces show representative sessions.

### Trace a blocker -- search returns the chain

```
You: "What's blocking the propulsion milestone?"

  ● flywheel › search
    query: "propulsion blocking milestone"
    → systems/propulsion/Propulsion System.md
        frontmatter: { status: "testing", owner: "Marcus Johnson" }
        outlinks: Engine Design, Turbopump, Cooling System, Fuel Tanks, +12

      systems/propulsion/Turbopump.md
        frontmatter: { status: "delayed", supplier: "Acme Aerospace" }

      project/Risk Register.md

        snippet: "...R-003: <mark>Turbopump</mark> Delivery Delay — CNC mill failure at Acme Aerospace.
                  Original: Jan 5. Revised: Jan 20. Score: 15..."

┌─ RESULT ───────────────────────────────────────────────────┐
│ Root cause: CNC mill failure at Acme Aerospace              │
│ Original delivery: January 5                                │
│ Revised ETA: January 20                                     │
│ Impact: Hot Fire Test 4 postponed, prototype in use         │
│ Backup: Precision Components Inc (12-week lead, $680K)      │
└─────────────────────────────────────────────────────────────┘

One search returned blockers, risk scores, and mitigations.
Zero file reads needed.
```

### Explain a decision -- enriched search

```
You: "Why did we choose LOX/RP-1?"

  ● flywheel › search
    query: "propellant selection LOX RP-1"
    → decisions/ADR-001 Propellant Selection.md
        frontmatter: { status: "accepted", chosen_option: "LOX/RP-1",
                       primary_driver: "budget", alternatives_evaluated: 4,
                       key_trade_off: "Cost vs ISP — LOX/LH2 has 30% higher ISP but exceeds budget by $3M" }

        snippet: "...Selected: LOX/RP-1 (Liquid Oxygen / Rocket-grade Kerosene).
                  The main engine will use liquid oxygen as the oxidizer and RP-1 as the fuel,
                  in a gas generator cycle configuration..."

┌─ RESULT ───────────────────────────────────────────────────┐
│ ADR-001: LOX/RP-1 selected (2025-08-15)                    │
│                                                             │
│ Primary driver: Budget ($14M constraint)                    │
│ Key trade-off: LOX/LH2 has 30% higher ISP but +$3M         │
│ 4 alternatives evaluated, LOX/RP-1 best balance of          │
│ cost, schedule risk, and team experience                    │
│                                                             │
│ Zero file reads needed — frontmatter has the decision.      │
└─────────────────────────────────────────────────────────────┘
```

### Find who owns what -- metadata query

```
You: "Who's responsible for each subsystem?"

  ● flywheel › search
    where: { type: "subsystem" }
    → systems/propulsion/Propulsion System.md
        frontmatter: { owner: "Marcus Johnson", status: "testing" }
      systems/avionics/Avionics System.md
        frontmatter: { owner: "Elena Rodriguez", status: "on-track" }
      systems/gnc/GNC System.md
        frontmatter: { owner: "Elena Rodriguez", status: "at-risk" }
      systems/structures/Structures System.md
        frontmatter: { owner: "James Park", status: "on-track" }

┌─ RESULT ───────────────────────────────────────────────────┐
│ Propulsion — Marcus Johnson (testing)                       │
│ Avionics   — Elena Rodriguez (on-track)                     │
│ GNC        — Elena Rodriguez (at-risk)                      │
│ Structures — James Park (on-track)                          │
└─────────────────────────────────────────────────────────────┘

One metadata query returned all owners and statuses.
```

---

*63 notes -- $14M budget, 18-month timeline, first flight December 2026. Start asking questions.*
