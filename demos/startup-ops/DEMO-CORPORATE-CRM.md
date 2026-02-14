# Demo: Corporate CRM - Startup Ops

**Audience**: Teams, startups, companies wanting "Free CRM" from markdown

**Scenario**: SaaS co-founder tracks customers, MRR, playbook execution. Daily logs become relationship intelligence.

---

## Setup

**Entity Index**: 31 notes, 34 wikilinks/file average
**Key Entities**:
- Customers: [[DataDriven Co]], [[GrowthStack]], [[InsightHub]]
- Contacts: [[Sarah Johnson]], [[Alex Chen]], [[Jamie Patel]]
- Features: [[Dashboard Usage]], [[API Access]], [[Alerts Feature]]
- Playbooks: [[Customer Onboarding]], [[Weekly Metrics Review]]
- Finance: [[MRR Tracker]], [[Investor Pipeline]]

---

## The "Free CRM" Concept

**Traditional CRM**: Separate system, per-seat licensing, data entry friction
**Flywheel CRM**: Your daily notes ARE your CRM. Graph builds from natural logging.

```
Daily Logs          →    Auto-Wikilinks    →    Relationship Graph
                         + Suggestions
"Called Sarah at         [[Sarah Johnson]]       Customer health from
DataDriven"              [[DataDriven Co]]       backlink density
                         → [[Customer Onboarding]]
```

---

## Step 1: Morning Log Entry

**Context**: Co-founder logs Day 2 customer check-in

```javascript
await crank.vault_add_to_section({
  path: 'daily-notes/2026-01-07.md',
  section: 'Log',
  content: 'Day 2 check-in with Sarah at DataDriven. Dashboard usage looking good - 3 team members active. She asked about API access for their BI tool.',
  format: 'timestamp-bullet',
  suggestOutgoingLinks: true
});
```

**Result** (with auto-wikilinks + suggestions):
```markdown
- 09:30 - Day 2 check-in with [[Sarah Johnson]] at [[DataDriven Co]]. [[Dashboard Usage]] looking good - 3 team members active. She asked about [[API Access]] for their BI tool. → [[Customer Onboarding]] [[GrowthStack]] [[MRR Tracker]]
```

**Auto-Wikilinks Applied**:
| Input | Linked To | Why |
|-------|-----------|-----|
| "Sarah" | [[Sarah Johnson]] | Unique Sarah, linked to DataDriven |
| "DataDriven" | [[DataDriven Co]] | Customer entity |
| "Dashboard" | [[Dashboard Usage]] | Feature entity |
| "API access" | [[API Access]] | Feature entity |

**Suggestions Appended**:
| Entity | Why Suggested |
|--------|---------------|
| [[Customer Onboarding]] | Context: "Day 2" = onboarding playbook |
| [[GrowthStack]] | Co-occurrence: Similar customer, similar stage |
| [[MRR Tracker]] | Context: Customer activity = revenue tracking |

**Demo Point**: "GrowthStack" suggested - another customer at similar stage. Context cloud captures similar-stage patterns.

---

## Step 2: Query Customer Health (Context Cloud)

**Traditional CRM**: Export report, filter by last contact date
**Flywheel Query**: Graph intelligence reveals relationship health

```javascript
// Query customer health via backlink density
const customers = await flywheel.search_notes({
  folder: 'ops/customers',
  where: { status: 'active' }
});

for (const customer of customers) {
  const backlinks = await flywheel.get_backlinks({ path: customer.path });
  const metadata = await flywheel.get_note_metadata({ path: customer.path });

  console.log(`${customer.name}:`);
  console.log(`  - MRR: ${metadata.mrr}`);
  console.log(`  - Last contact: ${metadata.last_contact}`);
  console.log(`  - Backlink count: ${backlinks.length}`);
  console.log(`  - Recent mentions: ${backlinks.slice(0,3).map(b => b.title)}`);
}
```

**Context Cloud Returns**:

```
[[DataDriven Co]]:
  - Status: active
  - MRR: $499
  - Last contact: today (Day 2 check-in)
  - Backlinks: 12 daily notes, 3 meetings, 2 playbook refs
  - Recent: Day 2 onboarding, dashboard active, API interest
  - Health Signal: 🟢 HIGH (dense recent backlinks)

[[GrowthStack]]:
  - Status: trial
  - MRR: $0
  - Last contact: 3 days ago
  - Backlinks: 5 daily notes, 2 meetings
  - Recent: SSO blocker, decision pending Friday
  - Health Signal: 🟡 MEDIUM (awaiting decision)

[[InsightHub]]:
  - Status: churned
  - MRR: $0
  - Last contact: 2 weeks ago
  - Backlinks: 3 daily notes (declining)
  - Pattern: No daily note mentions for 14 days before churn
  - Health Signal: ⚫ CHURNED (backlink density dropped)
```

**Demo Point**: The **backlink density** reveals relationship health. InsightHub had declining mentions before churn - a leading indicator CRM software would miss.

---

## Step 3: Playbook Execution with Auto-Updates

**Context**: DataDriven Day 2 complete, need to schedule Day 7 review

```javascript
// Update customer note with onboarding progress
await crank.vault_add_to_section({
  path: 'ops/customers/DataDriven Co.md',
  section: 'Timeline',
  content: '| 2026-01-07 | Day 2 complete | Dashboard active, API interest |',
  format: 'plain',
  suggestOutgoingLinks: true
});

// Agent decides: Also update playbook tracker
await crank.vault_add_to_section({
  path: 'ops/playbooks/Customer Onboarding.md',
  section: 'Active Onboardings',
  content: '[[DataDriven Co]] - Day 2 ✅, Day 7 scheduled (2026-01-13)',
  format: 'bullet',
  suggestOutgoingLinks: true
});
```

**Result**: Two notes updated from one interaction

**Customer Note** (DataDriven Co.md):
```markdown
## Timeline

| Date | Event | Notes |
|------|-------|-------|
| 2025-12-15 | Initial demo | Sarah loved the API integration |
| 2025-12-20 | Trial started | 14-day trial |
| 2026-01-01 | Converted to paid | Signed annual contract |
| 2026-01-06 | Kickoff | Technical onboarding call |
| 2026-01-07 | Day 2 complete | [[Dashboard Usage]] active, [[API Access]] interest → [[Customer Onboarding]] [[Alex Chen]] |
```

**Playbook Note** (Customer Onboarding.md):
```markdown
## Active Onboardings

- [[DataDriven Co]] - Day 2 ✅, Day 7 scheduled (2026-01-13) → [[Sarah Johnson]] [[Alex Chen]]
- [[GrowthStack]] - Awaiting decision (SSO blocker)
```

**Demo Point**: Playbook and customer both track progress. Graph connects everything.

---

## Step 4: Create Meeting Note

**Context**: Create meeting record with context suggestions

```javascript
// Create meeting note structure
await crank.vault_create_note({
  path: 'ops/meetings/2026-01-07 DataDriven Day 2.md',
  frontmatter: {
    type: 'meeting',
    date: '2026-01-07',
    customer: '[[DataDriven Co]]',
    attendees: ['[[Alex Chen]]', '[[Sarah Johnson]]'],
    stage: 'onboarding-day-2'
  },
  content: `# 2026-01-07 DataDriven Day 2

## Summary

## Discussion

## Action Items

`
});

// Add meeting content with suggestions
await crank.vault_add_to_section({
  path: 'ops/meetings/2026-01-07 DataDriven Day 2.md',
  section: 'Summary',
  content: 'Day 2 check-in successful. 3 team members now active on platform. Sarah enthusiastic about Q1 rollout.',
  format: 'plain',
  suggestOutgoingLinks: true
});

await crank.vault_add_to_section({
  path: 'ops/meetings/2026-01-07 DataDriven Day 2.md',
  section: 'Discussion',
  content: `- Dashboard usage patterns positive
- API access requested for BI tool integration
- Exploring advanced analytics module for expansion`,
  format: 'plain',
  suggestOutgoingLinks: true
});
```

**Result**:
```markdown
## Summary

Day 2 check-in successful. 3 team members now active on platform. [[Sarah Johnson]] enthusiastic about Q1 rollout. → [[DataDriven Co]] [[Customer Onboarding]]

## Discussion

- [[Dashboard Usage]] patterns positive
- [[API Access]] requested for BI tool integration
- Exploring [[Advanced Analytics]] module for expansion
→ [[MRR Tracker]] [[Feature Priorities]]
```

**Demo Point**: Meeting note automatically connected to relevant entities. Future queries will surface this context.

---

## Wow Factor Summary

| Traditional CRM | Flywheel "Free CRM" |
|-----------------|---------------------|
| Separate system to update | Log to daily note, auto-syncs |
| Manual contact tracking | Backlink density = health signal |
| Rigid pipeline stages | Flexible playbook execution |
| Report generation | Context cloud queries |
| Per-seat licensing | Free, git-backed, you own data |

---

## Key Message

**"Your daily notes ARE your CRM. Relationship intelligence from natural logging. Free, private, owned."**

### Why This Works for Teams

1. **Zero data entry friction** - Just log what you do naturally
2. **Backlinks reveal health** - More mentions = healthier relationship
3. **Playbooks stay connected** - Onboarding checklist links to customer notes
4. **Churn prediction** - Declining backlink density = early warning
5. **Full audit trail** - Git history shows exactly what happened when

### The Graph Advantage

**Scenario**: "When did we last discuss API access with DataDriven?"

**Traditional CRM**: Search notes, grep emails, ask around
**Flywheel Query**: `get_backlinks([[API Access]])` → Shows all mentions, including DataDriven meeting, with dates

**Scenario**: "Which customers are at similar stage to DataDriven?"

**Traditional CRM**: Filter by stage field (if populated)
**Flywheel Query**: Context cloud suggestions already surfaced [[GrowthStack]] when logging DataDriven activity

---

## Algorithm Evidence

**Backlink Density as Health Signal**:

| Customer | Daily Note Mentions (30d) | Meetings | Health |
|----------|---------------------------|----------|--------|
| [[DataDriven Co]] | 12 | 3 | 🟢 HIGH |
| [[GrowthStack]] | 5 | 2 | 🟡 MEDIUM |
| [[InsightHub]] | 0 (last 14d) | 0 | 🔴 CHURNED |

**Insight**: InsightHub's backlink density dropped to zero 14 days before churn. This pattern is now a leading indicator for at-risk customers.

**Co-occurrence Patterns**:

When logging DataDriven activity, algorithm suggests:
- [[GrowthStack]] - Both in onboarding stage, similar patterns
- [[Customer Onboarding]] - Playbook for this stage
- [[MRR Tracker]] - Revenue tracking context

**The graph captures what you're working on, not just what you wrote.**
