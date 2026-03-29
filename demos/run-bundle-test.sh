#!/usr/bin/env bash
# Bundle adoption test runner — tests all 12 tool bundles against carter-strategy vault.
#
# Usage:
#   demos/run-bundle-test.sh                  # default: 3 runs, sonnet model
#   RUNS=5 MODEL=opus demos/run-bundle-test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_SERVER="$REPO_ROOT/packages/mcp-server/dist/index.js"
DEMO_DIR="$SCRIPT_DIR/carter-strategy"
RUNS=${RUNS:-3}
MODEL=${MODEL:-sonnet}
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
RESULTS_DIR="$SCRIPT_DIR/test-results/bundle-$TIMESTAMP"

# Bundle definitions: name|FLYWHEEL_TOOLS|prompt|resets(yes/no)
BUNDLES=(
  'search|default|How much have I billed Acme Corp?|no'
  'read|default|Show me the full content and structure of the Acme Corp client note|no'
  'write|default|Add a line under Notes in the Acme Corp file saying '\''Reviewed Q1 billing with Sarah'\''|yes'
  'graph|default,graph|How are Acme Corp and Sarah Mitchell connected? Trace the relationship paths.|no'
  'schema|default,schema|Analyze the frontmatter conventions in this vault. Are all client notes using consistent fields?|no'
  'wikilinks|default,wikilinks|What entities in my vault should be linked but currently aren'\''t?|no'
  'corrections|default,corrections|Record a correction: the link '\''Data Migration'\'' should point to '\''Acme Data Migration'\''|yes'
  'tasks|default|What are all my open tasks across the vault?|no'
  'memory|default,memory|Brief me on the current state of this vault|no'
  'note-ops|default,note-ops|Rename '\''Quarterly Review Q4 2025'\'' to '\''Q4 2025 Quarterly Review'\''|yes'
  'temporal|default,temporal|What'\''s changed in this vault recently? Any stale notes?|no'
  'diagnostics|default,diagnostics|Run a health check on this vault and show me the stats|no'
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

if [[ ! -d "$DEMO_DIR" ]]; then
  echo "ERROR: carter-strategy demo not found at $DEMO_DIR"
  exit 1
fi

mkdir -p "$RESULTS_DIR/raw"

echo "=== Bundle Adoption Test ==="
echo "Model:       $MODEL"
echo "Runs/bundle: $RUNS"
echo "Bundles:     ${#BUNDLES[@]}"
echo "Total:       $((${#BUNDLES[@]} * RUNS)) runs"
echo "Output:      $RESULTS_DIR"
echo ""

completed=0
total=$((${#BUNDLES[@]} * RUNS))

for entry in "${BUNDLES[@]}"; do
  IFS='|' read -r name tools_env prompt resets <<< "$entry"

  echo "--- Bundle: $name (FLYWHEEL_TOOLS=$tools_env) ---"

  # Delete state.db between bundles to prevent state accumulation
  rm -f "$DEMO_DIR/.flywheel/state.db" "$DEMO_DIR/.flywheel/state.db-wal" "$DEMO_DIR/.flywheel/state.db-shm"

  # Build MCP config for this bundle
  mcp_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$DEMO_DIR","FLYWHEEL_TOOLS":"$tools_env"}}}}
EOF
  )

  for run in $(seq 1 "$RUNS"); do
    out="$RESULTS_DIR/raw/${name}_run${run}.jsonl"
    completed=$((completed + 1))
    echo "  [$completed/$total] $name run $run/$RUNS..."

    cd "$DEMO_DIR"
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

    # Reset vault for write bundles
    if [[ "$resets" == "yes" ]]; then
      cd "$DEMO_DIR"
      git checkout -- . 2>/dev/null || true
      git clean -fd 2>/dev/null || true
    fi

    sleep 3  # rate limiting buffer
  done
done

echo ""
echo "All runs complete. Analyzing..."

if python3 "$SCRIPT_DIR/analyze-bundle-test.py" "$RESULTS_DIR"; then
  echo ""
  echo "Report: $RESULTS_DIR/report.md"
else
  echo "WARN: Analysis failed — raw results at $RESULTS_DIR/raw/"
fi
