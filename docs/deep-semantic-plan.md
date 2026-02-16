# Flywheel: Deep Semantic Integration + Fixes

Four workstreams, ordered by priority:

---

## 1. CI Fixes (do first - unblocks everything)

### 1a. Schema version test assertion (flywheel-memory)
- **File:** `flywheel-memory/packages/core/test/sqlite.test.ts`
- **Fix:** Change `expect(version).toBe(8)` → `expect(version).toBe(9)`
- SCHEMA_VERSION was bumped to 9 for `note_embeddings` table but test wasn't updated

### 1b. Flaky Windows timing test (flywheel-memory)
- **File:** `flywheel-memory/test/write/stress/git-concurrency.test.ts`
- **Fix:** Raise threshold from 200ms → 10000ms (10s). These timing assertions are inherently flaky on CI — we only care that the behavior works, not how fast it is
- Only fails on slow Windows CI runners

### 1c. Missing exports in vault-core cross-product tests
- **File:** `vault-core/test/e2e/cross-product.test.ts`
- **Issue:** Tests reference `getEntityRecency`, `saveEntityCache`, `getProtectedZones` which no longer exist at expected export paths
- **Fix:** Update imports to match current API, or remove tests for removed functions

---

## 2. Deep Semantic Integration (the killer app)

### Phase 2a: Entity-Level Embeddings Infrastructure

Currently only **notes** have embeddings. Wikilink suggestions operate on **entities**. We need entity-level embeddings.

**New table** (`entity_embeddings`, schema v10):
```sql
CREATE TABLE IF NOT EXISTS entity_embeddings (
  entity_name TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  source_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**Files to modify:**
| File | Change |
|------|--------|
| `packages/core/src/sqlite.ts` | Add table, bump SCHEMA_VERSION 9→10 |
| `packages/mcp-server/src/core/read/embeddings.ts` | Add entity embedding functions (below) |
| `packages/mcp-server/src/tools/read/semantic.ts` | Chain entity embedding build into `init_semantic` |
| `packages/mcp-server/src/index.ts` | Load entity embeddings to memory on startup; wire incremental updates in watcher |

**New functions in `embeddings.ts`:**
- `buildEntityEmbeddingsIndex(vaultPath, entities, onProgress?)` - batch build all entity embeddings
- `updateEntityEmbedding(entityName, entity, vaultPath)` - update single entity
- `findSemanticallySimilarEntities(queryEmbedding, limit, excludeEntities?)` - cosine search against pre-computed entity embeddings
- `hasEntityEmbeddingsIndex()` - check if entity embeddings exist
- `loadEntityEmbeddingsToMemory()` - load all entity embeddings into memory (~768KB for 500 entities)
- `embedTextCached(text)` - LRU-cached embedding (avoids re-embedding same content)

**Entity embedding text** = entity name (doubled for weight) + aliases + category + first 500 chars of note body. This gives rich context so "MCP" the protocol embeds differently from "MCP" the company.

**Trigger:** Runs after note embeddings during `init_semantic`. ~500 entities takes ~2-3 min. Incremental updates via file watcher when an entity's backing note changes.

### Phase 2b: Layer 11 - Semantic Scoring in Wikilink Suggestions

**Core change:** Add semantic similarity as Layer 11 in `suggestRelatedLinks()`.

**Files to modify:**
| File | Change |
|------|--------|
| `packages/mcp-server/src/core/write/wikilinks.ts` | Make `suggestRelatedLinks()` async; add Layer 11 |
| `packages/mcp-server/src/core/write/types.ts` | Add `semanticBoost?: number` to `ScoreBreakdown` |
| `packages/mcp-server/src/tools/write/mutations.ts` | `await` suggestRelatedLinks calls |
| `packages/mcp-server/src/tools/write/notes.ts` | `await` suggestRelatedLinks calls |
| `packages/mcp-server/src/tools/write/tasks.ts` | `await` suggestRelatedLinks calls |
| `packages/mcp-server/src/core/write/policy/executor.ts` | `await` suggestRelatedLinks calls |
| `packages/mcp-server/src/tools/read/wikilinks.ts` | `await` suggestRelatedLinks calls |

**Layer 11 algorithm:**
1. Embed content via `embedTextCached(content)` (~200ms first call, 0ms cached)
2. `findSemanticallySimilarEntities(contentEmbedding, maxSuggestions*3, linkedEntities)` (<1ms against pre-computed)
3. For entities already scored by lexical layers: add semantic boost
4. For entities found ONLY by semantics (zero lexical match): create new scored entry with semantic + type/context/hub boosts — **this is the killer feature** (e.g., content about "deployment pipeline" suggests `[[CI/CD]]`)
5. Open `entitiesWithContentMatch` gate for semantic matches (without this they'd be filtered out)

**Constants:**
- `SEMANTIC_MIN_SIMILARITY = 0.30` (cosine threshold)
- `SEMANTIC_MAX_BOOST = 12` (at similarity=1.0; calibrated so exact token match +10 still wins over moderate semantic +8)
- Strictness multipliers: conservative 0.6x, balanced 1.0x, aggressive 1.3x
- Short-circuit: skip for content <20 chars

**Graceful degradation:** All semantic paths check `hasEntityEmbeddingsIndex()` first. Try/catch around all semantic calls — failure never breaks suggestions.

### Phase 2c: Semantic Integration Across the Flywheel

**Preflight duplicate detection** (`checkPreflightSimilarity` in `wikilinks.ts`):
- After existing FTS5 check, also check semantic similarity
- Catches cases like creating "Subjective Experience" when "Qualia" exists

**Graph analysis** (new modes in `graphAnalysis.ts`):
- `semantic_clusters` - group notes by embedding similarity, not link structure
- `semantic_bridges` - find notes with high semantic similarity but no link path (highest-value link suggestions)

**Note intelligence** (new mode in `noteIntelligence.ts`):
- `semantic_links` - for a given note, find semantically related entities not currently linked

**Broken link resolution** (`findSimilarEntity` in `wikilinks.ts`):
- Semantic fallback when prefix/contains matching fails for broken link targets

---

## 3. Heading Level Bumping (fix nesting/folding)

**Problem:** Content with `##` headings added to a `## Log` section creates siblings instead of children, breaking Obsidian folding.

**Solution:** New `bumpHeadingLevels(content, parentLevel)` function, called by default in `insertInSection()`.

**Algorithm:**
1. Find minimum heading level in content (`minLevel`)
2. Calculate `bump = parentLevel + 1 - minLevel`
3. If bump ≤ 0, no-op (headings already deeper)
4. Bump all headings, cap at level 6
5. Skip headings inside code blocks

**Example:** Content has `## Major Issue` (2) and `### Details` (3), parent is `## Log` (2):
- bump = 2+1-2 = 1 → `### Major Issue`, `#### Details`

**Files to modify:**
| File | Change |
|------|--------|
| `packages/mcp-server/src/core/write/writer.ts` | Add `bumpHeadingLevels()`, call from `insertInSection()` |
| `packages/mcp-server/src/tools/write/mutations.ts` | Add `bumpHeadings` param (default true, opt-out) to `vault_add_to_section` |

---

## 4. Better Error Messages for `vault_replace_in_section`

**Problem:** Error is just `No content matching "X" found in section "Y"` — no diagnostics.

**Solution:** `DiagnosticError` class + `buildReplaceNotFoundDiagnostic()` function.

**Diagnostic includes:**
- Section line range and line count
- Closest match via Levenshtein distance (extract to `core/shared/levenshtein.ts` from `graph.ts`)
- Multi-line search: per-line match analysis (which lines found, which didn't)
- Actionable suggestions (try useRegex, break into smaller replacements, whitespace warning)
- Structured `diagnostic` field on `MutationResult` (not just error string)

**Files to modify:**
| File | Change |
|------|--------|
| `packages/mcp-server/src/core/shared/levenshtein.ts` | New: extract `levenshteinDistance` from graph.ts |
| `packages/mcp-server/src/core/read/graph.ts` | Import from shared (backward compat) |
| `packages/mcp-server/src/core/write/writer.ts` | Add `buildReplaceNotFoundDiagnostic()`, `DiagnosticError` |
| `packages/mcp-server/src/core/write/types.ts` | Add `diagnostic?: Record<string, unknown>` to `MutationResult` |
| `packages/mcp-server/src/core/write/mutation-helpers.ts` | Handle `DiagnosticError` in `withVaultFile` catch block |
| `packages/mcp-server/src/tools/write/mutations.ts` | Throw `DiagnosticError` with diagnostics instead of plain Error |

---

## Verification

### CI Fixes
- Push fixes, verify all 3 matrix jobs pass on flywheel-memory
- Push vault-core fixes, verify CI passes

### Semantic Integration
- Run `init_semantic` → verify `entity_embeddings` table populated
- Test: content about "deployment automation" should suggest `[[CI/CD]]` even without those exact words
- Test: `suggestRelatedLinks` gracefully returns non-semantic results when embeddings unavailable
- Run existing test suite to ensure no regressions from async conversion

### Heading Bumping
- Add content with `## Heading` to a `## Section` → verify it becomes `### Heading`
- Verify code blocks inside content are not modified
- Verify `bumpHeadings: false` preserves original levels

### Error Messages
- Trigger a replace failure → verify closest match, line range, and suggestions in output
- Verify `diagnostic` field present on MutationResult
- Multi-line search with partial match → verify per-line analysis
