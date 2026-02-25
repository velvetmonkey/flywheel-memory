# Processing Loop — Developer Reference

Code-level reference for the flywheel processing loop, scoring engine, and feedback system.

## Entry Point

File: `packages/mcp-server/src/index.ts` — `onBatch()` handler (~line 980)

Triggered by the vault watcher when files change. Batches events and runs 15 steps sequentially via a `StepTracker`.

## Pipeline Steps

### 1. index_rebuild (~line 990)
Rebuilds `VaultIndex` from changed files. In-memory only.

### 2. note_moves (~line 1014)
Detects renames via `detectRenames()` in `eventQueue.ts`. Matches delete+upsert pairs by same stem within 5s. Updates `note_moves` table, renames entries in `wikilink_applications`, `note_links`, `note_link_history`, `note_tags`.

### 3. entity_scan (~line 1031)
Re-extracts entities from vault. Uses `extractFrontmatterFields()` for aliases/type and `categorizeEntity()` with 17 categories. Diffs against previous entity set to detect additions, removals, category changes.

### 4. hub_scores (~line 1065)
Computes backlink count per entity from `VaultIndex`. In-memory.

### 5. recency (~line 1079)
Updates last-mention timestamps via `saveRecencyToStateDb()`. Module-level StateDb ref set by `setRecencyStateDb()`.

### 6. cooccurrence (~line 1099)
Builds co-occurrence matrix — which entities appear together in notes. In-memory index.

### 7. edge_weights (~line 1122)
Recomputes edge quality scores via `recomputeEdgeWeights()` in `edgeWeights.ts`. Staleness-gated (1 hour). Three signals: edits_survived, co_sessions, source_access. Writes to `note_links.weight`.

### 8. note_embeddings (~line 1152)
Generates/updates note embeddings for changed files via `embedTextCached()`. Stored in `note_embeddings` table.

### 9. entity_embeddings (~line 1177)
Generates/updates entity embeddings. Stored in `entity_embeddings` table. Used by Layer 11 (semantic) in scoring.

### 10. index_cache (~line 1207)
Rebuilds in-memory suggestion index used by `suggestRelatedLinks()`.

### 11. task_cache (~line 1221)
Updates task cache for changed files via `updateTaskCacheForFile()` in `taskCache.ts`. Module-level db ref set by `setTaskCacheDatabase()`.

### 12. forward_links (~line 1241)
Resolves wikilinks per note using `extractLinkedEntities()`. Diffs against `note_links` table via `getStoredNoteLinks()`/`updateStoredNoteLinks()`/`diffNoteLinks()`. Produces `linkDiffs[]` with added/removed arrays. Also tracks link survival in `note_link_history` and triggers `implicit:kept` feedback at 3+ edits. First-run mitigation: seeds without reporting additions if previousSet empty.

### 13. wikilink_check (~line 1367)
Finds unwikified entity mentions via `findEntityMatches()`. Tracks applied wikilinks against `wikilink_applications`. Produces tracked links and unwikified mentions for the dashboard.

### 14. implicit_feedback (~line 1437)
Detects manual edits:
- **Removals**: `processImplicitFeedback()` + `linkDiffs[].removed` → `recordFeedback(entity, 'implicit:removed', file, false)`
- **Additions**: `linkDiffs[].added` not in `wikilink_applications` → `recordFeedback(entity, 'implicit:manual_added', file, true)`

### 15. tag_scan (~line 1475)
Detects tag additions/removals per note. Stores in `note_tags` table. First-run mitigation same pattern as forward_links.

## Scoring Engine

File: `packages/mcp-server/src/core/write/wikilinks.ts` — `suggestRelatedLinks()`

### Layer 0: Suppression filter
`isSuppressed()` from `wikilinkFeedback.ts`. Checks `wikilink_suppressions` table (global) and per-folder FP rates. Hard blocks entity from all three scoring loops (main, co-occurrence, semantic).

### Layers 1a-1b: Length + article filter
`MAX_ENTITY_LENGTH` (25 chars), `isLikelyArticleTitle()`.

### Layers 2-3: Content matching
`scoreEntity()` — exact token match (+10) and stem match (+6).

### Layer 4: Co-occurrence
`getCooccurrenceBoost()` — requires content overlap via tokenize/stem check. Max +6 (`MAX_COOCCURRENCE_BOOST = 6`). Recency multiplier: ×1.5 if recently mentioned, ×0.5 if stale.

### Layer 5: Type boost
`TYPE_BOOST[category]` — max +5 (people: +5, projects/animals: +3, orgs/events/media/health/vehicles: +2, locations/concepts/docs/food/hobbies/finance: +1, technologies/acronyms/other: 0).

### Layer 6: Context boost
`contextBoosts[category]` — max +5 (daily notes: people +5, animals/events +3, projects/food/health +2; project notes: projects +5, technologies/documents +2; tech notes: technologies +5, acronyms +3).

### Layer 7: Recency
`getRecencyBoost()` — max +8 (last hour: +8, last 24h: +5, last 3 days: +3, last week: +1, older: 0).

### Layer 8: Cross-folder
`getCrossFolderBoost()` — +3 if entity and note are in different top-level folders (`CROSS_FOLDER_BOOST = 3`).

### Layer 9: Hub boost
`getHubBoost()` — scales with backlink count. 100+ backlinks = +8.

### Layer 10: Feedback
`getAllFeedbackBoosts()` from `wikilinkFeedback.ts`. Maps entity → boost from tier system.

### Layer 11: Semantic
`findSemanticallySimilarEntities()` + `embedTextCached()`. Formula: `similarity × SEMANTIC_MAX_BOOST × strictnessMultiplier`. Max +12 (`SEMANTIC_MAX_BOOST = 12`); typical at balanced strictness: +3–7. Requires `init_semantic`.

### Layer 12: Edge weight
`getEdgeWeightBoostScore()` from `edgeWeights.ts`. Formula: `min((avgWeight - 1) * 2, 4)`.

## Feedback System

File: `packages/mcp-server/src/core/write/wikilinkFeedback.ts`

### Key functions
- `recordFeedback(stateDb, entity, context, notePath, correct)` — inserts into `wikilink_feedback`
- `isSuppressed(stateDb, entity, folder?)` — checks global `wikilink_suppressions` + folder-specific FP rates
- `getEntityStats(stateDb)` — aggregates per-entity accuracy from `wikilink_feedback`
- `computeBoostFromAccuracy(accuracy, total)` — maps to tier boost value
- `getAllFeedbackBoosts(stateDb)` — returns Map<entity, boost> for scoring
- `getDashboardData(stateDb)` — full dashboard data with tiers, suppressed, learning, timeline
- `getSuppressedEntities(stateDb)` — queries `wikilink_suppressions` joined with feedback counts

### Tier thresholds (FEEDBACK_BOOST_TIERS)
```typescript
{ minAccuracy: 0.95, minSamples: 20, boost: 5 }   // Champion
{ minAccuracy: 0.80, minSamples: 5,  boost: 2 }   // Good
{ minAccuracy: 0.60, minSamples: 5,  boost: 0 }   // Neutral
{ minAccuracy: 0.40, minSamples: 5,  boost: -2 }  // Poor
{ minAccuracy: 0,    minSamples: 5,  boost: -4 }   // Penalized
```

### Suppression thresholds
- `MIN_FEEDBACK_COUNT = 10`
- `SUPPRESSION_THRESHOLD = 0.30` (30% false positive rate)
- `FOLDER_SUPPRESSION_MIN_COUNT = 5`

## Database Tables

| Table | Used by | Purpose |
|-------|---------|---------|
| `entities` | entity_scan | Entity registry (name, category, aliases, path, description) |
| `note_links` | forward_links, edge_weights | Persisted wikilinks per note + quality weight |
| `note_link_history` | forward_links | Link survival tracking (edits_survived counter) |
| `note_moves` | note_moves | Rename history |
| `note_tags` | tag_scan | Tags per note |
| `note_embeddings` | note_embeddings | Note vector embeddings |
| `entity_embeddings` | entity_embeddings | Entity vector embeddings |
| `tasks` | task_cache | Cached task data |
| `wikilink_applications` | wikilink_check | Engine-applied links (entity + note_path + status) |
| `wikilink_feedback` | implicit_feedback | Accuracy records (entity + context + correct) |
| `wikilink_suppressions` | scoring Layer 0 | Hard-blocked entities |
| `suggestion_events` | scoring | Recent suggestion scores for dashboard |
| `index_events` | watcher | Pipeline run metadata |
| `recency` | recency step | Last-mention timestamps |
