#!/usr/bin/env bash
# Consolidated Carter Strategy Demo Runner — 9-beat, three-act narrative
#
# Act I  — Retrieval (Job 1):           memory, billing
# Act II — Enrichment + Learning Loop:  capture1, reject, accept, capture2
# Act III — Operational Power:           assign, dashboard, pipeline
#
# Runs against a disposable copy of the carter-strategy vault so the
# tracked checkout is never modified.
#
# Usage:
#   demos/run-demo-test.sh               # full 9-beat run (model: sonnet)
#   demos/run-demo-test.sh --seed-only   # seed feedback in temp vault, then exit

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEMO_SRC="$REPO_DIR/demos/carter-strategy"
MCP_SERVER="$REPO_DIR/packages/mcp-server/dist/index.js"
MODEL="${MODEL:-sonnet}"
RUN_DATE="${RUN_DATE:-2026-03-20}"
DAILY_NOTE="daily-notes/${RUN_DATE}.md"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
RESULTS_DIR="$REPO_DIR/demos/test-results/demo-$TIMESTAMP"

# ── Pre-flight checks ────────────────────────────────────────────

if [[ ! -f "$MCP_SERVER" ]]; then
  echo "ERROR: MCP server not built. Run: cd $REPO_DIR && npm run build"
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo "ERROR: claude CLI not found"
  exit 1
fi

# ── Temp vault setup ─────────────────────────────────────────────
# Copy vault content into a disposable workdir.  The tracked checkout
# is never modified.

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/carter-demo-XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Temp vault: $WORK_DIR"

# Copy markdown content directories
for dir in clients projects invoices proposals knowledge team admin weekly-notes monthly-notes daily-notes; do
  if [[ -d "$DEMO_SRC/$dir" ]]; then
    cp -r "$DEMO_SRC/$dir" "$WORK_DIR/$dir"
  fi
done

# Copy config files required by beats
cp "$DEMO_SRC/CLAUDE.md" "$WORK_DIR/" 2>/dev/null || true
cp "$DEMO_SRC/.mcp.json" "$WORK_DIR/" 2>/dev/null || true
if [[ -d "$DEMO_SRC/.claude" ]]; then
  cp -r "$DEMO_SRC/.claude" "$WORK_DIR/.claude"
fi

# Ensure daily-notes directory exists (captures happen here)
mkdir -p "$WORK_DIR/daily-notes"

# Fresh .flywheel — no carried-over state.db
mkdir -p "$WORK_DIR/.flywheel"

# Initialise git so Flywheel's mutation audit trail works
(cd "$WORK_DIR" && git init -q && git add -A && git commit -q -m "demo init" --allow-empty) 2>/dev/null || true

# ── MCP config ───────────────────────────────────────────────────

MCP_CONFIG=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$WORK_DIR","FLYWHEEL_TOOLS":"full"}}}}
EOF
)

# ── Feedback seeding ─────────────────────────────────────────────
# Seeds ~30 feedback records into state.db so the vault behaves like
# it's been in use for weeks.  Idempotent — checks before inserting.

seed_feedback() {
  local db="$WORK_DIR/.flywheel/state.db"

  if [[ ! -f "$db" ]]; then
    echo "  state.db not found — will be created on first MCP call"
    echo "  Seeding deferred to after first write beat"
    return 0
  fi

  # Check if feedback already exists
  local count
  count=$(sqlite3 "$db" "SELECT COUNT(*) FROM link;" 2>/dev/null || echo 0)
  if [[ "$count" -gt 10 ]]; then
    echo "  Feedback already seeded ($count records)"
    return 0
  fi

  echo "  Seeding feedback records..."

  # Create tables if they don't exist (plural: wikilink_suppressions)
  sqlite3 "$db" "
    CREATE TABLE IF NOT EXISTS link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      context TEXT,
      note_path TEXT,
      correct INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS wikilink_suppressions (
      entity TEXT PRIMARY KEY,
      false_positive_rate REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  " 2>/dev/null || true

  # Positive feedback — core Acme entities (high accuracy)
  for i in $(seq 1 10); do
    sqlite3 "$db" "INSERT INTO link (entity, context, note_path, correct, created_at) VALUES ('Sarah Mitchell', 'Acme project update', 'daily-notes/2026-03-$((10+i)).md', 1, datetime('now', '-$((30-i)) days'));"
  done
  for i in $(seq 1 8); do
    sqlite3 "$db" "INSERT INTO link (entity, context, note_path, correct, created_at) VALUES ('Acme Data Migration', 'project status', 'daily-notes/2026-03-$((10+i)).md', 1, datetime('now', '-$((28-i)) days'));"
  done
  for i in $(seq 1 12); do
    sqlite3 "$db" "INSERT INTO link (entity, context, note_path, correct, created_at) VALUES ('Acme Corp', 'client update', 'daily-notes/2026-03-$((8+i)).md', 1, datetime('now', '-$((30-i)) days'));"
  done
  for i in $(seq 1 6); do
    sqlite3 "$db" "INSERT INTO link (entity, context, note_path, correct, created_at) VALUES ('Marcus Webb', 'team assignment', 'daily-notes/2026-03-$((12+i)).md', 1, datetime('now', '-$((25-i)) days'));"
  done

  # Negative feedback — GlobalBank (suppressed: 30% accuracy with 25 obs)
  for i in $(seq 1 7); do
    sqlite3 "$db" "INSERT INTO link (entity, context, note_path, correct, created_at) VALUES ('GlobalBank', 'Acme context', 'daily-notes/2026-03-$((5+i)).md', 1, datetime('now', '-$((30-i)) days'));"
  done
  for i in $(seq 1 18); do
    sqlite3 "$db" "INSERT INTO link (entity, context, note_path, correct, created_at) VALUES ('GlobalBank', 'Acme context', 'daily-notes/2026-03-$((5+i)).md', 0, datetime('now', '-$((30-i)) days'));"
  done
  # Suppress GlobalBank
  sqlite3 "$db" "INSERT OR REPLACE INTO wikilink_suppressions (entity, false_positive_rate) VALUES ('GlobalBank', 0.72);"

  # Marginal feedback — Meridian Financial and Discovery Workshop Template
  sqlite3 "$db" "INSERT INTO link (entity, context, note_path, correct, created_at) VALUES ('Meridian Financial', 'pipeline review', 'daily-notes/2026-03-15.md', 1, datetime('now', '-15 days'));"
  sqlite3 "$db" "INSERT INTO link (entity, context, note_path, correct, created_at) VALUES ('Meridian Financial', 'Acme update', 'daily-notes/2026-03-18.md', 0, datetime('now', '-12 days'));"
  sqlite3 "$db" "INSERT INTO link (entity, context, note_path, correct, created_at) VALUES ('Meridian Financial', 'client meeting', 'daily-notes/2026-03-20.md', 1, datetime('now', '-10 days'));"
  sqlite3 "$db" "INSERT INTO link (entity, context, note_path, correct, created_at) VALUES ('Meridian Financial', 'weekly review', 'daily-notes/2026-03-22.md', 0, datetime('now', '-8 days'));"

  sqlite3 "$db" "INSERT INTO link (entity, context, note_path, correct, created_at) VALUES ('Discovery Workshop Template', 'project reference', 'daily-notes/2026-03-10.md', 1, datetime('now', '-20 days'));"
  sqlite3 "$db" "INSERT INTO link (entity, context, note_path, correct, created_at) VALUES ('Discovery Workshop Template', 'Acme standup', 'daily-notes/2026-03-17.md', 0, datetime('now', '-13 days'));"
  sqlite3 "$db" "INSERT INTO link (entity, context, note_path, correct, created_at) VALUES ('Discovery Workshop Template', 'cutover planning', 'daily-notes/2026-03-25.md', 1, datetime('now', '-5 days'));"

  local final_count
  final_count=$(sqlite3 "$db" "SELECT COUNT(*) FROM link;" 2>/dev/null || echo 0)
  echo "  Seeded $final_count feedback records"
}

# ── Seed-only mode ───────────────────────────────────────────────

if [[ "${1:-}" == "--seed-only" ]]; then
  echo "=== Seed-only mode ==="
  # Trigger index build by running a quick search, then seed
  echo "  Triggering index build..."
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

# ── Snapshot helper ──────────────────────────────────────────────

snapshot() {
  local label="$1"
  local snap_dir="$RESULTS_DIR/snapshots/$label"
  mkdir -p "$snap_dir"

  # List all markdown files
  find "$WORK_DIR" -name '*.md' -not -path '*/.git/*' -not -path '*/test-results/*' \
    | sort > "$snap_dir/files.txt"

  # Capture daily notes content if any exist
  if [[ -d "$WORK_DIR/daily-notes" ]] && ls "$WORK_DIR/daily-notes/"*.md &>/dev/null; then
    cp -r "$WORK_DIR/daily-notes" "$snap_dir/daily-notes" 2>/dev/null || true
    # Count wikilinks in daily notes
    grep -ohP '\[\[[^\]]+\]\]' "$WORK_DIR/daily-notes/"*.md 2>/dev/null \
      | sort | uniq -c | sort -rn > "$snap_dir/wikilinks.txt" || true
    # Capture suggestion suffixes
    grep -ohP '→ .*$' "$WORK_DIR/daily-notes/"*.md 2>/dev/null \
      > "$snap_dir/suggestions.txt" || true
  else
    echo "(no daily-notes)" > "$snap_dir/wikilinks.txt"
  fi

  echo "  Snapshot: $label"
}

# ── JSONL extraction helpers ─────────────────────────────────────

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

# ── Beat definitions ─────────────────────────────────────────────

declare -a BEAT_NAMES
declare -a BEAT_PROMPTS
declare -a BEAT_SLEEPS

# Act I — Retrieval
BEAT_NAMES+=("beat1_brief")
BEAT_PROMPTS+=("Brief me on what's happening")
BEAT_SLEEPS+=(2)

BEAT_NAMES+=("beat2_billing")
BEAT_PROMPTS+=("What's outstanding on billing? Any overdue invoices I need to chase?")
BEAT_SLEEPS+=(2)

# Act II — Enrichment + Learning Loop
BEAT_NAMES+=("beat3_capture1")
BEAT_PROMPTS+=("Log this to the daily note for ${RUN_DATE} with suggested outgoing links: Had a quick sync with Sarah Mitchell about the Acme cutover timeline. Marcus Webb confirmed the Airflow pipelines are solid and rollback procedures are documented in the Data Migration Playbook. Cutover still locked for March 28-29. Sarah wants to schedule a scoping call for the Acme Analytics Add-on after cutover wraps.")
BEAT_SLEEPS+=(5)

BEAT_NAMES+=("beat4_reject")
BEAT_PROMPTS+=("I see the suggestions on that last entry. Meridian Financial is wrong — completely different client, nothing to do with Acme cutover. And Discovery Workshop Template — that was months ago during the discovery phase, not relevant to the cutover. Record negative feedback on both of those suggestions.")
BEAT_SLEEPS+=(5)

BEAT_NAMES+=("beat5_accept")
BEAT_PROMPTS+=("The Acme Data Migration and Rate Card suggestions were spot on though. Acme Data Migration IS the project we're cutting over, and Marcus's rate needs updating. Record positive feedback for both.")
BEAT_SLEEPS+=(5)

BEAT_NAMES+=("beat6_capture2")
BEAT_PROMPTS+=("Log this to the daily note for ${RUN_DATE} with suggested outgoing links: Just got off a call about Nexus Health. They're confirmed to proceed with the Cloud Assessment once Leila Farouk is available in April. Need to finalise the proposal and get Priya Kapoor looped in for the compliance review. Their board wants the audit complete before the fundraise.")
BEAT_SLEEPS+=(5)

# Act III — Operational Power
BEAT_NAMES+=("beat7_assign")
BEAT_PROMPTS+=("Nexus Health is a go. Assign Leila Farouk as the cloud and security lead and Priya Kapoor for HIPAA compliance analysis. Update their utilization to show they're assigned and mark the proposal status as confirmed. Add a task to finalize the proposal by end of next week.")
BEAT_SLEEPS+=(5)

BEAT_NAMES+=("beat8_dashboard")
BEAT_PROMPTS+=("Show me the wikilink feedback dashboard — how is the learning loop doing?")
BEAT_SLEEPS+=(2)

BEAT_NAMES+=("beat9_pipeline")
BEAT_PROMPTS+=("Give me a full pipeline overview: active projects, pending proposals, outstanding billing, and team utilization.")
BEAT_SLEEPS+=(5)

# ── Main loop ────────────────────────────────────────────────────

echo "=== Carter Strategy Demo Runner (9-beat) ==="
echo "Demo:     carter-strategy"
echo "Model:    $MODEL"
echo "Run date: $RUN_DATE"
echo "Temp:     $WORK_DIR"
echo "Results:  $RESULTS_DIR"
echo ""

mkdir -p "$RESULTS_DIR/raw" "$RESULTS_DIR/snapshots"

passed=0
failed=0
total=${#BEAT_NAMES[@]}

for i in "${!BEAT_NAMES[@]}"; do
  beat_num=$((i + 1))
  beat_name="${BEAT_NAMES[$i]}"
  prompt="${BEAT_PROMPTS[$i]}"
  sleep_sec="${BEAT_SLEEPS[$i]}"
  out="$RESULTS_DIR/raw/${beat_name}.jsonl"

  echo "── Beat $beat_num: $beat_name ──"

  # Seed feedback between Act I and Act II (after read-only beats create state.db)
  if [[ "$beat_num" -eq 3 ]]; then
    # Trigger index build so state.db exists
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
  fi

  # Pre-beat snapshot
  snapshot "beat${beat_num}_pre"

  # Run the beat
  echo "  Running claude -p (model=$MODEL)..."
  timeout 180 claude -p "$prompt" \
    --output-format stream-json \
    --verbose \
    --no-session-persistence \
    --permission-mode bypassPermissions \
    --mcp-config <(echo "$MCP_CONFIG") \
    --strict-mcp-config \
    --model "$MODEL" \
    2>"${out%.jsonl}.stderr" > "$out" || true

  # Wait for flywheel watcher to process mutations
  echo "  Waiting ${sleep_sec}s for watcher..."
  sleep "$sleep_sec"

  # Post-beat snapshot
  snapshot "beat${beat_num}_post"

  # Extract tools used
  if [[ ! -s "$out" ]]; then
    echo "  [WARN] No output from claude (empty JSONL)"
    echo "  stderr: $(head -5 "${out%.jsonl}.stderr" 2>/dev/null || echo '(none)')"
    tools_used=""
  else
    tools_used=$(extract_tools "$out")
  fi
  echo "  Tools used:"
  echo "$tools_used" | sed 's/^/    /'

  # ── Per-beat verification ──────────────────────────────────────

  beat_pass=true

  case $beat_num in
    1) # memory
      if echo "$tools_used" | grep -q "mcp__flywheel__memory\|mcp__flywheel__memory"; then
        echo "  [PASS] memory/memory tool called"
      else
        echo "  [FAIL] memory/memory tool not called"
        beat_pass=false
      fi
      ;;

    2) # billing
      if echo "$tools_used" | grep -q "mcp__flywheel__search"; then
        echo "  [PASS] search tool called"
      else
        echo "  [FAIL] search tool not called"
        beat_pass=false
      fi
      ;;

    3) # capture1
      if echo "$tools_used" | grep -q "mcp__flywheel__edit_section"; then
        echo "  [PASS] edit_section called"
      else
        echo "  [FAIL] edit_section not called"
        beat_pass=false
      fi
      # Daily note should exist with wikilinks
      if [[ -f "$WORK_DIR/$DAILY_NOTE" ]]; then
        echo "  [PASS] daily note created: $DAILY_NOTE"
        for entity in "Sarah Mitchell" "Marcus Webb" "Data Migration Playbook"; do
          if grep -q "\[\[$entity\]\]" "$WORK_DIR/$DAILY_NOTE" 2>/dev/null; then
            echo "  [PASS] wikilink found: [[$entity]]"
          else
            echo "  [WARN] wikilink missing: [[$entity]]"
          fi
        done
        if grep -qP '→' "$WORK_DIR/$DAILY_NOTE" 2>/dev/null; then
          echo "  [PASS] suggestion suffix (→) found"
        else
          echo "  [WARN] no suggestion suffix found"
        fi
      else
        echo "  [FAIL] daily note not created: $DAILY_NOTE"
        beat_pass=false
      fi
      ;;

    4) # reject
      if echo "$tools_used" | grep -q "mcp__flywheel__link\|mcp__flywheel__link"; then
        echo "  [PASS] link/link tool called"
        feedback_args=$(extract_tool_args "$out" "mcp__flywheel__link")
        if [[ -z "$feedback_args" ]]; then
          feedback_args=$(extract_tool_args "$out" "mcp__flywheel__link")
        fi
        negative_count=$(echo "$feedback_args" | grep -c '"correct".*false\|"correct": false\|"accepted".*false\|"accepted": false' || true)
        if [[ "$negative_count" -ge 2 ]]; then
          echo "  [PASS] negative feedback recorded for both entities ($negative_count calls)"
        elif [[ "$negative_count" -ge 1 ]]; then
          echo "  [WARN] negative feedback recorded but only $negative_count call(s) (expected 2)"
        else
          echo "  [WARN] no explicit negative feedback detected in args"
        fi
      else
        echo "  [FAIL] link/link not called"
        beat_pass=false
      fi
      ;;

    5) # accept
      if echo "$tools_used" | grep -q "mcp__flywheel__link\|mcp__flywheel__link"; then
        echo "  [PASS] link/link tool called"
        feedback_args=$(extract_tool_args "$out" "mcp__flywheel__link")
        if [[ -z "$feedback_args" ]]; then
          feedback_args=$(extract_tool_args "$out" "mcp__flywheel__link")
        fi
        positive_count=$(echo "$feedback_args" | grep -c '"correct".*true\|"correct": true\|"accepted".*true\|"accepted": true' || true)
        if [[ "$positive_count" -ge 2 ]]; then
          echo "  [PASS] positive feedback recorded for both entities ($positive_count calls)"
        elif [[ "$positive_count" -ge 1 ]]; then
          echo "  [WARN] positive feedback recorded but only $positive_count call(s) (expected 2)"
        else
          echo "  [WARN] no explicit positive feedback detected in args"
        fi
      else
        echo "  [FAIL] link/link not called"
        beat_pass=false
      fi
      ;;

    6) # capture2
      if echo "$tools_used" | grep -q "mcp__flywheel__edit_section"; then
        echo "  [PASS] edit_section called"
      else
        echo "  [FAIL] edit_section not called"
        beat_pass=false
      fi
      # Check daily note for key wikilinks
      if [[ -f "$WORK_DIR/$DAILY_NOTE" ]]; then
        for entity in "Nexus Health" "Leila Farouk" "Priya Kapoor"; do
          if grep -q "\[\[$entity\]\]" "$WORK_DIR/$DAILY_NOTE" 2>/dev/null; then
            echo "  [PASS] wikilink found: [[$entity]]"
          else
            echo "  [WARN] wikilink missing: [[$entity]]"
          fi
        done
        # Check that suppressed entities are absent from suggestions
        for suppressed in "Meridian Financial" "Discovery Workshop Template"; do
          if grep -qiP "→.*$suppressed" "$WORK_DIR/$DAILY_NOTE" 2>/dev/null; then
            echo "  [WARN] suppressed entity '$suppressed' may still appear in suggestions"
          else
            echo "  [PASS] suppressed entity absent from suggestions: $suppressed"
          fi
        done
      else
        echo "  [FAIL] daily note not found: $DAILY_NOTE"
        beat_pass=false
      fi
      ;;

    7) # assign
      local_pass=true
      if echo "$tools_used" | grep -q "mcp__flywheel__vault_update_frontmatter"; then
        echo "  [PASS] vault_update_frontmatter called"
      else
        echo "  [FAIL] vault_update_frontmatter not called"
        local_pass=false
      fi
      if echo "$tools_used" | grep -q "mcp__flywheel__vault_add_task\|mcp__flywheel__tasks"; then
        echo "  [PASS] vault_add_task/tasks tool called"
      else
        echo "  [FAIL] vault_add_task/tasks not called"
        local_pass=false
      fi
      if ! $local_pass; then
        beat_pass=false
      fi
      ;;

    8) # dashboard
      if echo "$tools_used" | grep -q "mcp__flywheel__link\|mcp__flywheel__link"; then
        echo "  [PASS] link/link tool called"
        feedback_args=$(extract_tool_args "$out" "mcp__flywheel__link")
        if [[ -z "$feedback_args" ]]; then
          feedback_args=$(extract_tool_args "$out" "mcp__flywheel__link")
        fi
        if echo "$feedback_args" | grep -qi '"dashboard"\|"mode".*"dashboard"\|"action".*"dashboard"'; then
          echo "  [PASS] dashboard mode detected"
        else
          echo "  [WARN] feedback tool called but mode may not be dashboard"
        fi
      else
        echo "  [WARN] link/link not called (may have used alternative tool)"
      fi
      ;;

    9) # pipeline
      if echo "$tools_used" | grep -q "mcp__flywheel__policy"; then
        echo "  [PASS] policy tool called"
        if ! echo "$tools_used" | grep -q "mcp__flywheel__search"; then
          echo "  [WARN] search not called alongside policy (model may have skipped one route)"
        fi
      elif echo "$tools_used" | grep -q "mcp__flywheel__search"; then
        echo "  [PASS] search tool called"
        echo "  [WARN] policy not called (model may have skipped the policy route)"
      else
        echo "  [FAIL] neither policy nor search called"
        beat_pass=false
      fi
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
done

# ── Summary ──────────────────────────────────────────────────────

echo "=== Summary ==="
echo "Passed: $passed/$total"
echo "Failed: $failed/$total"
echo ""

# Generate report
cat > "$RESULTS_DIR/report.md" <<REPORTEOF
# Carter Strategy Demo E2E Test Report (9-beat)

**Date:** $(date -Iseconds)
**Model:** $MODEL
**Run date:** $RUN_DATE
**Result:** $passed/$total beats passed

## Beat Structure

| Beat | Name | Act | Focus |
|------|------|-----|-------|
| 1 | memory | Retrieval | Brief / context summary |
| 2 | billing | Retrieval | Outstanding invoices |
| 3 | capture1 | Learning Loop | Write + auto-suggest |
| 4 | reject | Learning Loop | Negative feedback (x2) |
| 5 | accept | Learning Loop | Positive feedback (x2) |
| 6 | capture2 | Learning Loop | Second write — suppressed entities absent |
| 7 | assign | Operational | Frontmatter + task mutations |
| 8 | dashboard | Operational | Feedback dashboard |
| 9 | pipeline | Operational | Full pipeline overview |

## Vault State After All Beats

### Daily Notes
$(if [[ -f "$WORK_DIR/$DAILY_NOTE" ]]; then
  echo "#### $DAILY_NOTE"
  echo '```'
  head -80 "$WORK_DIR/$DAILY_NOTE"
  echo '```'
  echo ""
else
  echo "(no daily notes created)"
fi)

### Wikilink Count
$(grep -ohP '\[\[[^\]]+\]\]' "$WORK_DIR/daily-notes/"*.md 2>/dev/null | sort | uniq -c | sort -rn || echo "(none)")

### Suggestion Suffixes
$(grep -ohP '→ .*$' "$WORK_DIR/daily-notes/"*.md 2>/dev/null || echo "(none)")

## Per-Beat Tool Usage

$(for i in "${!BEAT_NAMES[@]}"; do
  beat_num=$((i + 1))
  beat_name="${BEAT_NAMES[$i]}"
  out_file="$RESULTS_DIR/raw/${beat_name}.jsonl"
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
REPORTEOF

echo "Report: $RESULTS_DIR/report.md"

# Run analysis if script exists
if [ -f "$SCRIPT_DIR/analyze-demo-test.py" ]; then
  echo "Running analysis..."
  python3 "$SCRIPT_DIR/analyze-demo-test.py" "$RESULTS_DIR" --demo-dir "$WORK_DIR" || echo "WARN: analysis failed — raw results at $RESULTS_DIR/raw/"
fi

# Exit with failure if any beat failed
if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
