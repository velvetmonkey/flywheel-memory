---
type: meta
tags:
  - demo
  - zettelkasten
---

# Zettelkasten Demo Vault

> 47 notes on cognitive science and learning theory, wired together the way Luhmann intended.

---

**You are**: A knowledge worker building a Zettelkasten on cognitive science

**Your situation**: You have 47 notes across the full Zettelkasten lifecycle -- raw hunches in fleeting notes, book summaries in literature notes, atomic concepts in permanent notes, and synthesis projects pulling it all together. The vault has ~150 wikilinks and no orphan permanent notes. Your challenge is navigating a densely connected concept graph to find connections, surface gaps, and promote ideas up the chain from fleeting to permanent.

## Vault Map

```
zettelkasten/
├── fleeting/          (10 notes)
│   ├── hunch-about-elaboration.md
│   ├── idea-dual-coding-in-notes.md
│   ├── idea-spaced-repetition.md
│   ├── idea-testing-as-learning.md
│   ├── note-on-flow-state.md
│   ├── observation-interleaving-practice.md
│   ├── question-about-motivation.md
│   ├── question-about-sleep-and-memory.md
│   ├── thought-on-metacognition.md
│   └── wonder-about-chunking.md
├── literature/        (7 notes)
│   ├── A Mind for Numbers.md              # Barbara Oakley
│   ├── How We Learn.md                    # Benedict Carey
│   ├── Make It Stick.md                   # Brown, Roediger, McDaniel
│   ├── Mindset.md                         # Carol Dweck
│   ├── Peak.md                            # Anders Ericsson
│   ├── Thinking Fast and Slow.md          # Daniel Kahneman
│   └── Why We Sleep.md                    # Matthew Walker
├── permanent/         (23 notes)
│   ├── Active Recall.md
│   ├── Chunking.md
│   ├── Cognitive Load Theory.md
│   ├── Deliberate Practice.md
│   ├── Desirable Difficulties.md
│   ├── Dual Coding Theory.md
│   ├── Dunning-Kruger Effect.md
│   ├── Elaborative Interrogation.md
│   ├── Encoding Specificity.md
│   ├── Flow State.md
│   ├── Formative Assessment.md
│   ├── Growth Mindset.md
│   ├── Interleaving.md
│   ├── Memory Consolidation.md
│   ├── Metacognition.md
│   ├── Motivation and Learning.md
│   ├── Schema Theory.md
│   ├── Self-Determination Theory.md
│   ├── Spaced Repetition.md
│   ├── Spacing Effect.md
│   ├── Testing Effect.md
│   ├── Transfer of Learning.md
│   └── Working Memory.md
├── projects/          (4 notes)
│   ├── Curriculum Design for Retention.md
│   ├── Effective Study Habits.md
│   ├── Learning System Design.md
│   └── Teaching Methodology Research.md
├── daily-notes/       (5 entries)
│   ├── 2026-01-15.md through 2026-01-30.md
└── templates/         (3 templates)
    ├── fleeting.md, literature.md, permanent.md
```

## Why This Demo Matters

Zettelkasten is the best-case scenario for a knowledge graph tool. The whole method is about building dense connections between atomic ideas -- which is exactly what Flywheel indexes and queries.

This vault demonstrates:

- **Graph traversal across note types** -- trace an idea from a raw hunch (`fleeting/`) through a book summary (`literature/`) to an atomic concept (`permanent/`) to a synthesis project (`projects/`)
- **Hub detection** -- Active Recall, Spaced Repetition, and Desirable Difficulties are the most-connected nodes, and Flywheel finds them without reading any files
- **Wikilink suggestion** -- content is written with natural concept overlap so `suggest_wikilinks` surfaces real, useful connections
- **Cluster analysis** -- three distinct clusters emerge: learning techniques, cognitive architecture, and motivation
- **No orphans** -- every permanent note links to at least 2 others, giving Flywheel a connected graph to navigate

---

## Try It

```bash
cd demos/zettelkasten
claude
```

### 1. Trace a concept connection

> "How does Spaced Repetition relate to Active Recall?"

Flywheel follows the bidirectional links: Spaced Repetition references Active Recall as the retrieval mechanism within each review session, and Active Recall references Spaced Repetition as its scheduling system. Both connect through Testing Effect, Desirable Difficulties, and the literature note Make It Stick.

### 2. Trace the fleeting-to-permanent pipeline

> "What fleeting notes are ready to promote to permanent?"

Flywheel checks `fleeting/` notes, finds which ones already reference existing permanent notes, and flags the most connected ones as promotion candidates. Notes like `idea-spaced-repetition.md` already link to Spacing Effect and Active Recall -- they're ready to extract.

### 3. Find the hub concepts

> "What are the most connected notes in this vault?"

Graph analysis returns the hub nodes by connection count. Active Recall, Spaced Repetition, and Desirable Difficulties sit at the center of the graph. These are the structural backbone of the Zettelkasten.

### 4. Add a fleeting note with auto-wikilinks

> "Capture a fleeting note: I think elaborative interrogation works because it forces active recall of related schemas, which is a desirable difficulty"

Flywheel creates a fleeting note and auto-links the existing concepts: `[[Elaborative Interrogation]]`, `[[Active Recall]]`, `[[Schema Theory]]`, `[[Desirable Difficulties]]`. Four wikilinks you didn't have to type.

### 5. Find underconnected literature

> "Which literature notes have the fewest outgoing links to permanent notes?"

Flywheel checks forward links from each `literature/` note into `permanent/`. Books with fewer connections may have unextracted ideas waiting to become permanent notes.

---

## How It Works

### Worked Example 1: Concept connection -- graph traversal

```
You: "How does Spaced Repetition relate to Active Recall?"

● flywheel › get_backlinks
  path: "permanent/Spaced Repetition.md"
  ← permanent/Active Recall.md
    permanent/Testing Effect.md
    permanent/Spacing Effect.md
    literature/Make It Stick.md
    projects/Learning System Design.md

● flywheel › get_forward_links
  path: "permanent/Spaced Repetition.md"
  → [[Spacing Effect]], [[Active Recall]], [[Memory Consolidation]],
    [[Desirable Difficulties]], [[Metacognition]]

┌─ RESULT ──────────────────────────────────────────────┐
│ Bidirectional relationship:                            │
│                                                        │
│ Spaced Repetition → Active Recall                      │
│   Each review session employs active recall rather     │
│   than passive re-reading                              │
│                                                        │
│ Active Recall → Spaced Repetition                      │
│   Powers the scheduling system -- each review is       │
│   an act of recall                                     │
│                                                        │
│ Shared connections: Testing Effect, Desirable          │
│ Difficulties, Make It Stick, Learning System Design    │
│                                                        │
│ 2 tool calls, ~80 tokens read                          │
└────────────────────────────────────────────────────────┘
```

### Worked Example 2: Hub detection -- graph analysis

```
You: "Find the hub concepts"

● flywheel › graph_analysis
  mode: "hubs"
  ← Active Recall         (14 connections)
     Spaced Repetition     (12 connections)
     Desirable Difficulties (11 connections)
     Metacognition          (10 connections)
     Schema Theory          (9 connections)

┌─ RESULT ──────────────────────────────────────────────┐
│ Top 5 hub notes by connection count:                   │
│                                                        │
│ 1. Active Recall          14 links (7 in, 7 out)      │
│ 2. Spaced Repetition      12 links (6 in, 6 out)      │
│ 3. Desirable Difficulties 11 links (7 in, 4 out)      │
│ 4. Metacognition          10 links (5 in, 5 out)      │
│ 5. Schema Theory           9 links (4 in, 5 out)      │
│                                                        │
│ 1 tool call, ~60 tokens                                │
└────────────────────────────────────────────────────────┘
```

### Worked Example 3: Auto-wikilinks on write

```
You: "Capture: elaboration forces retrieval of schemas, which is a desirable difficulty"

● flywheel › vault_create_note
  folder: "fleeting/"
  content: "[[Elaborative Interrogation]] forces retrieval of [[Schema Theory|schemas]],
            which is a [[Desirable Difficulties|desirable difficulty]]"

  Auto-linked:
    "Elaborative Interrogation" → permanent/Elaborative Interrogation.md
    "schemas"                   → permanent/Schema Theory.md
    "desirable difficulty"      → permanent/Desirable Difficulties.md

┌─ RESULT ──────────────────────────────────────────────┐
│ Created fleeting/capture-elaboration-retrieval.md      │
│ 3 entities auto-linked to existing permanent notes     │
│                                                        │
│ The graph just got 3 new edges.                        │
└────────────────────────────────────────────────────────┘
```

---

## The Zettelkasten Flywheel

The Zettelkasten method is a flywheel by design. Notes flow through four stages, each feeding the next:

```
  fleeting → literature → permanent → projects
     ↑                                    │
     └────────────────────────────────────┘
           projects generate new questions
```

1. **Fleeting notes** capture raw ideas (`idea-spaced-repetition.md`)
2. **Literature notes** summarize sources (`Make It Stick.md`) and link to concepts they support
3. **Permanent notes** extract atomic ideas (`Active Recall.md`) connected to 2+ other permanent notes
4. **Project notes** synthesize permanent notes into arguments (`Learning System Design.md`)
5. Projects generate new questions that feed back into fleeting notes

Flywheel accelerates every stage. Auto-wikilinks connect new notes on creation. Graph queries find related concepts without manual browsing. Hub detection reveals the structural backbone. Gap analysis finds underconnected notes that need integration.

The more notes you add, the denser the graph. The denser the graph, the better the queries. The better the queries, the more useful the tool. That's the flywheel.

---

## Getting Started

```bash
cd demos/zettelkasten
claude
```

47 notes. ~150 wikilinks. Start asking questions.

---

**Token savings**: Notes in this vault average ~35 lines (~500 tokens each). Flywheel graph queries return ~50-80 tokens of targeted metadata instead of reading full files -- **6-10x savings** per query, compounding across agentic workflows that chain dozens of tool calls.
