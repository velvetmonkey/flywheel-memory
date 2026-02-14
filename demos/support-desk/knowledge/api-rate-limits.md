---
type: knowledge
category: api
aliases:
  - API Rate Limits
  - Rate Limits
  - Throttling
last_updated: 2026-02-01
---
# API Rate Limits

Rate limiting documentation for developers.

## Limits by Tier

| Tier | Requests/Minute | Burst |
|------|-----------------|-------|
| Trial | 100 | 20 |
| Developer | 1000 | 200 |
| Premium | 5000 | 1000 |
| Enterprise | 10000+ | Custom |

## Headers

Every response includes rate limit headers:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1707753600
```

## Handling 429 Errors

When rate limited, you'll receive:

```json
{
  "error": "rate_limit_exceeded",
  "retry_after": 60
}
```

**Best practices:**
1. Implement exponential backoff
2. Cache responses when possible
3. Use webhooks instead of polling

## Calculator

For 100 concurrent users at 1 req/sec:
- Needed: 6000 req/min
- Developer tier: ❌ (1000 limit)
- Premium tier: ❌ (5000 limit)
- Enterprise tier: ✓ (10000+ limit)

## Related

- [[Billing]] - Tier pricing
- [[Bob Wilson]] - Asked about this for his integration

