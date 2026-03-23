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

# Read question count
TOTAL_QUESTIONS=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['count'])")
if [[ "$COUNT" -eq 0 || "$COUNT" -gt "$TOTAL_QUESTIONS" ]]; then
  COUNT=$TOTAL_QUESTIONS
fi

echo ""
echo "=== LoCoMo End-to-End Benchmark ==="
echo "Questions:     $COUNT / $TOTAL_QUESTIONS"
echo "Model:         $MODEL"
echo "Vault mode:    $MODE"
echo "Results:       $RESULTS_DIR"
echo ""

# MCP config — agent preset (recall, memory, brief tools for conversational memory)
mcp_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$VAULT_DIR","FLYWHEEL_TOOLS":"agent"}}}}
EOF
)

mkdir -p "$RESULTS_DIR/raw"

for i in $(seq 0 $((COUNT - 1))); do
  padded=$(printf "%03d" "$i")
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
