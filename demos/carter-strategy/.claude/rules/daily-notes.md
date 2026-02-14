---
paths: "daily-notes/**/*.md"
alwaysApply: false
---

# Daily Notes Format

## Structure

Daily notes should include:
- Frontmatter with `billable_hours` when applicable
- A Log section for time-tracked activities

## Log Section

Format log entries as continuous bullets:

```markdown
## Log

- 09:00 - [[Acme Corp]] - Strategy session prep
- 10:30 - [[Acme Corp]] - Client call, discussed Q2 roadmap
- 14:00 - [[TechStart]] - Reviewed proposal feedback
- 15:30 - Admin - Invoice reconciliation
```

## Time Format

- Use 24-hour time: `09:00`, `14:30`
- Include client wikilink when billable
- Brief activity description after the dash
