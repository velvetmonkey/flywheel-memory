---
paths: "ops/customers/**/*.md"
alwaysApply: false
---

# Customer Records Format

## Required Frontmatter

```yaml
---
type: customer
status: active
mrr: 500
contract: annual
last_contact: 2026-01-15
owner: "[[Alex]]"
industry: SaaS
---
```

## Status Values

- `lead` - Potential customer, not yet converted
- `trial` - In free trial period
- `pilot` - Paid pilot/POC
- `active` - Paying customer
- `churned` - Former customer

## Contract Values

- `monthly` - Month-to-month billing
- `annual` - Annual contract

## Owner

Always link the account owner: `[[Person Name]]`

## Sections

### Overview
Company info, use case, key contacts

### Timeline
Interaction history:

```markdown
## Timeline

- 2026-01-15 - Onboarding call completed
- 2026-01-10 - Contract signed
- 2026-01-05 - Demo call with [[Sarah]]
```

### Notes
Preferences, risks, expansion opportunities

### Related
- Link to related meetings, support tickets, invoices
