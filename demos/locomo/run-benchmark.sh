#!/usr/bin/env bash
# End-to-end LoCoMo retrieval benchmark
#
# Runs LoCoMo questions through Claude with Flywheel MCP tools (agent preset),
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
COUNT="${COUNT:-0}"  # 0 = all
MODE="${MODE:-dialog}"
SEED="${SEED:-42}"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
RESULTS_DIR="$SCRIPT_DIR/results/run-$TIMESTAMP"

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
mkdir -p "$RESULTS_DIR/raw"

# Stratified sampling: equal per category, spread across conversations
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

echo ""
echo "=== LoCoMo End-to-End Benchmark ==="
echo "Questions:     $COUNT / $TOTAL_QUESTIONS (balanced)"
echo "Model:         $MODEL"
echo "Vault mode:    $MODE"
echo "Results:       $RESULTS_DIR"
echo ""

# MCP config — agent preset (recall, memory, brief tools for conversational memory)
mcp_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$VAULT_DIR","FLYWHEEL_TOOLS":"agent"}}}}
EOF
)

# Read indices
INDICES=$(python3 -c "import json; print(' '.join(str(i) for i in json.load(open('$INDICES_FILE'))))")
QNUM=0

for i in $INDICES; do
  padded=$(printf "%04d" "$i")
  question=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['questions'][$i]['question'])")
  category=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['questions'][$i]['category'])")

  echo -n "  q${padded} [${category}]: "

  if claude -p "You are answering questions about conversations stored in this vault.
Each note represents one session of a conversation between two people.
Use the recall and search tools to find relevant information.
If the information cannot be found in the vault, say \"no information available\".

Question: $question

Answer concisely in one or two sentences." \
    --output-format stream-json \
    --no-session-persistence \
    --permission-mode bypassPermissions \
    --mcp-config <(echo "$mcp_config") \
    --strict-mcp-config \
    --model "$MODEL" \
    > "$RESULTS_DIR/raw/q${padded}.jsonl" 2>"$RESULTS_DIR/raw/q${padded}.stderr"; then
    echo "done"
  else
    echo "FAILED (exit $?)"
  fi
done

echo ""
echo "=== All questions complete ==="
echo ""

# Run analysis
if [[ -f "$SCRIPT_DIR/analyze-benchmark.py" ]]; then
  echo "Running analysis..."
  python3 "$SCRIPT_DIR/analyze-benchmark.py" "$RESULTS_DIR" "$GROUND_TRUTH"
fi
