---
type: knowledge
category: billing
aliases:
  - Billing
  - Billing FAQ
  - Payment Issues
last_updated: 2026-02-11
---
# Billing

Common billing questions and troubleshooting.

## FAQ

### Why was my payment declined?

Common reasons:
1. Card expired
2. Insufficient funds
3. Bank fraud protection

**Resolution:** Update payment method in Settings > Billing.

### How do I get a refund?

Refunds processed within 3-5 business days. Contact support with:
- Account email
- Charge date
- Reason for refund

### How do I upgrade/downgrade?

Settings > Plan > Change Plan. Changes take effect next billing cycle.

## Known Issues

### Double Charge Bug (Feb 2026)

Some customers experienced duplicate charges due to webhook retry bug. Engineering fix deployed Feb 12. Affected customers receiving automatic refunds.

Related tickets: [[TKT-2024-003]]

## Pricing Tiers

| Tier | Price | Rate Limit |
|------|-------|------------|
| Trial | Free | 100 req/min |
| Developer | $29/mo | 1000 req/min |
| Premium | $99/mo | 5000 req/min |
| Enterprise | Custom | 10000+ req/min |

## Related

- [[API Rate Limits]] - Usage limits by tier
- [[Onboarding]] - New user setup

