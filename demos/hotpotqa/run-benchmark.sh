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

# MCP config — default preset (18 tools: search, read, write, tasks, memory)
mcp_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$VAULT_DIR","FLYWHEEL_TOOLS":"default"}}}}
EOF
)

mkdir -p "$RESULTS_DIR/raw"

# Pre-warm: ensure vault is fully indexed + embeddings built before questions start
warmup_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$VAULT_DIR","FLYWHEEL_TOOLS":"full"}}}}
EOF
)

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
echo ""

# Run each question individually (not piped, to avoid stdin issues)
for i in $(seq 0 $((QUESTION_COUNT - 1))); do
  padded=$(printf "%03d" "$i")
  question=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['questions'][$i]['question'])")
  qid=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['questions'][$i]['id'])")

  echo -n "  q${padded}: "

  if claude -p "Answer this question using the Flywheel MCP tools (search, get_note_structure, get_section_content, find_sections).
After searching, read the most relevant notes with get_note_structure to find the answer.
For multi-hop questions, search again using information from the first document to find the second.
Be concise.

$question" \
    --output-format stream-json \
    --no-session-persistence \
    --permission-mode bypassPermissions \
    --mcp-config <(echo "$mcp_config") \
    --strict-mcp-config \
    --disallowedTools "ToolSearch,Agent,Bash,Glob,Grep,Read,WebSearch,WebFetch" \
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
