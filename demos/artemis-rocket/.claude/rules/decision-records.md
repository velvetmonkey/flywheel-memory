---
paths: "decisions/**/*.md"
alwaysApply: false
---

# Architecture Decision Records (ADR)

## Naming Convention

`ADR-### Title.md` where:
- ### is a sequential number (001, 002, etc.)
- Title is a brief description

Example: `ADR-001 Propellant Selection.md`, `ADR-015 Engine Configuration.md`

## Required Frontmatter

```yaml
---
type: decision
status: accepted
date: 2026-01-15
owner: "[[Sarah Chen]]"
systems:
  - "[[Propulsion System]]"
---
```

## Status Values

- `proposed` - Under discussion
- `accepted` - Approved and active
- `superseded` - Replaced by newer ADR
- `deprecated` - No longer applicable

## Required Sections

### Context
Why this decision is needed. What problem are we solving?

### Decision
What we decided and why.

### Consequences
Trade-offs, risks, and impacts of this decision.

## Owner

Always link the decision owner as `[[Person Name]]`
