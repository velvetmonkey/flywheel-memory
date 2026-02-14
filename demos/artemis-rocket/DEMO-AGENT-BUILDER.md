# Demo: Agent Builder - Overnight Intelligence Agent

**Audience**: AI developers building with Claude Code, MCP tools, autonomous agents

**Scenario**: It's 2:30 AM. An overnight intelligence agent queries the vault to prepare a morning briefing for Chief Engineer [[Sarah Chen]].

---

## Setup

**Entity Index**: 65 notes, 104 wikilinks/file average
**Key Entities**:
- People: [[Sarah Chen]], [[Marcus Johnson]], [[Elena Rodriguez]], [[James Park]]
- Systems: [[Propulsion System]], [[Turbopump]], [[Avionics System]]
- Suppliers: [[Acme Aerospace]], [[Precision Components Inc]]
- Documents: [[Risk Register]], [[Project Roadmap]], [[ADR-001 Propellant Selection]]

---

## Step 1: Query Context Cloud

**Agent Query**: "What's the current state of propulsion testing?"

### Traditional Search (Precision)
```
Keyword search: "propulsion testing"
Result: 3 notes containing exact phrase
Agent knows: Tests are happening
```

### Flywheel Query (Context Cloud)
```javascript
// Query the graph, not just keywords
const backlinks = await flywheel.get_backlinks({ path: 'systems/propulsion/Propulsion System.md' });
const forwardLinks = await flywheel.get_forward_links({ path: 'tests/Engine Hot Fire Results.md' });
const blocked = await flywheel.search_notes({ where: { status: 'blocked' } });
```

**Context Cloud Returns**:
- [[Propulsion System]] - Hub with 200+ backlinks
- [[Marcus Johnson]] - Owner, co-occurs 47 times with propulsion work
- [[Turbopump]] - Status: delayed, delivery Jan 20
- [[Acme Aerospace]] - Vendor, linked via [[Vendor Meeting Acme Aerospace]]
- [[Test 4]] - At risk due to turbopump delay
- [[Risk Register]] R-003 - Turbopump delivery delay (Score: 15, HIGH)

**Demo Point**: Agent gets the *context cloud* around propulsion, not just notes with the keyword.

---

## Step 2: Log to Daily Note

**Agent Action**: Log overnight research to today's daily note

```javascript
// Step 1: Create note structure if needed
await crank.vault_create_note({
  path: 'daily-notes/2026-01-03.md',
  frontmatter: {
    type: 'daily',
    date: '2026-01-03',
    tags: ['daily', 'morning-briefing']
  },
  content: `# [[Daily Standup]] - 2026-01-03

## Morning Briefing

## Log

`
});

// Step 2: Add content with wikilink suggestions
await crank.vault_add_to_section({
  path: 'daily-notes/2026-01-03.md',
  section: 'Morning Briefing',
  content: 'Overnight analysis identified propulsion Test 4 at risk due to Turbopump delivery delay. Marcus Johnson tracking with Acme Aerospace - status call today.',
  format: 'timestamp-bullet',
  suggestOutgoingLinks: true  // Default: true
});
```

**Result** (with auto-wikilinks):
```markdown
- **02:30** Overnight analysis identified propulsion [[Test 4]] at risk due to [[Turbopump]] delivery delay. [[Marcus Johnson]] tracking with [[Acme Aerospace]] - status call today. → [[Propulsion System]] [[Risk Register]] [[Elena Rodriguez]]
```

**Suggested Links Explanation**:
- `[[Propulsion System]]` - Hub entity, co-occurs with propulsion work
- `[[Risk Register]]` - Context: delays = risks
- `[[Elena Rodriguez]]` - *"Locally imprecise"*: She's Avionics Lead, but propulsion timeline affects avionics integration

**Demo Point**: "Elena Rodriguez" suggested even though not mentioned - she works on avionics which depends on propulsion timeline. Context cloud captures cross-team dependencies.

---

## Step 3: Agent Updates Incidental Note

**Agent Decision**: The turbopump blocker affects avionics schedule too. Update Elena's tracking.

```javascript
// Agent autonomously decides to update a DIFFERENT note
await crank.vault_add_to_section({
  path: 'systems/avionics/Avionics System.md',
  section: 'Dependencies',
  content: 'Propulsion turbopump delay may impact avionics integration timeline. Monitor Test 4 status.',
  format: 'bullet',
  suggestOutgoingLinks: true
});
```

**Result**:
```markdown
- Propulsion [[Turbopump]] delay may impact avionics integration timeline. Monitor [[Test 4]] status. → [[Marcus Johnson]] [[Risk Register]]
```

**Graph Effect**:
- Avionics System note now connected to [[Turbopump]]
- Future queries about turbopump will surface avionics as affected
- Context cloud expands organically

**Demo Point**: Agent autonomously updated a *different* note based on relationship understanding. The graph gets smarter.

---

## Step 4: Create Decision Record

**Agent Action**: Risk escalation warrants a decision record

```javascript
// Step 1: Create decision record structure
await crank.vault_create_note({
  path: 'decisions/ADR-006 Turbopump Schedule Mitigation.md',
  frontmatter: {
    type: 'decision',
    status: 'proposed',
    date: '2026-01-03',
    owner: '[[Sarah Chen]]',
    risk: 'R-003'
  },
  content: `# ADR-006 Turbopump Schedule Mitigation

## Context

## Options

## Recommendation

Pending Chief Engineer review.
`
});

// Step 2: Add context with wikilink suggestions
await crank.vault_add_to_section({
  path: 'decisions/ADR-006 Turbopump Schedule Mitigation.md',
  section: 'Context',
  content: `Turbopump delivery delayed from Jan 5 to Jan 20. This impacts:
1. Test 4 originally scheduled Jan 8 - cannot proceed without flight unit
2. Critical Design Review prep (March 10) may need compression
3. Budget impact: $40K for expediting + dual-source qualification`,
  format: 'plain',
  suggestOutgoingLinks: true
});

// Step 3: Add options
await crank.vault_add_to_section({
  path: 'decisions/ADR-006 Turbopump Schedule Mitigation.md',
  section: 'Options',
  content: `1. **Delay Test 4 to Jan 25** - Accept 2-week slip, maintain CDR date
2. **Proceed with prototype turbopump** - Limited to 120s duration testing
3. **Accelerate parallel workstreams** - Compress software schedule to absorb slip`,
  format: 'numbered',
  suggestOutgoingLinks: true
});
```

**Result** (decision record with context cloud suggestions):
```markdown
## Context

Turbopump delivery delayed from [[Jan 5]] to [[Jan 20]]. This impacts:
1. [[Test 4]] originally scheduled [[Jan 8]] - cannot proceed without flight unit
2. [[Critical Design Review]] prep ([[March 10]]) may need compression
3. Budget impact: $40K for expediting + dual-source qualification
→ [[Turbopump]] [[Marcus Johnson]] [[Acme Aerospace]]

## Options

1. **Delay [[Test 4]] to [[Jan 25]]** - Accept 2-week slip, maintain CDR date
2. **Proceed with prototype turbopump** - Limited to 120s duration testing
3. **Accelerate parallel workstreams** - Compress software schedule to absorb slip
→ [[Risk Register]] [[Propulsion System]] [[Elena Rodriguez]]
```

**Demo Point**: New decision record automatically connected to relevant entities via auto-wikilinks + suggestions.

---

## Wow Factor Summary

| Action | Traditional Approach | Flywheel Approach |
|--------|---------------------|-------------------|
| **Query** | Keyword search, 3 results | Context cloud, 12 related entities |
| **Log** | Manual wikilinks or none | Auto-wikilinks + 3 suggestions |
| **Update** | Wouldn't think to update Elena | Agent sees relationship, updates |
| **Create** | Manual frontmatter, no links | Auto-wikilinks, suggestions, connected |

---

## Key Message

**"Your agent doesn't just search - it understands the context cloud and builds the graph as it works."**

### What Makes This Different

1. **Context Clouds vs Semantic Search**
   - Not just "notes containing X" but "notes related to X"
   - Graph structure reveals dependencies, ownership, risk chains

2. **Locally Imprecise, Globally Correct**
   - "Elena Rodriguez" suggested for propulsion work (she's Avionics!)
   - But she's affected by the timeline - context cloud captures this
   - Over time, these "imprecise" links build a navigable professional context

3. **Agent-Driven Graph Building**
   - Every mutation builds connections
   - Agent updates incidental notes based on relationship understanding
   - Graph gets smarter the more you use it

4. **All Client-Side**
   - Nothing leaves your machine
   - Full privacy, full control
   - Git commit on every mutation for undo safety

---

## Algorithm Evidence

**7-Layer Scoring at Work**:

| Entity Suggested | Why |
|------------------|-----|
| [[Propulsion System]] | Hub boost (+8), word overlap with "propulsion" |
| [[Marcus Johnson]] | Type boost (+5 people), co-occurrence with propulsion |
| [[Elena Rodriguez]] | Co-occurrence with schedule/timeline patterns |
| [[Turbopump]] | Exact match, high hub score |
| [[Risk Register]] | Context boost (delay → risk association) |
| [[Acme Aerospace]] | Co-occurrence with turbopump, vendor patterns |

**This is the algorithm documentation sales asset** - showing exactly why each suggestion was made.
