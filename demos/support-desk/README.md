# Support Desk

A support team vault with customer profiles, tickets, and a knowledge base.

## The Scenario

You're running support for a SaaS company. Your vault tracks:

- **Users**: [[Sarah Chen]] has billing issues, [[Bob Wilson]] is technical
- **Tickets**: [[TKT-2024-003]] is escalated, needs follow-up
- **Knowledge**: [[Billing]] FAQ, [[API Rate Limits]] docs
- **Daily notes**: Activity log, tickets handled

## Setup

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-memory"]
    }
  }
}
```

Open this folder in Claude Code and start asking questions.

## Examples

### Log an interaction

```json
{
  "tool": "vault_add_to_section",
  "path": "daily-notes/2026-02-12.md",
  "section": "## Log",
  "content": "Call with Sarah - refund still processing, she's frustrated",
  "format": "timestamp-bullet"
}
```

**Result:**
```markdown
## Log
- 14:30 Call with [[Sarah Chen]] - refund still processing, she's frustrated
  → [[TKT-2024-003]] [[Billing]]
```

Auto-wikilinks turn "Sarah" into `[[Sarah Chen]]` and suggest related notes.

### Update frontmatter

```json
{
  "tool": "vault_update_frontmatter",
  "path": "users/sarah-chen.md",
  "updates": { "sentiment": "very_frustrated", "churn_risk": "high" }
}
```

### Create a ticket

```json
{
  "tool": "vault_create_note",
  "path": "tickets/TKT-2024-006.md",
  "frontmatter": { "type": "ticket", "status": "open", "user": "[[Bob Wilson]]" },
  "content": "# TKT-2024-006: Webhook Setup\n\n[[Bob Wilson]] needs help setting up webhooks.\n"
}
```

### Add to knowledge base

```json
{
  "tool": "vault_add_to_section",
  "path": "knowledge/billing.md",
  "section": "## FAQ",
  "content": "### Why don't I see my discount?\n\nDiscounts apply on next billing cycle.",
  "format": "plain"
}
```

## Structure

```
support-desk/
├── users/                    # Customer profiles
│   ├── sarah-chen.md         # Premium, billing issues
│   ├── bob-wilson.md         # Developer, API questions
│   └── alice-martinez.md     # Trial, onboarding
├── tickets/                  # Support tickets
│   ├── TKT-2024-001.md       # Resolved: payment failed
│   ├── TKT-2024-002.md       # Resolved: API auth help
│   ├── TKT-2024-003.md       # Escalated: double charge
│   ├── TKT-2024-004.md       # Open: rate limits
│   └── TKT-2024-005.md       # Open: onboarding
├── knowledge/                # Knowledge base
│   ├── billing.md
│   ├── api-rate-limits.md
│   └── onboarding.md
├── daily-notes/
│   └── 2026-02-12.md
└── .claude/policies/
    └── daily-standup.yaml    # Shift summary workflow
```

## Tips

- **Reset vault**: `git checkout -- demos/support-desk/`
- **Test auto-wikilinks**: Mention "Sarah" or "Bob" in any note
- **Check backlinks**: `get_backlinks("users/sarah-chen.md")` to see ticket connections
- **Run policy**: Execute `daily-standup.yaml` for a multi-step workflow
