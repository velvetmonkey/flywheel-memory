# Arch Review — Close-Out (Gn+1)

Per `flywheel-memory-arch-review-plan.md` §Gn+1. Date: 2026-06-12.
Branch `arch-review-g1`, 19 commits over main @ `9d660c1` (G1 recon `9cdeefe` → S13 `9d6b5bc` + this doc). Unpushed.
Validates hypothesis ckpt-2a4d453cac7b876d — **largely confirmed, with named residuals** (§4).

## 1. Acceptance bar (B1–B7) at close-out

| Bar | Target | Result |
|---|---|---|
| B1 LOC | No src file >800 except exemptions | **5 files >800** (was 14). Exempt: `core/src/migrations.ts` 1,252 (versioned ledger, declared), `core/write/policy/executor.ts` 908 (single-concern engine, G1 disposition *keep*, direct tests). **NOT exempt — residual F2/F4**: `core/write/wikilinks.ts` 2,213, `core/write/wikilinkFeedback.ts` 1,847, `core/src/wikilinks.ts` 1,185 (see §4.1). Files >500: 36 → 24 |
| B2 Cycles | 0 (type-only included) | **0** (was 17). CI-enforced by `test/arch/dependency-rules.test.ts` |
| B3 Layering | tools→core only; read↛write; nothing imports index.ts | **22 baseline edges remain, accounted**: 20 are `tool-registry.ts → tools/*` — the registration composition point importing the files it registers, definitional, allowlisted-by-design. 2 real residuals: `core/read/taskCache.ts → tools/read/tasks.ts`, `resources/vault.ts → tools/read/frontmatter.ts` (stranded-helper inversions, §4.3). All 7 read→write pipeline edges and both tools-as-library edges from search/health are gone |
| B4 SQL | Confined to enumerated allowlist | **48 files**, all enumerated in the committed baseline: vault-core + repository-shaped modules (healthQueries, memoryMaintenance, embeddings stores, pipeline steps, watchGlue, bridging) + the F2/F4 residual god files |
| B5 Surface | Byte-identical registered schemas | **PASS — headline result.** `git diff 34ecc4c..HEAD -- test/catalog/__fixtures__` is empty: full input JSON schemas of all 20 tools AND both MCP initialize payloads (single/multi-vault) byte-identical across all 14 slices |
| B6 Suite | Full suite green | **PASS**: core 296 + bench 33 + mcp-server 3,138 pass / 1 expected fail (D4 defect pin) / 18 skip. Sole failing file: pre-existing hotpotqa benchmark (external 85MB download; network-blocked sandbox; identical to pre-review baseline). Test count grew 3,041 → 3,138 + the expected-fail pin (~120 new oracle/characterisation tests) |
| B7 Dead exports | No transition barrels; touched modules clean | The S8 embeddings facade is a deliberate permanent public surface (explicit named exports, house `writer.ts` pattern — documented deviation). No other re-export barrels introduced; all other slice moves re-pointed importers directly. ts-prune not run (no devDep added); manual review of new modules found no orphan exports |

## 2. God-class list — before / after

| G1 offender | Was | Now |
|---|---|---|
| `core/write/wikilinks.ts` | 2,233 | **2,213 — residual F2** (cycle broken S1; 4× overlap-filter + term-building dedup S11) |
| `core/write/wikilinkFeedback.ts` | 1,847 | **1,847 — residual F4** (repository extraction never scheduled, §4.1) |
| `packages/core/src/wikilinks.ts` | 1,806 | 1,185 engine + 649 lexicon data (`wikilinkLexicon.ts`, exempt) |
| `src/index.ts` | 1,796 | **121** composition root + `boot/` ×9 (all ≤452) |
| `core/read/watch/pipeline.ts` | 1,563 | deleted → `core/write/pipeline/` ×10 (all ≤452) |
| `core/read/embeddings.ts` | 1,401 | **77** facade + `embeddings/` ×6 (all ≤450) |
| `tools/read/health.ts` | 1,280 | **176** dispatch + `core/diagnostics/` ×6 (all ≤469) |
| `core/src/migrations.ts` | 1,252 | 1,252 (exempt ledger) |
| `core/write/policy/executor.ts` | 908 | 908 (keep, audited) |
| `tools/read/query.ts` | 855 | **343** orchestration + `core/search/` ×5 (all ≤198) |
| `tools/read/wikilinks.ts` | 843 (zombie) | deleted |
| `packages/core/src/entities.ts` | 833 | 619 + category-tables.ts 224 (data) |
| `tools/read/temporalAnalysis.ts` | 822 (dead) | deleted |
| `core/write/memory.ts` | 802 | 720 + memoryMaintenance.ts 94 |

## 3. Dependency graph — before / after

- **Cycles 17 → 0** (vault-scope hub dissolved via leaf type modules; wikilinks⇄feedback via `wikilinkText.ts`; registry/pipeline/discovery/sqlite pairs all broken).
- **Layering**: read→write edges 7 → 0 (pipeline relocated); tools-as-library imports from core: gone on the read side (structure/periodic/temporal/graphAdvanced all moved into core); 2 named residuals (§4.3).
- **Fork pairs → single implementations**: edit_section/mutations, note/notes+move-notes, entity-merge/merge — one implementation each in core/write, with the live contract pinned (~46 characterisation tests) before each merge.
- **Dead code**: ~7,800 LOC of unreachable/zombie source deleted across S2/S12 (15 dead files, 8 zombies, ~25 dead registrations, recall.ts.disabled). Total src LOC 68,423 → 57,341 (−16%) while adding ~120 tests.
- **New structure**: `core/search/` (ranking pipeline), `core/diagnostics/` (doctor stack), `core/write/pipeline/` (watcher pipeline + glue), `core/read/embeddings/` (six-module store), `src/boot/` (boot phases), leaf type modules (`vault-types.ts`, extended `*/types.ts`).

## 4. Residuals — open items by disposition

### 4.1 F2/F4: the wikilink learning core — **CLOSED by G5 (2026-06-13)**
F2: wikilinks.ts 2,213 → 61-line facade over wikilinkState (440) / wikilinkPipeline (378) / wikilinkScoringConfig (319) / wikilinkSuggest (798, boost block deduped via computeLayerBoosts with per-branch FP-order preservation) / noteCreationChecks (286) / proactiveWriter (134). F4: wikilinkFeedback.ts 1,847 → 874 domain core + wikilinkFeedbackStore.ts (868 — all 53+2 SQL sites, 51 typed functions, 8 tables) + wikilinkFeedbackReports.ts (761, deps-injected). Export surfaces verified identical via TS compiler API. The two last layering inversions (taskCache→tasks, resources→frontmatter) also closed: helpers moved to core/read. B1 exemptions recorded: wikilinkFeedbackStore.ts (homogeneous SQL catalog — exactly what B4 designates), wikilinkFeedback.ts 874 (single-concern Bayesian core, same rationale as executor.ts). Layering baseline 22 → 20; SQL files 48 → 47; cycles 0. Original text follows for the record.

#### (original residual text)
`core/write/wikilinks.ts` (2,213) and `core/write/wikilinkFeedback.ts` (1,847) were P0/P1 in G1 (F2: 10-responsibility god file with a 640-line scoring fn; F4: 53 inline SQL sites interleaved with the Bayesian model). **Neither the council-amended G3 scope (S0–S5) nor the G4 re-gate list (S6–S13) ever scheduled their splits** — the slice lists named search/health/embeddings/pipeline/index.ts. What DID land: their import cycle broken (S1), four duplicated predicates and the term-building loop unified (S11), scoring layers mapped (G1). The close-out criterion "no remaining P0" is therefore **not fully met**: F1/F3 are closed; F2/F4 stand. Proposed: one further gate ("G5: wikilink core split — F2 five-way split + F4 repository extraction"), guarded by the strong existing suites (write wikilinks 38-import test file, feedback suite, 362-test graph-quality canary).

### 4.2 Open decisions D1–D4 (Ben, unchanged — none folded in)
D1 PIPELINE_TOTAL_STEPS 19/22/25 desync (doctor-observable; constant frozen at 22). D2 dry_run for entity merge (pinned destructive). D3 stemmer unification (two Porter implementations; needs corpus golden or sign-off). **D4 stdio multi-vault routing dead** (import-time null-registry gating; writes route to primary; HTTP unaffected; pinned with defect-pin + `it.fails` tests — the S10 boot split deliberately preserved the buggy timing byte-for-byte).

### 4.3 Smaller residuals
- `core/read/taskCache.ts → tools/read/tasks.ts` and `resources/vault.ts → tools/read/frontmatter.ts`: last two real layering inversions (move the helpers into core, ~1h, fold into G5).
- `hasEmbeddingsIndex` remains a query with a self-repair write (kept verbatim in S8; purification = council R4, needs per-call-site pinning first).
- S8 embeddings facade + S6 `applySandwichOrdering` re-export from query.ts: deliberate compatibility surfaces, documented.
- `PipelineRuntimeState` narrowing (pipeline still types against full VaultContext) — cosmetic after S1's type-leaf extraction.
- tool-registry 4-deep wrapper chain: kept by decision; order invariant now documented in-code.
- B3's "tool-registry → tools/*" baseline entries: encode as an explicit dep-cruiser allowlist rule if/when dependency-cruiser is adopted in CI.

## 5. Verdict

The server is structurally clean by the bar everywhere except the wikilink learning core, which was analysed, de-cycled, and de-duplicated but never scheduled for its split. Tool surface provably byte-identical end-to-end; suite green and ~120 tests stronger; every dead line is gone; the dependency graph is acyclic and layered. Hypothesis ckpt-2a4d453cac7b876d: **validated for the executed scope; F2/F4 carried as the explicit remainder.**
