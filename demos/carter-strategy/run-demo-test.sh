#!/usr/bin/env bash
set -euo pipefail

# Carter Strategy Demo E2E Test — Learning Loop Edition
# Runs each beat of the demo video script as a separate claude -p call,
# verifying tool usage and vault state between beats.
#
# Beat structure:
#   1. capture1  — Voice capture with suggestOutgoingLinks
#   2. reject    — wikilink_feedback reject x2
#   3. accept    — wikilink_feedback accept x2
#   4. capture2  — Second capture — suppressed entities should be absent
#   5. dashboard — wikilink_feedback dashboard
#   6. graph     — Graph interaction (no tool verification)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MCP_SERVER="$REPO_ROOT/packages/mcp-server/dist/index.js"
MODEL="sonnet"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
RESULTS_DIR="$SCRIPT_DIR/test-results/$TIMESTAMP"
WATCHER_WAIT=${WATCHER_WAIT:-5}  # seconds to wait for flywheel watcher

# Beat prompts (one per demo beat)
BEAT1="Log this to today's daily note with suggested outgoing links: Had a quick sync with Sarah Mitchell about the Acme cutover timeline. Marcus Webb confirmed the Airflow pipelines are solid and rollback procedures are documented in the Data Migration Playbook. Cutover still locked for March 28-29. Sarah wants to schedule a scoping call for the Acme Analytics Add-on after cutover wraps."
BEAT2="I see the suggestions on that last entry. Meridian Financial is wrong — completely different client, nothing to do with Acme cutover. And Discovery Workshop Template — that was months ago during the discovery phase, not relevant to the cutover. Record negative feedback on both of those suggestions."
BEAT3="The Acme Data Migration and Rate Card suggestions were spot on though. Acme Data Migration IS the project we're cutting over, and Marcus's rate needs updating. Record positive feedback for both."
BEAT4="Log this to today's daily note with suggested outgoing links: Just got off a call about Nexus Health. They're confirmed to proceed with the Cloud Assessment once Leila Farouk is available in April. Need to finalise the proposal and get Priya Kapoor looped in for the compliance review. Their board wants the audit complete before the fundraise."
BEAT5="Show me the wikilink feedback dashboard — how is the learning loop doing?"
BEAT6="Show me the Acme Corp cluster in the graph — what entities are most strongly connected?"

BEATS=("$BEAT1" "$BEAT2" "$BEAT3" "$BEAT4" "$BEAT5" "$BEAT6")
BEAT_NAMES=("capture1" "reject" "accept" "capture2" "dashboard" "graph")

# ── Pre-flight checks ──────────────────────────────────────────────

if [[ ! -f "$MCP_SERVER" ]]; then
  echo "ERROR: MCP server not built. Run: cd $REPO_ROOT && npm run build"
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo "ERROR: claude CLI not found"
  exit 1
fi

# ── Feedback seeding ──────────────────────────────────────────────

seed_feedback() {
  # Seeds ~30 feedback records into state.db so the vault behaves like
  # it's been in use for weeks. Idempotent — checks before inserting.
  local db="$SCRIPT_DIR/.flywheel/state.db"

  if [[ ! -f "$db" ]]; then
    echo "  state.db not found — will be created on first MCP call"
    echo "  Seeding deferred to after first beat"
    return 0
  fi

  # Check if feedback already exists
  local count
  count=$(sqlite3 "$db" "SELECT COUNT(*) FROM wikilink_feedback;" 2>/dev/null || echo 0)
  if [[ "$count" -gt 10 ]]; then
    echo "  Feedback already seeded ($count records)"
    return 0
  fi

  echo "  Seeding feedback records..."

  # Create the table if it doesn't exist
  sqlite3 "$db" "
    CREATE TABLE IF NOT EXISTS wikilink_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      context TEXT,
      note_path TEXT,
      correct INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS wikilink_suppression (
      entity TEXT PRIMARY KEY,
      suppressed_at TEXT DEFAULT (datetime('now'))
    );
  " 2>/dev/null || true

  # Positive feedback — core Acme entities (high accuracy)
  for i in $(seq 1 10); do
    sqlite3 "$db" "INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES ('Sarah Mitchell', 'Acme project update', 'daily-notes/2026-03-$((10+i)).md', 1, datetime('now', '-$((30-i)) days'));"
  done
  for i in $(seq 1 8); do
    sqlite3 "$db" "INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES ('Acme Data Migration', 'project status', 'daily-notes/2026-03-$((10+i)).md', 1, datetime('now', '-$((28-i)) days'));"
  done
  for i in $(seq 1 12); do
    sqlite3 "$db" "INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES ('Acme Corp', 'client update', 'daily-notes/2026-03-$((8+i)).md', 1, datetime('now', '-$((30-i)) days'));"
  done
  for i in $(seq 1 6); do
    sqlite3 "$db" "INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES ('Marcus Webb', 'team assignment', 'daily-notes/2026-03-$((12+i)).md', 1, datetime('now', '-$((25-i)) days'));"
  done

  # Negative feedback — GlobalBank (suppressed: 30% accuracy with 25 obs)
  for i in $(seq 1 7); do
    sqlite3 "$db" "INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES ('GlobalBank', 'Acme context', 'daily-notes/2026-03-$((5+i)).md', 1, datetime('now', '-$((30-i)) days'));"
  done
  for i in $(seq 1 18); do
    sqlite3 "$db" "INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES ('GlobalBank', 'Acme context', 'daily-notes/2026-03-$((5+i)).md', 0, datetime('now', '-$((30-i)) days'));"
  done
  # Suppress GlobalBank
  sqlite3 "$db" "INSERT OR REPLACE INTO wikilink_suppression (entity) VALUES ('GlobalBank');"

  # Marginal feedback — Meridian Financial and Discovery Workshop Template
  sqlite3 "$db" "INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES ('Meridian Financial', 'pipeline review', 'daily-notes/2026-03-15.md', 1, datetime('now', '-15 days'));"
  sqlite3 "$db" "INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES ('Meridian Financial', 'Acme update', 'daily-notes/2026-03-18.md', 0, datetime('now', '-12 days'));"
  sqlite3 "$db" "INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES ('Meridian Financial', 'client meeting', 'daily-notes/2026-03-20.md', 1, datetime('now', '-10 days'));"
  sqlite3 "$db" "INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES ('Meridian Financial', 'weekly review', 'daily-notes/2026-03-22.md', 0, datetime('now', '-8 days'));"

  sqlite3 "$db" "INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES ('Discovery Workshop Template', 'project reference', 'daily-notes/2026-03-10.md', 1, datetime('now', '-20 days'));"
  sqlite3 "$db" "INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES ('Discovery Workshop Template', 'Acme standup', 'daily-notes/2026-03-17.md', 0, datetime('now', '-13 days'));"
  sqlite3 "$db" "INSERT INTO wikilink_feedback (entity, context, note_path, correct, created_at) VALUES ('Discovery Workshop Template', 'cutover planning', 'daily-notes/2026-03-25.md', 1, datetime('now', '-5 days'));"

  local final_count
  final_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM wikilink_feedback;" 2>/dev/null || echo 0)
  echo "  Seeded $final_count feedback records"
}

# ── Setup ──────────────────────────────────────────────────────────

mkdir -p "$RESULTS_DIR/raw" "$RESULTS_DIR/snapshots"

# Build MCP config pointing to local build
MCP_CONFIG=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$SCRIPT_DIR","FLYWHEEL_TOOLS":"default,wikilinks"}}}}
EOF
)

# Clean vault state — remove daily notes but PRESERVE state.db (pre-seeded feedback)
clean_vault() {
  rm -rf "$SCRIPT_DIR/daily-notes"
  echo "Vault cleaned: daily-notes removed (state.db preserved for feedback history)"
}

# Seed-only mode: just seed feedback and exit
if [[ "${1:-}" == "--seed-only" ]]; then
  echo "=== Seed-only mode ==="
  # Trigger index build by running a quick search, then seed
  echo "  Triggering index build..."
  cd "$SCRIPT_DIR"
  timeout 30 claude -p "Search for Acme Corp" \
    --output-format stream-json \
    --no-session-persistence \
    --permission-mode bypassPermissions \
    --mcp-config <(echo "$MCP_CONFIG") \
    --strict-mcp-config \
    --model "$MODEL" \
    2>/dev/null > /dev/null || true
  sleep 2
  seed_feedback
  echo "Done."
  exit 0
fi

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
    # Capture suggestion suffixes
    grep -ohP '→ .*$' "$SCRIPT_DIR/daily-notes/"*.md 2>/dev/null \
      > "$snap_dir/suggestions.txt" || true
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

# Extract tool call arguments from JSONL stream
extract_tool_args() {
  local jsonl="$1"
  local tool_name="$2"
  python3 -c "
import json, sys
for line in open(sys.argv[1]):
    try:
        obj = json.loads(line.strip())
        if obj.get('type') == 'assistant':
            for block in obj.get('message', {}).get('content', []):
                if block.get('type') == 'tool_use' and block['name'] == sys.argv[2]:
                    print(json.dumps(block.get('input', {})))
    except: pass
" "$jsonl" "$tool_name"
}

# ── Main ───────────────────────────────────────────────────────────

echo "=== Carter Strategy Demo E2E Test (Learning Loop) ==="
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

  # Seed feedback after Beat 1 creates state.db (if not already seeded)
  if [[ "$beat_num" -eq 2 ]]; then
    seed_feedback
  fi

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
    2>"${out%.jsonl}.stderr" > "$out" || true

  # Wait for flywheel watcher to process any mutations
  echo "  Waiting ${WATCHER_WAIT}s for watcher..."
  sleep "$WATCHER_WAIT"

  # Post-beat snapshot
  snapshot "beat${beat_num}_post"

  # Extract and display tools used
  if [[ ! -s "$out" ]]; then
    echo "  [WARN] No output from claude (empty JSONL)"
    echo "  stderr: $(head -5 "${out%.jsonl}.stderr" 2>/dev/null || echo '(none)')"
    tools_used=""
  else
    tools_used=$(extract_tools "$out")
  fi
  echo "  Tools used:"
  echo "$tools_used" | sed 's/^/    /'

  # ── Per-beat verification ──

  beat_pass=true

  case $beat_num in
    1)
      # Beat 1: capture — should write daily note with wikilinks
      if echo "$tools_used" | grep -qE "mcp__flywheel__search|mcp__flywheel__vault_add_to_section"; then
        echo "  [PASS] write/search tool called"
      elif echo "$tools_used" | grep -q "mcp__flywheel__brief"; then
        echo "  [PASS] brief tool called"
      else
        echo "  [WARN] no expected tool called"
      fi
      # Daily note should exist with wikilinks
      if [[ -d "$SCRIPT_DIR/daily-notes" ]] && ls "$SCRIPT_DIR/daily-notes/"*.md &>/dev/null; then
        echo "  [PASS] daily note created"
        for entity in "Sarah Mitchell" "Marcus Webb" "Data Migration Playbook"; do
          if grep -q "\[\[$entity\]\]" "$SCRIPT_DIR/daily-notes/"*.md 2>/dev/null; then
            echo "  [PASS] wikilink found: [[$entity]]"
          else
            echo "  [WARN] wikilink missing: [[$entity]]"
          fi
        done
        # Check for suggestion suffix
        if grep -qP '→' "$SCRIPT_DIR/daily-notes/"*.md 2>/dev/null; then
          echo "  [PASS] suggestion suffix (→) found in daily note"
        else
          echo "  [WARN] no suggestion suffix found"
        fi
      else
        echo "  [FAIL] no daily note created"
        beat_pass=false
      fi
      ;;
    2)
      # Beat 2: wikilink_feedback should be called with correct=false
      if echo "$tools_used" | grep -q "mcp__flywheel__wikilink_feedback"; then
        echo "  [PASS] wikilink_feedback called"
        # Check for negative feedback
        feedback_args=$(extract_tool_args "$out" "mcp__flywheel__wikilink_feedback")
        negative_count=$(echo "$feedback_args" | grep -c '"correct".*false\|"correct": false' || true)
        if [[ "$negative_count" -ge 1 ]]; then
          echo "  [PASS] negative feedback recorded ($negative_count calls)"
        else
          echo "  [WARN] no explicit negative feedback detected in args"
        fi
      else
        echo "  [FAIL] wikilink_feedback not called"
        beat_pass=false
      fi
      ;;
    3)
      # Beat 3: wikilink_feedback should be called with correct=true
      if echo "$tools_used" | grep -q "mcp__flywheel__wikilink_feedback"; then
        echo "  [PASS] wikilink_feedback called"
        feedback_args=$(extract_tool_args "$out" "mcp__flywheel__wikilink_feedback")
        positive_count=$(echo "$feedback_args" | grep -c '"correct".*true\|"correct": true' || true)
        if [[ "$positive_count" -ge 1 ]]; then
          echo "  [PASS] positive feedback recorded ($positive_count calls)"
        else
          echo "  [WARN] no explicit positive feedback detected in args"
        fi
      else
        echo "  [FAIL] wikilink_feedback not called"
        beat_pass=false
      fi
      ;;
    4)
      # Beat 4: vault_add_to_section called, suppressed entities absent
      if echo "$tools_used" | grep -q "mcp__flywheel__vault_add_to_section"; then
        echo "  [PASS] vault_add_to_section called"
      else
        echo "  [FAIL] vault_add_to_section not called"
        beat_pass=false
      fi
      # Check daily note for key wikilinks
      if [[ -d "$SCRIPT_DIR/daily-notes" ]]; then
        for entity in "Nexus Health" "Leila Farouk" "Priya Kapoor"; do
          if grep -q "\[\[$entity\]\]" "$SCRIPT_DIR/daily-notes/"*.md 2>/dev/null; then
            echo "  [PASS] wikilink found: [[$entity]]"
          else
            echo "  [WARN] wikilink missing: [[$entity]]"
          fi
        done
        # Check Beat 4 entry specifically for suppressed entities
        # Get content added after Beat 1 (the second log entry)
        beat4_content=$(python3 -c "
import json, sys
for line in open(sys.argv[1]):
    try:
        obj = json.loads(line.strip())
        if obj.get('type') == 'result':
            text = obj.get('result', '')
            if isinstance(text, str):
                print(text)
    except: pass
" "$out" 2>/dev/null)
        # Check tool result for suppressed entities in suggestions
        for suppressed in "Meridian Financial" "Discovery Workshop Template"; do
          if echo "$beat4_content" | grep -qi "→.*$suppressed\|suggest.*$suppressed"; then
            echo "  [WARN] suppressed entity '$suppressed' may still appear in suggestions"
          else
            echo "  [PASS] suppressed entity absent from suggestions: $suppressed"
          fi
        done
      else
        echo "  [FAIL] no daily note exists"
        beat_pass=false
      fi
      ;;
    5)
      # Beat 5: wikilink_feedback dashboard mode
      if echo "$tools_used" | grep -q "mcp__flywheel__wikilink_feedback"; then
        echo "  [PASS] wikilink_feedback called"
        feedback_args=$(extract_tool_args "$out" "mcp__flywheel__wikilink_feedback")
        if echo "$feedback_args" | grep -q '"dashboard"\|"mode".*"dashboard"'; then
          echo "  [PASS] dashboard mode detected"
        else
          echo "  [WARN] wikilink_feedback called but mode may not be dashboard"
        fi
      else
        echo "  [WARN] wikilink_feedback not called (may have used alternative tool)"
      fi
      ;;
    6)
      # Beat 6: graph interaction — no strict tool verification
      echo "  [PASS] graph beat (no tool verification required)"
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
# Carter Strategy Demo E2E Test Report (Learning Loop)

**Date:** $(date -Iseconds)
**Model:** $MODEL
**Result:** $passed/$total beats passed

## Beat Structure

| Beat | Name | Focus |
|------|------|-------|
| 1 | capture1 | Write + auto-suggest |
| 2 | reject | Negative feedback (x2) |
| 3 | accept | Positive feedback (x2) |
| 4 | capture2 | Second write — suppressed entities absent |
| 5 | dashboard | Feedback dashboard |
| 6 | graph | Graph interaction |

## Vault State After All Beats

### Daily Notes
$(if [[ -d "$SCRIPT_DIR/daily-notes" ]]; then
  for f in "$SCRIPT_DIR/daily-notes/"*.md; do
    echo "#### $(basename "$f")"
    echo '```'
    head -80 "$f"
    echo '```'
    echo ""
  done
else
  echo "(no daily notes created)"
fi)

### Wikilink Count
$(grep -ohP '\[\[[^\]]+\]\]' "$SCRIPT_DIR/daily-notes/"*.md 2>/dev/null | sort | uniq -c | sort -rn || echo "(none)")

### Suggestion Suffixes
$(grep -ohP '→ .*$' "$SCRIPT_DIR/daily-notes/"*.md 2>/dev/null || echo "(none)")

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
