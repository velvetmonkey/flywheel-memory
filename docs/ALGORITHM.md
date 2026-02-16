# The Scoring Algorithm

When Flywheel suggests `[[Marcus Johnson]]`, it didn't guess. It computed a score across 10 layers. Here's exactly how.

---

## The Pipeline

```
                         +-----------+
           Content  ---->|  FILTER   |----> Candidates
                         +-----------+
                               |
                         +-----------+
           Candidates -->| SCORE x8  |----> Scored list
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

## Phase 2: Scoring (8 Dimensions)

Every candidate that survives filtering gets scored across 8 independent dimensions. Each dimension adds (or subtracts) points. The total determines rank.

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

---

## Strictness Modes

Three modes control the precision/recall trade-off:

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

Let's trace three entities through all 8 layers:

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
| **Total** | | **34** |

### Final ranking

Sorted by score descending, then by recency as tiebreaker:

| Rank | Entity | Score | Recency |
|---|---|---|---|
| 1 | Turbopump | 34 | 30 min ago |
| 2 | Marcus Johnson | 34 | 2 hours ago |
| 3 | Acme Corp | 24 | 18 hours ago |

**Output:** `-> [[Turbopump]], [[Marcus Johnson]], [[Acme Corp]]`

All three exceed the conservative threshold of 15. Turbopump and Marcus are tied at 34, but Turbopump wins the tiebreak because it was mentioned more recently. The top 3 are returned by default.

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

## Vectors + Structure

Flywheel uses two complementary systems: the deterministic scoring pipeline above handles **wikilink suggestions** (where explainability matters), and optional semantic embeddings handle **content discovery** (where meaning matters). They serve different purposes and do not interfere with each other.

Five reasons the wikilink scoring pipeline remains fully deterministic:

**Deterministic** -- Same input always produces the same output. No model temperature, no sampling variance, no "it worked yesterday but not today." Every wikilink suggestion is reproducible and debuggable.

**Fast** -- The full pipeline runs in under 25ms for 1000 characters of content against thousands of entities. It's a loop over arrays with arithmetic -- no inference step in the hot path.

**Explainable** -- Every score is a sum of named layers. You can inspect exactly why `[[Turbopump]]` scored 34: content match contributed 10, recency contributed 8, hub boost contributed 3, and so on. Wikilink suggestions must be auditable because they modify your notes.

**Graph-aware** -- The scoring algorithm uses backlink counts (hub boost), folder topology (cross-folder boost), entity co-occurrence patterns, and note context. These are structural signals that encode your vault's unique topology -- something embeddings alone cannot capture.

**Private** -- No content leaves your machine. The wikilink pipeline runs locally on your filesystem and a SQLite database. Semantic embeddings, when enabled, are also generated locally using the `all-MiniLM-L6-v2` model -- no external APIs, no cloud storage.

Semantic embeddings complement this by powering `search` and `find_similar` in hybrid mode. When you search for a concept, BM25 keyword matching finds exact term hits while semantic similarity finds notes that are conceptually related even without shared vocabulary. The two result sets are merged via Reciprocal Rank Fusion (RRF). This improves discovery without touching the deterministic wikilink pipeline.
