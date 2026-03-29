#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_SERVER="$REPO_ROOT/packages/mcp-server/dist/index.js"
RUNS=${RUNS:-3}
MODEL=${MODEL:-sonnet}
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
RESULTS_DIR="$SCRIPT_DIR/test-results/$TIMESTAMP"

# Demo name | prompt (from each demo's README)
DEMOS=(
  "carter-strategy|How much have I billed Acme Corp?"
  "artemis-rocket|What's blocking propulsion?"
  "startup-ops|What's our MRR?"
  "nexus-lab|How does AlphaFold connect to my experiment?"
  "solo-operator|How's revenue looking?"
  "support-desk|What's Sarah Chen's situation?"
  "zettelkasten|How does spaced repetition connect to active recall?"
)

# Pre-flight checks
if [[ ! -f "$MCP_SERVER" ]]; then
  echo "ERROR: MCP server not built. Run: cd $REPO_ROOT && npm run build"
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo "ERROR: claude CLI not found"
  exit 1
fi

mkdir -p "$RESULTS_DIR/raw"

echo "=== Tool-Usage Test ==="
echo "Model:     $MODEL"
echo "Runs/demo: $RUNS"
echo "Demos:     ${#DEMOS[@]}"
echo "Total:     $((${#DEMOS[@]} * RUNS)) runs"
echo "Output:    $RESULTS_DIR"
echo ""

completed=0
total=$((${#DEMOS[@]} * RUNS))

for entry in "${DEMOS[@]}"; do
  IFS='|' read -r name prompt <<< "$entry"
  demo_dir="$SCRIPT_DIR/$name"

  if [[ ! -d "$demo_dir" ]]; then
    echo "WARN: demo dir not found: $demo_dir — skipping"
    continue
  fi

  # Build per-demo MCP config pointing to local build
  mcp_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$demo_dir"}}}}
EOF
  )

  for run in $(seq 1 "$RUNS"); do
    out="$RESULTS_DIR/raw/${name}_run${run}.jsonl"
    completed=$((completed + 1))
    echo "[$completed/$total] $name run $run/$RUNS..."

    cd "$demo_dir"
    timeout 120 claude -p "$prompt" \
      --output-format stream-json \
      --verbose \
      --no-session-persistence \
      --permission-mode bypassPermissions \
      --mcp-config <(echo "$mcp_config") \
      --strict-mcp-config \
      --model "$MODEL" \
      2>"${out%.jsonl}.stderr" > "$out" || true

    if [[ ! -s "$out" ]]; then
      echo "  WARN: empty output for $name run $run — check ${out%.jsonl}.stderr"
    fi

    sleep 3  # rate limiting buffer
  done
done

echo ""
echo "All runs complete. Analyzing..."

if python3 "$SCRIPT_DIR/analyze-tool-test.py" "$RESULTS_DIR" > "$RESULTS_DIR/report.md" 2>&1; then
  echo "Report: $RESULTS_DIR/report.md"
  echo ""
  cat "$RESULTS_DIR/report.md"
else
  echo "WARN: Analysis script failed — raw results at $RESULTS_DIR/raw/"
fi
