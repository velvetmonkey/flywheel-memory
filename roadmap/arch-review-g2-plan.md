# Arch Review G2 — Triage, Target Architecture, Sequenced Backlog

Input: `roadmap/arch-review-g1-findings.md` (findings F1–F16, @ 9cdeefe).
Per `flywheel-memory-arch-review-plan.md` §G2. Date: 2026-06-12. Branch: `arch-review-g1`.

Hard rules carried over: behaviour-preserving; MCP tool surface byte-identical at schema level; full suite green per slice; one cohesive slice at a time; no feature work.

---

## 1. Structural acceptance bar (checkable, not vibes)

Run at every slice gate and at close-out:

| Rule | Threshold | Check |
|---|---|---|
| **B1 Max file LOC** | Any file a slice creates or substantially rewrites: ≤500 LOC. Close-out: no src file >800 LOC except exemptions below | `find packages/*/src -name '*.ts' ! -name '*.test.ts' \| xargs wc -l \| awk '$1>800'` vs exemption list |
| **B2 No cycles** | Zero import cycles (type-only included) in `mcp-server/src` + `core/src` | madge/dependency-cruiser (add as devDep in S1) — `npx madge --circular --extensions ts packages/mcp-server/src packages/core/src` exits 0 |
| **B3 Layering** | `tools/` may import `core/` + top-level infra, never the reverse (no `core/ → tools/`); `core/read/` never imports `core/write/`; nothing imports `index.ts`; `vault-scope.ts`/`vault-registry.ts` import only leaf type modules | dependency-cruiser rules (committed config), CI-enforced |
| **B4 One concern per file** | Files under `tools/` export only `register*` functions, zod schemas, and types — no domain logic imported by other modules. No file both talks SQL and implements scoring/policy math | grep gate: `db.prepare\|\.prepare(` allowed only in `@velvetmonkey/vault-core` and designated `**/store/*.ts` / `*Repository.ts` modules |
| **B5 Tool surface frozen** | Registered tool catalog (names, categories, tiers, description hashes, input schemas) identical before/after each slice | catalog hash via `collectToolCatalog` (`src/tools/toolCatalog.ts:183`); snapshot committed in S0, diffed per slice |
| **B6 Suite green** | All ~3,289 cases / 217 files pass | `npm test` |
| **B7 No dead exports** | Close-out: no unexported-and-unused or exported-but-unimported symbols in refactored modules | `ts-prune` (or knip) report clean for touched modules |

**B1 exemptions** (append-only or data-shaped, splitting harms): `packages/core/src/migrations.ts` (versioned ledger), `src/generated/*`, the new wikilink-lexicon data module (S11), `packages/core/src/entities.ts` (833 — review in S11, exempt only if single-concern).

Current baseline (2026-06-12): 36 files >500 LOC, 14 files >800, 17 cycles, `db.prepare` in 10+ files outside core storage. Close-out target: 0 files >800 (minus exemptions), 0 cycles, SQL confined to repository modules.

---

## 2. Triage

| Priority | Findings | Rationale |
|---|---|---|
| **P0 — rot actively costing** | F1 (fork drift — already produced `dry_run` divergence; tests assert the dead side), F2 (write/wikilinks god file — every learning-path change pays the toll), F3 (index.ts — untested entry file with embedded SQL; blocks all boot work) | Active drift, active risk, active blockage |
| **P1 — clear wins** | F4 (feedback SQL repository), F5 (pipeline relocate/split), F6 (cycle collapse), F7 (health/query registration↔domain), F8 (embeddings split), F9 (dead code), F10 (duplicated algorithms), F11 (characterisation tests — folded into slices) | Big structure gain, bounded risk |
| **P2 — nice-to-have** | F12 (core wikilinks lexicon/data split), F13 (config instructions extract), F15 (test-helper drift), F16 (doc drift). F14 (SDK coupling): explicitly **keep** — version-audit note only, no slice | Cheap polish, low harm if deferred |

---

## 3. Sequenced slice backlog

Order chosen so that: tooling lands first (S0–S1 make the bar enforceable), deletions shrink the surface before splits, fork-merges precede the god-file split that touches the same domain, and the two big blind-spot refactors (S9, S10) come last with characterisation tests in hand. Each slice independently shippable; suite green before the next.

Conflict map: S3↔S5 touch `core/write/wikilinks.ts` consumers (sequence, don't parallelize). S6↔S8 both touch RRF (S6 consolidates into the search module; S8 then moves storage — do S6 first). Everything else is disjoint.

### S0 — Surface snapshot + bar tooling (pre-slice, no src edits)
**Target**: commit catalog snapshot (`collectToolCatalog` output incl. full input schemas) + dependency-cruiser config encoding B2/B3 + CI/test that runs both. New `test/catalog/surface-freeze.test.ts` comparing live catalog to snapshot.
**Seam**: none (additive test/tooling). **Blast**: 0 src files. **Guarding tests**: itself. **Char-first**: n/a.

### S1 — Cycle collapse via type extraction (F6) — P1, mechanical
**Target shape**: new leaf modules `src/types/vault-scope-types.ts` (the ~8 field types `vault-scope.ts:15–22` pulls upward: `CooccurrenceIndex`, `IndexState`, `InferredCategory`, `RecencyIndex`, `PipelineActivity`, `IntegrityState`, `VaultBootState`, `FlywheelConfig` re-export or move) and `src/types/vault-context.ts` (`VaultContext` out of `vault-registry.ts`, killing the `vault-registry.ts:16` ⇄ `pipeline.ts:29` cycle). `tool-registry.ts` ⇄ `discovery.ts`: move `ToolTierController` type to `tool-registry/types.ts` (already exists). `core/src/sqlite.ts` ⇄ `queries.ts`: extract shared type/connection handle.
**Seam**: type-only moves + re-exports from old locations (keep import sites stable where possible; where moved, mechanical sed).
**Blast radius**: ~25 files' import lines; zero runtime change (all `import type`).
**Guarding tests**: full suite (compile = the real check); B2 goes 17 → 0 and becomes CI-enforced here.
**Char-first**: no.

### S2 — Dead-code purge wave 1 (F9a) — P1
**Target**: delete the 15 zero-importer files (G1 §6.1: `core/read/{calibrationExport,entityHistory,learningReport}.ts`, `tools/read/{calibrationExport,entityHistory,learningReport,merges,metrics,sessionHistory,temporalAnalysis}.ts`, `tools/write/{corrections,tags,toolSelectionFeedback,wikilinkFeedback}.ts`, `tools/read/recall.ts.disabled`) + broken `test/helpers/createTestServer.ts` + `test/write/_archive/` + dead imports (`query.ts:33,53`; `health.ts:23,26–29`) + dead symbols (`enrichNoteCompact` enrichment.ts:510; retired names in `retrievalCooccurrence.ts:33`; no-op `registerBriefTools` brief.ts:312; dead branch `core/src/wikilinks.ts:1720–1730`).
**Seam**: deletion only — every target has zero src AND zero test importers (verified G1).
**Blast**: −~4,500 LOC, 0 behaviour. **Guarding**: full suite + B5 catalog diff (must be empty — none of these register in prod).
**Char-first**: no. **Caution**: do NOT touch `embedding-worker.ts`/`integrity-worker.ts` (Worker-spawned, G1 §6.1) or `toolCatalog.ts`/`generated/*`.

### S3 — Fork reunification: edit_section (F1a) — P0
**Target shape**: `tools/write/editSection.ts` becomes thin registration; the add/remove/replace pipeline lives once in `core/write/sections.ts` (extracted from whichever fork is canonical — diff `editSection.ts:420–726` vs `mutations.ts:238–459` first; reconcile any drift explicitly in the commit message). `mutations.ts` deleted.
**Seam**: the handlers' shared `runValidationPipeline → insert/remove/replaceInSection` flow; `createNoteFromTemplate` (mutations.ts:42) moves to core/write.
**Blast**: 2 tool files, 1 new core file; tests: `test/write/tools/mutations.test.ts` (ports to edit_section surface), `test/write/core/http-transport.test.ts:14` (re-point at editSection registration).
**Guarding tests**: ported mutations.test + trace tests (`test/write/traces/no-refresh/section-content.trace.test.ts`).
**Char-first: YES** — `editSection.ts` (768 LOC) has no direct tests (G1 §8). Port `mutations.test.ts` assertions to the `edit_section` tool surface FIRST, confirm green against current code, then refactor under them.

### S4 — Fork reunification: note create/delete (F1b) — P0
**Target shape**: single create/delete pipeline in `core/write/noteLifecycle.ts`; `tools/write/note.ts` thin; `tools/write/notes.ts` deleted; dead regs in `move-notes.ts:516–542` stripped (move/rename helpers stay, renamed `core/write/noteMove.ts` or kept as helper).
**Seam**: the duplicated sequence `sanitizeNotePath → ensureFileExists → checkPreflightSimilarity → detectAliasCollisions → maybeApplyWikilinks → suggestRelatedLinks → injectMutationMetadata → suggestAliases → handleGitCommit` (`note.ts:188–356` vs `notes.ts:61–220`). **Diff the forks line-by-line first**; any divergence = decide which is canonical, record it.
**Blast**: 3 tool files, 1–2 new core files; tests: `test/write/tools/notes.test.ts` ports to `note` surface; http-transport.test re-points.
**Guarding**: ported notes tests + write traces + security suite (`test/write/security/tool-integration.test.ts` imports move-notes — update import only).
**Char-first: YES** (same reason — `note.ts` itself only integration-covered).

### S5 — Fork reunification: entity merge/absorb (F1c) — P0
**Target shape**: single merge implementation in `core/write/entityMerge.ts`; `entity.ts:402–520` and `merge.ts:42–200` both replaced by calls to it; `merge.ts` deleted.
**Seam**: validate → read both → alias dedup → "## Merged from" append → backlink rewire → write+unlink+initializeEntityIndex.
**Behaviour trap (explicit)**: `merge.ts` supports `dry_run` (:40,131–178); live `entity(action: merge)` does not (schema documents dry_run as `[alias]`-only, `entity.ts:54`). The unified core fn takes a `dryRun` param; the **registered schema stays unchanged** — dry_run remains alias-only. Re-exposing it for merge is a G2-backlog feature note, NOT this slice.
**Blast**: 2 tool files, 1 new core file; `test/write/tools/merge-entities.trace` + http-transport re-point.
**Guarding**: ported merge tests against `entity` surface. **Char-first: YES** (port first, green on current code).

> S3–S5 close finding F9b: each deletes its zombie file + dead registrations and re-points `test/write/core/http-transport.test.ts` / `test/read/helpers/createTestServer.ts` rows for that area. After S5, http-transport.test should build from `registerAllTools` (production path) — eliminating the parallel test-server assembly for write tools.

### S6 — Search stack: characterise, then extract from query.ts (F7b, F10 partial) — P1
**Part A (char tests)**: golden tests for `search` via tool surface: fixed fixture vault → assert result ordering, snippet/section expansion, sandwich ordering, hybrid vs non-hybrid paths, memory-channel scoring. Direct unit tests for `core/read/{enrichment,similarity,multihop,mmr,snippets}` (currently integration-only, G1 §8).
**Part B (extract)**: new `core/read/search/` package-dir: `ranking.ts` (graph rerank `query.ts:114–154`, sandwich `:167–183`, memory scoring `:253–291`), `merge.ts` (single RRF — absorbs `query.ts:665–701` and delegates to/replaces `similarity.ts:240–261`; `embeddings.ts:602` RRF callers re-pointed in S8), `assemble.ts` (snippets/sections `:354–413`, the 3× post-processing block deduped to one fn), `bridging.ts` (`:190–235`). `query.ts` shrinks to schema + orchestration (<300 LOC). Date-window + tail dup with find_notes (`query.ts:545–571` vs `find_notes.ts:73–92`) moves to `tools/read/filters.ts` (already the shared home).
**Seam**: the handler's pipeline stages are already function-shaped; cut at existing function boundaries.
**Blast**: query.ts, find_notes.ts, similarity.ts + new dir; importers of `applySandwichOrdering` re-pointed.
**Guarding**: Part A goldens + existing `test/read/tools/query.test`, retrieval-bench suite (3 files — ranking regression canary).
**Char-first: YES (Part A is the point).**

### S7 — doctor logic out of health.ts (F7a) — P1
**Target shape**: `core/read/health/` — `score.ts` (formula `health.ts:530–576`), `diagnosis.ts` (10-check engine `:996–1184`), `stats.ts` (`:836–939`), `freshness.ts` (`:352–401`); config get/set moves beside `core/read/config.ts` (it persists config — write-ish; name it `configStore.ts`). `VALID_CONFIG_KEYS` moves to core (currently imported from retired `tools/write/config.ts` — `health.ts:14`; then delete `tools/write/config.ts` + its dead reg, update `test/write/docs/tool-counts.test.ts:13`, `test/write/tools/config.test.ts:7` imports). health.ts → schema + dispatch (<300 LOC). Dedupe the verbatim SQL pair (`:649–651`/`:1142–1144`) into one repository fn.
**Seam**: doctor's action dispatch — each action's body is already a block.
**Blast**: health.ts + 1 retired file + new core dir; tests: `test/read/tools/health.test` (direct, strong) + config tests.
**Guarding**: health.test + tool-counts.test. **Char-first**: no (direct coverage exists). 

### S8 — embeddings.ts split (F8) — P1
**Target shape**: `core/read/embeddings/` — `provider.ts` (model registry/lifecycle :82–241), `noteStore.ts` (:354–483 + loaders), `entityStore.ts` (:941–1042 + classifier :1166–1319), `search.ts` (cosine/semantic/RRF :494–617), `state.ts` (build-state machine/invalidation :165–200, :649–692, orphan cleanup :1058–1126), `diagnosis.ts` (:698–855, feeds doctor). SQL confined to the two stores + state. Make `hasEmbeddingsIndex` read-only; its self-repair side-effect (:649–677) moves to an explicit `repairBuildState()` called from the existing call sites that need it (verify each call site's expectation first — this is the slice's one behaviour trap).
**Seam**: the six concerns barely share state (G1: RRF + classifier have zero coupling).
**Blast**: 20 importers re-pointed (fan-in 20 — mechanical, old module becomes re-export barrel for one release of the slice, then importers migrate within the same slice).
**Guarding**: `embeddingsState`, `embeddingsOrphanGuard`, `read/tools/embeddings` tests (direct, G1 §8) + semantic search goldens from S6.
**Char-first**: only for `hasEmbeddingsIndex` callers — add a test pinning current repair-on-read behaviour before relocating it.

### S9 — pipeline relocate + split (F5) — P1
**Target shape**: move `core/read/watch/pipeline.ts` → `core/pipeline/` (it is read+write orchestration, not read): `scheduler.ts` (DeferredStepScheduler :78–203), `activity.ts` (:205–240), `steps/` (one file per step cluster: indexing, embeddings, wikilinks, feedback, prospects, maintenance), `runner.ts` (run() :394–503). Introduce `PipelineRuntimeState` narrow interface for the per-vault fields it mutates (pipeline.ts:336, 614, 678, 712–735, 850) — `VaultContext` implements it; pipeline stops importing vault-registry types directly.
**Behaviour trap (explicit)**: step-count constants are desynced (docblock 19, `PIPELINE_TOTAL_STEPS = 22` :208, actual 25–26). `doctor(action: pipeline)` may surface step counts/activity — **verify what doctor emits before touching the constant**; if observable, fixing the number is a behaviour change → leave constant as-is this slice, file as a one-line bugfix decision for Ben.
**Blast**: pipeline.ts + maintenance.ts + importers (index.ts wiring :1418–1689, vault-registry types); `core/read/watch/` keeps watcher/event-queue (genuinely read-side).
**Guarding**: `test/read/watch/pipeline.test` + `pipeline-prospects.test` (direct, strong) + write traces.
**Char-first**: partial — add a test pinning `doctor(action: pipeline)` output shape first.

### S10 — index.ts dismantle (F3) — P0, LAST of the big slices
**Part A (char tests FIRST — biggest blind spot in repo)**: (1) HTTP transport test that boots via real `createConfiguredServer`/express path (current http-transport.test bypasses index.ts); (2) watcher batch-handling test covering `handleBatch` (:1444–1627): symlink/WSL normalization, mute filter, sha256 gate, rename bookkeeping SQL; (3) integrity state-machine test (:380–506); (4) startup-order smoke extending `package-startup.test.ts` (stdio + http + multi-vault boot).
**Part B (split)**: `src/boot/` — `state.ts` (singletons :176–228), `serverFactory.ts` (:235–334 incl. HTTP pool), `vaultBoot.ts` (:513–833), `integrity.ts` (→ merge into `core/read/integrity.ts` :380–506), `postIndex.ts` (runPostIndexWork :1198–1719, watcher glue extracted to `core/pipeline/watchGlue.ts`, rename-SQL to a repository), `transport.ts` (:899–1007 + watchdog :1027–1076), `cli.ts` (`--init-semantic` :1725–1761), `shutdown.ts` (:1770–1796). index.ts becomes <150-LOC composition root. Kill the import-time side effect (:340–363) by moving server construction into `main()` — **verify stdio handshake timing is unaffected** (instructions generation currently runs with `vaultRegistry=null`; preserve exact instructions output, see S12/F13 trap).
**Blast**: widest — index.ts + new boot/ dir + everything that reads its exports (check: nothing should import index.ts; B3 enforces after).
**Guarding**: Part A suite + full suite + B5 catalog diff.
**Char-first: YES — mandatory, Part A is its own commit.**

### S11 — Remaining duplication + core wikilinks data split (F10 rest, F12) — P1/P2
- 4× overlap-filter copies → one exported predicate in `packages/core/src/wikilinks` engine (core:532–537, core:1593–1604, core:1689–1704, write:711–724).
- `processWikilinks` diverged copy: make `src/core/write/wikilinks.ts:576–758` call core's engine pieces rather than re-orchestrating where genuinely identical; keep write-only steps (suppression/corrections/markers/sanitize) in write.
- Lexicon extraction (F12): `packages/core/src/wikilinkLexicon.ts` (data-only, B1-exempt) out of `wikilinks.ts:49–1374`; `suggestWikilinks` (:707–828) re-uses `applyWikilinks`' candidate loop.
- similarity.ts internal dup (:117–135 vs :153–172) → use own helper.
- **Stemmer merge (F10): DEFERRED — flagged for council.** The two Porter implementations (`packages/core/src/stemmer.ts` 207 LOC vs `src/core/shared/stemmer.ts` 390 LOC) are *different algorithms in detail*; unifying changes stem outputs → changes link matching + scoring = behaviour change tests won't catch. Only safe path: corpus golden test (stem outputs over a representative vault) proving identical outputs, or accept as behaviour fix with Ben's sign-off. Not in this review unless council finds a safe seam.
**Guarding**: core wikilinks.test, write wikilinks.test (38 imports), graph-quality suite (33 files — link-quality regression canary).

### S12 — P2 batch: config split, test-helper retarget, docs (F13, F15, F16)
- `config.ts`: tables stay; `generateInstructions` (:408–655) → `src/instructions.ts` with `hasEmbeddingsIndex` injected as predicate. **Trap**: instructions text is part of the MCP initialize payload — byte-identical output required (snapshot test first).
- `test/read/helpers/createTestServer.ts`: stop registering 6 retired surfaces; build from `registerAllTools` (zombie tools die here — after S3–S5 already retargeted the write side).
- Doc fixes: CLAUDE.md (core/semantic/ ghost, 21→20 tools, missing `read:raw`/`memory:supersede` actions), plan-note test counts.
**Guarding**: full suite; instructions snapshot.

### Close-out (Gn+1)
Re-run B1–B7; before/after god-file table + cycle count; `arch-review-closeout.md`.

---

## 4. Risk register (council: attack these)

| # | Risk | Slice | Mitigation in plan |
|---|---|---|---|
| R1 | Fork reconciliation picks the wrong canonical side (note/notes, entity/merge, editSection/mutations may have *intentional* post-fork fixes on the live side) | S3–S5 | line-by-line fork diff is step 1 of each slice; divergences recorded in commit message; live side wins by default |
| R2 | `dry_run` regression gets "fixed" silently (= behaviour change) | S5 | schema frozen; core fn takes param; surface unchanged |
| R3 | `PIPELINE_TOTAL_STEPS` fix leaks into doctor output | S9 | pin doctor(pipeline) output first; constant untouched this review unless proven non-observable |
| R4 | `hasEmbeddingsIndex` repair-on-read relocation changes first-call behaviour after crash | S8 | pin current behaviour with test; relocate call-site-by-call-site |
| R5 | Killing index.ts import-time server construction changes stdio startup timing/instructions content | S10 | instructions snapshot test + startup smoke first |
| R6 | Stemmer unification changes link/scoring behaviour invisibly | S11 | DEFERRED; corpus golden required |
| R7 | Zombie-test deletion loses real characterisation value | S2–S5 | tests ported to merged-tool surface before file deletion; S2 deletes only zero-test-importer files |
| R8 | Re-export barrels left behind after splits (B7 violation, fake "done") | S6–S10 | barrels allowed only intra-slice; removed before slice commit; ts-prune in gate |
| R9 | Catalog hash too weak to catch schema drift (hash covers name/category/tier/description — verify it includes input schema) | S0 | S0 must extend snapshot to full JSON schema per tool if `descriptionHash` doesn't cover it |
| R10 | dependency-cruiser rules too strict → mass exemptions that rot | S1 | start with B2+B3 only; B4 grep-gate separate |

---

## 5. Sequencing summary

```
S0 tooling → S1 cycles → S2 dead code → S3 edit_section → S4 note → S5 entity-merge
→ S6 search stack → S7 doctor → S8 embeddings → S9 pipeline → S10 index.ts → S11 dup/lexicon → S12 P2 batch
```

Char-tests-first slices: **S3, S4, S5, S6(A), S10(A)** (+ pinning tests in S8, S9).
Independent/parallelizable if ever needed: S7 vs S6; S2 vs S1. Everything wikilink-adjacent (S3–S5, S11) stays serial.

## 6. Execution checklist (update per G3 slice)

- [ ] S0 surface snapshot + bar tooling
- [ ] S1 cycle collapse (17 → 0)
- [ ] S2 dead-code purge wave 1
- [ ] S3 edit_section reunification
- [ ] S4 note reunification
- [ ] S5 entity-merge reunification
- [ ] S6 search stack extract (A: goldens, B: extract)
- [ ] S7 doctor logic to core
- [ ] S8 embeddings split
- [ ] S9 pipeline relocate/split
- [ ] S10 index.ts dismantle (A: char tests, B: split)
- [ ] S11 duplication + lexicon
- [ ] S12 P2 batch
- [ ] Close-out report

---

## 7. Council review

_To be appended after adversarial council (codex / gemini / claude / grok) per plan §G2 gate. No G3 execution before this section is filled and cut-lines re-confirmed._
