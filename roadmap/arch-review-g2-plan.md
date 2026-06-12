# Arch Review G2 — Triage, Target Architecture, Sequenced Backlog

Input: `roadmap/arch-review-g1-findings.md` (findings F1–F16, @ 9cdeefe).
Per `flywheel-memory-arch-review-plan.md` §G2. Date: 2026-06-12. Branch: `arch-review-g1`.
**Rev 2 — council-amended** (see §7; amendments marked ⚠️COUNCIL).

Hard rules carried over: behaviour-preserving; MCP tool surface byte-identical at schema level; full suite green per slice; one cohesive slice at a time; no feature work.

**Canonical-side rule (⚠️COUNCIL, applies to all fork merges S3–S5): the LIVE registered tool is the behavioural contract — response payloads, error strings, error codes, catch/no-catch shapes included.** Retired-fork tests are NOT ported verbatim; their *scenarios* are re-expressed against the live surface with expectations rewritten to live behaviour. Known live↔retired divergences are enumerated per slice below; finding a new one during a slice = record it in the commit message, keep live behaviour.

---

## 1. Structural acceptance bar (checkable, not vibes)

Run at every slice gate and at close-out:

| Rule | Threshold | Check |
|---|---|---|
| **B1 Max file LOC** | Files a slice creates/substantially rewrites: ≤500 LOC **and the split must follow a responsibility boundary named in G1 §3 (or enumerated in the slice) — a file name must name one concern; no `misc.ts`/`utils2.ts`/arbitrary line-count cuts** (⚠️COUNCIL). Close-out: no src file >800 LOC except exemptions | `find packages/*/src -name '*.ts' ! -name '*.test.ts' \| xargs wc -l \| awk '$1>800'` vs exemption list + reviewer check of file names vs contents |
| **B2 No cycles** | Zero import cycles (type-only included) in `mcp-server/src` + `core/src` | madge/dependency-cruiser (devDep added in S0) — exits 0 |
| **B3 Layering** | `tools/` may import `core/` + top-level infra, never the reverse; `core/read/` never imports `core/write/` (write may import read); nothing imports `index.ts`; `vault-scope.ts`/`vault-registry.ts` import only leaf type modules; **`tools/` files export only `register*` fns, zod schemas, types** (⚠️COUNCIL — promoted from B4 so dep-cruiser can enforce: no src module outside `tools/` may import from `tools/`) | dependency-cruiser rules (committed config), CI-enforced |
| **B4 SQL confinement** | `db.prepare`/raw SQL only in `@velvetmonkey/vault-core` and repository modules **enumerated by exact path in the committed dep-cruiser/grep-gate config — allowlist is a reviewed file list, not a `*Repository.ts` name pattern** (⚠️COUNCIL: name-pattern is gameable by renaming). Repository modules export no business logic (review rule) | grep gate against committed path allowlist |
| **B5 Tool surface frozen** | Registered tool catalog identical before/after each slice. ⚠️COUNCIL: `descriptionHash` (toolCatalog.ts:151–158) covers description text ONLY — **S0 must extend the snapshot to the full input schema per tool (zod→JSON-schema serialization), plus name/category/tier** | full-schema snapshot committed in S0, diffed per slice |
| **B6 Suite green** | Full suite passes | `npm test` |
| **B7 No dead exports** | Close-out: ts-prune/knip clean for touched modules; no transition re-export barrels left behind | ts-prune report |

**B1 exemptions**: `packages/core/src/migrations.ts` (versioned ledger), `src/generated/*`, wikilink-lexicon data module (S11). ⚠️COUNCIL: `packages/core/src/entities.ts` (833) is **NOT pre-exempt** — single-concern audit in S13 decides exempt-or-split. `core/write/memory.ts` (802) likewise S13.

Current baseline (2026-06-12): 36 files >500 LOC, 14 >800, 17 cycles (all type-only edges at the hub — council-verified: zero runtime imports of vault-scope create cycles), SQL in 10+ files outside core storage. Close-out target: 0 files >800 (minus audited exemptions), 0 cycles, SQL confined to allowlist.

---

## 2. Triage

| Priority | Findings | Rationale |
|---|---|---|
| **P0 — rot actively costing** | F1 (fork drift — live/retired forks have diverged response contracts, locking/CAS, sharding; tests assert the dead side), F2 (write/wikilinks god file), F3 (index.ts blind spot) | Active drift, active risk, active blockage |
| **P1 — clear wins** | F4 (feedback SQL repository), F5 (pipeline relocate/split), F6 (cycle collapse), F7 (health/query registration↔domain), F8 (embeddings split), F9 (dead code), F10 (dup algorithms), F11 (char tests — folded into slices), ⚠️COUNCIL **F17 (missed rot: tools/read/graphAdvanced.ts 757 LOC of domain logic in tools layer; core/write/memory.ts 802; core/shared/prospects.ts 750; packages/core/src/entities.ts 833 — audit/relocate, S13)** | Big structure gain, bounded risk |
| **P2 — nice-to-have** | F12 (lexicon split), F13 (config instructions extract), F15 (test-helper drift), F16 (doc drift). F14 (SDK coupling): **keep** — version-audit note only. ⚠️COUNCIL: tool-registry 4-deep wrapper chain (tool-registry.ts:498–530): **keep**, document wrapper-order invariants in S12 | Cheap polish, low harm if deferred |

---

## 3. Sequenced slice backlog

Order (⚠️COUNCIL-revised): tooling first; test-infra fix early and ONCE; deletions before splits; fork-merges before the wikilink split; **S9 (pipeline) now owns the index.ts watcher-glue extraction and runs before S10** (council blocker: S9/S10 both touched index.ts:1418–1689).

Conflict map: S3–S5 + S11 (wikilink-adjacent) serial. S6 consolidates RRF in query.ts+similarity.ts ONLY; embeddings.ts:602 RRF callers re-point in S8 (explicit boundary, ⚠️COUNCIL). S9 before S10 (shared index.ts region).

### S0 — Surface snapshot + bar tooling (pre-slice, no src edits)
**Target**: catalog snapshot extended to **full input schema per tool** (zod→JSON-schema; descriptionHash alone is insufficient, toolCatalog.ts:151–158) + name/category/tier; dependency-cruiser config encoding B2/B3 + SQL-allowlist file for B4; `test/catalog/surface-freeze.test.ts`. ⚠️COUNCIL: also snapshot the **MCP initialize result** (instructions text + capabilities) for stdio in single-vault AND multi-vault modes — needed by S10/S12 (codex #13–15: instructions content depends on construction timing, `vaultRegistry` null-ness at build, and `hasEmbeddingsIndex()` timing, config.ts:444–459).
**Blast**: 0 src files. **Guarding**: itself.

### S1 — Cycle collapse via type extraction (F6) — P1, mechanical
Unchanged from rev 1: leaf type modules for vault-scope's 8 upward type-imports (vault-scope.ts:15–22), `VaultContext` out of vault-registry (kills vault-registry.ts:16 ⇄ pipeline.ts:29), tool-registry⇄discovery via tool-registry/types.ts, core sqlite⇄queries extract. All type-only (council-verified no runtime cycle edges). **Blast**: ~25 files' import lines. **Guarding**: compile + suite; B2 17→0, CI-enforced here.

### S2 — Dead-code purge wave 1 (F9a) + test-infra repoint — P1
**Target**: delete the 15 zero-importer files (G1 §6.1) + broken `test/helpers/createTestServer.ts` + `_archive/` + dead imports/symbols (G1 §6.4).
⚠️COUNCIL clarifications: (a) `mutations.ts`, `notes.ts`, `merge.ts`, `move-notes.ts`, `tools/write/config.ts` are **NOT in S2** — they have live importers (e.g. editSection.ts:42 imports `createNoteFromTemplate` from mutations.ts); they die in S3–S5/S7. S2's list is strictly the zero-src-AND-zero-test-importer set. (b) **`test/write/core/http-transport.test.ts` is rewritten ONCE here** to build from production `registerAllTools` and call live tool names (it currently imports 3 retired registration fns at :14,:17,:19 — re-pointing it per-slice ×3 was wasteful; it tests transport mechanics, not tool semantics, so early rewrite is safe).
**Blast**: −~4,500 LOC, 0 behaviour. **Guarding**: suite + B5 diff (must be empty). Do NOT touch worker files / toolCatalog / generated.

### S3 — Fork reunification: edit_section (F1a) — P0
**Target shape**: add/remove/replace + template pipeline once in `core/write/sections.ts` (+ `core/write/noteTemplate.ts` for `createNoteFromTemplate`, mutations.ts:42 — a LIVE dependency of editSection.ts:42, not retired cleanup); `editSection.ts` thin; `mutations.ts` deleted.
⚠️COUNCIL (codex #1,#3): the live tool is a superset — sharding state/side-effects (`ShardOptions`, shard creation, canonical-note backlinking: editSection.ts:44,350,516) and child-content wikilink processing (editSection.ts:448) that mutations.ts lacks (mutations.ts:271 sanitizes raw children). The extraction covers the FULL live handler incl. sharding; mutations.ts contributes nothing behavioural.
⚠️COUNCIL (claude #1): `mutations.test.ts` tests low-level `core/write/writer.js` helpers (which live on — those tests stay put untouched) plus `createNoteFromTemplate`; it is NOT a portable tool-surface suite. **Char tests are written fresh** against `edit_section` (add/remove/replace/template/sharding/child-wikilinks scenarios), green on current code first. Effort sized accordingly: char-test commit ≈ same size as refactor commit.
**Blast**: 2 tool files, 2 new core files, fresh test file. **Guarding**: new surface tests + section-content traces. **Char-first: YES (fresh, not ported).**

### S4 — Fork reunification: note create/delete (F1b) — P0
**Target shape**: live pipeline → `core/write/noteLifecycle.ts`; `note.ts` thin; `notes.ts` deleted; move-notes.ts dead regs (:516–542) stripped and its helpers (`extractAliases`, `moveNote`, `renameNote`, `findBacklinks`, `updateBacklinksInFile`, `getTitleFromPath`, `escapeRegex`) **moved to `core/write/noteMove.ts`** — required so core never imports the tools layer (⚠️COUNCIL codex #12; B3).
⚠️COUNCIL (codex #5–7): live-only behaviour to preserve verbatim — per-path locking, `FILE_EXISTS` code + `Use overwrite:true` wording (note.ts:197,317), CAS `expectedHash`/`WRITE_CONFLICT` (note.ts:341,351), prospect resolution, action-level `confirm:true` delete gate (note.ts:128). notes.ts's `Use overwrite=true`/codeless variants are dead contract — not carried.
**Char-first: YES (fresh surface tests pinning the live contract incl. those error shapes), green before refactor.**
**Blast**: 3 tool files, 2 core files; security-suite import update (`tool-integration.test.ts`).

### S5 — Fork reunification: entity merge/absorb (F1c) — P0
**Target shape**: single implementation `core/write/entityMerge.ts`; entity.ts merge branch + merge.ts both replaced; merge.ts deleted.
⚠️COUNCIL (codex #8–10): live contract divergences to preserve exactly — response `path: primary` (entity.ts:437) not `target_path`; messages `Secondary file not found`/`Primary file not found` (entity.ts:451,513); validation labels `Invalid source path`/`Invalid target path` for primary/secondary (entity.ts:418,423 — misleading wording, but it IS the contract; renaming = behaviour change, out of scope); **no `WriteConflictError` catch in the live merge branch** (merge.ts:200 wraps; entity.ts:492 doesn't) — the unified core fn throws, the entity tool layer stays catch-free, write-conflict warning metadata from merge.ts is NOT resurrected.
`dry_run`: core fn takes param; registered schema unchanged (alias-only, entity.ts:54) — confirmed safe cut (codex #11). Re-exposure = feature backlog note.
**Char-first: YES (fresh tests pinning live contract).** **Blast**: 2 tool files, 1 core file.

### S6 — Search stack: characterise, then extract from query.ts (F7b, F10 partial) — P1
**Part A (char tests)** ⚠️COUNCIL (claude #2 — goldens must not be noise machines): structure-pinning tests, not score-pinning. Fixed tiny fixture vault, FTS-only mode (no embeddings → hybrid path off → deterministic BM25), assert: result path-sets, relative order where deterministic, presence/shape of decision-surface fields via schema parse, sandwich-ordering property (best at positions 1 and N) rather than exact arrays; volatile fields (scores, timestamps, rrf values) stripped by a normalizer before compare. Separate deterministic unit tests for `core/read/{enrichment,similarity,multihop,mmr,snippets}` with synthetic inputs (no vault state).
**Part B (extract)**: `core/read/search/` — `ranking.ts` (query.ts:114–154, :167–183, :253–291), `merge.ts` (single RRF absorbing query.ts:665–701 + similarity.ts:240–261 — **embeddings.ts:602 NOT touched here; its callers re-point in S8**, ⚠️COUNCIL claude #9), `assemble.ts` (:354–413 + 3× post-proc block deduped), `bridging.ts` (:190–235). query.ts → schema + orchestration <300 LOC. Date/tail dup with find_notes → `tools/read/filters.ts`… ⚠️COUNCIL B3 note: filters.ts is a tools/ file imported by two tools — acceptable interim (tools→tools sibling import), but the shared logic itself moves to `core/read/noteFilters.ts` so B3's "nothing outside tools/ imports tools/" holds and tools files stay logic-free.
**Guarding**: Part A + retrieval-bench suite (regression canary, not gate — bench scores may shift with NO code change; only structural assertions gate).
**Char-first: YES (Part A).**

### S7 — doctor logic out of health.ts (F7a) — P1
Unchanged from rev 1 in shape: `core/read/health/{score,diagnosis,stats,freshness}.ts`, config get/set → `core/read/configStore.ts`, `VALID_CONFIG_KEYS` to core, delete `tools/write/config.ts` (+update its 2 test imports), dedupe SQL pair, health.ts <300 LOC.
⚠️COUNCIL (grok #4 — no god directories): `core/read/health/` capped at the 4 named single-concern files; no umbrella barrel; if any lands <100 LOC, fold it into its nearest concern rather than keeping a stub file.
**Guarding**: health.test (direct) + tool-counts.test. **Char-first**: shape-pinning test for `doctor(action: health|diagnosis|stats)` output (schema-parse, not values — claude #2) before extraction.

### S8 — embeddings.ts split (F8) — P1
Unchanged in shape: `core/read/embeddings/{provider,noteStore,entityStore,search,state,diagnosis}.ts`; SQL in stores+state only (B4 allowlist); `hasEmbeddingsIndex` purified with `repairBuildState()` extracted — pin current repair-on-read behaviour with a test per call site FIRST. ⚠️COUNCIL: RRF callers of embeddings.ts:602 re-point to `core/read/search/merge.ts` here (closing the S6 boundary). Transition barrels removed before slice commit (B7).
**Guarding**: embeddingsState/orphanGuard/tools-embeddings tests + S6 goldens.

### S9 — pipeline relocate + split + index.ts watcher-glue extraction (F5) — P1 ⚠️COUNCIL-expanded
**Target shape**: pipeline moves to **`core/write/pipeline/`** (not top-level `core/pipeline/` — it imports 5 write modules and writes vault files; placing it in write makes B3's read↛write rule clean, ⚠️COUNCIL grok #5,#12): `scheduler.ts`, `activity.ts`, `runner.ts`, `steps/*` (one file per cohesive step cluster). `PipelineRuntimeState` narrow interface replaces the VaultContext upward dependency.
⚠️COUNCIL (grok #9,#10 — S9/S10 conflict resolved): **this slice also extracts the watcher glue out of index.ts** (`handleBatch` closure + watcher wiring, index.ts:1418–1689, incl. the rename-bookkeeping SQL :1543–1578 → repository module) into `core/write/pipeline/watchGlue.ts`, since S9 rewires exactly that region. S10 no longer touches watcher code.
**Char-first (expanded)**: (a) pin `doctor(action: pipeline)` output shape; **`PIPELINE_TOTAL_STEPS` (=22, pipeline.ts:208) is observable there → the 19/22/25 desync is NOT fixed in this review** — logged as a one-line bugfix decision for Ben; (b) watcher batch-handling characterisation (symlink/WSL normalization, mute filter, sha256 gate, rename SQL) moves here from old S10A; (c) **`maintenance.ts` direct tests** (currently bare, G1 §8 — ⚠️COUNCIL claude #6).
**Guarding**: pipeline.test + pipeline-prospects.test + new (a)–(c). **Blast**: pipeline.ts, maintenance.ts, index.ts watcher region, vault-registry types.

### S10 — index.ts dismantle (F3) — P0, after S9
**Part A (char tests — own slice-sized commit, ⚠️COUNCIL claude #7 acknowledges scope)**: (1) HTTP transport boot via real `createConfiguredServer`; (2) integrity state-machine (index.ts:380–506); (3) startup-order smoke extending package-startup.test; (4) ⚠️COUNCIL (codex #13–15): **initialize-result snapshots** in single-vault AND multi-vault stdio modes (from S0), because the import-time construction (:340–363) currently builds instructions with `vaultRegistry=null` and pre-`activateVault` `hasEmbeddingsIndex()` — i.e. today's instructions deliberately LACK the multi-vault section (config.ts:451) and embeddings state. Moving construction into `main()` after registry setup **would change the initialize payload**; the refactor must preserve construction-equivalent timing (build server before registry/vault activation, or compute instructions from an explicitly-null registry snapshot) so the snapshots stay byte-identical. Watcher tests already landed in S9.
**Part B (split)**: `src/boot/{state,serverFactory,vaultBoot,postIndex,transport,cli,shutdown}.ts`; integrity orchestration → `core/read/integrity.ts`; index.ts → <150-LOC composition root; nothing imports it (B3).
**Guarding**: Part A + suite + B5 + initialize snapshots.

### S11 — Remaining duplication + core wikilinks data split (F10 rest, F12) — P1/P2
Unchanged: 4× overlap-filter → one predicate; write `processWikilinks` re-uses core engine where identical; lexicon → `packages/core/src/wikilinkLexicon.ts` (B1-exempt, data); `suggestWikilinks` reuses `applyWikilinks` loop; similarity.ts internal dup fixed.
**Stemmer merge: DEFERRED** — council did not find a safe seam; stands as G1 stated (corpus golden or Ben sign-off; behaviour change otherwise).
**Guarding**: core+write wikilinks tests, graph-quality suite (33 files).

### S12 — P2 batch: config split, test-helper retarget, docs, wrapper-chain doc
Unchanged from rev 1, plus ⚠️COUNCIL additions: `resources/vault.ts` gets a readResource/listResources test (bare, G1 §8); `caller-scope.ts` gets a unit test (live via tool-registry.ts:33, zero coverage); tool-registry wrapper-order invariants documented (gating→vault-activation→integrity-gate→tracking, tool-registry.ts:498–530). `generateInstructions` extract keeps byte-identical output (S0 snapshots gate it).

### S13 — Missed-rot audit: graphAdvanced / memory / prospects / entities (F17) — P1 ⚠️COUNCIL-added
**Target**: `tools/read/graphAdvanced.ts` (757 — domain logic in tools layer, B3 violation once enforced) → `core/read/graph*` modules, graphTools.ts re-points. `core/write/memory.ts` (802) + `core/shared/prospects.ts` (750) + `packages/core/src/entities.ts` (833): single-concern audit each — split along G1-style responsibility enumeration if multi-concern, else record B1 exemption with justification. No blanket exemptions.
**Guarding**: memory tests (3 direct files), prospects.test, core entities.test, graph-quality suite.
**Sequencing**: after S10 (graphAdvanced move conflicts with nothing; memory/prospects/entities audits independent — can interleave after S5 if convenient, before close-out mandatory).

### Close-out (Gn+1)
Re-run B1–B7; before/after god-file + cycle tables; `arch-review-closeout.md`.

---

## 4. Risk register (rev 2)

| # | Risk | Slice | Mitigation |
|---|---|---|---|
| R1 | Fork "reconciliation" imports retired behaviour into live contract | S3–S5 | Canonical-side rule (§ top); per-slice divergence lists from council; fresh live-surface char tests, never verbatim ports |
| R2 | `dry_run` silently re-exposed for merge | S5 | schema frozen; council-confirmed cut |
| R3 | `PIPELINE_TOTAL_STEPS` fix leaks into doctor output | S9 | council-confirmed observable → constant frozen this review; bugfix decision logged for Ben |
| R4 | `hasEmbeddingsIndex` repair-on-read relocation changes post-crash behaviour | S8 | per-call-site pinning tests first |
| R5 | index.ts construction move changes MCP initialize payload (multi-vault section, embeddings hint) | S10 | S0 initialize snapshots single+multi-vault; preserve construction-equivalent timing (codex #13–14) |
| R6 | Stemmer unification changes link/scoring invisibly | S11 | DEFERRED |
| R7 | Zombie-test deletion loses characterisation value | S2–S5 | S2 deletes only zero-importer files; S3–S5 write fresh surface tests before deleting forks |
| R8 | Transition re-export barrels survive slices | S6–S10 | removed pre-commit; B7 |
| R9 | Catalog hash misses schema drift | S0 | **realized** (council: descriptionHash covers description only) → full-JSON-schema snapshot mandatory |
| R10 | dep-cruiser rules rot via exemptions | S1 | B2+B3 only at first; B4 allowlist is a reviewed path list |
| R11 ⚠️ | Golden tests become flaky noise (scores/timestamps/index state) | S6, S7, S9 | structure/shape pinning + normalizers; FTS-only deterministic mode; bench = canary not gate |
| R12 ⚠️ | God directories replace god files | S6–S10 | B1 cohesion clause; no umbrella barrels; <100-LOC stubs folded |
| R13 ⚠️ | S9/S10 collide on index.ts:1418–1689 | S9/S10 | watcher glue owned by S9 exclusively; S10 scope reduced |

---

## 5. Sequencing summary (rev 2)

```
S0 tooling+snapshots → S1 cycles → S2 dead code + http-transport repoint
→ S3 edit_section → S4 note → S5 entity-merge
→ S6 search stack → S7 doctor → S8 embeddings
→ S9 pipeline + watcher glue (before S10!) → S10 index.ts dismantle
→ S11 dup/lexicon → S12 P2 batch → S13 missed-rot audit → close-out
```

Char-first slices: **S3, S4, S5 (fresh live-contract tests), S6A, S9a–c, S10A** (+ pinning tests in S7, S8).
S13 may interleave anywhere after S5; everything wikilink-adjacent (S3–S5, S11) serial; S9 strictly before S10.

## 6. Execution checklist (update per G3 slice)

- [ ] S0 surface + initialize snapshots, bar tooling
- [ ] S1 cycle collapse (17 → 0)
- [ ] S2 dead-code purge + http-transport repoint
- [ ] S3 edit_section reunification (char tests first)
- [ ] S4 note reunification (char tests first)
- [ ] S5 entity-merge reunification (char tests first)
- [ ] S6 search stack (A: structure goldens, B: extract)
- [ ] S7 doctor logic to core
- [ ] S8 embeddings split
- [ ] S9 pipeline relocate + watcher glue + maintenance tests
- [ ] S10 index.ts dismantle (A: char tests, B: split)
- [ ] S11 duplication + lexicon
- [ ] S12 P2 batch
- [ ] S13 missed-rot audit (graphAdvanced/memory/prospects/entities)
- [ ] Close-out report

---

## 7. Council review (held 2026-06-12, pre-G3 gate — PASSED with amendments)

Panel: **codex** (gpt-5-codex; seams/behaviour-coupling lens), **claude** (sonnet; test-strategy/sequencing lens), **grok** (bar-gameability/missed-rot lens). *gemini: disabled in this roundtable server instance — 3-of-4 panel.* All read-only; both roadmap docs + live code inspected.

**Blockers raised → resolution:**
1. codex #2 / claude #3: `createNoteFromTemplate` is a live dependency of editSection.ts:42 → S3 explicitly extracts it to core (`noteTemplate.ts`); S2 clarified to exclude mutations.ts (claude #3's "S2 breaks edit_section" was a misread of S2's file list — S2 never deleted mutations.ts — but the ambiguity was real; list now explicit). 
2. codex #5/#8: note + entity-merge forks have diverged contracts (locking/CAS/error codes; payload field names/messages/catch shape) → canonical-side rule added; per-slice divergence inventories embedded in S3–S5; verbatim test-porting abandoned for fresh live-surface tests.
3. codex #13: moving server construction into main() changes initialize instructions (multi-vault section, config.ts:451; embeddings hint timing, config.ts:444) → S0 snapshots initialize in both modes; S10 must preserve construction-equivalent timing (R5).
4. claude #2: proposed goldens flaky-by-design → S6A/S7/S9 re-specified as structure/shape pinning with normalizers, FTS-only determinism (R11).
5. grok #3: B4 `*Repository.ts` name-pattern gameable → exact-path allowlist (B4 rev).
6. grok #6/#15: missed rot (graphAdvanced 757, memory.ts 802, prospects 750, entities.ts 833) → new F17 + slice S13; entities.ts/memory.ts stripped from implicit exemption.
7. grok #9/#10: S9 and S10 both rewire index.ts:1418–1689 → watcher-glue extraction moved into S9; S10 scope reduced; order S9→S10 now mandatory (R13).

**Confirmations banked:** S3's non-sharded seam real (codex #4); dry_run cut safe (codex #11); all 17 cycles type-only — S1 sufficient, no runtime cycle remains (grok #8/#14); vitest forks/maxWorkers-1 makes per-slice green meaningful (claude #5); B5 weakness proven (grok #1/#13 — descriptionHash text-only).

**Rejected/noted:** claude #8 (test-file count 206 vs 217) — counting-method difference, no plan impact; claude #1's "10x underestimate" — directionally accepted, S3–S5 char-test commits sized as half the slice each; grok #4 (forbid nested dirs) — adopted as B1 cohesion clause + R12 rather than a flat-only rule.

**Open decisions for Ben (none block G3 start):**
- D1: `PIPELINE_TOTAL_STEPS` 19/22/25 desync — fix is user-visible in `doctor(action: pipeline)`; one-line bugfix outside this review, or fold in with sign-off? (S9/R3)
- D2: re-expose `dry_run` for `entity(action: merge)` later? (feature backlog, S5)
- D3: stemmer unification — corpus-golden project or accept-as-fix? (S11/R6)
