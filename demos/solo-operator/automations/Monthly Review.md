---
type: playbook
trigger: monthly
automation: ai-managed
owner: system
last_run: 2025-12-31
---
# Monthly Review

End-of-month review automation. Aggregates the month's data into a comprehensive review.

## Purpose

- Summarize monthly performance across all metrics
- Identify wins and concerns
- Set focus for next month

## Schedule

- **When**: Last day of each month (or first day of new month)
- **Command**: "monthly review" or "do monthly review"
- **Duration**: ~2 minutes to generate

## Inputs

1. All weekly notes for the month
2. [[Revenue Tracker]] - Monthly totals
3. [[Subscriber Metrics]] - Growth data
4. [[Newsletter Archive]] - Content performance
5. [[AI Automation Course]] - Product metrics
6. [[Consulting Services]] - Consulting hours
7. Daily notes for the month

## Process

### Step 1: Aggregate Weekly Data
- Read all weekly-notes for the month
- Sum: revenue, hours, sales, growth

### Step 2: Calculate Metrics
- Total revenue vs target
- Subscriber growth vs target
- Course sales and conversion
- Consulting hours and rate

### Step 3: Identify Patterns
- Best performing content
- Revenue trends
- Growth acceleration/deceleration

### Step 4: Generate Review
Create monthly note in `monthly-notes/` folder

### Step 5: Set Next Month Focus
Based on gaps and opportunities, suggest 3 priorities

## Output Format

Creates `monthly-notes/YYYY-MM.md`:

```markdown
---
type: monthly
month: YYYY-MM
automation: ai-generated
revenue_total: [amount]
subscriber_growth: [net]
---
# [Month Year] Review

## Performance Summary

| Metric | Result | Target | Status |
|--------|--------|--------|--------|
| Revenue | $X | $Y | [%] |
| Subscribers | +X | +Y | [%] |
| Course Sales | X | Y | [%] |
| Consulting Hours | X | Y | [%] |
| Newsletters Sent | X | X | [check] |

## Revenue Breakdown

| Stream | Amount | % of Total |
|--------|--------|------------|
| Newsletter | $X | X% |
| Course | $X | X% |
| Consulting | $X | X% |

## Highlights

### Wins
- [Achievement 1]
- [Achievement 2]

### Concerns
- [Issue 1]
- [Issue 2]

## Content Performance

| Issue | Title | Opens | Clicks |
|-------|-------|-------|--------|
| #X | Title | X% | X% |

Best performer: Issue #X

## Next Month Focus

1. [Priority 1]
2. [Priority 2]
3. [Priority 3]

```

## Example Output

```markdown
---
type: monthly
month: 2025-12
automation: ai-generated
revenue_total: 3776
subscriber_growth: 155
---
# December 2025 Review

## Performance Summary

| Metric | Result | Target | Status |
|--------|--------|--------|--------|
| Revenue | $3,776 | $4,000 | 94% |
| Subscribers | +155 | +200 | 78% |
| Course Sales | 8 | 6 | 133% |
| Consulting Hours | 3 | 4 | 75% |
| Newsletters Sent | 8 | 8 | 100% |

## Highlights

### Wins
- Best course sales month ever (8 sales)
- Hit 2,800 subscriber milestone
- Year-end retrospective was most-shared post

### Concerns
- Subscriber growth below target
- Consulting hours light (holidays)

## Next Month Focus

1. Launch subscriber growth campaign (lead magnet)
2. Close TechCorp expansion ($2,400)
3. Begin course v2.0 planning
```

## Related

- Revenue: [[Revenue Tracker]]
- Subscribers: [[Subscriber Metrics]]
- Weekly: [[2026-W01]]
