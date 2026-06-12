# Arch Review G1 — Findings Report (flywheel-memory MCP server)

Read-only architectural recon per `flywheel-memory-arch-review-plan.md` §G1 (plan d8db1818).
Date: 2026-06-12. Branch: `arch-review-g1`, based on main @ `9d660c1`. Zero source edits.

All paths relative to repo root; `src/` means `packages/mcp-server/src/` unless prefixed.

---

## 1. Package + module layout

| Package | src files | src LOC | Role |
|---|---|---|---|
| `packages/mcp-server` | 165 | 54,466 | The MCP server: tools, core logic, transport, watch pipeline |
| `packages/core` (`@velvetmonkey/…`) | 18 | 7,403 | Shared lib: sqlite/migrations/queries, wikilink engine, entities, markdown parsing |
| `packages/bench` | 31 | 6,554 | Vault generator + benchmark harness (out of refactor scope) |

`mcp-server/src` layout: `index.ts` (entry, 1,796 LOC), `tool-registry.ts` (+ `tool-registry/` helpers), `config.ts`, `vault-registry.ts`, `vault-scope.ts`, `caller-scope.ts`, `tools/read/` (36 files), `tools/write/` (20 files), `core/read/` (29 + `watch/` 9), `core/write/` (24 + `policy/` 12), `core/shared/` (20), `resources/` (1), `generated/` (2).

### Tool surface: 20 registered tools, 12 categories, 69 actions

Authoritative map: `TOOL_CATEGORY` at `src/config.ts:261` (20 tools, 12 categories), `TOOL_TIER` at `src/config.ts:307`. The plan's "69 tools" figure is the **action count**: 20 tools × their action discriminators = 69 actions total. Coverage asserted at module load (`src/config.ts:354`, `:389`).

| Tool | Registered at | Actions | Style |
|---|---|---|---|
| search | `src/tools/read/query.ts:427` | query, similar (2) | z.enum, optional |
| init_semantic | `src/tools/read/semantic.ts:37` | FLAT | — |
| discover_tools | `src/tools/read/discovery.ts:29` | FLAT | — |
| read | `src/tools/read/primitives.ts:262` | structure, section, sections, raw (4) | z.enum |
| find_notes | `src/tools/read/find_notes.ts:27` | FLAT | — |
| note | `src/tools/write/note.ts:51` | create, move, rename, delete (4) | z.enum |
| edit_section | `src/tools/write/editSection.ts:180` | add, remove, replace (3) | z.enum |
| vault_update_frontmatter | `src/tools/write/frontmatter.ts:24` | FLAT | — |
| policy | `src/tools/write/policy.ts:39` | list, validate, preview, execute, author, revise (6) | z.enum |
| graph | `src/tools/read/graphTools.ts:38` | analyse, backlinks, forward_links, strong_connections, path, neighbors, strength, cooccurrence_gaps, export (9) | z.enum |
| schema | `src/tools/read/schemaTools.ts:34` | overview, field_values, conventions, folders, rename_field, rename_tag, migrate, validate (8) | z.enum |
| link | `src/tools/write/link.ts:189` | suggest, feedback, unlinked, validate, stubs, dashboard, unsuppress, timeline, layer_timeseries, snapshot_diff (10) | z.enum |
| correct | `src/tools/write/correct.ts:33` | record, list, resolve, undo (4) | z.enum |
| tasks | `src/tools/read/primitives.ts:268` | list, toggle (2) | z.enum, optional |
| vault_add_task | `src/tools/write/tasks.ts:117` | FLAT | — |
| memory | `src/tools/write/memory.ts:28` | store, get, search, list, forget, supersede, unsupersede, summarize_session, brief (9) | z.enum |
| entity | `src/tools/write/entity.ts:39` | list, alias, suggest_aliases, merge, suggest_merges, dismiss_merge, dismiss_prospect (7) | z.enum |
| insights | `src/tools/read/insightsTools.ts:95` | evolution, staleness, context, note_intelligence, growth (5) | z.enum |
| doctor | `src/tools/read/health.ts:968` | health, diagnosis, stats, pipeline, config, log (6) | z.enum |
| refresh_index | `src/tools/read/system.ts:92` | FLAT | — |

Discriminator pattern is **consistent**: all 14 action tools use direct `z.enum([...])` (no unions/discriminatedUnion); 2 make `action` optional with a default (search, tasks); 6 tools are flat. No structural inconsistency to fix here.

Registration mechanism: `registerAllTools()` (`src/tool-registry.ts:657`) calls per-file `registerXxxTools(server, getters...)`; `applyToolGating()` (`src/tool-registry.ts:198`) monkey-patches `server.tool()`/`server.registerTool()` to gate by category, wrap handlers (tracking `:293`, integrity gate `:441`, vault activation `:459`), and inject the multi-vault `vault` param (`:484`).

### Documentation drift (in-repo)

- `CLAUDE.md` "Source Structure" describes a `core/semantic/` directory that does not exist (real files: `src/core/read/embeddings.ts`, `src/core/read/similarity.ts`); also referenced by `src/tools/read/semanticAnalysis.ts:5`. CLAUDE.md says "21 merged tools"; actual is 20 (`TOOL_CATEGORY`, `src/config.ts:261`).
- `read` tool has a 4th action `raw` (`src/tools/read/primitives.ts:262`) not listed in CLAUDE.md; `memory` has `supersede`/`unsupersede` not listed.
- Plan note: `roadmap/uber-search.md` **does not exist** in this repo (no `roadmap/` dir prior to this report). Uber-search decision is recorded only in `CHANGELOG.md:45,63,66,163,167`. See §7 for merge state.
- Plan's "~2541 tests / 124 files" is stale: 217 test files on disk (~214 run; 2 in excluded `_archive/`, 1 unreachable in `demos/`), ~3,289 test cases (grep method, §8.4).

---

## 2. Dependency graph

Computed from static import resolution over all non-test `.ts` in `mcp-server/src` + `core/src` (relative imports + `@velvetmonkey/*`).

**Top fan-in** (most-imported): `@velvetmonkey/vault-core` (73), `core/read/types.ts` (52), `core/read/graph.ts` (27), `core/write/wikilinks.ts` (22), `core/read/embeddings.ts` (20), `core/read/config.ts` (20), `core/shared/serverLog.ts` (19), `core/write/types.ts` (19), `core/write/wikilinkFeedback.ts` (17), `vault-scope.ts` (17), `core/read/indexGuard.ts` (15), `core/write/writer.ts` (13).

**Top fan-out**: `index.ts` (39), `tool-registry.ts` (38), `core/read/watch/pipeline.ts` (23), `tools/read/query.ts` (22), `tools/read/health.ts` (20), `core/write/wikilinks.ts` (18), `tools/read/system.ts` (18).

### 2.1 Cycles: 17 unique import cycles

Hub: **`vault-scope.ts` appears in ~12 of 17.** Root cause: it type-imports "upward" from the very modules that read it back:

- `vault-scope.ts:15` ← `core/shared/cooccurrence.js` (`CooccurrenceIndex`)
- `vault-scope.ts:17` ← `core/read/graph.js` (`IndexState`) — `graph.ts:25` imports back → direct 2-cycle
- `vault-scope.ts:18` ← `core/read/embeddings.js` (`InferredCategory`) — `embeddings.ts:38` back → direct 2-cycle
- `vault-scope.ts:20` ← `core/shared/recency.js` (`RecencyIndex`) — `recency.ts:24` back → direct 2-cycle
- `vault-scope.ts:21` ← `core/read/watch/pipeline.js` (`PipelineActivity`) — pipeline's runtime imports (pipeline.ts:37–57) each read vault-scope → most indirect cycles
- `vault-scope.ts:22` ← `vault-registry.js` (`IntegrityState`, `VaultBootState`)

All eight upward imports are `import type` (erased at runtime — no init-order hazard), but they make the static graph cyclic and poison any dependency tooling. Other cycles:

- `vault-registry.ts:16` ⇄ `core/read/watch/pipeline.ts:29` — mutual type imports (`DeferredStepScheduler`/`PipelineActivity` vs `VaultContext`).
- `core/write/wikilinks.ts:48` ⇄ `core/write/wikilinkFeedback.ts:9` — feedback pulls a single 10-line pure helper `extractLinkedEntities` (defined `wikilinks.ts:867–877`, used once at `wikilinkFeedback.ts:1102`); wikilinks pulls 6 feedback symbols. Moving one helper to shared kills the cycle.
- `tool-registry.ts` ⇄ `tools/read/discovery.ts` — discovery imports the controller type back.
- `packages/core/src/sqlite.ts` ⇄ `packages/core/src/queries.ts`.

### 2.2 Cross-layer reach-arounds

- **`core/read/watch/pipeline.ts` is a write-side orchestrator misfiled under `core/read/`**: imports `../../write/wikilinks.js` (pipeline.ts:39), `../../write/proactiveQueue.js` (:40), 13 symbols from `../../write/wikilinkFeedback.js` (:60–74), `../../write/corrections.js` (:75), `../../write/edgeWeights.js` (:76); its drain step writes vault files via `applyProactiveSuggestions` (pipeline.ts:1366–1376, 1448).
- **Core depends upward on composition root**: pipeline mutates per-vault state hung off `VaultContext` (pipeline.ts:336, 614, 678, 712–713, 735, 850).
- **Tool files imported as libraries by core**: `core/read/taskCache.ts` imports `tools/read/tasks.ts`; `core/read/watch/pipeline.ts`/`maintenance.ts` import `tools/read/wikilinks.ts`-adjacent helpers; others import retired tool files as helper libs (§6.1).
- **Ranking logic exported from a registration file**: `applySandwichOrdering` defined in `tools/read/query.ts:167–183` and imported by other modules.
- **Write path inside a read tool**: `doctor(action: config)` set-path with validation/persistence/reload at `tools/read/health.ts:1230–1266`.

### 2.3 SDK-internal coupling (confirmed, documented)

`tool-registry.ts:550–591` (`installTieredCallHandler`) reaches 6 SDK internals: `serverAny.server.setRequestHandler` (:553), `handleAutomaticTaskPolling` (:575), `validateToolInput` (:577), `executeToolHandler` (:578), `validateToolOutput` (:582), `createToolError` (:588), plus shape-probing `tool.execution?.taskSupport`/`'createTask' in tool.handler` (:566–567). Monkey-patches of public surface at :498–513 (`server.tool`) and :515–529 (`registerTool`). Self-documented "stable across SDK 1.25–1.26" with upstream TODO (:539–548). `index.ts:905–1007` hand-rolls an express replica of the SDK's HTTP app (body-limit reason).

---

## 3. God classes / god files

Top offenders by LOC × responsibility-count × fan-in/out:

| File | LOC | Fan-in/out | Distinct responsibilities | Disposition |
|---|---|---|---|---|
| `src/core/write/wikilinks.ts` | 2,233 | 22 / 18 | **10**: DI/ALS state plumbing (:100–259); entity-index lifecycle + SQLite cache (:296–452, :811–850); prioritization (:466–488); validation (:494–562); write-pipeline orchestration (:576–806); scoring config (:867–1179); **640-line scoring engine** `suggestRelatedLinks` (:1204–1842); inline SQL persistence (:1712–1746, :2214–2223); note-creation intelligence (:1883–2113); proactive background writer (:2123–2233) | split (5 units: state/lifecycle, pipeline, scoring, note-intel, proactive-writer) |
| `src/core/write/wikilinkFeedback.ts` | 1,847 | 17 / – | Bayesian feedback model (:146–176, :292–305, :645–659) interleaved with **53 `db.prepare()` sites** over 8 tables (key: :190, :420–435, :906–916, :975–994, :1025–1038); suppression state; dashboard/formatting | split (repository / model / dashboard) |
| `packages/core/src/wikilinks.ts` | 1,806 | (core pkg) | 8, of which **~1,000 LOC is static lexicon data** (:49–265, :311–321, :977–1339, :1341–1374); link-apply engine (:380–698); `suggestWikilinks` re-implements applyWikilinks' loop (:707–828); implicit-entity detection (:1388–1607); orchestration (:1621–1748) | split (lexicon data module vs engine) |
| `src/index.ts` | 1,796 | – / 39 | ~14: singletons (:176–228); server factory (:235–292); HTTP server pool (:298–334); **import-time side effect** — stdio server built+tools registered at module load (:340–363); vault init (:513–574); scope building (:577–634); vault activation (:644–708); integrity orchestration (:380–506); boot (:714–833); `main()` incl. hand-rolled HTTP transport (:839–1103); watchdog (:1027–1076); **521-line `runPostIndexWork`** (:1198–1719) incl. watcher wiring (:1418–1689) with `handleBatch` closure carrying sha256 gating + **6 raw SQL statements** (:1511–1578); maintenance timers (:1163–1192); `--init-semantic` CLI (:1725–1761); shutdown (:1770–1796) | split (boot / transport / watcher-glue / integrity to core; see §8 coverage warning) |
| `src/core/read/watch/pipeline.ts` | 1,563 | – / 23 | scheduler (:78–203); activity struct (:205–240); DI plumbing (:242–276); **25–26 step implementations** (:505–1562); inline SQL (:593, :624–626, :672, :918–931, :1151–1152, :1551–1552). Step-count drift: docblock "19-step" (:308), `PIPELINE_TOTAL_STEPS = 22` (:208), actual 25–26 | split + relocate (it's write orchestration, not core/read) |
| `src/core/read/embeddings.ts` | 1,401 | 20 / – | ≥10: model registry (:82–112); provider lifecycle (:227–241); generation+LRU (:243–274); BLOB storage (:354–483, :941–1042); cosine/semantic search (:494–591); **RRF** (:602–617, zero coupling to rest); invalidation/state machine (:165–200, :649–692); orphan cleanup (:1058–1126); **doctor diagnosis** (:698–855); **entity category classifier w/ own DDL** (:1166–1319); ~35 raw SQL statements | split (provider / note-store / entity-store+classifier / search+RRF); `hasEmbeddingsIndex` (:649–677) is a query with write side-effects |
| `src/tools/read/health.ts` | 1,280 | – / 20 | Registers ONE tool (`doctor`, :968–1278); **~1,100 LOC inline domain logic**: health-score formula (:530–576); dead-link scan (:510–528); 10-check diagnosis engine (:996–1184); stats aggregation (:836–939); config get/set write path (:1230–1266); raw SQL (:649–662, :1062, :1142–1144 — verbatim dup of :649–651); dead imports from retired tools (:23, :26–29); ~240 LOC zod-schema/TS-type parallel duplication (:74–310) | split (logic → core/read/health; prune dead imports) |
| `src/tools/read/query.ts` | 855 | – / 22 | Registers ONE tool (`search`, :427–854); inline: multi-hop heuristic (:68–107); graph reranking (:114–154); sandwich ordering (:167–183, exported); entity bridging w/ N+1 SQL (:190–235); memory scoring "ported from recall.ts" (:253–291); hybrid RRF merge (:658–756); post-processing block copy-pasted 3× (:721–748, :791–812, :827–848); dead imports `loadNoteEmbeddingsForPaths` (:33), `selectByMmr` (:53) | split (ranking pipeline → core/read/search) |
| `core/src/migrations.ts` | 1,252 | (core pkg) | v1–v40 migrations, only v40 directly tested (§8) | keep (append-only by nature); add tests if touched |
| `src/core/write/policy/executor.ts` | 908 | – / 12 | policy execution engine | keep (has direct tests; single concern) |
| `src/tools/read/temporalAnalysis.ts` | 822 | retired | dead registration + helpers for insights | prune dead reg (§6) |
| `src/tools/write/editSection.ts` | 768 | – | edit_section tool; forked copy of mutations.ts handlers (§5) | merge forks |
| `src/tool-registry.ts` | 767 | 9 / 38 | gating + tiering + tracking + observation emission + cross-vault wrap — cohesive but layered concerns in one wrapper chain (:498–530) | keep or light split |
| `src/tools/write/link.ts` | 762 | – | link tool registration (10 actions) | keep; integration-only coverage (§8) |
| `src/core/shared/prospects.ts` | 750 | 7 / – | prospect scanning/scoring | keep |

---

## 4. Separation-of-concerns violations (named)

1. **Registration ↔ domain**: `tools/read/health.ts` (~1,100/1,280 LOC domain logic, §3) and `tools/read/query.ts` (~85% domain logic) are core modules wearing a registration hat. Other tools delegate properly (e.g. `tools/write/memory.ts` → `core/write/memory.ts`).
2. **Domain ↔ storage**: raw SQL inside domain/orchestration code instead of a repository layer — `wikilinkFeedback.ts` (53 sites), `embeddings.ts` (~35), `pipeline.ts` (6 clusters), `index.ts:1543–1578` (rename bookkeeping SQL in the entry file), `query.ts:202–204/626–655`, `health.ts:649–662/1062/1142–1144`. `@velvetmonkey/vault-core` already owns schema/queries (`core/src/queries.ts`), so a second, scattered SQL layer grew beside it.
3. **Read ↔ write layering**: `core/read/watch/pipeline.ts` imports 5 write modules and writes vault files (§2.2); `doctor` (read tool) persists config (`health.ts:1230–1266`); `hasEmbeddingsIndex` mutates state (`embeddings.ts:649–677`).
4. **Entry file ↔ everything**: `index.ts` carries watcher batch logic, integrity policy, embeddings build retry orchestration (:1305–1416 incl. 3 mid-build `activateVault` calls), plus import-time server construction (:340–363) — `generateInstructions` runs with `vaultRegistry=null` at load.
5. **"Pure config" that isn't**: `config.ts:1–5` claims no side effects, but throws at module load (:354, :389) and `generateInstructions` (:408–655) calls DB-backed `hasEmbeddingsIndex()` (:445) — runtime edge from config into the embeddings/cycle neighborhood.

---

## 5. Duplication

1. **T43 forked copies (highest-risk duplication — already diverging):**
   - `note(create|delete)`: `tools/write/note.ts:188–356, 439–478` duplicates `tools/write/notes.ts:61–220, 258+` (identical pipeline sequence) — notes.ts not imported by note.ts at all.
   - `entity(merge)`: `tools/write/entity.ts:402–520` is a near-verbatim copy of `tools/write/merge.ts:42–200`; **the fork dropped `dry_run`** which `merge.ts:40,131–178` supports (entity.ts has dry_run only for the alias path, :54/:264). Concrete evidence forks drift.
   - `edit_section`: `tools/write/editSection.ts:420–726` forks `mutations.ts:238–459` handlers; imports only `createNoteFromTemplate` (editSection.ts:42).
2. **RRF implemented twice**: `core/read/similarity.ts:240–261` vs `tools/read/query.ts:665–701` (identical title-fallback expression at similarity.ts:255 / query.ts:685); a third RRF lives in `embeddings.ts:602–617`.
3. **search vs find_notes**: date-window filter verbatim dup (`query.ts:545–554` vs `find_notes.ts:73–82`); sort/limit/enrich tail dup (`query.ts:557–571` vs `find_notes.ts:84–92`); search's no-query date branch (`query.ts:540–572`) is a feature-subset re-implementation of find_notes.
4. **Two Porter stemmers**: `packages/core/src/stemmer.ts` (207 LOC, used by core wikilinks) vs `src/core/shared/stemmer.ts` (390 LOC, used by write wikilinks + scoring) — link-time and scoring-time stemming can disagree.
5. **processWikilinks diverged copy**: `core/src/wikilinks.ts:1621–1748` vs `src/core/write/wikilinks.ts:576–758` (write re-orchestrates rather than calling core; near-duplicate implicit-filter blocks; the 3-clause overlap filter exists in **4 copies** — core:532–537, core:1593–1604, core:1689–1704, write:711–724).
6. **Scoring boost block copy-pasted 3× inside one function**: `write/wikilinks.ts:1376–1417`, :1527–1544, :1626–1635 (each with slightly different caps).
7. **query.ts post-processing block 3×**: :721–748, :791–812, :827–848.
8. **similarity.ts internal**: excludeLinked block (:117–135) duplicates its own helper `getLinkedPaths` (:153–172).
9. **health.ts**: proactive-queue count SQL verbatim twice (:649–651, :1142–1144); zod schemas vs hand-written types (:74–310).
10. **Test-server triplication**: `test/helpers/createTestServer.ts` (orphaned + broken — imports 4 nonexistent exports, would throw if loaded), `test/read/helpers/createTestServer.ts` (live, registers 6 retired surfaces production doesn't), `test/helpers/createWriteTestServer.ts` (uses production `registerAllTools` — correct one).

---

## 6. Dead code

### 6.1 Fully dead files (no src or test importers)

`src/core/read/calibrationExport.ts`, `entityHistory.ts`, `learningReport.ts`; `src/tools/read/calibrationExport.ts`, `entityHistory.ts`, `learningReport.ts`, `merges.ts`, `metrics.ts`, `sessionHistory.ts`, `temporalAnalysis.ts` (822 LOC); `src/tools/write/corrections.ts` (119 LOC), `tags.ts`, `toolSelectionFeedback.ts`, `wikilinkFeedback.ts`; `src/tools/read/recall.ts.disabled` (462 LOC, still contains `server.tool('recall')` at :385). **Disposition: delete.**

NOT dead despite zero static importers: `core/read/embedding-worker.ts` / `integrity-worker.ts` (spawned via `new Worker(path)` — `embeddingProvider.ts:53`, `integrity.ts:61–68`); `tools/toolCatalog.ts` (scripts + tests); `generated/*` (toolRouting + tests); `core/write/vaultRoot.ts` (index.ts).

### 6.2 Zombie files (kept alive only by test helpers)

`tools/read/graph.ts`, `noteIntelligence.ts`, `semanticAnalysis.ts`, `vaultSchema.ts`, `wikilinks.ts` (843 LOC) — only importer: `test(/read)/helpers/createTestServer.ts`. `tools/write/merge.ts`, `notes.ts`, `system.ts` — only `test/write/core/http-transport.test.ts:14–19`. **Disposition: delete file + retarget tests at the merged tools** (the tests are characterisation value; their assertions should move to note/entity/edit_section surfaces).

### 6.3 Dead registrations inside live helper files

~25 dead `server.tool`/`registerTool` calls across 11 retired files that double as helper libs: `move-notes.ts:516–542`, `notes.ts:40,239`, `merge.ts:34,221`, `mutations.ts:157–397`, `corrections.ts:22–83`, `migrations.ts:285–324` (via `registerTool` — naive greps miss it), `graphAnalysis.ts:334–341`, `config.ts:39–46`, `tools/read/wikilinks.ts:278–768`, `graph.ts:280`, `vaultSchema.ts:40–182`, `noteIntelligence.ts:36`. 6 of 17 retired files are fully converted pure helpers (graphAdvanced, bidirectional, computed, temporal, periodic, read/frontmatter). **Disposition: strip dead registrations, keep helpers (interim); long-term move helpers into core.**

### 6.4 Dead imports/symbols in live files

`query.ts:33` (`loadNoteEmbeddingsForPaths`), `query.ts:53` (`selectByMmr`); `health.ts:23,26–29` (retired-tool residue: searchFTS5, benchmark fns, getRecentInvocations, category helpers, suppression constants); `core/read/enrichment.ts:510` `enrichNoteCompact` (recall-only, zero consumers); `core/shared/retrievalCooccurrence.ts:33` lists retired tool names `'recall'`, `'search_notes'`; dead branch `core/src/wikilinks.ts:1720–1730` (both branches identical); `tools/read/brief.ts:312` `registerBriefTools` no-op never called. `tools/read/merges.ts:15` + `semanticAnalysis.ts:12` are no-op stubs.

### 6.5 Dead test material

`test/helpers/createTestServer.ts` (broken, zero importers); `test/write/_archive/langchain/` (2 files, excluded by `vitest.config.ts`); `demos/bootstrap-template/scripts/*.test.ts` (reachable by no vitest config).

---

## 7. Uber-search state (flag per plan; do not finish here)

Merge is **functionally complete**: `search` runs all three channels — notes (`query.ts:592`), entities (`query.ts:594–601,616–617`), memories (`query.ts:603–614`); recall scoring explicitly ported (`query.ts:250`, `:296`). Leftovers: `recall.ts.disabled` (462 LOC); dead MMR/embedding imports in query.ts (:33, :53 — recall's MMR path not ported; only `action=similar` gets MMR via similarity.ts); `enrichNoteCompact` orphan; recall-era names in `retrievalCooccurrence.ts:33`; dropped recall params never re-surfaced (`focus`, `entity` filter, `max_tokens` — `recall.ts.disabled:359–393`). Whether those params return is a **feature** decision (out of scope per plan); the leftovers themselves are cleanup.

---

## 8. Test-coverage shape per module (gates refactor safety)

~3,289 test cases / 217 files (method: `grep -rEc "^\s*(it|test|it\.each|test\.each)\("` over `*.test.ts`; +65 with .skip/.only variants). Per-package vitest configs; mcp-server runs `test/**/*.test.ts` excluding `_archive`, forks pool, maxWorkers 1.

| Area | Shape | Detail |
|---|---|---|
| `core/write` (24 files) | **GOOD** | 13 direct (wikilinks, wikilinkFeedback, wikilinkScoring, writer, validator, git, memory ×3, mutation-helpers, proactiveQueue…); security suite covers path/content paths |
| `core/write/policy` (12) | **GOOD** | executor + storage direct; rest exercised via executor tests |
| `core/read` (29) | **MIXED** | 12 direct (embeddings, fts5, graph, parser, vault, integrity…); **search stack integration-only**: enrichment (544 LOC), multihop, mmr, similarity, snippets — only via query.ts tool tests |
| `core/read/watch` (9) | **MIXED** | pipeline, eventQueue, selfHeal, index, incrementalIndex direct; **maintenance.ts effectively BARE** (sole importer is untested index.ts) |
| `core/shared` (20) | **GOOD** | 10 direct; retrievalCooccurrence, serverLog integration-only |
| `tools/read` (36) | **MIXED** | 13 direct; **BARE: insightsTools (572), schemaTools (258)** (+ dead temporalAnalysis 822); graphAdvanced (757) reached only via tested wrappers |
| `tools/write` (20) | **MIXED** | 11 direct — but several test the RETIRED file not the live merged tool: `mutations.test.ts` tests mutations.ts not editSection.ts; notes/merge/tags/config tests likewise. **editSection.ts (768) and link.ts (762) have no direct tests** — only registerAllTools trace/workflow tests |
| `tool-registry(.ts + /)` | **GOOD** | 4 root tests + helpers.test; types.ts trivial |
| top-level | **POOR** | **`index.ts` (1,796): zero test imports** — only `package-startup.test.ts` spawns dist (smoke); http-transport.test.ts builds its own server bypassing index.ts. `caller-scope.ts` (36): zero refs. config.ts direct |
| `resources/vault.ts` (151) | **BARE** | zero `readResource`/`listResources` in any test |
| `packages/core/src` (18) | **MIXED** | sqlite, entities, wikilinks, protectedZones, parseMarkdown direct; **migrations.ts (1,252): only v40 targeted**; queries.ts (733) untested directly; `logging/operationLogger.ts` (328) zero refs |

**Refactor-safety implications:**
- SAFE to refactor under existing tests: core/write wikilink stack, policy, tool-registry, core/read primary modules.
- **Characterisation tests FIRST** (G2 must sequence these): `index.ts` split (biggest gap — 1,796 LOC, zero direct coverage); `editSection.ts`/`link.ts` (write tools, integration-only); enrichment/similarity/multihop/mmr (search stack — only via one tool's tests); maintenance.ts; resources/vault.ts.
- Zombie-test trap: deleting retired files (§6.2) deletes their tests — port assertions to merged tools first (e.g. `mutations.test.ts` assertions → edit_section).

---

## 9. Ranked findings (structural-harm × blast-radius)

| # | Finding | Harm × Blast | Disposition |
|---|---|---|---|
| **F1** | T43 merger left **forked copies** of write-path logic (note vs notes, entity-merge vs merge, editSection vs mutations) with proven drift (`dry_run` lost in entity merge, §5.1) + tests still pointing at the retired side (§8) | HIGH × HIGH — live write paths, silent divergence, misleading green suite | **merge** forks into the live tools, port tests, then **delete** retired files |
| **F2** | `core/write/wikilinks.ts` 10-responsibility god file (2,233 LOC) incl. 640-line scoring fn with 3× copy-pasted boost block; cycle with wikilinkFeedback via one 10-line helper | HIGH × HIGH — top fan-in (22) write module; the learning core | **split** (5 units); **extract** `extractLinkedEntities` to shared (kills cycle) |
| **F3** | `index.ts`: 14-responsibility entry file, business logic + raw SQL in watcher glue, import-time server construction, **zero direct test coverage** | HIGH × HIGH — boots everything; blind spot makes refactor risky | **split** after characterisation tests (§8) |
| **F4** | `wikilinkFeedback.ts`: 53 inline SQL sites interleaved with Bayesian model | HIGH × MED — storage/domain entanglement blocks any wikilink refactor | **split** (repository extract) |
| **F5** | `core/read/watch/pipeline.ts`: write orchestrator misfiled in core/read; 5 write-module imports; step-count drift (19 vs 22 vs 25); mutates VaultContext upward | HIGH × MED | **relocate + split**; narrow `PipelineRuntimeState` interface |
| **F6** | `vault-scope.ts` type-import cycle hub (~12/17 cycles) + vault-registry⇄pipeline type cycle | MED × HIGH (graph-wide) but runtime-harmless; cheap fix | **extract-types** to leaf module(s) — collapses most cycles mechanically |
| **F7** | Registration files as god modules: `health.ts` (~1,100 LOC domain logic incl. write path), `query.ts` (~85% domain logic, exported ranking fns, 3× duped block, N+1 SQL) | MED × HIGH — search is the primary entry point; logic untestable in isolation | **split** logic into core/read/{health,search} |
| **F8** | `embeddings.ts`: 4+ modules in one (storage, search, RRF, diagnosis, classifier), ~35 SQL sites, impure `hasEmbeddingsIndex` | MED × MED | **split** (≥4 files); fan-in 20 drops mechanically |
| **F9** | Dead code mass: 15 fully dead files (§6.1, ~3,000+ LOC incl. recall.ts.disabled), 8 zombie files (§6.2), ~25 dead registrations (§6.3), dead imports (§6.4) | MED × LOW — pure deletion + test retargeting | **delete** (zombies need test ports first) |
| **F10** | Duplicated algorithms: RRF ×3, stemmer ×2, overlap-filter ×4, processWikilinks diverged copy, search/find_notes date+tail dup, similarity.ts internal dup | MED × MED — behavioural drift risk between copies | **merge** each to single home |
| **F11** | Coverage blind spots gate everything: index.ts, editSection.ts, link.ts, search stack (enrichment/similarity/multihop/mmr), maintenance.ts, resources/vault.ts, migrations v1–v39 | MED × HIGH (meta-finding) | characterisation tests first (G2 sequencing input) |
| **F12** | `packages/core/src/wikilinks.ts`: ~1,000 LOC lexicon data inline; suggestWikilinks re-implements applyWikilinks loop; dead branch :1720–1730 | LOW-MED × MED | **split** data out; **merge** suggest/apply loops |
| **F13** | `config.ts` "pure" contract violated (load-time throws OK-ish; runtime DB call in generateInstructions :445) | LOW × MED | **extract** instructions module, inject embeddings predicate |
| **F14** | SDK-internal coupling (6 internals + 2 monkey-patches, tool-registry.ts:498–591) — documented, version-pinned risk | LOW × HIGH if SDK shifts | **keep** + version audit note; upstream middleware TODO stands |
| **F15** | Test-helper drift: broken orphan helper; live read helper registers 6 retired surfaces | LOW × LOW–MED — falsifies "production surface" in read tests | **delete** orphan; retarget read helper at registerAllTools |
| **F16** | Doc drift: CLAUDE.md (core/semantic/, 21 tools, missing actions), plan's stale test counts, `roadmap/uber-search.md` nonexistent | LOW × LOW | **fix docs** (separate doc commit) |

Prior-context confirmations per plan: path-security hardening (p44, v2.12.2) not re-audited — write-path tests still present and green-by-suite (`test/write/security/`, 8 files). 13-layer scoring mapped (actually **15 layers** — doc comment `core/shared/types.ts:191–208`, union `:215–225`, numbering skips 13; full layer→line map in agent recon, §3 row 1) — structure judged, algorithm untouched per plan.

---

## 10. G2 inputs (sequencing hints, not decisions)

- Cheapest-first mechanical wins: F6 (type extraction, near-zero behaviour risk), F9 minus zombies, F16.
- F1 before F2: fork-merges shrink the wikilink/note write surface before splitting it.
- F3 (index.ts) must be preceded by characterisation tests (F11) — biggest blind spot in the repo.
- F2/F4 land as a pair (wikilinks split + feedback repository) — same domain, same tests (`test/write/core/wikilinks.test.ts`, `test/write/tools/wikilinkFeedback.test.ts` are strong).
- Tool-surface invariance check for every slice: diff registered schemas (catalog hash exists — `tools/toolCatalog.ts:183`).
