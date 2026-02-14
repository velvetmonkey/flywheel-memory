---
type: knowledge
category: getting-started
aliases:
  - Onboarding
  - Getting Started
  - Quickstart
last_updated: 2026-02-10
---
# Onboarding

Guide for new users getting started.

## Quick Start (5 minutes)

1. **Create account** - Verify email
2. **Get API key** - Settings > API Keys > Generate
3. **Make first call** - See example below
4. **Explore docs** - Full API reference at docs.example.com

## First API Call

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
     https://api.example.com/v1/hello
```

Expected response:
```json
{
  "message": "Welcome to the API!",
  "docs": "https://docs.example.com"
}
```

## Common First Questions

### "Where do I find my API key?"

Settings > API Keys > Generate New Key

### "What can I build?"

Popular use cases:
- SaaS integrations
- Data syncing
- Automation workflows
- Custom dashboards

### "What's the free tier limit?"

Trial: 100 requests/minute for 14 days. See [[API Rate Limits]].

## Onboarding Checklist

- [ ] Email verified
- [ ] API key generated
- [ ] First API call made
- [ ] Billing info added (for paid plans)
- [ ] Team members invited (if applicable)

## Related

- [[Billing]] - Plan pricing
- [[API Rate Limits]] - Usage limits
- [[Alice Martinez]] - Example onboarding ticket

