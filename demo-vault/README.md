# Demo Vault: Customer Support Agent Memory

A realistic vault showing Flywheel-Crank as a memory layer for AI support agents.

This is **the exact use case** that [Mem0](https://mem0.ai) and [LangMem](https://blog.langchain.com/langmem-sdk-launch/) solve with cloud APIs. Flywheel-Crank does it locally, deterministically, in <100ms.

## The Scenario

You're an AI support agent for a SaaS company. You need to:

- **Remember users**: [[Sarah Chen]] has billing issues, [[Bob Wilson]] is technical
- **Track tickets**: [[TKT-2024-003]] is escalated, needs follow-up
- **Reference knowledge**: [[Billing]] FAQ, [[API Rate Limits]] docs
- **Log activity**: Daily summaries, tickets handled

## Setup: Eyes + Hands

```json
{
  "mcpServers": {
    "flywheel": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-mcp"],
      "env": { "PROJECT_PATH": "/path/to/demo-vault" }
    },
    "flywheel-crank": {
      "command": "npx",
      "args": ["-y", "@velvetmonkey/flywheel-crank"],
      "env": { "PROJECT_PATH": "/path/to/demo-vault" }
    }
  }
}
```

## Real-World Examples

### 1. Log a Support Interaction

Sarah calls about her refund. Log it:

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

- **Auto-wikilinks**: "Sarah" → `[[Sarah Chen]]`
- **Contextual suggestions**: Related ticket and knowledge article

### 2. Update User Sentiment

Sarah's frustration is escalating:

```json
{
  "tool": "vault_update_frontmatter",
  "path": "users/sarah-chen.md",
  "updates": {
    "sentiment": "very_frustrated",
    "churn_risk": "high"
  }
}
```

Next time you handle Sarah, you see she's high churn risk.

### 3. Create a New Ticket

Bob has a new question:

```json
{
  "tool": "vault_create_note",
  "path": "tickets/TKT-2024-006.md",
  "frontmatter": {
    "type": "ticket",
    "status": "open",
    "user": "[[Bob Wilson]]",
    "category": "api"
  },
  "content": "# TKT-2024-006: Webhook Setup\n\n## Issue\n\n[[Bob Wilson]] needs help setting up webhooks.\n\n## Notes\n"
}
```

### 4. Resolve a Ticket

Mark Bob's rate limit question as answered:

```json
{
  "tool": "vault_update_frontmatter",
  "path": "tickets/TKT-2024-004.md",
  "updates": {
    "status": "resolved",
    "resolved": "2026-02-12"
  }
}
```

### 5. Add to Knowledge Base

Document a new FAQ:

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
demo-vault/
├── users/                    # Customer profiles
│   ├── sarah-chen.md         # Premium, billing issues, frustrated
│   ├── bob-wilson.md         # Developer, API questions
│   └── alice-martinez.md     # Trial, onboarding
├── tickets/                  # Support tickets
│   ├── TKT-2024-001.md       # Resolved: payment failed
│   ├── TKT-2024-002.md       # Resolved: API auth help
│   ├── TKT-2024-003.md       # Escalated: double charge
│   ├── TKT-2024-004.md       # Open: rate limits
│   └── TKT-2024-005.md       # Open: onboarding
├── knowledge/                # Knowledge base
│   ├── billing.md            # Billing FAQ
│   ├── api-rate-limits.md    # API documentation
│   └── onboarding.md         # Getting started guide
├── daily-notes/              # Agent activity log
│   └── 2026-02-12.md
├── .claude/
│   └── policies/
│       └── daily-standup.yaml  # Shift summary workflow
└── README.md
```

## Entities for Auto-Wikilinks

| Entity | Aliases | Context |
|--------|---------|---------|
| Sarah Chen | Sarah | Premium customer, billing issues |
| Bob Wilson | Bob | Developer, API questions |
| Alice Martinez | Alice | Trial user, onboarding |
| Billing | Billing FAQ, Payment Issues | Knowledge article |
| API Rate Limits | Rate Limits, Throttling | Knowledge article |
| Onboarding | Getting Started | Knowledge article |
| TKT-2024-* | - | Individual tickets |

## Why This Matters

### Mem0 vs Flywheel-Crank

| Feature | Mem0 | Flywheel-Crank |
|---------|------|----------------|
| **Latency** | Network-dependent | <100ms |
| **Privacy** | Cloud API | Local files |
| **Debugging** | Black box | Git history |
| **Cost** | Per-API-call | Free |
| **Lock-in** | Proprietary format | Standard markdown |
| **Determinism** | No | Yes |

### The Graph Builds Itself

```
Day 1:   Sarah mentions billing → [[Billing]] linked
         ↓
Week 1:  Pattern emerges: Sarah = billing issues
         ↓
Month 1: Agent knows: "Sarah calling? Probably billing."
```

Every interaction builds the graph. The graph improves context. Better context = better support.

## Tips

- **Reset vault**: `git checkout -- demo-vault/`
- **Test auto-wikilinks**: Mention "Sarah" or "Bob" in any note
- **Check backlinks**: Use Flywheel's `get_backlinks` to see ticket-user connections
- **Run policy**: Execute `daily-standup.yaml` to see multi-step workflow
