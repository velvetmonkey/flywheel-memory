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

### Trace a blocker

```
You: "What's blocking the propulsion milestone?"

  ● get_note_metadata("systems/propulsion/Propulsion System.md")

┌─ CLAUDE THINKS ────────────────────────────────────────────┐
│ Propulsion status is "testing", owner Marcus Johnson.      │
│ Active issues mention Turbopump delivery delay.            │
│ Let me check the Turbopump note.                           │
└────────────────────────────────────────────────────────────┘

  ● get_note_metadata("systems/propulsion/Turbopump.md")

┌─ CLAUDE THINKS ────────────────────────────────────────────┐
│ Turbopump status is "delayed", supplier is Acme Aerospace. │
│ I need the delivery delay details.                         │
└────────────────────────────────────────────────────────────┘

  ● get_section_content("systems/propulsion/Turbopump.md", "Delivery Delay")

┌─ RESULT ───────────────────────────────────────────────────┐
│ Root cause: CNC mill failure at Acme Aerospace             │
│ Original delivery: January 5                               │
│ Revised ETA: January 20                                    │
│ Impact: Hot Fire Test 4 postponed, prototype in use        │
│ Backup: Precision Components Inc (12-week lead, $680K)     │
└────────────────────────────────────────────────────────────┘

Claude: "Propulsion is in testing but the Turbopump is delayed.
Acme Aerospace had a CNC mill failure -- delivery slipped from
Jan 5 to Jan 20. Hot Fire Test 4 is postponed until the flight
unit arrives. Backup option is Precision Components Inc at
$680K with a 12-week lead time."
```

### Explain a decision

```
You: "Why did we choose LOX/RP-1?"

  ● search_notes({folder: "decisions", query: "propellant"})

┌─ CLAUDE THINKS ────────────────────────────────────────────┐
│ Found ADR-001 Propellant Selection.md (status: accepted,   │
│ date: 2025-08-15, owner: Sarah Chen). I need the full      │
│ rationale -- metadata alone won't explain "why".            │
└────────────────────────────────────────────────────────────┘

  ● get_section_content("decisions/ADR-001 Propellant Selection.md", "Decision")

┌─ RESULT ───────────────────────────────────────────────────┐
│ Selected LOX/RP-1 bipropellant for Artemis-1.              │
│ Evaluated against hypergolics and solid propellants.       │
│ Key factors: specific impulse, handling safety,            │
│ supplier availability, and cost per flight.                │
└────────────────────────────────────────────────────────────┘

Claude: "ADR-001 (accepted Aug 2025, owner Sarah Chen) chose
LOX/RP-1 over hypergolics and solids. Main reasons: higher
specific impulse for better performance, non-toxic handling
for safer ground ops, and better supplier availability.
The tradeoff was added complexity from cryogenic systems."
```

### Find who owns what

```
You: "Who's responsible for each subsystem?"

  ● get_note_metadata("systems/propulsion/Propulsion System.md")
  ● get_note_metadata("systems/avionics/Avionics System.md")
  ● get_note_metadata("systems/gnc/GNC System.md")
  ● get_note_metadata("systems/structures/Structures System.md")

┌─ RESULT ───────────────────────────────────────────────────┐
│ Propulsion — Marcus Johnson (status: testing)              │
│ Avionics   — Elena Rodriguez (status: on-track)            │
│ GNC        — Elena Rodriguez (status: at-risk)             │
│ Structures — James Park (status: on-track)                 │
│                                                            │
│ 4 metadata reads, ~200 tokens total                        │
└────────────────────────────────────────────────────────────┘

Claude: "Marcus Johnson owns Propulsion (currently in testing).
Elena Rodriguez owns both Avionics (on-track) and GNC (at-risk
-- landing algorithm is 60% complete). James Park owns
Structures (on-track)."
```

---

*63 notes -- $14M budget, 18-month timeline, first flight December 2026. Start asking questions.*
