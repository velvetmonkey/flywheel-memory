# Testing

Your vault is your second brain. You don't hand it to software you can't trust.

**2,001 tests | 91 test files | 37,000+ lines of test code**

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

## Graph Quality (162 tests, 14 files)

The graph quality suite validates that the wikilink suggestion engine works correctly across every scenario that matters: precision/recall, scoring layers, archetypes, feedback loops, temporal evolution, and regression gates.

**Pillars 1-6 (Phase 1-2):**

- **Precision/Recall** -- per-mode, per-tier, per-category metrics against a 96-note/61-entity/60-link ground truth vault (18 tests)
- **Scoring Layers** -- 12-layer ablation proving each layer's contribution to F1 (13 tests)
- **Graph Health** -- topology metrics: link density, orphan rate, connectedness, clustering coefficient (11 tests)
- **Archetypes** -- 6 structural topologies: hub-and-spoke, hierarchical, dense-mesh, sparse-orphan, bridge-network, small-world (32 tests)
- **Chaos** -- adversarial vault conditions: typos, abbreviations, ambiguous entities (7 tests)
- **Observability** -- pipeline tracing, algorithm attribution, suggestion events with ScoreBreakdown (33 tests)

**Full Spectrum (Phase 3):**

- **Regression Gate** -- locks F1/precision/recall/MRR per mode into `baselines.json`; CI fails if any metric regresses >5% (5 tests)
- **Feedback Integration** -- positive boosts, negative suppression, entity journey stages, Champion tier validation (7 tests)
- **Strictness Differentiation** -- proves 3 modes produce different outputs with expected ordering (7 tests)
- **Temporal Evolution** -- 5-cycle vault growth simulation proving F1 is non-decreasing (5 tests)
- **Golden Set** -- 20 hand-curated "obvious" links with 100% recall target (4 tests)
- **Parameter Sweep** -- maxSuggestions sweep (1-10), curve smoothness, mode comparison (5 tests)

Measured baselines: conservative F1=82.7%, balanced F1=76.9%, precision=90.9%, recall=66.7%.

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
