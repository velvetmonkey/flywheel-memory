# The Scoring Algorithm

When Flywheel suggests `[[Marcus Johnson]]`, it didn't guess. It computed a score across 9 layers. Here's exactly how.

---

## The Pipeline

```
                         +-----------+
           Content  ---->|  FILTER   |----> Candidates
                         +-----------+
                               |
                         +-----------+
           Candidates -->| SCORE x9  |----> Scored list
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

**Suppression filter** -- Entities with a historically high false positive rate (>30% over 10+ feedback samples) are excluded entirely. See [The Self-Correcting Loop](#the-self-correcting-loop) below.

---

## Phase 2: Scoring (9 Dimensions)

Every candidate that survives filtering gets scored across 9 independent dimensions. Each dimension adds (or subtracts) points. The total determines rank.

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

### Layer 3: Type Boost

Different entity categories have different baseline value for linking. People are almost always worth linking. Common technology names can over-saturate if boosted.

| Category | Boost |
|---|---|
| People | +5 |
| Projects | +3 |
| Organizations | +2 |
| Locations | +1 |
| Concepts | +1 |
| Technologies | 0 |
| Acronyms | 0 |

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

Notes with many backlinks (hub notes) are central to the knowledge graph. Linking to them strengthens the graph's connective tissue.

| Backlink count | Boost |
|---|---|
| >= 100 | +8 |
| >= 50 | +5 |
| >= 20 | +3 |
| >= 5 | +1 |
| < 5 | 0 |

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

---

## Strictness Modes

Three modes control the precision/recall trade-off. Strictness is set per call site — not configurable by the user:

- **Write mutations** (`vault_add_to_section`, `vault_replace_in_section`) use **conservative** — minimizes false positives when auto-linking
- **`suggest_wikilinks`** with `detail: true` uses **balanced** — more permissive for exploration

| Setting | Conservative | Balanced | Aggressive |
|---|---|---|---|
| `minSuggestionScore` | 15 | 8 | 5 |
| `minMatchRatio` | 0.6 | 0.4 | 0.3 |
| `requireMultipleMatches` | true | false | false |
| `stemMatchBonus` | 3 | 5 | 6 |
| `exactMatchBonus` | 10 | 10 | 10 |

**Conservative** (default) requires either an exact word match plus a stem match, or strong contextual signals. Single-word entities must have at least one exact match -- stem-only matches are rejected. This minimizes false positives at the cost of missing some valid suggestions.

**Balanced** accepts any entity that passes a single exact match or two stem matches. Good for vaults with well-curated entity names.

**Aggressive** accepts single stem matches. Maximizes recall for discovery-oriented workflows, but may suggest loosely related entities.

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

This is a daily note at `daily-notes/2025-06-15.md`. Strictness is `conservative` (default). Content is 54 characters, so we use the base `minSuggestionScore` of 15.

### Candidates after filtering

The entity index contains thousands of entities. After filtering (length <= 25, word count <= 3, not already linked, no article patterns, not suppressed), the scoring loop evaluates each survivor.

Let's trace three entities through all 9 layers:

### Marcus Johnson (people, path: `people/Marcus Johnson.md`)

| Layer | Signal | Score |
|---|---|---|
| 1. Content Match | "marcus" exact match: +10 | +10 |
| 2. Co-occurrence | Marcus co-occurs with Turbopump (2x in vault): +3 | +3 |
| 3. Type Boost | people | +5 |
| 4. Context Boost | daily note + people | +5 |
| 5. Recency | mentioned 2 hours ago | +5 |
| 6. Cross-Folder | `people/` != `daily-notes/` | +3 |
| 7. Hub Boost | 12 backlinks (>= 5) | +1 |
| 8. Feedback | 85% accuracy over 8 samples | +2 |
| 9. Semantic | "tracking delivery" ↔ Marcus: 0.25 (below 0.30 min) | 0 |
| **Total** | | **34** |

### Acme Corp (organizations, path: `organizations/Acme Corp.md`)

| Layer | Signal | Score |
|---|---|---|
| 1. Content Match | "acme" exact match: +10 | +10 |
| 2. Co-occurrence | Acme co-occurs with Marcus (3x): +3, capped | +3 |
| 3. Type Boost | organizations | +2 |
| 4. Context Boost | daily note + organizations: none | 0 |
| 5. Recency | mentioned 18 hours ago | +5 |
| 6. Cross-Folder | `organizations/` != `daily-notes/` | +3 |
| 7. Hub Boost | 7 backlinks (>= 5) | +1 |
| 8. Feedback | no feedback yet | 0 |
| 9. Semantic | "delivery delayed" ↔ Acme: 0.22 (below 0.30 min) | 0 |
| **Total** | | **24** |

### Turbopump (projects, path: `projects/Turbopump.md`)

| Layer | Signal | Score |
|---|---|---|
| 1. Content Match | "turbopump" exact match: +10 | +10 |
| 2. Co-occurrence | Turbopump co-occurs with Marcus (2x): +3 | +3 |
| 3. Type Boost | projects | +3 |
| 4. Context Boost | daily note + projects | +2 |
| 5. Recency | mentioned 30 minutes ago | +8 |
| 6. Cross-Folder | `projects/` != `daily-notes/` | +3 |
| 7. Hub Boost | 25 backlinks (>= 20) | +3 |
| 8. Feedback | 92% accuracy over 12 samples | +2 |
| 9. Semantic | "delivery delayed" ↔ Turbopump: 0.41 × 12 × 0.6 = 2.95 | +2.95 |
| **Total** | | **36.95** |

Layer 9 is where it gets interesting. "Turbopump delivery delayed" is semantically close to the Turbopump entity (0.41 similarity). That exceeds the 0.30 minimum, so the formula kicks in: `0.41 × 12 × 0.6 = 2.95` (conservative multiplier). Marcus and Acme didn't clear the 0.30 threshold — their names already matched via Layer 1, so semantic adds nothing new for them.

### Final ranking

Sorted by score descending, then by recency as tiebreaker:

| Rank | Entity | Score | Recency |
|---|---|---|---|
| 1 | Turbopump | 36.95 | 30 min ago |
| 2 | Marcus Johnson | 34 | 2 hours ago |
| 3 | Acme Corp | 24 | 18 hours ago |

**Output:** `-> [[Turbopump]], [[Marcus Johnson]], [[Acme Corp]]`

All three exceed the conservative threshold of 15. Turbopump pulls ahead with the Layer 9 semantic boost. The top 3 are returned by default.

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

Entities that accumulate too many false positives get suppressed entirely:

| Parameter | Value |
|---|---|
| `MIN_FEEDBACK_COUNT` | 10 (minimum samples before suppression kicks in) |
| `SUPPRESSION_THRESHOLD` | 0.30 (30% false positive rate triggers suppression) |
| `FOLDER_SUPPRESSION_MIN_COUNT` | 5 (minimum samples for folder-specific suppression) |

Suppression is also **folder-aware**. An entity might be useful in `projects/` but consistently wrong in `daily-notes/`. Folder-specific suppression handles this: if an entity has >= 5 feedback entries in a specific folder and its false positive rate exceeds 30% within that folder, it's suppressed for notes in that folder -- even if its global accuracy is fine.

Suppression is reversible. If new positive feedback brings the false positive rate below 30%, the entity is un-suppressed automatically.

---

## Vectors + Structure: Deeply Integrated

Flywheel uses embeddings in two complementary ways:

**Inside the scoring pipeline (Layer 9)** -- Entity-level embeddings participate directly in wikilink scoring. When you write about "deployment automation", Layer 9 finds `[[CI/CD]]` at similarity 0.72 even though those words don't appear in the content. This is the same deterministic pipeline -- the semantic boost is just another number in the sum.

**Alongside the scoring pipeline** -- Note-level embeddings power `search` (hybrid mode) and `find_similar` via Reciprocal Rank Fusion. Graph analysis gains `semantic_clusters` and `semantic_bridges` modes. These serve different purposes: discovery and exploration rather than wikilink suggestions.

Five properties of the scoring pipeline remain unchanged:

**Deterministic** -- Same input always produces the same output. Semantic scores are computed from fixed embeddings with cosine similarity -- no model inference in the hot path, no sampling variance.

**Fast** -- Entity embeddings are loaded into memory at startup. Layer 9 queries are in-memory cosine comparisons (<1ms for 500 entities).

**Explainable** -- The semantic boost is a named number in the score breakdown, just like every other layer. `detail: true` shows the exact similarity score and resulting boost.

**Graph-aware** -- Structural signals (backlinks, co-occurrence, folder topology) still dominate. Semantic similarity complements structure -- it doesn't replace it.

**Private** -- All embeddings are generated locally using the `all-MiniLM-L6-v2` model. No content leaves your machine.
