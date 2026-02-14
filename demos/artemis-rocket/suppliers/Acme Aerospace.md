---
type: supplier
status: delayed
contact: Steve Morrison (VP Engineering)
specialty: turbomachinery
blocked_by:
  - "[[Turbopump]]"
affects:
  - "[[Propulsion System]]"
  - "[[Engine Hot Fire Results]]"
created: 2025-06-15
updated: 2026-01-02
tags:
  - supplier
  - propulsion
  - critical-path
  - turbopump
---
# [[Acme Aerospace]]

Primary supplier for the [[Turbopump]] flight unit.

## Current Status

**Delivery Status**: 🔴 DELAYED
**Original Delivery**: [[Jan 5]], 2026
**Revised Delivery**: [[Jan 20]], 2026 (potentially longer)

### [[Delivery Delay]] Details

**Root Cause**: Machine shop equipment failure (5-axis CNC mill)
- Impeller machining requires specialized equipment
- Repair estimated 2 weeks
- No spare capacity at other facilities
- Alternative suppliers have 16-week lead time for custom turbopumps

**Impact**:
- Threatens [[Engine Hot Fire Results]] Test 4 schedule ([[Jan 8]])
- Delays [[Ignition Sequence]] validation with flight hardware
- Blocks [[Thrust Validation]] testing
- See [[Risk Register]] R-003 for full impact analysis

## Contract Details

- **Contract**: Fixed-price, $600K for flight unit + 2 spares
- **History**: Reputable supplier, 15+ years in aerospace turbomachinery
- **Relationship Status**: 🟡 Strained due to delay

## [[Mitigation Actions]]

1. ✅ Expedited shipping arranged (+$15K cost, saves 2-3 days)
2. 🔄 Dual-sourcing evaluation with [[Precision Components Inc]]
3. 🔄 Using prototype turbopump for Tests 1-3 (completed)

## Contact

- **VP Engineering**: [[Steve Morrison]]
- **Weekly status calls**: See [[Vendor Meeting Acme Aerospace]]

## Related

- [[Turbopump]] - Component being supplied
- [[Propulsion System]] - Affected system
- [[Risk Register]] - R-003 (delivery delay risk)
- [[Precision Components Inc]] - Backup supplier

---

*Last Updated: 2026-01-02*
*Next review: Daily until flight unit delivered*
