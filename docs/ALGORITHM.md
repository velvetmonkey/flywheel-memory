# The Scoring Algorithm

[← Back to docs](README.md)

When Flywheel suggests `[[Marcus Johnson]]`, it didn't guess. It computed a score across 13 scoring layers -- each independently testable, each ablatable, each with a reason to exist. Here's exactly how.

- [The 13 Layers](#the-13-layers)
- [The Pipeline](#the-pipeline)
- [The Flywheel Effect](#the-flywheel-effect)
- [Phase 1: Filtering (Layers 1-2)](#phase-1-filtering-layers-1-2)
- [Phase 2: Scoring (Layers 3-13)](#phase-2-scoring-layers-3-13)
- [Why Marginal Suggestions Matter](#why-marginal-suggestions-matter)
- [Strictness Modes](#strictness-modes)
- [Adaptive Thresholds](#adaptive-thresholds)
- [Worked Example](#worked-example)
- [The Self-Correcting Loop](#the-self-correcting-loop)
- [Vectors + Structure: Deeply Integrated](#vectors--structure-deeply-integrated)
- [Search Pipeline](#search-pipeline)
- [Decision Surface](#decision-surface)

---

## The 13 Layers

```
Filtering:   1. length_filter    2. article_filter
Matching:    3. exact_match      4. stem_match
Scoring:     5. cooccurrence     6. type_boost      7. context_boost
             8. recency          9. cross_folder    10. hub_boost
Learning:   11. feedback        12. semantic        13. edge_weight
```

**Filtering** prunes candidates before scoring begins. **Matching** determines if an entity's name appears in the content. **Scoring** adds contextual signals from the vault's structure. **Learning** adjusts based on what the system has observed over time -- feedback from your edits, semantic meaning, and link survival.

The first 10 layers fire on every mutation. Layers 12 and 13 require prior state: semantic needs embeddings (built via `init_semantic`), edge weight needs accumulated link history. Both degrade gracefully -- if absent, they contribute zero and the other layers carry the score.

---

## The Pipeline

```
                         +-----------+
           Content  ---->|  FILTER   |----> Candidates       (Layers 1-2)
                         +-----------+
                               |
                         +-----------+
           Candidates -->|   SCORE   |----> Scored list      (Layers 3-13)
                         +-----------+
                               |
                         +-----------+
           Scored list ->|   RANK    |----> Top 3
                         +-----------+
```

Every note mutation flows through this pipeline. Content goes in, up to 3 wikilink suggestions come out. No LLM calls. No network requests. Pure local computation.

---

## The Flywheel Effect

This is why the product is called Flywheel. The algorithm doesn't just score -- it compounds. Every write you make changes how future scores are computed.

### Day 1

You write: *"Met with Sarah about the data migration."*

Flywheel links `[[Sarah Thompson]]` and `[[Data Migration]]` because their names match existing notes. Two new graph edges. Co-occurrence count between Sarah and Data Migration: 1. Every layer except feedback and edge weight contributes to the score. The suggestions are based purely on name matching, entity type, and folder context.

Score for Sarah Thompson: `+10 (exact) +5 (people type) +5 (daily context) +3 (cross-folder)` = **23**. Clean, but generic. The algorithm knows Sarah exists. It doesn't yet know she matters.

### Week 2

You've mentioned Sarah and Data Migration together in 8 daily notes. Co-occurrence kicks in (Layer 5). Now when you write about Sarah, Data Migration gets a +3 boost even if you don't mention it by name. The graph is starting to know things you haven't explicitly told it.

Sarah's hub score has risen to 15 (eigenvector centrality -- she's linked from multiple well-connected project notes). Hub boost adds +3.9.

Score for Sarah Thompson: `+10 +5 +5 +3 +3 (cooc) +3.9 (hub) +5 (recency)` = **34.9**. The algorithm now knows Sarah is central and frequently relevant. Not because you configured anything -- because you used it.

### Month 1

You rejected `[[Daily Standup]]` as a suggestion 4 times -- the Beta-Binomial posterior shifted, soft penalty is now -8 points. You kept `[[Sarah Thompson]]` through 12 edits -- her edge weight accumulated to 4.6, earning the maximum +4 boost. The algorithm now scores Sarah +4 higher and Daily Standup -8 lower than it did on day 1. It learned from your editing behavior, not from any configuration.

Score for Sarah Thompson: `+10 +5 +5 +3 +3 +3.9 +5 +2 (feedback) +4 (edge)` = **40.9**. A 78% increase from day 1, driven entirely by accumulated usage.

### Month 3

Your vault has 3,097 new linked lines. Hub detection finds `[[Acme Corp]]` is the most central entity -- 14 project notes, 23 meeting notes, and 8 invoices all link to it. When you write about anything Acme-related, the hub boost lifts related entities before you even mention them. The graph is doing associative retrieval that grep can't.

Semantic embeddings are built. Content about "deployment automation" now suggests `[[CI/CD]]` even though those words never appear -- Layer 12 found the conceptual link at 0.72 similarity, adding +8.6 to the score.

**The loop**: writes create edges -> edges create co-occurrence -> co-occurrence sharpens scoring -> sharper scoring creates better edges -> better edges improve search -> better search drives more writes.

### Proactive Linking: The Watcher Closes the Loop

The flywheel doesn't require you to write through Claude. **Proactive linking** (on by default) means the file watcher monitors your vault for any change -- Obsidian edits, synced files, external tools -- and runs the full 13-layer scoring pipeline on changed notes. When an entity scores above the proactive threshold (default 20, double the balanced minimum), the watcher **queues** the suggestion for deferred application.

Why deferred? The file that triggered the watcher was just modified -- its mtime is fresh, so a 30-second safety guard blocks immediate writes. Applying inline would either fail silently or conflict with in-progress edits. Instead, proactive linking uses a two-step queue:

1. **Enqueue (step 12.5)** -- After suggestion scoring, high-confidence entities (score >= 20, confidence = high) are persisted to a `proactive_queue` table. Up to 5 per file per batch. Duplicate entities deduplicate, keeping the higher score. Entries expire after 6 hours.
2. **Drain (step 0.5)** -- At the start of each watcher batch, pending queue entries are applied to files that pass safety checks: file mtime older than 1 minute (not actively being edited), and under the daily cap (default 10 links per file per day).

This is what makes the flywheel self-sustaining. You edit a note in Obsidian. The watcher scores it and queues links. Next time the watcher fires, those links are applied. The new links create co-occurrence edges. Those edges sharpen future scoring. The graph grows whether you're using Claude or not.

The threshold is deliberately conservative -- score 20 means strong exact match plus multiple contextual signals. Flywheel won't speculatively link based on a stem match alone. The per-cycle cap of 5 and daily cap of 10 prevent flooding. If this is too aggressive for your workflow, disable it: `flywheel_config({ mode: "set", key: "proactive_linking", value: false })`. Auto-linking through explicit write tool calls (`vault_add_to_section`, etc.) is unaffected.

Static tools give you the same results on day 1 and day 100. Flywheel's results on day 100 are informed by everything you've written and edited since day 1. No retraining, no configuration changes, no manual curation. Just use it.

---

## Phase 1: Filtering (Layers 1-2)

Before scoring begins, candidates are pruned. This keeps the hot path fast and prevents junk suggestions.

### Layer 1: Length & Pattern Filter

**Length filter** -- Entity names longer than 25 characters are dropped. Article titles like "Complete Guide to Azure Data Factory" are not concepts worth linking.

**Word count filter** -- Entity names with more than 3 words are dropped. Real concepts are 1-3 words: "Marcus Johnson", "MCP", "Turbopump".

**Already-linked filter** -- Entities that already have `[[wikilinks]]` in the content are skipped. No double-linking.

**Generic word filter** -- Tokens too common to be meaningful are excluded from matching: message, file, info, item, list, name, type, value, result, issue, example, option, and others.

### Layer 2: Article & Suppression Filter

**Article pattern filter** -- Names matching editorial patterns are dropped: "Guide to", "How to", "Introduction to", "Best Practices", "Tutorial", "Checklist", "Cheatsheet".

**Suppression filter** -- Entities use a Beta-Binomial posterior model (Beta(8, 1) prior). When posteriorMean drops below 0.35 with at least 20 observations, the entity is hard-gated from auto-linking. A soft proportional penalty also applies in the suggestion scoring path. See [The Self-Correcting Loop](#the-self-correcting-loop) below.

---

## Phase 2: Scoring (Layers 3-13)

Every candidate that survives filtering gets scored across 11 dimensions. Each dimension adds (or subtracts) points. The total determines rank.

### Layer 3: Exact Match

The foundation. Does the entity's name (or one of its aliases) appear verbatim in the content?

| Match type | Score |
|---|---|
| Exact word match | +10 per word |
| Full alias match (single-word alias, 4+ chars) | +8 bonus |

For multi-word entities, a minimum percentage of words must match or the entity scores zero:

| Strictness | Minimum match ratio |
|---|---|
| Conservative | 60% |
| Balanced | 40% |
| Aggressive | 30% |

### Layer 4: Stem Match

Morphological matching via Porter stemmer. "tracking" matches "track", "delivered" matches "deliver", "technologies" matches "technology".

| Match type | Score |
|---|---|
| Stem-only match | +3 / +5 / +6 (conservative / balanced / aggressive) |

The stem bonus is intentionally lower than the exact bonus -- an exact word match is stronger evidence than a morphological cousin.

### Layer 5: Co-occurrence

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

**Retrieval co-occurrence** adds a second signal: notes that are frequently retrieved together in search sessions build implicit associations. The watcher mines `tool_invocations` for co-retrieved note pairs, weights them with Adamic-Adar (smaller sessions = stronger signal), and applies 7-day exponential decay. Co-occurrence pairs are stored in the `retrieval_cooccurrence` table (schema v30). The final boost is `Math.max(contentBoost, retrievalBoost)` -- the stronger signal wins, no double-counting. Retrieval boost caps at 6 (half of content co-occurrence max).

**Multi-hop search backfill.** Search results automatically include documents linked from top results. When a search finds document A which mentions entity B, document B is included in the result set at lower rank. This enables second-hop retrieval without LLM re-ranking -- measured at 92.4% document recall on 500 hard HotpotQA questions (4,960 documents).

### Layer 6: Type Boost

Different entity categories have different baseline value for linking. People are almost always worth linking. Common technology names can over-saturate if boosted.

| Category | Boost | Notes |
|----------|-------|-------|
| People | +5 | Names are high-value connections |
| Projects | +3 | Provide context for work |
| Animals | +3 | Pets and animals are personal and specific |
| Organizations | +2 | Companies and teams |
| Events | +2 | Meetings, trips, milestones |
| Media | +2 | Movies, books, shows |
| Health | +2 | Medical, fitness -- personal relevance |
| Vehicles | +2 | Cars, bikes -- specific items |
| Locations | +1 | Geographic context |
| Concepts | +1 | Abstract concepts |
| Documents | +1 | Reports, guides |
| Food | +1 | Recipes, restaurants |
| Hobbies | +1 | Crafts, sports |
| Finance | +1 | Accounts, budgets |
| Periodical | +1 | Daily/weekly/monthly notes |
| Technologies | 0 | Common -- avoid over-suggesting |
| Acronyms | 0 | May be ambiguous |
| Other | 0 | Unknown category |

### Layer 7: Context Boost

The folder a note lives in signals what kind of entity is most useful to suggest. A daily note mentioning "Marcus" should prioritize linking the person. A tech doc mentioning "Redis" should prioritize the technology.

| Note context | Boosted categories |
|---|---|
| Daily notes (`daily-notes/`, `journal/`, `logs/`) | People +5, Projects +2 |
| Project notes (`projects/`, `systems/`) | Projects +5, Technologies +2 |
| Tech notes (`tech/`, `code/`, `engineering/`, `docs/`) | Technologies +5, Acronyms +3 |
| General | No boost |

### Layer 8: Recency

Recently-mentioned entities are more likely to be relevant right now. The recency index tracks the last time each entity appeared in any vault file (by file modification time).

| Recency | Boost |
|---|---|
| Last hour | +8 |
| Last 24 hours | +5 |
| Last 3 days | +3 |
| Last week | +1 |
| Older | 0 |

### Layer 9: Cross-Folder

Entities from a different top-level folder than the current note are more valuable for building cross-cutting connections. A person note linking to a project note is more interesting than project notes linking to sibling project notes.

| Signal | Boost |
|---|---|
| Entity and note are in different top-level folders | +3 |

### Layer 10: Hub Boost

Central notes strengthen graph connectivity. Hub scores are computed using **eigenvector centrality** -- a power-iteration algorithm on the bidirectional wikilink graph (50 iterations). Scores are scaled 0-100 and stored in `entities.hub_score`. Unlike simple backlink counting, eigenvector centrality weighs the *quality* of connections -- a note linked by other well-connected notes scores higher than one with many links from peripheral notes.

The boost uses logarithmic scaling: `min(round(log2(hubScore) x 10) / 10, 6)`.

| Hub Score (eigenvector) | Boost |
|---|---|
| 100 | +6.0 (max) |
| 50 | +5.6 |
| 20 | +4.3 |
| 10 | +3.3 |
| 5 | +2.3 |
| 1 | 0 |

### Layer 11: Feedback Adjustment

Historical accuracy of suggestions adjusts future scores. High-accuracy entities get promoted. Low-accuracy entities get penalized. This is the algorithm learning from its own mistakes.

| Accuracy | Min samples | Adjustment |
|---|---|---|
| >= 95% | 20 | +5 |
| >= 80% | 5 | +2 |
| >= 60% | 5 | 0 |
| >= 40% | 5 | -2 |
| < 40% | 5 | -4 |

Feedback is stratified by folder. An entity that performs well in `projects/` but poorly in `daily-notes/` will get different adjustments depending on where the current note lives.

### Layer 12: Semantic Similarity

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

**Formula:** `boost = similarity x SEMANTIC_MAX_BOOST x strictnessMultiplier`

**Short-circuit:** Content shorter than 20 characters skips semantic scoring entirely.

**The killer feature:** Entities found ONLY by semantic similarity -- with zero content match -- still enter the scoring pipeline. They receive semantic + type + context + hub boosts, opening the `entitiesWithContentMatch` gate. This means content about "deployment automation" can suggest `[[CI/CD]]` even though those exact words never appear.

**Graceful degradation:** All semantic paths check `hasEntityEmbeddingsIndex()` before attempting queries. Errors are caught and logged -- semantic failures never break suggestions.

### Layer 13: Edge Weight

High-quality links strengthen future suggestions. Each wikilink in your vault accumulates an edge weight based on survival:

**Formula:** `weight = 1.0 + (edits_survived x 0.3) + (co_sessions x 0.2) + (source_access x 0.1)`

Three signals:

| Signal | What it measures |
|--------|-----------------|
| `edits_survived` | Link persists through note edits without being removed |
| `co_sessions` | Source and target note edited in the same session |
| `source_access` | Source note is actively read and edited |

**Scoring boost:** `min((avgWeight - 1) x 2, 4)` -- capped at +4.

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

The scoring engine optimizes for *current* relevance. The graph benefits from *accumulated* structure. A link that barely clears the threshold today may become a high-traffic edge tomorrow -- not because the score was wrong, but because the context around it grew.

This is why precision matters more than aggressive recall. A wrong link pollutes the graph. A marginal-but-correct link compounds silently.

---

## Strictness Modes

Three modes control the precision/recall trade-off:

- **Default:** `balanced` -- opinionated toward link discovery, opt out to `conservative` if too noisy
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

**Aggressive** accepts single stem matches. Used automatically for daily notes via adaptive strictness. Daily captures are low-stakes and benefit from maximum recall -- the feedback loop (Layer 11) self-corrects bad suggestions over time.

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

The entity index contains thousands of entities. After Layers 1-2 (length <= 25, word count <= 3, not already linked, no article patterns, not suppressed), the scoring loop evaluates each survivor.

Let's trace three entities through Layers 3-13. This is a fresh vault -- Layer 13 (Edge Weight) is zero for all three since no links have accumulated history yet:

### Marcus Johnson (people, path: `people/Marcus Johnson.md`)

| Layer | Signal | Score |
|---|---|---|
| 3. Exact Match | "marcus" exact match: +10 | +10 |
| 4. Stem Match | no additional stem matches | 0 |
| 5. Co-occurrence | Marcus co-occurs with Turbopump (2x in vault): +3 | +3 |
| 6. Type Boost | people | +5 |
| 7. Context Boost | daily note + people | +5 |
| 8. Recency | mentioned 2 hours ago | +5 |
| 9. Cross-Folder | `people/` != `daily-notes/` | +3 |
| 10. Hub Boost | eigenvector hub score 12 | +3.6 |
| 11. Feedback | 85% accuracy over 8 samples | +2 |
| 12. Semantic | "tracking delivery" <-> Marcus: 0.25 (below 0.30 min) | 0 |
| 13. Edge Weight | no link history yet | 0 |
| **Total** | | **36.6** |

### Acme Corp (organizations, path: `organizations/Acme Corp.md`)

| Layer | Signal | Score |
|---|---|---|
| 3. Exact Match | "acme" exact match: +10 | +10 |
| 4. Stem Match | no additional stem matches | 0 |
| 5. Co-occurrence | Acme co-occurs with Marcus (3x): +3, capped | +3 |
| 6. Type Boost | organizations | +2 |
| 7. Context Boost | daily note + organizations: none | 0 |
| 8. Recency | mentioned 18 hours ago | +5 |
| 9. Cross-Folder | `organizations/` != `daily-notes/` | +3 |
| 10. Hub Boost | eigenvector hub score 7 | +2.8 |
| 11. Feedback | no feedback yet | 0 |
| 12. Semantic | "delivery delayed" <-> Acme: 0.22 (below 0.30 min) | 0 |
| 13. Edge Weight | no link history yet | 0 |
| **Total** | | **25.8** |

### Turbopump (projects, path: `projects/Turbopump.md`)

| Layer | Signal | Score |
|---|---|---|
| 3. Exact Match | "turbopump" exact match: +10 | +10 |
| 4. Stem Match | no additional stem matches | 0 |
| 5. Co-occurrence | Turbopump co-occurs with Marcus (2x): +3 | +3 |
| 6. Type Boost | projects | +3 |
| 7. Context Boost | daily note + projects | +2 |
| 8. Recency | mentioned 30 minutes ago | +8 |
| 9. Cross-Folder | `projects/` != `daily-notes/` | +3 |
| 10. Hub Boost | eigenvector hub score 25 | +4.6 |
| 11. Feedback | 92% accuracy over 12 samples | +2 |
| 12. Semantic | "delivery delayed" <-> Turbopump: 0.41 x 12 x 0.6 = 2.95 | +2.95 |
| 13. Edge Weight | no link history yet | 0 |
| **Total** | | **38.55** |

Layer 12 is where it gets interesting. "Turbopump delivery delayed" is semantically close to the Turbopump entity (0.41 similarity). That exceeds the 0.30 minimum, so the formula kicks in: `0.41 x 12 x 0.6 = 2.95` (conservative multiplier). Marcus and Acme didn't clear the 0.30 threshold -- their names already matched via Layer 3, so semantic adds nothing new for them.

### Final ranking

Sorted by score descending, then by recency as tiebreaker:

| Rank | Entity | Score | Recency |
|---|---|---|---|
| 1 | Turbopump | 38.55 | 30 min ago |
| 2 | Marcus Johnson | 36.6 | 2 hours ago |
| 3 | Acme Corp | 25.8 | 18 hours ago |

**Output:** `-> [[Turbopump]], [[Marcus Johnson]], [[Acme Corp]]`

All three exceed the aggressive threshold of 5. Turbopump pulls ahead with the Layer 12 semantic boost and the highest eigenvector hub score.

### Three months later: same content, different scores

Now replay the same mutation -- **"Turbopump delivery delayed. Marcus tracking with Acme."** -- after three months of daily use. The content is identical. The scores are not.

### Marcus Johnson (3 months of usage)

| Layer | Day 1 | Month 3 | What changed |
|---|---|---|---|
| 3. Exact Match | +10 | +10 | -- |
| 5. Co-occurrence | +3 | +6 | Mentioned together in 22 notes (NPMI stronger) |
| 6. Type Boost | +5 | +5 | -- |
| 7. Context Boost | +5 | +5 | -- |
| 8. Recency | +5 | +8 | Mentioned 20 min ago (was 2 hours) |
| 9. Cross-Folder | +3 | +3 | -- |
| 10. Hub Boost | +3.6 | +5.3 | Hub score rose from 12 to 38 (more notes link to Marcus) |
| 11. Feedback | +2 | +5 | 96% accuracy over 47 samples (was 85% over 8) |
| 12. Semantic | 0 | 0 | Still below threshold |
| 13. Edge Weight | 0 | +4 | Survived 15 edits, weight 4.2 (was 0) |
| **Total** | **36.6** | **51.3** | **+40%** from accumulated usage |

Every learning layer contributed. Co-occurrence deepened. Hub score rose as more notes linked to Marcus. Feedback became statistically significant. Edge weight maxed out. None of this required configuration. The vault taught the algorithm.

---

## The Self-Correcting Loop

The algorithm doesn't just score -- it learns. Every wikilink it applies is tracked, and every removal is noticed. Three mechanisms form the feedback loop.

### Implicit Feedback

When Flywheel applies `[[Marcus Johnson]]` to a note, it records the application in the `wikilink_applications` table. If a user later edits the note and removes that wikilink, the next mutation detects the removal and records implicit negative feedback: "Marcus Johnson was wrong for this note."

This creates a feedback loop without requiring the user to do anything explicit:

1. **Apply** -- Flywheel adds `[[Marcus Johnson]]` to daily note
2. **Track** -- Application recorded: entity="marcus johnson", note_path="daily-notes/2025-06-15.md", status="applied"
3. **Remove** -- User edits the note and deletes the wikilink
4. **Detect** -- On next mutation, Flywheel notices the tracked entity is no longer linked
5. **Record** -- Implicit feedback: correct=false, context="implicit:removed"

Removal confidence is time-weighted. A link removed within an hour gets confidence 1.0 (the user clearly rejected it). A link removed after 24 hours gets 0.7 (it might have been relevant at the time). This prevents stale cleanups from being treated as strong rejection signals.

### Survival Tracking

The flip side of removal. Links that *survive* edits accumulate positive implicit feedback (confidence 0.8, with a 24-hour cooldown per entity+note pair). You don't have to approve anything. If Flywheel linked `[[Sarah Thompson]]` and you edited the note three times without removing her -- that's signal. She earned her place. The 24-hour cooldown prevents a single heavy-editing session from flooding the feedback table.

### Edge Weight Accumulation

Each surviving wikilink accumulates weight from three signals:

- **edits_survived** -- the link persists through note modifications (+0.3 per edit)
- **co_sessions** -- source and target note are both edited in the same session (+0.2 per session)
- **source_access** -- the source note is actively read and edited (+0.1 per access)

A link between Sarah and Data Migration that survives 10 edits earns weight ~4.0, which earns the maximum +4 scoring boost (Layer 13). The link earned its influence through demonstrated usefulness, not through popularity.

### Suppression

Entities that accumulate too many false positives get suppressed. Flywheel uses a **Beta-Binomial posterior model** -- each entity starts with a Beta(8, 1) prior giving 89% benefit of the doubt. As feedback accumulates, the posterior mean shifts. When posteriorMean drops below 0.35 with at least 20 observations, the entity is hard-gated from auto-linking. A soft proportional penalty also applies in the suggestion scoring path.

| Parameter | Value |
|---|---|
| Prior | Beta(a=8, b=1) -- 89% benefit of the doubt |
| Suppression threshold | posteriorMean < 0.35 AND totalObs >= 20 |
| Soft penalty | Proportional: `MAX_SUPPRESSION_PENALTY x (1 - posteriorMean / threshold)` |
| `MAX_SUPPRESSION_PENALTY` | -15 |
| `FOLDER_SUPPRESSION_MIN_COUNT` | 5 (minimum samples for folder-specific suppression) |

Suppression is **folder-aware**. An entity might be useful in `projects/` but consistently wrong in `daily-notes/`. Folder-specific suppression handles this: if an entity has >= 5 feedback entries in a specific folder and its posterior mean drops below the threshold within that folder, it's suppressed for notes in that folder -- even if its global accuracy is fine.

**Suppression is reversible.** If new positive feedback raises the posterior mean above 0.35, the entity is un-suppressed automatically. The system can change its mind. This matters because context shifts -- an entity that was irrelevant during one project might become central to the next.

---

## Vectors + Structure: Deeply Integrated

Flywheel uses embeddings in two complementary ways:

**Inside the scoring pipeline (Layer 12)** -- Entity-level embeddings participate directly in wikilink scoring. When you write about "deployment automation", Layer 12 finds `[[CI/CD]]` at similarity 0.72 even though those words don't appear in the content. This is the same deterministic pipeline -- the semantic boost is just another number in the sum.

**Alongside the scoring pipeline** -- Note-level embeddings power `search` (hybrid mode) and `find_similar` via Reciprocal Rank Fusion. The `semantic_analysis` tool provides `clusters` and `bridges` modes. These serve different purposes: discovery and exploration rather than wikilink suggestions.

Five properties of the scoring pipeline remain unchanged:

**Deterministic** -- Same input always produces the same output. Semantic scores are computed from fixed embeddings with cosine similarity -- no model inference in the hot path, no sampling variance.

**Fast** -- Entity embeddings are loaded into memory at startup. Layer 12 queries are in-memory cosine comparisons (<1ms for 500 entities).

**Explainable** -- The semantic boost is a named number in the score breakdown, just like every other layer. `detail: true` shows the exact similarity score and resulting boost.

**Graph-aware** -- Structural signals (backlinks, co-occurrence, folder topology) still dominate. Semantic similarity complements structure -- it doesn't replace it.

**Private** -- All embeddings are generated locally using the `all-MiniLM-L6-v2` model. No content leaves your machine.

---

## Search Pipeline

The scoring algorithm above powers wikilink suggestions -- what to link. The search pipeline is the other half: what to return when an AI asks a question. One call, everything the vault knows, structured for machine consumption.

### Query Routing

| Input | Route | What runs |
|---|---|---|
| Query text present | Content search | FTS5 + semantic + entity + memory channels |
| No query, filters only | Metadata search | Frontmatter, tags, folder, date range |
| `prefix: true` + query | Entity autocomplete | Name/alias prefix matching |

### Three Search Channels (Structured Response)

Search returns three sections in a single response. Entity-name matches form a fourth RRF channel alongside FTS5, semantic, and edge-weight context. Memory results are independent and do not affect note ranking.

**`results[]` (Notes)** -- FTS5 full-text search with BM25 ranking. Column weights: frontmatter values 10x, title 5x, content 1x. When embeddings are built, semantic similarity runs in parallel (cosine on local all-MiniLM-L6-v2 embeddings enriched with contextual prefixes -- no content leaves the machine). Results go through RRF fusion, graph reranking, U-shaped interleaving, snippet extraction, and section expansion into a decision surface. This pipeline is identical to pre-merge search -- benchmark-validated, untouched.

**`entities[]`** -- Matches against the entity database (names, aliases, descriptions). Returns entity profiles directly: category, hub score, description, aliases. Separate list, separate ranking.

**`memories[]`** -- FTS5 across stored memory keys and values. Returns stored facts, preferences, observations, and session summaries. Type-aware scoring: facts and preferences are stable, observations decay with age. Separate list.

### Reciprocal Rank Fusion (RRF)

RRF merges the note search channels into one ranked list. Each channel (FTS5, semantic, entity-name matches, edge-weight context) produces a ranked list. RRF combines them:

```
rrf_score(d) = Σ 1 / (k + rank_i(d))
```

Constant k=60 (standard RRF). A note that ranks #1 in FTS5 and #3 in semantic scores higher than one that ranks #2 in both. The fusion handles different scales without normalization -- each channel just contributes a reciprocal rank.

When `context_note` is provided, results connected via weighted edges get an additional RRF boost (edge-weight context channel).

### Result Enrichment (P38 Context Engineering)

Every result carries structured metadata for machine consumption -- a decision surface, not a list of filenames:

| Field | What it tells the AI | Present on |
|---|---|---|
| `type` | note / entity / memory | All results |
| `section` | Which heading contains the match | Notes (content matches) |
| `section_content` | Full section text around the match (up to 2,500 chars) | Top N notes (when section heading exists) |
| `snippet_confidence` | How likely this result answers the query (0--1) | All results |
| `dates_mentioned` | Extracted dates from the matching section | When dates found |
| `bridges` | Shared entities between this result and others | When bridges detected |
| `frontmatter` | All YAML metadata (status, owner, dates, amounts) | Notes |
| `backlinks` | Top 10 notes linking here, ranked by edge weight × recency | Notes |
| `outlinks` | Top 10 outgoing links, existence-checked | Notes |
| `snippet` | Best-matching paragraph (~800 chars, section-aware) | Notes (content matches) |
| `content_preview` | First ~300 chars of body | Notes (non-FTS matches) |
| `category` | Entity type (person, project, technology, etc.) | Entities |
| `hub_score` | Eigenvector centrality (graph importance) | Entities |
| `description` | One-line entity summary | Entities |

Top results (controlled by `detail_count`, default 5) get full metadata including section expansion; remaining results get lightweight summaries with just path, title, snippet, and score.

### U-Shaped Interleaving (Lost in the Middle)

LLMs have a U-shaped attention curve -- accuracy drops 30%+ for information placed in the middle of context (Liu et al. 2024, "Lost in the Middle"). The search pipeline exploits this by reordering results so the highest-ranked items land at positions 1 and N (the attention peaks), while the lowest-ranked items sit in the middle (the attention trough).

Given score-sorted results `[1, 2, 3, 4, 5, 6, 7, 8]`, the interleave produces `[1, 3, 5, 7, 8, 6, 4, 2]`. Odd-ranked items fill from the front, even-ranked from the back. Best result first, second-best last, worst in the middle. This is invisible to the consumer but measurably improves how models weight results.

### Section Expansion (Dual-Granularity)

Search matches at paragraph level (fine-grained snippets ~800 chars) but presents at section level. For the top N results (controlled by `detail_count`, default 5), when the snippet maps to a `## Section` heading, the pipeline reads the full section content and attaches it as `section_content` (up to 2,500 chars, truncated at paragraph boundaries).

This gives the AI two signals per result:
- **`snippet`** -- the precision signal: which paragraph matched and why
- **`section_content`** -- the context signal: the full section around the match, with heading for provenance

The snippet tells the AI *what matched*. The section tells it *what the match means in context*. One search call now delivers enough surrounding content that most follow-up `get_section_content` calls become unnecessary.

### Contextual Embedding Prefix

When embeddings are built, each note's embedding text is enriched with document-level context before vectorisation. Raw markdown (which starts with YAML frontmatter syntax) is replaced with:

```
Note: {title}. Tags: {tag1}, {tag2}.

{body without frontmatter}
```

This matches the contextual retrieval technique (Anthropic, 2024) -- embedding a chunk alongside its document identity so the vector carries semantic meaning about *what the note is*, not just what it contains. A note titled "Emma" with tag "person" now embeds as `"Note: Emma. Tags: person. ..."` instead of `"---\ntype: person\nstatus: active\n---"`.

An `EMBEDDING_TEXT_VERSION` constant is mixed into the content hash. Bumping it forces a one-time re-embed on upgrade -- no schema migration needed.

---

## Decision Surface

Most MCP search tools return a list of matches and say good luck. Flywheel returns a decision surface -- structured metadata that lets the AI decide whether to spend a tool call going deeper.

What each field enables:

- **Section provenance + content** → the snippet tells you *where* the match is; `section_content` gives you the full section so you can reason about it without a follow-up read
- **Pre-extracted dates** → answer temporal questions without parsing content
- **Entity bridges** → discover connections between results without a second search
- **Confidence scores** → skip low-value results without reading them
- **Frontmatter** → answer structured queries (amounts, status, dates) directly from the result -- no file open needed
- **Backlinks + outlinks** → multi-hop traversal from the search result itself

One search call replaces what would otherwise be 5--10 follow-up reads. The AI doesn't scan results -- it reasons across a structured surface where every field carries signal.
