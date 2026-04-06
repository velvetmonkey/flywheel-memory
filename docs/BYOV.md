# BYOV (Bring Your Own Vault) Evaluation Guide

[← Back to docs](README.md)

Measure how well flywheel-memory retrieves information from your specific vault. This guide covers writing test questions, running the evaluation, and interpreting the results.

- [Why evaluate on your own vault](#why-evaluate-on-your-own-vault)
- [Question format](#question-format)
- [Running the evaluation](#running-the-evaluation)
- [Interpreting results](#interpreting-results)
- [Tips for writing good test questions](#tips-for-writing-good-test-questions)

## Why evaluate on your own vault

Generic benchmarks (HotpotQA, LoCoMo) measure retrieval in controlled settings. BYOV evaluation answers a different question: **does search work well for your notes, your terminology, and your structure?**

Common findings from BYOV evaluation:

- Notes with sparse frontmatter rank lower than expected
- Uncommon terminology needs aliases to surface reliably
- Folder-heavy vaults benefit from path-aware queries

## Question format

Questions live in a JSONL file (one JSON object per line):

```json
{"question": "Who is the lead on Project Alpha?", "expected_notes": ["projects/alpha.md"], "expected_keywords": ["lead", "manager"]}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `question` | Yes | Natural-language query to send to the search tool |
| `expected_notes` | Yes | Array of vault-relative paths that should appear in results |
| `expected_keywords` | No | Array of keywords that should appear in the result text |

### Path matching rules

- Exact path: `"clients/acme.md"` matches any result whose path contains `clients/acme.md` (case-insensitive)
- Folder prefix: `"meetings/"` matches any result under the meetings folder
- Partial filename: `"acme.md"` matches `clients/acme.md` or `archive/acme.md`

## Running the evaluation

### Option 1: Template script (recommended)

```bash
cd demos/byov-template
VAULT_PATH=/path/to/vault ./run-eval.sh my-questions.jsonl
```

The script starts a flywheel-memory HTTP server, runs the evaluation, writes `results.json`, and prints a summary.

### Option 2: Manual setup

Start the server:

```bash
VAULT_PATH=/path/to/vault FLYWHEEL_TRANSPORT=http FLYWHEEL_HTTP_PORT=3111 \
  npx -y @velvetmonkey/flywheel-memory
```

Run the CLI:

```bash
npx tsx packages/bench/src/cli/byov.ts \
  --questions path/to/questions.jsonl \
  --output results.json \
  --url http://localhost:3111
```

### CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--questions <path>` | (required) | Path to JSONL questions file |
| `--output <path>` | stdout | Path for JSON report output |
| `--url <url>` | `http://localhost:3111` | Server base URL |
| `--timeout <ms>` | `30000` | Max time to wait for server health check |

## Interpreting results

The output is a JSON report:

```json
{
  "summary": {
    "total_questions": 10,
    "evidence_recall": 0.80,
    "keyword_recall": 0.90,
    "timestamp": "2026-04-06T12:00:00.000Z"
  },
  "questions": [...]
}
```

### Metrics

- **evidence_recall** — Average fraction of expected notes found across all questions. 1.0 means every expected note appeared in search results for every question.
- **keyword_recall** — Average fraction of expected keywords found in result text. Measures whether the right content is surfaced, not just the right files.
- **note_recall** (per question) — Fraction of that question's expected notes that were found.
- **keyword_recall** (per question) — Fraction of that question's expected keywords found in the response.

### Benchmarks

| Score | Interpretation |
|-------|---------------|
| 0.9+ | Excellent retrieval for your vault |
| 0.7-0.9 | Good, but some questions may need tuning or vault notes may need richer metadata |
| < 0.7 | Investigate: check frontmatter, aliases, and whether expected notes contain the queried terms |

## Tips for writing good test questions

1. **Start with real queries.** Think about what you actually search for in your vault. Those make the best test cases.

2. **Mix specificity levels.** Include both precise questions ("What is Acme Corp's billing address?") and broad ones ("What are my current priorities?").

3. **Use folder prefixes for broad expectations.** If any meeting note is acceptable, use `"meetings/"` rather than listing every file.

4. **Keep expected_notes realistic.** Expect 1-3 notes per question. If a question could match 20 notes, it is too broad to score meaningfully.

5. **Choose keywords that indicate understanding.** Pick terms that appear in the relevant content but are not so common they appear everywhere.

6. **Include at least 10-20 questions** for a meaningful aggregate score. Five questions can swing wildly on a single miss.

7. **Iterate.** Run the evaluation, review which questions scored 0, and decide whether the question or the vault content needs adjustment.
