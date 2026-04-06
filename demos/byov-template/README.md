# BYOV Evaluation Template

Evaluate flywheel-memory's search quality against your own Obsidian vault.

## How it works

1. Start a flywheel-memory HTTP server pointed at your vault
2. Feed it questions with expected answers (notes and keywords)
3. Get a scored report showing evidence recall and keyword recall

## Writing questions

Create a `.jsonl` file where each line is a JSON object:

```json
{"question": "What is the project timeline?", "expected_notes": ["projects/timeline.md"], "expected_keywords": ["deadline", "milestone"]}
```

- **question** — A natural-language query you'd ask about your vault
- **expected_notes** — Paths (relative to vault root) that should appear in results. Trailing `/` matches any file under that folder
- **expected_keywords** — Words that should appear somewhere in the search result text

See `questions-example.jsonl` for a working example targeting the carter-strategy demo vault.

## Running

```bash
VAULT_PATH=/path/to/your/vault ./run-eval.sh questions.jsonl
```

Or run manually:

```bash
# Terminal 1: start server
VAULT_PATH=/path/to/vault FLYWHEEL_TRANSPORT=http npx -y @velvetmonkey/flywheel-memory

# Terminal 2: run eval
npx tsx ../../packages/bench/src/cli/byov.ts --questions questions.jsonl --output results.json
```

## Interpreting results

- **evidence_recall** — Fraction of expected notes found in search results (0.0-1.0)
- **keyword_recall** — Fraction of expected keywords found in result text (0.0-1.0)
- Per-question breakdown shows exactly which notes and keywords were matched

A score of 0.8+ on evidence recall indicates strong retrieval. Keyword recall below 0.7 may suggest the vault needs richer content or the questions need adjustment.
