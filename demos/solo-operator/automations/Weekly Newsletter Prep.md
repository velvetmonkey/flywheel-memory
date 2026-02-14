---
type: playbook
trigger: weekly
automation: ai-managed
owner: system
last_run: 2026-01-07
---
# Weekly Newsletter Prep

Automated prep for the twice-weekly newsletter.

## Purpose

Reduce newsletter creation time from 2 hours to 1 hour by:
- Pre-gathering research from daily notes
- Finding relevant past issues
- Drafting an outline based on my voice

## Schedule

| Day | Newsletter | Prep Runs |
|-----|------------|-----------|
| Monday | - | Prep for Tuesday issue |
| Tuesday | Issue #X | - |
| Wednesday | - | Prep for Thursday issue |
| Thursday | Issue #X+1 | - |

## Trigger

- **Command**: "prep newsletter" or "newsletter prep"
- **Timing**: Monday and Wednesday mornings
- **Automatic**: Can be scheduled via hook

## Inputs

1. [[Content Calendar]] - Scheduled topic for this issue
2. Recent daily notes (last 3-5 days) - Research and ideas
3. [[Newsletter Archive]] - Past issues on similar topics
4. [[Reference]] - Voice and style guidelines
5. [[Subscriber Metrics]] - Current subscriber count

## Process

### Step 1: Check Calendar
- Read [[Content Calendar]]
- Identify scheduled topic for this issue
- If no topic, suggest from ideas backlog

### Step 2: Gather Research
- Scan recent daily notes for `## Notes` sections
- Extract relevant quotes, ideas, observations
- Look for patterns and themes

### Step 3: Find Related Past Issues
- Search [[Newsletter Archive]] for similar topics
- Note which subject lines performed well
- Identify angles that worked

### Step 4: Generate Outline
Based on my voice from [[Reference]]:
- Draft a 3-5 point outline
- Suggest a subject line (using successful patterns)
- Include CTA recommendation

### Step 5: Write to Daily Note
Add prep summary to today's daily note under `## Newsletter Prep`

## Output Format

```markdown
## Newsletter Prep (auto-generated)

**This Issue:** AI Tools Weekly #[number]
**Topic:** [scheduled topic]
**Subscribers:** [current count]

**Key points from recent notes:**
- [Point 1 with source link]
- [Point 2 with source link]
- [Point 3]

**Related past issues:**
- Issue #[X]: "[Title]" ([open rate])
- Issue #[Y]: "[Title]" ([open rate])

**Suggested outline:**
1. [Opening hook]
2. [Main point 1]
3. [Main point 2]
4. [CTA]

**Subject line options:**
- "[Option 1]" (pattern: number + outcome)
- "[Option 2]" (pattern: curiosity)

**Voice reminder:** Clear, practical, slightly opinionated. No fluff.
```

## Example Output

```markdown
## Newsletter Prep (auto-generated)

**This Issue:** AI Tools Weekly #49
**Topic:** Solo Operator Stack
**Subscribers:** 2,847

**Key points from recent notes:**
- Flywheel working well for daily ops [[2026-01-06]]
- Chief of staff pattern resonating [[2026-01-07]]
- Revenue tracking without spreadsheets [[2026-01-02]]

**Related past issues:**
- Issue #43: "AI Tools I Actually Use" (40%)
- Issue #38: "My Productivity Stack" (37%)

**Suggested outline:**
1. Hook: "Running a business from markdown files"
2. The 3 components: vault, AI, workflows
3. What I actually use daily
4. CTA: Reply with your stack

**Subject line options:**
- "My $8K/month markdown business" (pattern: specific outcome)
- "The solo operator stack I use daily" (pattern: personal/specific)

**Voice reminder:** Clear, practical, slightly opinionated. No fluff.
```

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to generate | <1 minute |
| Outline quality | Usable 80% of time |
| Subject line used | 60% of time |

## Related

- Content: [[Content Calendar]]
- Archive: [[Newsletter Archive]]
- Voice: [[Reference]]
- Metrics: [[Subscriber Metrics]]
