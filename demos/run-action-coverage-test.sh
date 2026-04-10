#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_SERVER="$REPO_ROOT/packages/mcp-server/dist/index.js"
PROMPTS_FILE="$SCRIPT_DIR/action-coverage-prompts.json"
DEMO_DIR="$SCRIPT_DIR/carter-strategy"
MODEL="${MODEL:-sonnet}"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
RESULTS_DIR="$SCRIPT_DIR/test-results/action-coverage-$TIMESTAMP"
FILTER="${FILTER:-}"  # Optional: only run prompts matching this regex on id

# Pre-flight
if [[ ! -f "$MCP_SERVER" ]]; then
  echo "ERROR: MCP server not built. Run: cd $REPO_ROOT && npm run build"
  exit 1
fi
if ! command -v claude &>/dev/null; then
  echo "ERROR: claude CLI not found"
  exit 1
fi
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq not found"
  exit 1
fi

mkdir -p "$RESULTS_DIR/raw"

# State reset — prior runs leave behind mutated vault files and Claude Code
# auto-memory entries that shadow fresh tool calls. Without this, tests like
# memory_store and entity_dismiss_merge silently pass against stale state from
# previous runs instead of exercising the MCP tool surface.
echo "Resetting demo vault and Claude auto-memory to clean state..."
if [[ -d "$DEMO_DIR/.git" ]]; then
  git -C "$DEMO_DIR" checkout -- . 2>/dev/null || true
  git -C "$DEMO_DIR" clean -fd 2>/dev/null || true
fi
rm -rf "$HOME/.claude/projects/-home-ben-src-flywheel-memory-demos-carter-strategy"

# Parse prompts
total=$(jq '.prompts | length' "$PROMPTS_FILE")
echo "=== T43 Action-Coverage Test ==="
echo "Model:   $MODEL"
echo "Prompts: $total"
echo "Vault:   $DEMO_DIR"
echo "Output:  $RESULTS_DIR"
if [[ -n "$FILTER" ]]; then
  echo "Filter:  $FILTER"
fi
echo ""

# MCP config — agent preset (the shipping default). Tests measure what real
# users see, not a configuration we never deploy.
mcp_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$DEMO_DIR","FLYWHEEL_TOOLS":"agent"}}}}
EOF
)

passed=0
failed=0
skipped=0
completed=0

# Results accumulator
results_json="[]"

for i in $(seq 0 $((total - 1))); do
  id=$(jq -r ".prompts[$i].id" "$PROMPTS_FILE")
  tool=$(jq -r ".prompts[$i].tool" "$PROMPTS_FILE")
  action=$(jq -r ".prompts[$i].action // empty" "$PROMPTS_FILE")
  prompt=$(jq -r ".prompts[$i].prompt" "$PROMPTS_FILE")
  skip_when_claude=$(jq -r ".prompts[$i].skip_when_claude // false" "$PROMPTS_FILE")

  # Apply filter
  if [[ -n "$FILTER" ]] && ! echo "$id" | grep -qE "$FILTER"; then
    skipped=$((skipped + 1))
    continue
  fi

  # Skip prompts marked as unreachable from Claude Code (memory-plane collision).
  # The server suppresses the `memory` tool when CLAUDECODE=1, so tests for its
  # sub-actions have nothing to route to. Override with FW_ENABLE_MEMORY_FOR_CLAUDE=1.
  if [[ "$skip_when_claude" == "true" && "${FW_ENABLE_MEMORY_FOR_CLAUDE:-0}" != "1" ]]; then
    printf "[--] %-35s SKIP (memory suppressed for Claude Code)\n" "$id"
    skipped=$((skipped + 1))
    continue
  fi

  completed=$((completed + 1))
  out="$RESULTS_DIR/raw/${id}.jsonl"
  printf "[%d] %-35s " "$completed" "$id"

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
    echo "ERROR (empty output)"
    failed=$((failed + 1))
    results_json=$(echo "$results_json" | jq --arg id "$id" --arg tool "$tool" --arg action "$action" \
      '. + [{"id": $id, "tool": $tool, "action": $action, "status": "error", "tools_called": [], "reason": "empty output"}]')
    continue
  fi

  # Extract tool calls with their arguments
  tools_called=$(python3 -c "
import json, sys
tools = []
with open('$out') as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            obj = json.loads(line)
        except: continue
        if obj.get('type') == 'assistant':
            for block in obj.get('message', {}).get('content', []):
                if isinstance(block, dict) and block.get('type') == 'tool_use':
                    name = block['name'].replace('mcp__flywheel__', '')
                    args = block.get('input', {})
                    act = args.get('action', args.get('mode', ''))
                    tools.append({'name': name, 'action': str(act)})
json.dump(tools, sys.stdout)
" 2>/dev/null || echo "[]")

  # Check if expected tool was called
  tool_match=$(echo "$tools_called" | python3 -c "
import json, sys
tools = json.load(sys.stdin)
target_tool = '$tool'
target_action = '$action'
# Merged action-param tools where any sub-action should count as a pass.
# Rationale: exploratory calls ('list' before 'validate') are natural LLM
# behaviour. We care that the agent chose the merged tool, not the sub-action.
LENIENT_MERGED = {'policy', 'entity', 'schema', 'insights', 'graph', 'link', 'correct', 'tasks', 'memory', 'note'}
# Check both merged and standalone tool names
for t in tools:
    if t['name'] == target_tool:
        if not target_action or t['action'] == target_action or t['action'] == '':
            # Empty action from model = tool called without action param (implicit default)
            print('exact')
            sys.exit(0)
        if target_tool in LENIENT_MERGED:
            # Any sub-action on a merged tool is acceptable — agent picked the right tool
            print('exact')
            sys.exit(0)
# Also check standalone equivalents
aliases = {
    'link': ['suggest_wikilinks', 'wikilink_feedback', 'validate_links', 'discover_stub_candidates', 'discover_cooccurrence_gaps', 'suggest_entity_aliases'],
    'correct': ['vault_record_correction', 'vault_list_corrections', 'vault_resolve_correction', 'vault_undo_last_mutation'],
    'entity': ['list_entities', 'absorb_as_alias', 'suggest_entity_aliases', 'merge_entities', 'suggest_entity_merges', 'dismiss_merge_suggestion'],
    'schema': ['vault_schema', 'schema_conventions', 'schema_validate', 'rename_field', 'rename_tag', 'migrate_field_values', 'get_folder_structure'],
    'graph': ['graph_analysis', 'get_backlinks', 'get_forward_links', 'get_strong_connections', 'get_link_path', 'get_common_neighbors', 'get_connection_strength', 'discover_cooccurrence_gaps'],
    'insights': ['track_concept_evolution', 'predict_stale_notes', 'get_context_around_date', 'note_intelligence', 'vault_growth'],
    'note': ['vault_create_note', 'vault_move_note', 'vault_rename_note', 'vault_delete_note'],
    'search': ['find_similar'],
    'memory': ['brief'],
    'tasks': ['vault_add_task', 'vault_toggle_task'],
}
# Reverse: standalone -> merged
reverse = {}
for merged, standalones in aliases.items():
    for s in standalones:
        reverse[s] = merged
for t in tools:
    # If target is merged, accept standalone equivalents
    if target_tool in aliases and t['name'] in aliases[target_tool]:
        print('alias')
        sys.exit(0)
    # If target is standalone, accept merged equivalent
    if t['name'] in reverse and reverse[t['name']] == target_tool:
        print('alias')
        sys.exit(0)
    # Direct standalone match
    if t['name'] == target_tool and not target_action:
        print('exact')
        sys.exit(0)
print('miss')
" 2>/dev/null || echo "miss")

  tool_names=$(echo "$tools_called" | jq -r '.[].name' 2>/dev/null | tr '\n' ', ' | sed 's/,$//')

  if [[ "$tool_match" == "exact" ]]; then
    echo "PASS (exact: $tool_names)"
    passed=$((passed + 1))
    status="pass_exact"
  elif [[ "$tool_match" == "alias" ]]; then
    echo "PASS (alias: $tool_names)"
    passed=$((passed + 1))
    status="pass_alias"
  else
    echo "FAIL (got: ${tool_names:-none}, wanted: ${tool}${action:+($action)})"
    failed=$((failed + 1))
    status="fail"
  fi

  results_json=$(echo "$results_json" | jq \
    --arg id "$id" --arg tool "$tool" --arg action "$action" \
    --arg status "$status" --arg tools_called "$tool_names" --arg match "$tool_match" \
    '. + [{"id": $id, "tool": $tool, "action": $action, "status": $status, "tools_called": ($tools_called | split(", ")), "match": $match}]')
done

echo ""
echo "=== Summary ==="
echo "Passed: $passed"
echo "Failed: $failed"
echo "Skipped: $skipped"
echo "Total:  $((passed + failed))"
echo ""

if [[ $((passed + failed)) -gt 0 ]]; then
  pct=$((passed * 100 / (passed + failed)))
  echo "Action adoption rate: ${pct}%"
  echo ""

  # Count exact vs alias
  exact=$(echo "$results_json" | jq '[.[] | select(.status == "pass_exact")] | length')
  alias=$(echo "$results_json" | jq '[.[] | select(.status == "pass_alias")] | length')
  echo "  Exact matches: $exact"
  echo "  Alias matches: $alias"
  echo "  Failures:      $failed"
fi

# Write results
echo "$results_json" | jq '.' > "$RESULTS_DIR/results.json"

# Generate report
cat > "$RESULTS_DIR/report.md" <<REPORT
# T43 Action-Coverage Test Report

**Date:** $(date -Iseconds)
**Model:** $MODEL
**Passed:** $passed / $((passed + failed))
**Action adoption rate:** ${pct:-0}%

## Results

| ID | Tool | Action | Status | Tools Called |
|----|------|--------|--------|-------------|
$(echo "$results_json" | jq -r '.[] | "| \(.id) | \(.tool) | \(.action // "-") | \(.status) | \(.tools_called | join(", ")) |"')

## Failures

$(echo "$results_json" | jq -r '.[] | select(.status == "fail") | "- **\(.id)**: wanted \(.tool)\(if .action != "" then "(\(.action))" else "" end), got \(.tools_called | join(", "))"')
REPORT

echo "Report: $RESULTS_DIR/report.md"
echo "Results: $RESULTS_DIR/results.json"
