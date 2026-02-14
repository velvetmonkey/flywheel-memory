# Demo: Voice/PKM - Solo Consultant Workflow

**Audience**: PKM enthusiasts using Whisper/voice transcription, Obsidian power users

**Scenario**: Solo consultant captures client work via voice memos while walking. Zero-friction capture, passive relationship intelligence.

---

## Setup

**Entity Index**: 32 notes, 15 wikilinks/file average
**Key Entities**:
- Clients: [[Acme Corp]], [[TechStart Inc]], [[GlobalBank]]
- Contacts: [[Sarah Mitchell]], [[Mike Chen]]
- Projects: [[Acme Data Migration]], [[TechStart MVP Build]]
- Invoices: [[INV-2025-047]], [[INV-2025-048]]
- Knowledge: [[Data Migration Playbook]], [[Rate Card]]

---

## The Voice-Native Stack

```
WhisperType (transcription) → OpenClaw Agent → Claude Code → Flywheel-Crank → Obsidian Vault
     ↓                            ↓                ↓              ↓
Voice memo                    Interprets       Executes        Auto-wikilinks
                              intent           mutation        + markup
```

---

## Step 1: Voice Memo Arrives

**Context**: Consultant just finished a client call. Walking to car, speaks voice memo via Telegram to Clawdbot.

**Raw Whisper Transcription**:
```
"Just wrapped up the call with Sarah at Acme about the data migration.
She's happy with progress, validation showing 85% complete now.
Need to follow up with their IT team about the staging environment access.
Also mentioned they might have another project for Q2."
```

**Clawdbot (OpenClaw)**: Detects intent → route to daily note

---

## Step 2: Log to Daily Note

**Agent Action**: Log to today's daily note with auto-wikilinks

```javascript
// Flywheel-Crank mutation
await crank.vault_add_to_section({
  path: 'daily-notes/2026-01-03.md',
  section: 'Log',
  content: 'Call with Sarah at Acme about the data migration. Validation 85% complete. Follow up with IT team re: staging access. Potential Q2 project.',
  format: 'timestamp-bullet',
  suggestOutgoingLinks: true
});
```

**Result** (with auto-wikilinks + suggestions):
```markdown
- 14:30 - Call with [[Sarah Mitchell]] at [[Acme Corp]] about the [[Acme Data Migration]]. Validation 85% complete. Follow up with IT team re: staging access. Potential Q2 project. → [[TechStart Inc]] [[GlobalBank]] [[INV-2025-048]]
```

**Auto-Wikilinks Applied**:
| Input | Linked To | Why |
|-------|-----------|-----|
| "Sarah" | [[Sarah Mitchell]] | Unique Sarah in vault, linked to Acme |
| "Acme" | [[Acme Corp]] | Exact match |
| "data migration" | [[Acme Data Migration]] | Entity match |

**Suggestions Appended**:
| Entity | Why Suggested |
|--------|---------------|
| [[TechStart Inc]] | Co-occurrence: Often work TechStart after Acme calls |
| [[GlobalBank]] | Co-occurrence: Similar client patterns |
| [[INV-2025-048]] | Context: Acme work = billable hours, pending invoice |

**Demo Point**: "TechStart Inc" suggested even though not mentioned - consultant often works TechStart after Acme calls (co-occurrence pattern). Invoice suggested because Acme work = billable hours.

---

## Step 3: "Wrong" Suggestions Build Worthy Meaning

**The Context Cloud Philosophy**:

```
Week 1: Voice logs mention "Acme call", get suggestion → [[GlobalBank]]
  (Seems wrong - GlobalBank not directly involved)

Week 2: Consultant starts GlobalBank pilot project
  (Turns out GlobalBank opportunity came from Acme referral)

Week 3: Agent queries "What was I working on before GlobalBank?"
  → Context cloud reveals: Acme calls, TechStart work, validation patterns
  → "Oh right, the GlobalBank opportunity came from Acme's referral"
```

**The "imprecise" suggestion captured working context, not just content.**

Over time, "wrong" suggestions create a **navigable timeline of professional activity**.

---

## Step 4: Update Client Note

**Agent Decision**: "Potential Q2 project" is valuable client intel

```javascript
// Agent autonomously updates client note
await crank.vault_add_to_section({
  path: 'clients/Acme Corp.md',
  section: 'Pending Opportunities',
  content: 'Q2 project mentioned during 2026-01-03 call. Details TBD. Follow up with Sarah.',
  format: 'bullet',
  suggestOutgoingLinks: true
});
```

**Result**:
```markdown
## Pending Opportunities

### [[Acme Analytics Add-on]]
- Proposal for analytics dashboard layer on top of migrated data
- Value: $35,000
- Status: Draft, decision expected Q1 2026

- Q2 project mentioned during 2026-01-03 call. Details TBD. Follow up with [[Sarah Mitchell]]. → [[Acme Data Migration]] [[Business Goals 2026]]
```

**Graph Effect**:
- Acme Corp note now has Q2 pipeline entry
- Future queries about pipeline will surface this
- Relationship intelligence building passively

---

## Step 5: Create Follow-Up Task

**Agent Action**: Create actionable task from voice memo

```javascript
await crank.vault_add_to_section({
  path: 'daily-notes/2026-01-03.md',
  section: 'Tasks',
  content: 'Follow up with Acme IT team about staging environment access',
  format: 'task',
  suggestOutgoingLinks: true
});
```

**Result**:
```markdown
## Tasks

- [ ] Follow up with [[Acme Corp]] IT team about staging environment access → [[Acme Data Migration]] [[James Rodriguez]]
```

**Suggestion**: [[James Rodriguez]] - He's the IT Director at Acme, the right person to contact.

---

## Wow Factor Summary

| Action | Manual PKM | Flywheel Voice Flow |
|--------|------------|---------------------|
| **Capture** | Type, manually link | Speak, auto-wikilinks |
| **Context** | Remember to add links | Suggestions capture co-occurrence |
| **Client Intel** | Forget or lose it | Auto-logged to client note |
| **Recall** | Grep and pray | Context cloud query |

---

## Key Message

**"Speak your thoughts, build your graph. Zero friction capture, passive relationship intelligence."**

### The Voice-Native Promise

1. **5 seconds of speaking** → rich, linked, searchable entry
2. **Auto-markup** makes everything clickable and navigable
3. **Graph builds passively** from natural speech
4. **Wake up with context** already assembled (overnight agent briefings)

### Why This Matters for Solo Consultants

- **Client relationships are assets** - graph captures interaction patterns
- **Pipeline is scattered** - suggestions surface opportunities from casual mentions
- **Billable context matters** - invoice suggestions when logging client work
- **Knowledge compounds** - playbook references appear when relevant

---

## Algorithm Evidence

**Co-occurrence Boost at Work**:

When you log "Acme call", the algorithm looks at what entities frequently co-occur with Acme in your vault:
- [[Sarah Mitchell]] - 47 co-occurrences (primary contact)
- [[Acme Data Migration]] - 32 co-occurrences (active project)
- [[TechStart Inc]] - 12 co-occurrences (often worked same week)
- [[INV-2025-048]] - 8 co-occurrences (pending payment)

**This is why "wrong" suggestions are right** - they capture your working context, not just the immediate content.

---

## The Full Voice Workflow

```
┌─────────────────┐
│   Voice Memo    │  "Spoke with Sarah about migration..."
│   (5 seconds)   │
└────────┬────────┘
         ↓
┌─────────────────┐
│  WhisperType    │  Transcription
│  (Local/API)    │
└────────┬────────┘
         ↓
┌─────────────────┐
│   OpenClaw      │  Intent detection, routing
│   (Telegram)    │
└────────┬────────┘
         ↓
┌─────────────────┐
│  Claude Code    │  Interprets, decides mutations
│  (MCP Client)   │
└────────┬────────┘
         ↓
┌─────────────────────────────────────────────────┐
│                 Flywheel-Crank                  │
│  ─────────────────────────────────────────────  │
│  vault_add_to_section({                         │
│    section: 'Log',                              │
│    content: 'Call with Sarah at Acme...',       │
│    suggestOutgoingLinks: true                   │
│  })                                             │
│                                                 │
│  Auto-wikilinks: [[Sarah Mitchell]] [[Acme]]    │
│  Suggestions: → [[TechStart]] [[INV-2025-048]]  │
│  Git commit: [Crank:Add] daily-notes/01-03.md   │
└────────┬────────────────────────────────────────┘
         ↓
┌─────────────────┐
│  Obsidian Sync  │  Graph updates, backlinks populated
│  (or Git pull)  │
└─────────────────┘
```

**Result**: Voice → Graph entry in under 10 seconds, with context cloud connections.
