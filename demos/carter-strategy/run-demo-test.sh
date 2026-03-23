#!/usr/bin/env bash
set -euo pipefail

# Carter Strategy Demo E2E Test
# Runs each beat of the demo video script as a separate claude -p call,
# verifying tool usage and vault state between beats.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MCP_SERVER="$REPO_ROOT/packages/mcp-server/dist/index.js"
MODEL=${MODEL:-sonnet}
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
RESULTS_DIR="$SCRIPT_DIR/test-results/$TIMESTAMP"
WATCHER_WAIT=${WATCHER_WAIT:-5}  # seconds to wait for flywheel watcher

# Beat prompts (one per demo beat)
BEAT1="Brief me on what's happening"
BEAT2="What's outstanding on billing? Any overdue invoices I need to chase?"
BEAT3="Add tasks to chase Sarah Mitchell at Acme about those three overdue invoices, and separately remind me to check in with Mike Chen at TechStart about today's invoice. Both due Wednesday."
BEAT4="Had a really productive call with Sarah Mitchell and James Rodriguez from Acme Corp this morning about the Data Migration cutover. Great news — UAT is fully complete. All the validation scripts Marcus Webb wrote passed across every table, and the performance benchmarks show we're hitting the 3x improvement target we originally set during the Discovery Workshop back in October. Marcus has confirmed the Airflow pipelines are rock solid and all the rollback procedures are documented in the Data Migration Playbook. We've locked in March 28-29 as the cutover window — Sarah is getting final sign-off from Emily Chen on production environment access. One risk flag: James says the legacy Oracle system decommission timeline still hasn't been confirmed by their IT team. I've asked him to escalate to his director. If we can't get a firm date by next Friday we may need to run both systems in parallel during the support window, which would push costs beyond the original 75K budget — probably an extra 8-10K for Marcus's time. On a more positive note, Sarah mentioned the Acme Analytics Add-on proposal I drafted has been circulating with their finance team and getting good reception. She wants to schedule a scoping call with Emily Chen and their data team right after cutover wraps up. I told her Priya Kapoor would be ideal for the requirements gathering given her financial modeling background. Also need to update the Rate Card — Marcus's rate is going up to 220 an hour from April, and we should reflect Leila Farouk's rates for the Nexus Health engagement. Speaking of Nexus Health — Tom Huang emailed back confirming they want to proceed with the Cloud Assessment. He wants to start as soon as Leila is available. I need to check with Leila on her April availability and get the proposal finalized. Mike Chen from TechStart gave them a strong reference which definitely helped close it. Finally, Dan Oliveira pinged me about the Beta Corp Dashboard — he's finished the Pipeline module and wants to demo it to Stacy Thompson before the client presentation next Wednesday."
BEAT5="Give me a full pipeline overview: active projects, pending proposals, outstanding billing, and team utilization."

BEATS=("$BEAT1" "$BEAT2" "$BEAT3" "$BEAT4" "$BEAT5")
BEAT_NAMES=("brief" "billing" "tasks" "showstopper" "pipeline")

# ── Pre-flight checks ──────────────────────────────────────────────

if [[ ! -f "$MCP_SERVER" ]]; then
  echo "ERROR: MCP server not built. Run: cd $REPO_ROOT && npm run build"
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo "ERROR: claude CLI not found"
  exit 1
fi

# ── Setup ──────────────────────────────────────────────────────────

mkdir -p "$RESULTS_DIR/raw" "$RESULTS_DIR/snapshots"

# Build MCP config pointing to local build
MCP_CONFIG=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$SCRIPT_DIR","FLYWHEEL_TOOLS":"default"}}}}
EOF
)

# Clean vault state — remove any daily notes from previous runs
clean_vault() {
  rm -rf "$SCRIPT_DIR/daily-notes"
  # Remove flywheel state db to get fresh index
  rm -f "$SCRIPT_DIR/.flywheel/state.db"
  echo "Vault cleaned: daily-notes removed, state.db cleared"
}

# Snapshot vault state
snapshot() {
  local label="$1"
  local snap_dir="$RESULTS_DIR/snapshots/$label"
  mkdir -p "$snap_dir"

  # List all files
  find "$SCRIPT_DIR" -name '*.md' -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/test-results/*' \
    | sort > "$snap_dir/files.txt"

  # Capture daily notes content if any exist
  if [[ -d "$SCRIPT_DIR/daily-notes" ]]; then
    cp -r "$SCRIPT_DIR/daily-notes" "$snap_dir/daily-notes" 2>/dev/null || true
    # Count wikilinks in daily notes
    grep -ohP '\[\[[^\]]+\]\]' "$SCRIPT_DIR/daily-notes/"*.md 2>/dev/null \
      | sort | uniq -c | sort -rn > "$snap_dir/wikilinks.txt" || true
  else
    echo "(no daily-notes dir)" > "$snap_dir/wikilinks.txt"
  fi

  echo "  Snapshot: $label"
}

# Extract tool names from JSONL stream
extract_tools() {
  local jsonl="$1"
  python3 -c "
import json, sys
tools = []
for line in open(sys.argv[1]):
    try:
        obj = json.loads(line.strip())
        if obj.get('type') == 'assistant':
            for block in obj.get('message', {}).get('content', []):
                if block.get('type') == 'tool_use':
                    tools.append(block['name'])
    except: pass
for t in tools:
    print(t)
" "$jsonl"
}

# ── Main ───────────────────────────────────────────────────────────

echo "=== Carter Strategy Demo E2E Test ==="
echo "Model:        $MODEL"
echo "Beats:        ${#BEATS[@]}"
echo "Watcher wait: ${WATCHER_WAIT}s"
echo "Output:       $RESULTS_DIR"
echo ""

clean_vault

passed=0
failed=0
total=${#BEATS[@]}

for i in "${!BEATS[@]}"; do
  beat_num=$((i + 1))
  beat_name="${BEAT_NAMES[$i]}"
  prompt="${BEATS[$i]}"
  out="$RESULTS_DIR/raw/beat${beat_num}_${beat_name}.jsonl"

  echo "── Beat $beat_num: $beat_name ──"

  # Pre-beat snapshot
  snapshot "beat${beat_num}_pre"

  # Run the beat
  echo "  Running claude -p (model=$MODEL)..."
  cd "$SCRIPT_DIR"
  timeout 180 claude -p "$prompt" \
    --output-format stream-json \
    --verbose \
    --no-session-persistence \
    --permission-mode bypassPermissions \
    --mcp-config <(echo "$MCP_CONFIG") \
    --strict-mcp-config \
    --model "$MODEL" \
    2>/dev/null > "$out" || true

  # Wait for flywheel watcher to process any mutations
  echo "  Waiting ${WATCHER_WAIT}s for watcher..."
  sleep "$WATCHER_WAIT"

  # Post-beat snapshot
  snapshot "beat${beat_num}_post"

  # Extract and display tools used
  tools_used=$(extract_tools "$out")
  echo "  Tools used:"
  echo "$tools_used" | sed 's/^/    /'

  # ── Per-beat verification ──

  beat_pass=true

  case $beat_num in
    1)
      # Beat 1: brief tool should be called
      if echo "$tools_used" | grep -q "mcp__flywheel__brief"; then
        echo "  [PASS] brief tool called"
      else
        echo "  [WARN] brief tool not called (may have used search/recall instead)"
      fi
      ;;
    2)
      # Beat 2: should use search or recall, find invoice entities
      if echo "$tools_used" | grep -qE "mcp__flywheel__(search|recall)"; then
        echo "  [PASS] search/recall tool called"
      else
        echo "  [FAIL] no search or recall tool used"
        beat_pass=false
      fi
      # Check for WebSearch fallback (regression)
      if echo "$tools_used" | grep -q "WebSearch"; then
        echo "  [FAIL] WebSearch fallback detected — regression!"
        beat_pass=false
      else
        echo "  [PASS] no WebSearch fallback"
      fi
      # Check that excessive get_note_structure calls didn't happen
      gns_count=$(echo "$tools_used" | grep -c "mcp__flywheel__get_note_structure" || true)
      if [[ "$gns_count" -gt 3 ]]; then
        echo "  [WARN] $gns_count get_note_structure calls (Beat 2 billing regression?)"
      else
        echo "  [PASS] get_note_structure calls: $gns_count (acceptable)"
      fi
      ;;
    3)
      # Beat 3: daily note should exist with tasks
      if [[ -d "$SCRIPT_DIR/daily-notes" ]] && ls "$SCRIPT_DIR/daily-notes/"*.md &>/dev/null; then
        echo "  [PASS] daily note created"
        # Check for task markers
        if grep -q '\- \[ \]' "$SCRIPT_DIR/daily-notes/"*.md 2>/dev/null; then
          echo "  [PASS] tasks found in daily note"
        else
          echo "  [WARN] no task checkboxes found in daily note"
        fi
        # Check for key wikilinks
        for entity in "Sarah Mitchell" "Mike Chen"; do
          if grep -q "\[\[$entity\]\]" "$SCRIPT_DIR/daily-notes/"*.md 2>/dev/null; then
            echo "  [PASS] wikilink found: [[$entity]]"
          else
            echo "  [WARN] wikilink missing: [[$entity]]"
          fi
        done
      else
        echo "  [FAIL] no daily note created"
        beat_pass=false
      fi
      ;;
    4)
      # Beat 4: daily note should have many wikilinks
      if [[ -d "$SCRIPT_DIR/daily-notes" ]]; then
        wikilink_count=$(grep -ohP '\[\[[^\]]+\]\]' "$SCRIPT_DIR/daily-notes/"*.md 2>/dev/null | wc -l || echo 0)
        echo "  Wikilinks in daily note: $wikilink_count"
        if [[ "$wikilink_count" -ge 10 ]]; then
          echo "  [PASS] 10+ wikilinks (showstopper threshold met)"
        elif [[ "$wikilink_count" -ge 5 ]]; then
          echo "  [WARN] $wikilink_count wikilinks (expected 10+)"
        else
          echo "  [FAIL] only $wikilink_count wikilinks (expected 10+)"
          beat_pass=false
        fi
        # Check for key entities
        for entity in "Marcus Webb" "Acme Corp" "Data Migration Playbook" "Priya Kapoor" "Nexus Health"; do
          if grep -q "\[\[$entity\]\]" "$SCRIPT_DIR/daily-notes/"*.md 2>/dev/null; then
            echo "  [PASS] entity linked: $entity"
          else
            echo "  [WARN] entity not linked: $entity"
          fi
        done
      else
        echo "  [FAIL] no daily note exists for Beat 4"
        beat_pass=false
      fi
      ;;
    5)
      # Beat 5: should synthesize across vault — check response mentions key items
      # Extract assistant text from JSONL
      response_text=$(python3 -c "
import json, sys
for line in open(sys.argv[1]):
    try:
        obj = json.loads(line.strip())
        if obj.get('type') == 'assistant':
            for block in obj.get('message', {}).get('content', []):
                if block.get('type') == 'text':
                    print(block['text'])
    except: pass
" "$out" 2>/dev/null)
      # Check for key synthesis elements
      for keyword in "Acme" "TechStart" "pipeline" "billing" "overdue"; do
        if echo "$response_text" | grep -qi "$keyword"; then
          echo "  [PASS] response mentions: $keyword"
        else
          echo "  [WARN] response missing: $keyword"
        fi
      done
      ;;
  esac

  if $beat_pass; then
    passed=$((passed + 1))
    echo "  Result: PASS"
  else
    failed=$((failed + 1))
    echo "  Result: FAIL"
  fi

  echo ""
  sleep 3  # rate limiting buffer between beats
done

# ── Summary ────────────────────────────────────────────────────────

echo "=== Summary ==="
echo "Passed: $passed/$total"
echo "Failed: $failed/$total"
echo ""

# Generate report
cat > "$RESULTS_DIR/report.md" <<EOF
# Carter Strategy Demo E2E Test Report

**Date:** $(date -Iseconds)
**Model:** $MODEL
**Result:** $passed/$total beats passed

## Vault State After All Beats

### Daily Notes
$(if [[ -d "$SCRIPT_DIR/daily-notes" ]]; then
  for f in "$SCRIPT_DIR/daily-notes/"*.md; do
    echo "#### $(basename "$f")"
    echo '```'
    head -50 "$f"
    echo '```'
    echo ""
  done
else
  echo "(no daily notes created)"
fi)

### Wikilink Count
$(grep -ohP '\[\[[^\]]+\]\]' "$SCRIPT_DIR/daily-notes/"*.md 2>/dev/null | sort | uniq -c | sort -rn || echo "(none)")

## Per-Beat Tool Usage

$(for i in "${!BEAT_NAMES[@]}"; do
  beat_num=$((i + 1))
  beat_name="${BEAT_NAMES[$i]}"
  out_file="$RESULTS_DIR/raw/beat${beat_num}_${beat_name}.jsonl"
  echo "### Beat $beat_num: $beat_name"
  if [[ -f "$out_file" ]]; then
    echo '```'
    extract_tools "$out_file"
    echo '```'
  else
    echo "(no output)"
  fi
  echo ""
done)
EOF

echo "Report: $RESULTS_DIR/report.md"

# Exit with failure if any beat failed
if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
