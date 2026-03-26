# Sharing Calibration Data

Flywheel learns from how you use your vault. Every accepted link, every removal, every edit that survives — it all feeds back into scoring. This page explains what's tracked, what's safe to share, and how sharing helps everyone.

## What's tracked and why

All data lives in `.flywheel/state.db` on your machine. Zero network calls (enforced by [CI test](../SECURITY.md)).

| Data | Purpose | Contains vault-specific info? |
|------|---------|-------------------------------|
| **Wikilink feedback** | Tracks accepted/removed auto-links to learn suppression thresholds | Yes — note paths, entity names, context snippets |
| **Suggestion events** | Audit log of every scoring decision (13-layer breakdown) | Yes — note paths, entity names |
| **Vault metrics** | Aggregate counts (notes, links, entities, accuracy) over time | No — just numbers |
| **Performance benchmarks** | Search latency, index timing, watcher pipeline | No — just timing data |
| **Co-occurrence index** | Which entities appear together across notes | Yes — entity names |
| **Edge weights** | Link strength based on survival and feedback | Yes — note paths |

The first two groups are where the learning happens. The last two are aggregate statistics that contain no identifying information.

## What's safe to share

### `flywheel_calibration_export` (recommended)

Purpose-built for cross-vault sharing. The export contains:

- **Vault profile** — size bucket (e.g. "500-999"), not exact count. Link density, strictness mode, flywheel age
- **Entity distribution** — counts per category (person: 45, project: 12), no names
- **Suggestion funnel** — evaluations → applications → survivals, with rates
- **Layer contributions** — average score per scoring layer, which layers contribute most
- **Score distribution** — histogram in 5-point bins, mean and median
- **Survival by category** — which entity types stick and which get removed
- **Feedback stats** — explicit vs. implicit counts, accuracy rates
- **Suppression stats** — how many entities are auto-suppressed
- **Threshold analysis** — pass rates at different score thresholds

What it **does not** contain: entity names, note paths, note content, file names, tag names, or anything that identifies your vault's subject matter. An optional `vault_id` (SHA-256 hash of your vault path, truncated) lets you track your own exports over time without revealing the path.

### Also safe

- **`vault_growth`** — aggregate metrics (note count, link density, connected ratio). Numbers only.
- **`flywheel_benchmark`** — search latency, index timing. Performance data only.

### Review before sharing

- **`flywheel_learning_report`** — includes entity names in the "top rejected" section. Entity names could be people, clients, or other sensitive identifiers. Safe if your vault is non-sensitive; review the output first if it is.

### Never share

- **Raw `.flywheel/state.db`** — contains note paths, content snippets, entity names, and the full audit trail. Treat it like your vault itself.

## How to export

Ask your AI client:

> Run `flywheel_calibration_export` with `days_back` set to 30.

Or for a longer analysis window:

> Run `flywheel_calibration_export` with `days_back` 90 and `include_vault_id` true.

The output is a JSON object. Copy it.

## How to share

Post your calibration export in the [**Calibration Data** discussion category](https://github.com/velvetmonkey/flywheel-memory/discussions/categories/calibration-data) on GitHub.

**Suggested title format:**

```
[calibration] <size_bucket> / <days> days / v<version>
```

Example: `[calibration] 1000-2499 / 30 days / v2.0.145`

Paste the JSON in the body. Add any observations you have — what's working, what's surprising, what entity categories your vault focuses on. Context helps us interpret the numbers.

## Why share

Every vault is different. A personal journal, a software project, a research corpus — they have different entity distributions, different link densities, different feedback patterns. Calibration exports help us:

- **Tune default thresholds** — is the default strictness right for vaults your size?
- **Balance layer weights** — which scoring layers matter most across different vault types?
- **Spot category-specific issues** — do certain entity types (people, projects, technologies) have systematically different survival rates?
- **Track improvement** — are newer versions actually better across real vaults?

Your data is anonymous. Your vault stays local. The aggregate patterns help everyone.

## Privacy architecture

For the full security model, see [SECURITY.md](../SECURITY.md). The key guarantees:

- **Local-only storage** — all data in `.flywheel/state.db` on your machine
- **Zero telemetry** — no phone-home, no analytics, no tracking. Enforced by CI
- **One network exception** — `@huggingface/transformers` model download (~23MB, one-time, for semantic search). No vault data is sent
- **Calibration export is opt-in** — you choose what to share, when, and where
