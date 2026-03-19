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

> "Capture a fleeting note: I think Spaced Repetition leverages the Testing Effect as a form of Desirable Difficulties"

Flywheel creates a fleeting note and auto-links the existing concepts: `[[Spaced Repetition]]`, `[[Testing Effect]]`, `[[Desirable Difficulties]]`. Three wikilinks you didn't have to type.

### 5. Find underconnected literature

> "Which literature notes have the fewest outgoing links to permanent notes?"

Flywheel checks forward links from each `literature/` note into `permanent/`. Books with fewer connections may have unextracted ideas waiting to become permanent notes.

---

## How It Works

> Claude's exact tool path varies between runs. These traces show representative sessions.

### Worked Example 1: Concept connection -- enriched search

```
You: "How does Spaced Repetition relate to Active Recall?"

● flywheel › search
  query: "Spaced Repetition Active Recall"
  → permanent/Spaced Repetition.md
      frontmatter: { type: "permanent", status: "mature" }
      description: "Distributing review over increasing intervals exploits the spacing effect for long-term retention"
      outlinks: Spacing Effect, Active Recall, Memory Consolidation, Desirable Difficulties, Metacognition, Anki
      backlinks: Active Recall.md, Testing Effect.md, Desirable Difficulties.md, +8

    permanent/Active Recall.md
      description: "Retrieving information from memory strengthens neural pathways more than passive re-reading"
      outlinks: Testing Effect, Spaced Repetition, Elaborative Interrogation, Metacognition, Dunning-Kruger Effect, Schema Theory
      backlinks: Spaced Repetition.md, Elaborative Interrogation.md, Testing Effect.md, +9

    permanent/Testing Effect.md
      description: "Being tested on material strengthens memory more than additional study time — retrieval is learning"

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
│ Difficulties, Metacognition                            │
└────────────────────────────────────────────────────────┘

Descriptions and outlinks in search results reveal the relationship.
Zero file reads needed.
```

### Worked Example 2: Hub detection -- search reveals structure

```
You: "What are the most connected notes in this vault?"

● flywheel › search
  query: "learning", limit: 20
  → permanent/Active Recall.md
      backlink_count: 12, outlink_count: 10
    permanent/Spaced Repetition.md
      backlink_count: 11, outlink_count: 8
    permanent/Desirable Difficulties.md
      backlink_count: 10, outlink_count: 7
    permanent/Metacognition.md
      backlink_count: 9, outlink_count: 8
    permanent/Schema Theory.md
      backlink_count: 8, outlink_count: 7

┌─ RESULT ──────────────────────────────────────────────┐
│ Most connected notes (by backlink + outlink count):    │
│                                                        │
│ 1. Active Recall           22 links (12 in, 10 out)   │
│ 2. Spaced Repetition       19 links (11 in, 8 out)    │
│ 3. Desirable Difficulties  17 links (10 in, 7 out)    │
│ 4. Metacognition           17 links (9 in, 8 out)     │
│ 5. Schema Theory           15 links (8 in, 7 out)     │
└────────────────────────────────────────────────────────┘
```

### Worked Example 3: Auto-wikilinks on write

```
You: "Capture: Spaced Repetition leverages the Testing Effect as a form of Desirable Difficulties"

● flywheel › vault_create_note
  folder: "fleeting/"
  content: "[[Spaced Repetition]] leverages the [[Testing Effect]] as a form of
            [[Desirable Difficulties]]"

  Auto-linked:
    "Spaced Repetition"      → permanent/Spaced Repetition.md
    "Testing Effect"         → permanent/Testing Effect.md
    "Desirable Difficulties" → permanent/Desirable Difficulties.md

┌─ RESULT ──────────────────────────────────────────────┐
│ Created fleeting/capture-spaced-repetition-testing.md  │
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

**Token savings**: Enriched search returns descriptions, outlinks, backlinks, and headings for every hit — concept connections visible without reading files.
