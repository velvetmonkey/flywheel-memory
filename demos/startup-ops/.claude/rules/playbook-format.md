---
paths: "ops/playbooks/**/*.md"
alwaysApply: false
---

# Playbook Format

## Purpose

Playbooks document repeatable operational processes.

## Examples

- `[[Customer Onboarding]]`
- `[[Support Escalation]]`
- `[[Monthly Invoicing]]`
- `[[Churn Prevention]]`

## Required Sections

### Overview
Brief description of when to use this playbook

### Checklist

Numbered steps with clear owners:

```markdown
## Checklist

1. [ ] Create customer folder from [[Customer Template]]
2. [ ] Schedule onboarding call (Owner: [[Alex]])
3. [ ] Send welcome email with [[Welcome Email Template]]
4. [ ] Add to Slack channel
5. [ ] Create first invoice in [[Invoicing System]]
6. [ ] Update [[Customer List]] with new entry
```

### Templates Used
Link to templates this playbook references

### Time Estimate
Approximate time to complete (e.g., "30 minutes")

## Formatting Rules

- Use checkboxes `[ ]` for actionable items
- Include owner in parentheses when relevant
- Link to all templates and related notes
- Keep steps atomic and verifiable
