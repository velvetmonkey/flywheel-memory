#!/usr/bin/env bash
# End-to-end LoCoMo retrieval benchmark
#
# Runs LoCoMo questions through Claude with Flywheel MCP tools (default preset),
# then analyzes evidence recall and answer quality.
#
# Usage:
#   demos/locomo/run-benchmark.sh                              # default: all questions, sonnet, dialog mode
#   COUNT=50 demos/locomo/run-benchmark.sh                     # subset of questions
#   MODEL=opus MODE=summary demos/locomo/run-benchmark.sh      # use opus, summary vault mode

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
MCP_SERVER="$REPO_DIR/packages/mcp-server/dist/index.js"
VAULT_DIR="$SCRIPT_DIR/vault"
GROUND_TRUTH="$SCRIPT_DIR/ground-truth.json"
MODEL="${MODEL:-sonnet}"
COUNT="${COUNT:-695}"  # Default: 695 balanced questions (matches Mem0 competition paper)
MODE="${MODE:-dialog}"
SEED="${SEED:-42}"
JUDGE="${JUDGE:-1}"
JUDGE_MODEL="${JUDGE_MODEL:-haiku}"
ANSWER_EXTRACT="${ANSWER_EXTRACT:-1}"
EXTRACT_MODEL="${EXTRACT_MODEL:-haiku}"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
RESULTS_DIR="${RESUME:-$SCRIPT_DIR/results/run-$TIMESTAMP}"

# Pre-flight
if [[ ! -f "$MCP_SERVER" ]]; then
  echo "ERROR: MCP server not built. Run: cd $REPO_DIR && npm run build"
  exit 1
fi

# Build vault if not present or mode changed
if [[ ! -d "$VAULT_DIR" || ! -f "$GROUND_TRUTH" ]]; then
  echo "Building LoCoMo vault (mode=$MODE)..."
  node "$SCRIPT_DIR/build-vault.js" --mode "$MODE"
fi

# Build balanced sample indices
TOTAL_QUESTIONS=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['count'])")
if [[ "$COUNT" -eq 0 || "$COUNT" -gt "$TOTAL_QUESTIONS" ]]; then
  COUNT=$TOTAL_QUESTIONS
fi

INDICES_FILE="$RESULTS_DIR/indices.json"
mkdir -p "$RESULTS_DIR/raw" "$RESULTS_DIR/answers"

# Stratified sampling: equal per category, spread across conversations
if [[ -n "${RESUME:-}" ]] && [[ -f "$INDICES_FILE" ]]; then
  echo "Resuming — reusing existing indices"
  python3 -c "
import json
from collections import Counter
gt = json.load(open('$GROUND_TRUTH'))
questions = gt['questions']
indices = json.load(open('$INDICES_FILE'))
print(f'Sampled {len(indices)} questions across {len(set(questions[i][\"category\"] for i in indices))} categories')
dist = Counter(questions[i]['category'] for i in indices)
for cat, n in sorted(dist.items()):
    print(f'  {cat}: {n}')
"
else
python3 -c "
import json, random
random.seed(${SEED})
gt = json.load(open('$GROUND_TRUTH'))
questions = gt['questions']
count = $COUNT

if count >= len(questions):
    indices = list(range(len(questions)))
else:
    # Group by category
    by_cat = {}
    for i, q in enumerate(questions):
        cat = q['category']
        by_cat.setdefault(cat, []).append(i)

    # Shuffle within each category
    for cat in by_cat:
        random.shuffle(by_cat[cat])

    # Round-robin across categories
    indices = []
    cats = sorted(by_cat.keys())
    per_cat = max(1, count // len(cats))
    for cat in cats:
        indices.extend(by_cat[cat][:per_cat])
    # Fill remainder from largest categories
    remaining = count - len(indices)
    for cat in cats:
        if remaining <= 0:
            break
        extra = by_cat[cat][per_cat:per_cat + remaining]
        indices.extend(extra)
        remaining -= len(extra)
    indices = sorted(indices[:count])

json.dump(indices, open('$INDICES_FILE', 'w'))
print(f'Sampled {len(indices)} questions across {len(set(questions[i][\"category\"] for i in indices))} categories')
# Show distribution
from collections import Counter
dist = Counter(questions[i]['category'] for i in indices)
for cat, n in sorted(dist.items()):
    print(f'  {cat}: {n}')
"
fi

echo ""
echo "=== LoCoMo End-to-End Benchmark ==="
echo "Questions:     $COUNT / $TOTAL_QUESTIONS (balanced)"
echo "Model:         $MODEL"
echo "Vault mode:    $MODE"
echo "Results:       $RESULTS_DIR"
echo ""

# MCP config — default preset (search, memory, brief tools for conversational memory)
mcp_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$VAULT_DIR"}}}}
EOF
)

# Pre-warm: ensure vault is fully indexed + embeddings built before questions start
# Uses full preset (health_check, refresh_index, init_semantic) for bootstrap
warmup_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$VAULT_DIR","FLYWHEEL_TOOLS":"full,memory"}}}}
EOF
)

if [[ -n "${RESUME:-}" ]] && [[ -f "$RESULTS_DIR/warmup.jsonl" ]]; then
  echo "Resuming — skipping warmup (already done)"
else
echo "Pre-warming vault: index + auto-link + embeddings..."
if claude -p "Bootstrap this vault for benchmarking. Run these steps in order:
1. Call health_check — report entity_count and note_count.
2. Call vault_init with mode='enrich' and dry_run=false to auto-link all notes with wikilinks.
3. Call refresh_index to re-index with the new wikilinks.
4. Call init_semantic to build embeddings. Wait for completion.
5. Call health_check — confirm fts5_ready=true and embeddings_ready=true.
Report final status with entity_count, note_count, and embeddings_ready." \
  --output-format stream-json \
  --no-session-persistence \
  --permission-mode bypassPermissions \
  --mcp-config <(echo "$warmup_config") \
  --strict-mcp-config \
  --model haiku \
  > "$RESULTS_DIR/warmup.jsonl" 2>"$RESULTS_DIR/warmup.stderr"; then
  echo "Vault pre-warmed (index + auto-link + embeddings)"
else
  echo "WARNING: Pre-warm failed (exit $?) — continuing anyway"
fi
fi
echo ""

# Read indices
INDICES=$(python3 -c "import json; print(' '.join(str(i) for i in json.load(open('$INDICES_FILE'))))")
QNUM=0

for i in $INDICES; do
  padded=$(printf "%04d" "$i")
  question=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['questions'][$i]['question'])")
  category=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['questions'][$i]['category'])")

  echo -n "  q${padded} [${category}]: "

  # Resume support: skip questions with existing answer artifact
  answer_artifact="$RESULTS_DIR/answers/q${padded}.json"
  existing="$RESULTS_DIR/raw/q${padded}.jsonl"
  if [[ -f "$answer_artifact" ]]; then
    echo "skip (exists)"
    continue
  fi

  # Run question (or skip if JSONL already exists from a pre-answer-layer run)
  if [[ -f "$existing" ]] && [[ $(wc -l < "$existing") -gt 1 ]]; then
    echo -n "reuse... "
  elif timeout 180 claude -p "You are answering questions about conversations stored in this vault.
Each note is one session of a multi-session conversation between two people.
Use the Flywheel MCP tools (search, get_note_structure, get_section_content, find_sections).
After searching, read relevant session notes with get_note_structure to find evidence.
For multi-hop questions, search again using details from what you've read.

Question: $question

After searching, provide your answer in this exact format:
ANSWER: <your concise factual answer>

- Put ONLY the factual answer after ANSWER: — no reasoning, no search explanation
- If the information is not in the vault: ANSWER: Not stated in the vault." \
    --output-format stream-json \
    --no-session-persistence \
    --permission-mode bypassPermissions \
    --mcp-config <(echo "$mcp_config") \
    --strict-mcp-config \
    --disallowedTools "ToolSearch,Agent,Bash,Glob,Grep,Read,WebSearch,WebFetch" \
    --model "$MODEL" \
    > "$RESULTS_DIR/raw/q${padded}.jsonl" 2>"$RESULTS_DIR/raw/q${padded}.stderr"; then
    echo -n "answered... "
  else
    echo "FAILED (exit $?)"
    continue
  fi

  # Extract and persist answer artifact
  if [[ "${ANSWER_EXTRACT}" == "1" ]]; then
    python3 "$SCRIPT_DIR/../lib/answer_layer.py" extract \
      --jsonl "$RESULTS_DIR/raw/q${padded}.jsonl" \
      --question "$question" \
      --index "$i" \
      --category "$category" \
      --model "$EXTRACT_MODEL" \
      --output "$answer_artifact" 2>&1 | tr '\n' ' '
  fi
  echo "done"
done

echo ""
echo "=== All questions complete ==="
echo ""

# Run analysis
if [[ -f "$SCRIPT_DIR/analyze-benchmark.py" ]]; then
  echo "Running analysis..."
  python3 "$SCRIPT_DIR/analyze-benchmark.py" "$RESULTS_DIR" "$GROUND_TRUTH" \
    ${JUDGE:+--judge --judge-model "$JUDGE_MODEL"}
fi
