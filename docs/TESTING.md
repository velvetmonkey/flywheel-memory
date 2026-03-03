# Testing

Your vault is your second brain. You don't hand it to software you can't trust.

**2,198 tests | 121 test files | 47,000+ lines of test code**

---

## Test Philosophy

Three principles guide every test in this project:

1. **Prove it at scale.** Not with 5 notes in a toy vault -- with 100,000-line files and 2,500-entity indexes. If it works at scale, it works everywhere.

2. **Break it before users do.** The test suite is adversarial by design: property-based fuzzing with randomized inputs, injection attacks against every input surface, race conditions under concurrent load.

3. **Document with tests.** README examples are test fixtures. Tool counts are verified in CI. If the documentation says it works, a test proves it.

---

## Performance Benchmarks

Measured thresholds are generous to absorb CI variability. Local runs are typically faster.

| Operation | Threshold | Typical |
|---|---|---|
| 1,000-line file mutation | <100ms | ~15ms |
| 10,000-line file mutation | <500ms | -- |
| 100,000-line file mutation | <2s | -- |
| 100 consecutive mutations | <5x degradation | ~1.2x |
| Heading extraction (1,000 lines) | <10ms | -- |
| Entity scoring (1,000 entities) | <50ms | -- |
| Entity scoring (5,000 entities) | <200ms | -- |
| Wikilink suggestion (1,000 chars) | <25ms | ~2ms |

Memory: verified that a 2,500-entity index initializes and scores correctly without excessive allocation.

Source: [`packages/mcp-server/test/write/performance/benchmarks.test.ts`](../packages/mcp-server/test/write/performance/benchmarks.test.ts)

---

## Concurrency & Stress

The concurrency suite verifies that parallel and sequential operations never corrupt vault state.

- **100 parallel mutations** to different files -- zero corruption, all entries verified.
- **100 sequential mutations** to the same file -- all entries preserved, ordering maintained.
- **Sustained load:** 4 batches of 25 mutations, performance ratio stays below 10x first-batch time.
- **Mixed operations:** 5 rounds of parallel mutations across 20 files interleaved with sequential writes to a single file.
- **Frontmatter integrity:** complex YAML (nested objects, arrays, tags) survives 10 consecutive mutations unchanged.
- **Unicode/emoji preservation:** special characters (Japanese, Greek, emoji) round-trip through write cycles without loss.

Source: [`packages/mcp-server/test/write/stress/concurrency.test.ts`](../packages/mcp-server/test/write/stress/concurrency.test.ts)

---

## Battle-Hardening (Fuzzing)

Property-based testing using [fast-check](https://github.com/dubzzz/fast-check). Each property runs 50 randomized iterations by default (configurable).

Properties tested:

- **Mutation safety** -- `vault_add_to_section` never corrupts file structure, regardless of generated input.
- **Section heading preservation** -- all original headings survive any mutation.
- **Frontmatter round-trip** -- YAML keys and values survive read-write cycles.
- **Unicode/emoji preservation** -- CJK, mathematical symbols, arrows, and emoji persist through mutations.
- **Large content non-truncation** -- files with 100-500 lines are never silently truncated.
- **Idempotency** -- applying the same mutation to two identical files produces identical results.
- **Ordering** -- prepend inserts before existing content, append inserts after. Order is deterministic.
- **Markdown special characters** -- headings, bold, italic, code, links, blockquotes, tables, and horizontal rules inside content do not corrupt document structure.
- **Nested list preservation** -- 10-level deep indented lists survive mutation and round-trip intact.

Source: [`packages/mcp-server/test/write/battle-hardening/fuzzing.test.ts`](../packages/mcp-server/test/write/battle-hardening/fuzzing.test.ts)

---

## Security Testing

Six dedicated security test files cover the attack surface:

- **`injection.test.ts`** -- YAML injection in frontmatter fields, shell command injection via crafted git commit messages, template injection in policy YAML definitions.
- **`path-encoding.test.ts`** -- URL-encoded path traversal (`%2e%2e%2f`), double encoding, null byte injection, Windows backslash sequences, Unicode normalization attacks.
- **`permission-bypass.test.ts`** -- attempts to bypass permission boundaries (e.g., writing outside vault root).
- **`boundaries.test.ts`** -- Unicode normalization collisions, case sensitivity collisions (macOS HFS+), extreme content sizes (memory exhaustion resistance), deep heading nesting (stack exhaustion resistance).
- **`platform.test.ts`** -- cross-platform path handling and behavioral differences.
- **`sensitive-files.test.ts`** -- prevention of access to sensitive files (`.env`, credentials, private keys).

Source: [`packages/mcp-server/test/write/security/`](../packages/mcp-server/test/write/security/)

---

## Cold Start & Edge Cases

Tests for first-run and degraded environments:

- **Empty vault:** first note creation succeeds, entity index initializes from nothing.
- **Missing directories:** auto-creation when writing to nested paths that don't exist yet.
- **Non-git vault:** mutations succeed normally; git operations (commit, undo) fail gracefully with clear errors.
- **Read-only vault:** appropriate error handling when the filesystem denies writes.

Source: [`packages/mcp-server/test/write/coldstart/`](../packages/mcp-server/test/write/coldstart/)

---

## Graph Quality (266 tests, 31 files)

The graph quality suite validates that the wikilink suggestion engine works correctly across every scenario that matters: precision/recall, scoring layers, archetypes, feedback loops, temporal evolution, and regression gates.

**Precision & Scoring:** precision/recall, 13-layer ablation, parameter sweep (+ deep), golden set, strictness differentiation, baselines

**Stability & Evolution:** multi-generation (50 gen), temporal evolution, vault lifecycle, learning curve, flywheel pipeline

**Topology & Resilience:** 7 archetypes, topology resilience, health metrics, health snapshot

**Feedback & Recovery:** regression gate, feedback integration, sparse feedback, agent feedback, cross-vault learning, recovery

**Robustness:** chaos, chaos mutations, alias collision, property-based invariants (7 properties × 100 runs)

**Observability:** pipeline tracing, observability APIs, score breakdowns

### Baselines

Locked in `baselines.json` (2026-02-26). CI fails if any metric regresses >5pp.

| Mode | Precision | Recall | F1 | MRR |
|---|---|---|---|---|
| Conservative | 100% | 71.7% | 83.5% | 0.720 |
| Balanced | 100% | 80.0% | 88.9% | 0.697 |
| Aggressive | 100% | 81.7% | 89.9% | 0.697 |

Measured against a 96-note/61-entity ground truth vault. Links stripped, engine must rediscover them.

### Multi-Generation Stress Test

50 generations of suggest → feedback (85/15 noise) → mutate vault → rebuild index. Proves the Beta-Binomial suppression model prevents F1 death spiral under sustained noisy feedback.

**6 CI assertions:**
1. F1 stays within 20pp of baseline across all generations
2. No single generation drops F1 by more than 15pp
3. Trend slope ≥ -0.002 after generation 10
4. At least 3 entity categories maintain F1 > 0
5. Vault note count grows (mutations accumulate)
6. Suppression rate stays below 50%

Source: [`packages/mcp-server/test/graph-quality/multi-generation.test.ts`](../packages/mcp-server/test/graph-quality/multi-generation.test.ts)

For full per-category, per-tier, per-archetype breakdown, see [QUALITY_REPORT.md](QUALITY_REPORT.md).

Sources: [`packages/mcp-server/test/graph-quality/`](../packages/mcp-server/test/graph-quality/)

To regenerate baselines: `npx tsx packages/mcp-server/test/graph-quality/generate-baselines.ts`

---

## Running the Tests

```bash
git clone https://github.com/velvetmonkey/flywheel-memory.git
cd flywheel-memory
npm install
npm test
```
