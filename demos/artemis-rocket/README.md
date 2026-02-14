# Artemis Rocket

> Your AI knows your entire rocket program and can answer anything about it.

---

**You are**: Chief Engineer at a 15-person aerospace startup

**Your situation**: Building a small launch vehicle to deliver 250kg to orbit. You're 8 months in, between design reviews, running hot fire tests. 65 documents cover propulsion, avionics, structures, team, and decisions.

## Vault Map

```
┌─────────────────────────────────────────────────────────┐
│                    ARTEMIS ROCKET                       │
│                                                         │
│    ┌──────────────┐         ┌──────────────┐           │
│    │ Team Roster  │◄───────►│   Roadmap    │           │
│    └──────┬───────┘ staffs  └──────┬───────┘           │
│           │                        │ defines            │
│    owns   │    ┌───────────────────┘                   │
│           ▼    ▼                                        │
│    ┌─────────────────┐    ┌─────────────────┐          │
│    │   Propulsion    │───►│   Milestones    │          │
│    │     System      │    │                 │          │
│    └────────┬────────┘    └────────┬────────┘          │
│             │ depends-on           │ blocked-by        │
│             ▼                      ▼                   │
│    ┌─────────────────┐    ┌─────────────────┐          │
│    │   Decisions     │◄───│    Suppliers    │          │
│    │    (DR-###)     │    │                 │          │
│    └─────────────────┘    └─────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

## Try it now

Ask Claude:

- "What's the status of the propulsion system?"
- "What's causing the turbopump delay?"
- "Show me today's standup notes"
- "Who's responsible for avionics?"
- "What decisions led to our engine design?"

## What you'll discover

- Ask about any system and get instant context from connected documents
- Find what needs attention: disconnected notes, broken links, stale docs
- Add to your daily standup with a single sentence

---

## How it works

When you ask Claude questions or request changes, here's the flow:

### Trace a blocker (metadata only)

```
You: "What's blocking propulsion?"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Find what's blocking propulsion             │
│ Strategy: Trace blocked_by links through graph      │
│ Tools: mcp__flywheel__get_note_metadata (×3)        │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__get_note_metadata("Propulsion...")   │
│   → status: blocked, blocked_by: [[Turbopump Test]] │
│                                                     │
│ mcp__flywheel__get_note_metadata("Turbopump Test")  │
│   → status: waiting, depends_on: [[Seal Supplier]]  │
│                                                     │
│ mcp__flywheel__get_note_metadata("Seal Supplier")   │
│   → status: delayed, eta: 2026-01-18                │
│                                                     │
│ Total: ~120 tokens (vs ~7,500 reading 3 full files) │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE SYNTHESIZES ────────────────────────────────┐
│ Metadata sufficient - no file reads needed          │
│ Chain: Propulsion ← Turbopump ← Seal Supplier       │
└─────────────────────────────────────────────────────┘

Claude: "Propulsion is blocked by the turbopump test,
which is waiting on seals from Apex Materials.
ETA: Jan 18 (14 days out)."
```

### Explain a decision (requires file read)

```
You: "Why did we choose LOX over hypergolics?"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Explain propellant decision rationale       │
│ Strategy: Find decision record, read full context   │
│ Tools: mcp__flywheel__search_notes, then Read       │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__search_notes("LOX hypergolic")       │
│   → decisions/DR-003-lox-propellant.md              │
│   → systems/propulsion/Engine Design.md             │
│                                                     │
│ Total: ~80 tokens (search results only)             │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE DECIDES: NEED MORE DETAIL ──────────────────┐
│ Search found the file, but I need the full          │
│ rationale to answer "why" - metadata not enough     │
└─────────────────────────────────────────────────────┘

┌─ SELECTIVE FILE READ ───────────────────────────────┐
│ Read("decisions/DR-003-lox-propellant.md")          │
│   → Full decision record with pros/cons analysis    │
│                                                     │
│ Total: ~400 tokens (1 targeted file read)           │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE SYNTHESIZES ────────────────────────────────┐
│ Combines search context + full decision rationale   │
└─────────────────────────────────────────────────────┘

Claude: "We chose LOX over hypergolics in DR-003 for
three reasons: 1) Higher specific impulse (better
performance), 2) Non-toxic handling (safer ops),
3) Supplier availability. The tradeoff was added
complexity in cryogenic systems."
```

### Add a log entry (write operation)

```
You: "/log turbopump test successful - 98% efficiency"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Append to today's daily note log section    │
│ Strategy: Write directly - no reads needed          │
│ Tools: mcp__flywheel__vault_add_to_section    │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL WRITES ──────────────────────────────────────┐
│ mcp__flywheel__vault_add_to_section           │
│   path: "daily-notes/2026-01-04.md"                 │
│   section: "Log"                                    │
│   content: "turbopump test successful - 98%..."     │
│   format: "timestamp-bullet"                        │
└─────────────────────────────────────────────────────┘

## Log
- 09:15 Team sync
- 14:47 turbopump test successful - 98% efficiency  ← NEW
```

### Create a decision record

```
You: "Record decision: switching to titanium valves"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Create new decision record with context     │
│ Strategy: Check folder conventions, create note     │
│ Tools: mcp__flywheel__get_folder_structure,         │
│        mcp__flywheel__vault_create_note       │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__get_folder_structure("decisions/")   │
│   → Pattern: DR-###-slug.md                         │
│   → Next number: DR-015                             │
│                                                     │
│ Total: ~60 tokens                                   │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL WRITES ──────────────────────────────────────┐
│ mcp__flywheel__vault_create_note              │
│   path: "decisions/DR-015-titanium-valves.md"       │
│   frontmatter:                                      │
│     date: 2026-01-04                                │
│     status: approved                                │
│     context: "[[Turbopump Test Results]]"           │
│   content: "Switching to titanium valves..."        │
└─────────────────────────────────────────────────────┘

Created: decisions/DR-015-titanium-valves.md
```

---

*65 notes. Just start asking questions.*

---

**Token savings:** Each note in this vault averages ~170 lines (~2,500 tokens).
With Flywheel, graph queries cost ~50-100 tokens instead of reading files.
For structure queries (backlinks, metadata, tasks), you avoid file reads entirely—enabling hundreds of queries in agentic workflows without token bloat.
