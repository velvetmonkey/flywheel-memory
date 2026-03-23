# The Scoring Algorithm

When Flywheel suggests `[[Marcus Johnson]]`, it didn't guess. It computed a score across 10 scoring layers (plus filtering, suppression, and adaptive thresholds). Here's exactly how.

---

## The Pipeline

```
                         +-----------+
           Content  ---->|  FILTER   |----> Candidates
                         +-----------+
                               |
                         +-----------+
           Candidates -->| SCORE x10 |----> Scored list
                         +-----------+
                               |
                         +-----------+
           Scored list ->|   RANK    |----> Top 3
                         +-----------+
```

Every note mutation flows through this pipeline. Content goes in, up to 3 wikilink suggestions come out. No LLM calls. No network requests. Pure local computation.

---

## Phase 1: Filtering

Before scoring begins, candidates are pruned. This keeps the hot path fast and prevents junk suggestions.

**Length filter** -- Entity names longer than 25 characters are dropped. Article titles like "Complete Guide to Azure Data Factory" are not concepts worth linking.

**Word count filter** -- Entity names with more than 3 words are dropped. Real concepts are 1-3 words: "Marcus Johnson", "MCP", "Turbopump".

**Article pattern filter** -- Names matching editorial patterns are dropped: "Guide to", "How to", "Introduction to", "Best Practices", "Tutorial", "Checklist", "Cheatsheet".

**Already-linked filter** -- Entities that already have `[[wikilinks]]` in the content are skipped. No double-linking.

**Generic word filter** -- Tokens too common to be meaningful are excluded from matching: message, file, info, item, list, name, type, value, result, issue, example, option, and others.

**Suppression filter** -- Entities use a Beta-Binomial posterior model (Beta(8, 1) prior). When posteriorMean drops below 0.35 with at least 20 observations, the entity is hard-gated from auto-linking. A soft proportional penalty also applies in the suggestion scoring path. See [The Self-Correcting Loop](#the-self-correcting-loop) below.

---

## Phase 2: Scoring (10 Dimensions)

Every candidate that survives filtering gets scored across 10 independent dimensions. Each dimension adds (or subtracts) points. The total determines rank.

### Layer 1: Content Match

The foundation. Does the entity's name (or one of its aliases) actually appear in the content?

| Match type | Score |
|---|---|
| Exact word match | +10 per word |
| Stem-only match | +3 / +5 / +6 (conservative / balanced / aggressive) |
| Full alias match (single-word alias, 4+ chars) | +8 bonus |

For multi-word entities, a minimum percentage of words must match or the entity scores zero:

| Strictness | Minimum match ratio |
|---|---|
| Conservative | 60% |
| Balanced | 40% |
| Aggressive | 30% |

Stemming uses a Porter stemmer. "tracking" matches "track", "delivered" matches "deliver", "technologies" matches "technology". The stem bonus is intentionally lower than the exact bonus -- an exact word match is stronger evidence than a morphological cousin.

### Layer 2: Co-occurrence

Entities that frequently appear together in vault notes get a boost. If your content mentions "Flywheel" and "MCP" often co-occur across your vault, "MCP" gets a lift even if it doesn't appear in this specific content.

| Signal | Score |
|---|---|
| Per qualifying co-occurrence relationship | +3 |
| Maximum co-occurrence boost | 6 (capped) |
| Minimum co-occurrence count to qualify | 2 |

A **recency multiplier** adjusts the co-occurrence boost based on how recently the entity was mentioned:
- Entity has recent activity (recency boost > 0): **1.5x** multiplier
- Entity is stale (no recent activity): **0.5x** multiplier

Co-occurrence candidates must also have at least 1 word overlapping with the content. This prevents popular but irrelevant entities from being suggested purely on graph connectivity.

Co-occurrence strength uses **NPMI (Normalized Pointwise Mutual Information)** scoring to penalize ubiquitous entities. An entity that co-occurs with everything gets a lower boost than one with a focused co-occurrence pattern. The `computeNpmi()` function scales by PMI_SCALE=12, capped at 12.

**Retrieval co-occurrence** adds a second signal: notes that are frequently retrieved together in search/recall sessions build implicit associations. The watcher mines `tool_invocations` for co-retrieved note pairs, weights them with Adamic-Adar (smaller sessions = stronger signal), and applies 7-day exponential decay. Co-occurrence pairs are stored in the `retrieval_cooccurrence` table (schema v30). The final boost is `Math.max(contentBoost, retrievalBoost)` — the stronger signal wins, no double-counting. Retrieval boost caps at 6 (half of content co-occurrence max).

**Multi-hop search backfill.** Search results automatically include documents linked from top results. When a search finds document A which mentions entity B, document B is included in the result set at lower rank. This enables second-hop retrieval without LLM re-ranking — measured at 87.5% document recall on 200 hard HotpotQA questions.

### Layer 3: Type Boost

Different entity categories have different baseline value for linking. People are almost always worth linking. Common technology names can over-saturate if boosted.

| Category | Boost | Notes |
|----------|-------|-------|
| People | +5 | Names are high-value connections |
| Projects | +3 | Provide context for work |
| Animals | +3 | Pets and animals are personal and specific |
| Organizations | +2 | Companies and teams |
| Events | +2 | Meetings, trips, milestones |
| Media | +2 | Movies, books, shows |
| Health | +2 | Medical, fitness — personal relevance |
| Vehicles | +2 | Cars, bikes — specific items |
| Locations | +1 | Geographic context |
| Concepts | +1 | Abstract concepts |
| Documents | +1 | Reports, guides |
| Food | +1 | Recipes, restaurants |
| Hobbies | +1 | Crafts, sports |
| Finance | +1 | Accounts, budgets |
| Periodical | +1 | Daily/weekly/monthly notes |
| Technologies | 0 | Common — avoid over-suggesting |
| Acronyms | 0 | May be ambiguous |
| Other | 0 | Unknown category |

### Layer 4: Context Boost

The folder a note lives in signals what kind of entity is most useful to suggest. A daily note mentioning "Marcus" should prioritize linking the person. A tech doc mentioning "Redis" should prioritize the technology.

| Note context | Boosted categories |
|---|---|
| Daily notes (`daily-notes/`, `journal/`, `logs/`) | People +5, Projects +2 |
| Project notes (`projects/`, `systems/`) | Projects +5, Technologies +2 |
| Tech notes (`tech/`, `code/`, `engineering/`, `docs/`) | Technologies +5, Acronyms +3 |
| General | No boost |

### Layer 5: Recency

Recently-mentioned entities are more likely to be relevant right now. The recency index tracks the last time each entity appeared in any vault file (by file modification time).

| Recency | Boost |
|---|---|
| Last hour | +8 |
| Last 24 hours | +5 |
| Last 3 days | +3 |
| Last week | +1 |
| Older | 0 |

### Layer 6: Cross-Folder

Entities from a different top-level folder than the current note are more valuable for building cross-cutting connections. A person note linking to a project note is more interesting than project notes linking to sibling project notes.

| Signal | Boost |
|---|---|
| Entity and note are in different top-level folders | +3 |

### Layer 7: Hub Boost

Central notes strengthen graph connectivity. Hub scores are computed using **eigenvector centrality** — a power-iteration algorithm on the bidirectional wikilink graph (50 iterations). Scores are scaled 0–100 and stored in `entities.hub_score`. Unlike simple backlink counting, eigenvector centrality weighs the *quality* of connections — a note linked by other well-connected notes scores higher than one with many links from peripheral notes.

The boost uses logarithmic scaling: `min(round(log₂(hubScore) × 10) / 10, 6)`.

| Hub Score (eigenvector) | Boost |
|---|---|
| 100 | +6.0 (max) |
| 50 | +5.6 |
| 20 | +4.3 |
| 10 | +3.3 |
| 5 | +2.3 |
| 1 | 0 |

### Layer 8: Feedback Adjustment

Historical accuracy of suggestions adjusts future scores. High-accuracy entities get promoted. Low-accuracy entities get penalized. This is the algorithm learning from its own mistakes.

| Accuracy | Min samples | Adjustment |
|---|---|---|
| >= 95% | 20 | +5 |
| >= 80% | 5 | +2 |
| >= 60% | 5 | 0 |
| >= 40% | 5 | -2 |
| < 40% | 5 | -4 |

Feedback is stratified by folder. An entity that performs well in `projects/` but poorly in `daily-notes/` will get different adjustments depending on where the current note lives.

### Layer 9: Semantic Similarity

When entity embeddings are available (built via `init_semantic`), candidates receive a semantic boost based on how closely the content's meaning aligns with each entity.

**Prerequisites:** Entity embeddings must be built via `init_semantic`. If unavailable, this layer is silently skipped.

| Parameter | Value |
|---|---|
| Minimum similarity | 0.30 (`SEMANTIC_MIN_SIMILARITY`) |
| Maximum boost | 12 (`SEMANTIC_MAX_BOOST`) |

**Strictness multipliers:**

| Strictness | Multiplier |
|---|---|
| Conservative | 0.6x |
| Balanced | 1.0x |
| Aggressive | 1.3x |

**Formula:** `boost = similarity × SEMANTIC_MAX_BOOST × strictnessMultiplier`

**Short-circuit:** Content shorter than 20 characters skips semantic scoring entirely.

**The killer feature:** Entities found ONLY by semantic similarity -- with zero content match -- still enter the scoring pipeline. They receive semantic + type + context + hub boosts, opening the `entitiesWithContentMatch` gate. This means content about "deployment automation" can suggest `[[CI/CD]]` even though those exact words never appear.

**Graceful degradation:** All semantic paths check `hasEntityEmbeddingsIndex()` before attempting queries. Errors are caught and logged -- semantic failures never break suggestions.

### Layer 10: Edge Weight

High-quality links strengthen future suggestions. Each wikilink in your vault accumulates an edge weight based on survival:

**Formula:** `weight = 1.0 + (edits_survived × 0.3) + (co_sessions × 0.2) + (source_access × 0.1)`

Three signals:

| Signal | What it measures |
|--------|-----------------|
| `edits_survived` | Link persists through note edits without being removed |
| `co_sessions` | Source and target note edited in the same session |
| `source_access` | Source note is actively read and edited |

**Scoring boost:** `min((avgWeight − 1) × 2, 4)` — capped at +4.

| Edge weight | Boost |
|------------|-------|
| 1.0 (new) | 0 |
| 2.0 (moderate) | +2 |
| 3.0 (established) | +4 (capped) |
| 4.0+ (strong) | +4 (capped) |

A link that survives 10 edits (weight ~4.0) earns the maximum +4 boost. This creates a feedback loop: links that survive are trusted, and trusted links score higher in future suggestions.

**Prerequisites:** Edge weights are computed by the watcher pipeline's `edge_weights` step (staleness-gated to once per hour). Available without `init_semantic`.

---

## Why Marginal Suggestions Matter

A suggestion scoring 11 (just above the balanced threshold of 10) looks marginal. But if accepted, it:

1. Creates an edge that future co-occurrence calculations traverse
2. Adds a backlink that hub detection considers
3. Generates implicit feedback data when the link survives future edits
4. Becomes part of answer paths for queries that don't exist yet

The scoring engine optimizes for *current* relevance. The graph benefits from *accumulated* structure. A link that barely clears the threshold today may become a high-traffic edge tomorrow — not because the score was wrong, but because the context around it grew.

This is why precision matters more than aggressive recall. A wrong link pollutes the graph. A marginal-but-correct link compounds silently.

---

## Strictness Modes

Three modes control the precision/recall trade-off:

- **Default:** `balanced` — opinionated toward link discovery, opt out to `conservative` if too noisy
- **Configurable:** Set `wikilink_strictness` in `flywheel_config` to `conservative` or `aggressive`
- **Adaptive (on by default):** Daily notes auto-escalate to `aggressive` for maximum capture. Set `adaptive_strictness: false` to disable.
- **`suggest_wikilinks`** with `detail: true` always uses `balanced` for exploration

| Setting | Conservative | Balanced | Aggressive |
|---|---|---|---|
| `minSuggestionScore` | 18 | 10 | 5 |
| `minMatchRatio` | 0.6 | 0.4 | 0.3 |
| `requireMultipleMatches` | true | false | false |
| `stemMatchBonus` | 3 | 5 | 6 |
| `exactMatchBonus` | 10 | 10 | 10 |

**Conservative** requires either an exact word match plus a stem match, or strong contextual signals. Single-word entities must have at least one exact match -- stem-only matches are rejected. Opt into this with `wikilink_strictness: 'conservative'` if link noise is too high.

**Balanced** (default) accepts any entity that passes a single exact match or two stem matches. The sweet spot for most vaults -- enough coverage to build a dense graph without flooding notes with weak links.

**Aggressive** accepts single stem matches. Used automatically for daily notes via adaptive strictness. Daily captures are low-stakes and benefit from maximum recall -- the feedback loop (Layer 8) self-corrects bad suggestions over time.

---

## Adaptive Thresholds

The minimum score adjusts based on content length:

| Content length | Threshold calculation |
|---|---|
| Short (< 50 chars) | `max(5, floor(baseScore * 0.6))` |
| Medium (50-200 chars) | `baseScore` (unchanged) |
| Long (> 200 chars) | `floor(baseScore * 1.2)` |

Short content (a quick note, a task) gets a lower bar because there are fewer words to match against. Long content gets a higher bar because there are more words, so matches are more likely to be coincidental.

---

## Worked Example

Content: **"Turbopump delivery delayed. Marcus tracking with Acme."**

This is a daily note at `daily-notes/2025-06-15.md`. Adaptive strictness escalates daily notes to `aggressive` (minSuggestionScore of 5). Content is 54 characters (short), so the adaptive threshold applies: `max(5, floor(5 * 0.6))` = 5.

### Candidates after filtering

The entity index contains thousands of entities. After filtering (length <= 25, word count <= 3, not already linked, no article patterns, not suppressed), the scoring loop evaluates each survivor.

Let's trace three entities through all 10 scoring layers (Layer 10 — Edge Weight — is zero for all three in this example since none have accumulated edge weight data yet):

### Marcus Johnson (people, path: `people/Marcus Johnson.md`)

| Layer | Signal | Score |
|---|---|---|
| 1. Content Match | "marcus" exact match: +10 | +10 |
| 2. Co-occurrence | Marcus co-occurs with Turbopump (2x in vault): +3 | +3 |
| 3. Type Boost | people | +5 |
| 4. Context Boost | daily note + people | +5 |
| 5. Recency | mentioned 2 hours ago | +5 |
| 6. Cross-Folder | `people/` != `daily-notes/` | +3 |
| 7. Hub Boost | eigenvector hub score 12 | +3.6 |
| 8. Feedback | 85% accuracy over 8 samples | +2 |
| 9. Semantic | "tracking delivery" ↔ Marcus: 0.25 (below 0.30 min) | 0 |
| **Total** | | **36.6** |

### Acme Corp (organizations, path: `organizations/Acme Corp.md`)

| Layer | Signal | Score |
|---|---|---|
| 1. Content Match | "acme" exact match: +10 | +10 |
| 2. Co-occurrence | Acme co-occurs with Marcus (3x): +3, capped | +3 |
| 3. Type Boost | organizations | +2 |
| 4. Context Boost | daily note + organizations: none | 0 |
| 5. Recency | mentioned 18 hours ago | +5 |
| 6. Cross-Folder | `organizations/` != `daily-notes/` | +3 |
| 7. Hub Boost | eigenvector hub score 7 | +2.8 |
| 8. Feedback | no feedback yet | 0 |
| 9. Semantic | "delivery delayed" ↔ Acme: 0.22 (below 0.30 min) | 0 |
| **Total** | | **25.8** |

### Turbopump (projects, path: `projects/Turbopump.md`)

| Layer | Signal | Score |
|---|---|---|
| 1. Content Match | "turbopump" exact match: +10 | +10 |
| 2. Co-occurrence | Turbopump co-occurs with Marcus (2x): +3 | +3 |
| 3. Type Boost | projects | +3 |
| 4. Context Boost | daily note + projects | +2 |
| 5. Recency | mentioned 30 minutes ago | +8 |
| 6. Cross-Folder | `projects/` != `daily-notes/` | +3 |
| 7. Hub Boost | eigenvector hub score 25 | +4.6 |
| 8. Feedback | 92% accuracy over 12 samples | +2 |
| 9. Semantic | "delivery delayed" ↔ Turbopump: 0.41 × 12 × 0.6 = 2.95 | +2.95 |
| **Total** | | **38.55** |

Layer 9 is where it gets interesting. "Turbopump delivery delayed" is semantically close to the Turbopump entity (0.41 similarity). That exceeds the 0.30 minimum, so the formula kicks in: `0.41 × 12 × 0.6 = 2.95` (conservative multiplier). Marcus and Acme didn't clear the 0.30 threshold — their names already matched via Layer 1, so semantic adds nothing new for them.

### Final ranking

Sorted by score descending, then by recency as tiebreaker:

| Rank | Entity | Score | Recency |
|---|---|---|---|
| 1 | Turbopump | 38.55 | 30 min ago |
| 2 | Marcus Johnson | 36.6 | 2 hours ago |
| 3 | Acme Corp | 25.8 | 18 hours ago |

**Output:** `-> [[Turbopump]], [[Marcus Johnson]], [[Acme Corp]]`

All three exceed the conservative threshold of 15. Turbopump pulls ahead with the Layer 9 semantic boost and the highest eigenvector hub score. The top 3 are returned by default.

---

## The Self-Correcting Loop

The algorithm doesn't just score -- it learns. Every wikilink it applies is tracked, and every removal is noticed.

### Implicit Feedback

When Flywheel applies `[[Marcus Johnson]]` to a note, it records the application in the `wikilink_applications` table. If a user later edits the note and removes that wikilink, the next mutation detects the removal and records implicit negative feedback: "Marcus Johnson was wrong for this note."

This creates a feedback loop without requiring the user to do anything explicit:

1. **Apply** -- Flywheel adds `[[Marcus Johnson]]` to daily note
2. **Track** -- Application recorded: entity="marcus johnson", note_path="daily-notes/2025-06-15.md", status="applied"
3. **Remove** -- User edits the note and deletes the wikilink
4. **Detect** -- On next mutation, Flywheel notices the tracked entity is no longer linked
5. **Record** -- Implicit feedback: correct=false, context="implicit:removed"

### Suppression

Entities that accumulate too many false positives get suppressed. Flywheel uses a **Beta-Binomial posterior model** — each entity starts with a Beta(8, 1) prior giving 89% benefit of the doubt. As feedback accumulates, the posterior mean shifts. When posteriorMean drops below 0.35 with at least 20 observations, the entity is hard-gated from auto-linking. A soft proportional penalty also applies in the suggestion scoring path.

| Parameter | Value |
|---|---|
| Prior | Beta(α=8, β=1) — 89% benefit of the doubt |
| Suppression threshold | posteriorMean < 0.35 AND totalObs ≥ 20 |
| Soft penalty | Proportional: `MAX_SUPPRESSION_PENALTY × (1 − posteriorMean / threshold)` |
| `MAX_SUPPRESSION_PENALTY` | −15 |
| `FOLDER_SUPPRESSION_MIN_COUNT` | 5 (minimum samples for folder-specific suppression) |

Suppression is also **folder-aware**. An entity might be useful in `projects/` but consistently wrong in `daily-notes/`. Folder-specific suppression handles this: if an entity has >= 5 feedback entries in a specific folder and its posterior mean drops below the threshold within that folder, it's suppressed for notes in that folder -- even if its global accuracy is fine.

Suppression is reversible. If new positive feedback raises the posterior mean above 0.35, the entity is un-suppressed automatically.

---

## Vectors + Structure: Deeply Integrated

Flywheel uses embeddings in two complementary ways:

**Inside the scoring pipeline (Layer 9)** -- Entity-level embeddings participate directly in wikilink scoring. When you write about "deployment automation", Layer 9 finds `[[CI/CD]]` at similarity 0.72 even though those words don't appear in the content. This is the same deterministic pipeline -- the semantic boost is just another number in the sum.

**Alongside the scoring pipeline** -- Note-level embeddings power `search` (hybrid mode) and `find_similar` via Reciprocal Rank Fusion. The `semantic_analysis` tool provides `clusters` and `bridges` modes. These serve different purposes: discovery and exploration rather than wikilink suggestions.

Five properties of the scoring pipeline remain unchanged:

**Deterministic** -- Same input always produces the same output. Semantic scores are computed from fixed embeddings with cosine similarity -- no model inference in the hot path, no sampling variance.

**Fast** -- Entity embeddings are loaded into memory at startup. Layer 9 queries are in-memory cosine comparisons (<1ms for 500 entities).

**Explainable** -- The semantic boost is a named number in the score breakdown, just like every other layer. `detail: true` shows the exact similarity score and resulting boost.

**Graph-aware** -- Structural signals (backlinks, co-occurrence, folder topology) still dominate. Semantic similarity complements structure -- it doesn't replace it.

**Private** -- All embeddings are generated locally using the `all-MiniLM-L6-v2` model. No content leaves your machine.
