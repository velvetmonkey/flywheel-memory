---
paths: "daily-notes/**/*.md"
alwaysApply: false
---

# Daily Notes Format

## Structure

Daily notes capture engineering progress with links to people, systems, and decisions.

## Log Section

Format entries as continuous bullets with context:

```markdown
## Log

- 08:30 - [[Sarah Chen]] - Reviewed propulsion test data
- 10:00 - [[Propulsion System]] - Anomaly analysis meeting
- 14:00 - [[Marcus Johnson]] - GNC integration sync
- 16:00 - [[ADR-015 Engine Selection]] - Drafted decision record
```

## Linking Conventions

- Link team members: `[[Sarah Chen]]`, `[[Marcus Johnson]]`
- Link systems: `[[Propulsion System]]`, `[[Avionics System]]`
- Link decisions: `[[ADR-### Title]]`
- Link tests: `[[Test Name]]`

## Time Format

- Use 24-hour time: `08:30`, `14:00`
- Include person or system context
- Brief description of activity
