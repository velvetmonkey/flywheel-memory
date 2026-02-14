---
paths: "clients/**/*.md"
alwaysApply: false
---

# Client Notes Format

## Required Frontmatter

```yaml
---
type: client
status: active
hourly_rate: 250
contact_name: "Jane Smith"
contact_email: "jane@example.com"
---
```

## Status Values

- `lead` - Potential client, not yet engaged
- `active` - Current paying client
- `paused` - Relationship on hold
- `past` - Former client

## Sections

Include these sections in client notes:

### Contact Info
Key contacts and communication preferences

### Projects
Links to all `[[Project Name]]` for this client

### Invoices
Links to related invoices: `[[INV-2026-001]]`

### Notes
Meeting notes, preferences, relationship context
