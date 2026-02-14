# Nexus Lab

> See how your research connects - from foundational papers to your latest experiments.

---

**You are**: A PhD student in computational biology

**Your situation**: You're studying protein folding and drug-target prediction. Your notes include 7 foundational papers, 6 methods, 10 experiments, and 2 active projects. You need to trace how ideas flow from literature through your work.

## Vault Map

```
┌─────────────────────────────────────────────────────────┐
│                      NEXUS LAB                          │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ PAPERS        AlphaFold 2 ─── ESMFold ─── GROMACS│   │
│  └────────────────────┬────────────────────────────┘   │
│                       │ informs                        │
│                       ▼                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │ METHODS           Protein Folding Method        │   │
│  └────────────────────┬────────────────────────────┘   │
│                       │ used-by                        │
│                       ▼                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │ EXPERIMENTS   Run 1 ─► Run 2 ─► Run 3 ─► Run 7  │   │
│  └────────────────────┬────────────────────────────┘   │
│                       │ feeds                          │
│                       ▼                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │ PROJECTS          Drug Target Prediction        │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Try it now

Ask Claude:

- "How does AlphaFold connect to my docking experiment?"
- "What did I work on last week?"
- "Which experiments share the same methods?"
- "Summarize my November research"
- "What papers haven't I built on yet?"

## What you'll discover

- Trace citation chains from papers through methods to your experiments
- Find which experiments build on each other
- See patterns in your research you didn't notice

---

## How it works

When you ask Claude questions or request changes, here's the flow:

### Trace a connection (graph traversal only)

```
You: "How does AlphaFold connect to my docking experiment?"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Find path from paper to experiment          │
│ Strategy: Traverse forward links through graph      │
│ Tools: mcp__flywheel__get_forward_links (×3)        │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__get_forward_links("AlphaFold 2")     │
│   → [[Protein Folding Method]]                      │
│                                                     │
│ mcp__flywheel__get_forward_links("Protein Foldi..") │
│   → [[Structure Prediction Exp]], [[Docking...]]    │
│                                                     │
│ mcp__flywheel__get_forward_links("Structure...")    │
│   → [[Docking Experiment 7]]                        │
│                                                     │
│ Total: ~100 tokens (vs ~9,600 reading 4 full files) │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE SYNTHESIZES ────────────────────────────────┐
│ Graph traversal sufficient - path found             │
│ No file reads needed for connection map             │
└─────────────────────────────────────────────────────┘

Connection path (3 hops):
  [[AlphaFold 2]] → [[Protein Folding Method]]
    → [[Structure Prediction Exp]] → [[Docking Experiment 7]]
```

### Explain a method (requires file read)

```
You: "How does my protein folding method work?"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Explain methodology details                 │
│ Strategy: Get metadata, then read for explanation   │
│ Tools: mcp__flywheel__get_note_metadata, then Read  │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__get_note_metadata("methods/protein..")│
│   → type: method, based_on: [[AlphaFold 2]]         │
│   → used_by: 7 experiments                          │
│                                                     │
│ Total: ~50 tokens                                   │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE DECIDES: NEED MORE DETAIL ──────────────────┐
│ Metadata shows what it links to, but "how does it   │
│ work" requires reading the actual methodology       │
└─────────────────────────────────────────────────────┘

┌─ SELECTIVE FILE READ ───────────────────────────────┐
│ Read("methods/protein-folding.md")                  │
│   → ## Approach, ## Parameters, ## Validation       │
│                                                     │
│ Total: ~500 tokens (1 targeted file)                │
└─────────────────────────────────────────────────────┘

Claude: "Your protein folding method adapts AlphaFold's
attention mechanism with custom parameters for smaller
proteins (<100 residues). Key difference: reduced
MSA depth for faster inference. Validated against
3 known structures with <0.5Å RMSD."
```

### Find unused papers (orphan detection)

```
You: "What papers haven't I built on yet?"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Find papers with no outgoing links          │
│ Strategy: Use orphan detection on papers/ folder    │
│ Tools: mcp__flywheel__find_orphan_notes             │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL READS ────────────────────────────────────┐
│ mcp__flywheel__find_orphan_notes                    │
│   folder: "papers/"                                 │
│   direction: "outgoing"                             │
│   → papers/rosetta-commons.md (0 outgoing links)    │
│   → papers/gromacs-tutorial.md (0 outgoing links)   │
│                                                     │
│ Total: ~40 tokens (index query only)                │
└─────────────────────────────────────────────────────┘

┌─ CLAUDE SYNTHESIZES ────────────────────────────────┐
│ Orphan detection sufficient - no file reads needed  │
└─────────────────────────────────────────────────────┘

Orphan Papers (not connected to your work):
- [[Rosetta Commons]] - docking algorithms
- [[GROMACS Tutorial]] - MD simulation setup

Suggestion: Link these to relevant methods or experiments.
```

### Log experiment results (write operation)

```
You: "/log docking run 7 complete - 0.3Å RMSD"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Append result to today's research log       │
│ Strategy: Direct write - no reads needed            │
│ Tools: mcp__flywheel__vault_add_to_section    │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL WRITES ──────────────────────────────────────┐
│ mcp__flywheel__vault_add_to_section           │
│   path: "daily-notes/2026-01-04.md"                 │
│   section: "Log"                                    │
│   content: "docking run 7 complete - 0.3Å RMSD"     │
│   format: "timestamp-bullet"                        │
└─────────────────────────────────────────────────────┘

## Log
- 09:00 Literature review
- 15:22 docking run 7 complete - 0.3Å RMSD         ← NEW
```

### Link a paper to a method (write operation)

```
You: "Connect AlphaFold paper to my folding method"

┌─ CLAUDE INTERPRETS ─────────────────────────────────┐
│ Intent: Add wikilink to method's references         │
│ Strategy: Append to ## References section           │
│ Tools: mcp__flywheel__vault_add_to_section    │
└─────────────────────────────────────────────────────┘

┌─ FLYWHEEL WRITES ──────────────────────────────────────┐
│ mcp__flywheel__vault_add_to_section           │
│   path: "methods/protein-folding.md"                │
│   section: "References"                             │
│   content: "[[AlphaFold 2]]"                        │
│   format: "bullet"                                  │
└─────────────────────────────────────────────────────┘

## References
- [[AlphaFold 2]]                                  ← NEW
```

---

*30 notes. Just start asking questions.*

---

**Token savings:** Each note in this vault averages ~160 lines (~2,400 tokens).
With Flywheel, graph queries cost ~50-100 tokens instead of reading full files.
That's **24-48x savings** per query—enabling hundreds of queries in agentic workflows.
