---
paths: "systems/**/*.md"
alwaysApply: false
---

# System Notes Format

## Required Frontmatter

```yaml
---
type: system
status: dev
risk: medium
owner: "[[Sarah Chen]]"
subsystems:
  - "[[Engine Assembly]]"
  - "[[Fuel Delivery]]"
---
```

## Status Values

- `dev` - In active development
- `test` - Under testing
- `done` - Complete and validated
- `blocked` - Waiting on dependency

## Risk Values

- `low` - Well understood, low complexity
- `medium` - Some uncertainty or moderate complexity
- `high` - Significant technical risk
- `critical` - Mission-critical, requires extra review

## Owner

Always link the system owner as `[[Person Name]]`

## Sections

### Overview
Brief description of the system's purpose and scope

### Requirements
Key requirements and constraints

### Interfaces
How this system connects to other systems

### Status
Current state, recent updates, next steps
