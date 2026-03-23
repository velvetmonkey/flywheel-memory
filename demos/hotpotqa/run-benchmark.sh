#!/usr/bin/env bash
# End-to-end HotpotQA retrieval benchmark
#
# Runs each HotpotQA question through Claude with Flywheel MCP tools,
# then analyzes whether the supporting documents were found.
#
# Usage:
#   demos/hotpotqa/run-benchmark.sh                    # default: 50 questions, sonnet
#   COUNT=20 demos/hotpotqa/run-benchmark.sh           # fewer questions (faster/cheaper)
#   MODEL=opus demos/hotpotqa/run-benchmark.sh         # use opus

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
MCP_SERVER="$REPO_DIR/packages/mcp-server/dist/index.js"
VAULT_DIR="$SCRIPT_DIR/vault"
GROUND_TRUTH="$SCRIPT_DIR/ground-truth.json"
MODEL="${MODEL:-sonnet}"
COUNT="${COUNT:-50}"
SEED="${SEED:-42}"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
RESULTS_DIR="$SCRIPT_DIR/results/run-$TIMESTAMP"

# Pre-flight
if [[ ! -f "$MCP_SERVER" ]]; then
  echo "ERROR: MCP server not built. Run: cd $REPO_DIR && npm run build"
  exit 1
fi

# Build vault if not present
if [[ ! -d "$VAULT_DIR" || ! -f "$GROUND_TRUTH" ]]; then
  echo "Building HotpotQA vault (count=$COUNT, seed=$SEED)..."
  node "$SCRIPT_DIR/build-vault.js" --count "$COUNT" --seed "$SEED"
fi

# Read question count and questions into arrays
QUESTION_COUNT=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['count'])")

echo ""
echo "=== HotpotQA End-to-End Benchmark ==="
echo "Questions: $QUESTION_COUNT"
echo "Model:     $MODEL"
echo "Results:   $RESULTS_DIR"
echo ""

# MCP config — default preset (16 tools: search, read, write, tasks)
mcp_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$VAULT_DIR","FLYWHEEL_TOOLS":"default"}}}}
EOF
)

mkdir -p "$RESULTS_DIR/raw"

# Run each question individually (not piped, to avoid stdin issues)
for i in $(seq 0 $((QUESTION_COUNT - 1))); do
  padded=$(printf "%03d" "$i")
  question=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['questions'][$i]['question'])")
  qid=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['questions'][$i]['id'])")

  echo -n "  q${padded}: "

  if claude -p "Answer this question using only the Flywheel MCP tools (search, get_note_structure, etc). Do not use WebSearch, WebFetch, or ToolSearch. Be concise.

$question" \
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
