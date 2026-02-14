---
type: automation
trigger: daily
automation: ai-managed
owner: system
last_run: 2026-01-07
---
# Morning Briefing

Automated daily briefing routine. Runs each morning to prep the day.

## Purpose

Start each day with clarity:
- What happened yesterday
- What's on deck today
- What needs attention

## Trigger

- **Command**: `/briefing` or "run my morning briefing"
- **Timing**: Run after 8am, before starting work
- **Frequency**: Daily (weekdays)

## Inputs

The briefing reads from:

1. **Yesterday's daily note** - `## Log` section for activities
2. [[Revenue Tracker]] - Yesterday's transactions
3. [[Content Calendar]] - Today's deadlines
4. [[Subscriber Metrics]] - Growth alerts

## Process

1. Read yesterday's daily note
2. Extract key activities from `## Log`
3. Count completed vs pending tasks
4. Check Revenue Tracker for yesterday's sales
5. Check Content Calendar for today's due items
6. Check Subscriber Metrics for any alerts
7. Generate briefing summary
8. Write to today's daily note under `## Briefing`

## Output Format

```markdown
## Briefing (auto-generated)

**Yesterday:**
- [Activity 1]
- [Activity 2]
- [Revenue event if any]

**Today:**
- [Priority 1 from calendar]
- [Priority 2 from pending tasks]
- [Priority 3]

**Alerts:**
- [green/yellow/red] [Metric status]
```

## Example Output

```markdown
## Briefing (auto-generated)

**Yesterday:**
- Newsletter sent: "5 Claude Code Workflows" (42% open rate)
- Course sale: 1 ($297) from newsletter CTA
- TechCorp consulting session completed

**Today:**
- Follow up on TechCorp expansion proposal
- Research Thursday newsletter topic
- Update Revenue Tracker

**Alerts:**
- [green] Course sales on track for $3K month
- [yellow] Subscriber growth below target (-28%)
```

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to generate | <30 seconds |
| Accuracy | All data points correct |
| Actionability | 3 clear priorities |

## Related

- Command file: [[.claude/commands/morning-briefing]]
- Reference: [[Reference]]
- Revenue: [[Revenue Tracker]]
- Content: [[Content Calendar]]
