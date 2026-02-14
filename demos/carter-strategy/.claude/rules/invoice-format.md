---
paths: "invoices/**/*.md"
alwaysApply: false
---

# Invoice Format

## Naming Convention

`INV-YYYY-###.md` where:
- YYYY is the year
- ### is a sequential number (001, 002, etc.)

Example: `INV-2026-001.md`, `INV-2026-042.md`

## Required Frontmatter

```yaml
---
type: invoice
client: "[[Client Name]]"
amount: 5000
status: pending
due_date: 2026-02-15
hours: 20
hourly_rate: 250
---
```

## Status Values

- `pending` - Invoice sent, awaiting payment
- `paid` - Payment received
- `overdue` - Past due date, unpaid

## Content

- Always link to the client: `[[Client Name]]`
- Include line items or summary of work
- Reference related projects when applicable
