---
type: knowledge
category: checklist
last_reviewed: 2024-10-15
used_in:
  - "[[GlobalBank API Audit]]"
  - "[[TechStart MVP Build]]"
tags:
  - knowledge
  - reusable
  - security
  - api
---
# [[API Security Checklist]]

## Overview

Comprehensive [[Security Checklist]] for API development and review. [[Used In]] security audits and as a guide during development.

**[[Last Reviewed]]**: [[October 2024]]
**Used In**: [[GlobalBank API Audit]], [[TechStart MVP Build]]

## Authentication

- [ ] Use industry-standard protocols (OAuth 2.0, OpenID Connect)
- [ ] Implement proper token expiration
- [ ] Use secure token storage ([[HttpOnly]] cookies, secure storage)
- [ ] Implement token refresh mechanism
- [ ] Rate limit authentication attempts
- [ ] Log authentication failures

## Authorization

- [ ] Implement role-based access control (RBAC)
- [ ] Validate authorization on every request
- [ ] Use principle of least privilege
- [ ] Prevent privilege escalation
- [ ] Document permission model

## [[Input Validation]]

- [ ] Validate all input parameters
- [ ] Use allowlists over denylists
- [ ] Implement request size limits
- [ ] Sanitize user input
- [ ] Validate content types
- [ ] Protect against injection attacks (SQL, NoSQL, command)

## [[Data Protection]]

- [ ] Use TLS 1.3 for all connections
- [ ] Encrypt sensitive data at rest
- [ ] Implement proper key management
- [ ] Mask sensitive data in logs
- [ ] Implement data classification

## [[Error Handling]]

- [ ] Use generic error messages for clients
- [ ] Log detailed errors server-side
- [ ] Never expose stack traces
- [ ] Implement proper exception handling
- [ ] Use consistent error response format

## [[Rate Limiting]]

- [ ] Implement rate limiting per client
- [ ] Use progressive backoff
- [ ] Return proper 429 responses
- [ ] Monitor for abuse patterns
- [ ] Document rate limits in API docs

## Logging & Monitoring

- [ ] Log all API access
- [ ] Include request IDs for tracing
- [ ] Monitor for anomalies
- [ ] Set up alerting
- [ ] Retain logs per compliance requirements

## Headers & CORS

- [ ] [[Set Content]]-Security-Policy
- [ ] Configure CORS appropriately
- [ ] Use X-Content-Type-Options: nosniff
- [ ] Set X-Frame-Options
- [ ] Remove server version headers

## [[API Design]]

- [ ] Use versioning
- [ ] Document all endpoints (OpenAPI)
- [ ] Implement pagination
- [ ] Use proper HTTP methods
- [ ] Return appropriate status codes

## Related

- Projects: [[GlobalBank API Audit]], [[TechStart MVP Build]]
- Playbook: [[Data Migration Playbook]]

---

*Standard checklist for all API work*
