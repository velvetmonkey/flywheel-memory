#!/usr/bin/env bash
# Sequential demo beat runner for carter-strategy
#
# Runs each beat of the demo script as a non-interactive claude -p call,
# capturing tool usage per beat for verification.
#
# Usage:
#   demos/run-demo-test.sh                  # pinned: sonnet model

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEMO_DIR="$REPO_DIR/demos/carter-strategy"
MCP_SERVER="$REPO_DIR/packages/mcp-server/dist/index.js"
MODEL="sonnet"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
RESULTS_DIR="$REPO_DIR/demos/test-results/demo-$TIMESTAMP"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-5}"

# Pre-flight checks
if [[ ! -f "$MCP_SERVER" ]]; then
  echo "ERROR: MCP server not built. Run: cd $REPO_DIR && npm run build"
  exit 1
fi

# Build MCP config with all 77 tools available
mcp_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$DEMO_DIR","FLYWHEEL_TOOLS":"full,memory"}}}}
EOF
)

echo "=== Demo Beat Test Runner ==="
echo "Demo:    carter-strategy"
echo "Model:   $MODEL"
echo "Tools:   full,memory (77 tools)"
echo "Results: $RESULTS_DIR"
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR/raw"

# Reset vault state
rm -f "$DEMO_DIR/daily-notes/2026-03-20.md"
echo "Reset: deleted daily-notes/2026-03-20.md (if existed)"

# Beat definitions (sequential — each builds on previous vault state)
# Format: beat_name|prompt
declare -a BEAT_NAMES
declare -a BEAT_PROMPTS
declare -a BEAT_EXPECTED

BEAT_NAMES+=("beat1-brief")
BEAT_PROMPTS+=("Brief me on what's happening")
BEAT_EXPECTED+=("brief")

BEAT_NAMES+=("beat2-billing")
BEAT_PROMPTS+=("What's outstanding on billing? Any overdue invoices I need to chase?")
BEAT_EXPECTED+=("search")

BEAT_NAMES+=("beat3-tasks")
BEAT_PROMPTS+=("Add tasks to chase Sarah Mitchell at Acme about those three overdue invoices, and separately remind me to check in with Mike Chen at TechStart about today's invoice. Both due Wednesday.")
BEAT_EXPECTED+=("policy,vault_add_task")

BEAT_NAMES+=("beat4-showstopper")
BEAT_PROMPTS+=("Had a really productive call with Sarah Mitchell and James Rodriguez from Acme Corp this morning about the Data Migration cutover. Great news — UAT is fully complete. All the validation scripts Marcus Webb wrote passed across every table, and the performance benchmarks show we're hitting the 3x improvement target we originally set during the Discovery Workshop back in October. Marcus has confirmed the Airflow pipelines are rock solid and all the rollback procedures are documented in the Data Migration Playbook. We've locked in March 28-29 as the cutover window — Sarah is getting final sign-off from Emily Chen on production environment access. One risk flag: James says the legacy Oracle system decommission timeline still hasn't been confirmed by their IT team. I've asked him to escalate to his director. If we can't get a firm date by next Friday we may need to run both systems in parallel during the support window, which would push costs beyond the original \$75K budget — probably an extra \$8-10K for Marcus's time. On a more positive note, Sarah mentioned the Acme Analytics Add-on proposal I drafted has been circulating with their finance team and getting good reception. She wants to schedule a scoping call with Emily Chen and their data team right after cutover wraps up. I told her Priya Kapoor would be ideal for the requirements gathering given her financial modeling background. Also need to update the Rate Card — Marcus's rate is going up to \$220/hr from April, and we should reflect Leila Farouk's rates for the Nexus Health engagement. Speaking of Nexus Health — Tom Huang emailed back confirming they want to proceed with the Cloud Assessment. He wants to start as soon as Leila is available. I need to check with Leila on her April availability and get the proposal finalized. Mike Chen from TechStart gave them a strong reference which definitely helped close it. Finally, Dan Oliveira pinged me about the Beta Corp Dashboard — he's finished the Pipeline module and wants to demo it to Stacy Thompson before the client presentation next Wednesday.")
BEAT_EXPECTED+=("vault_add_to_section")

BEAT_NAMES+=("beat5-assign")
BEAT_PROMPTS+=("Nexus Health is a go. Assign Leila Farouk as the cloud and security lead and Priya Kapoor for HIPAA compliance analysis. Update their utilization to show they're assigned and mark the proposal status as confirmed. Add a task to finalize the proposal by end of next week.")
BEAT_EXPECTED+=("vault_update_frontmatter,vault_add_task")

BEAT_NAMES+=("beat6-meeting")
BEAT_PROMPTS+=("Create a meeting note for the Acme Corp cutover planning session with Sarah Mitchell and Marcus Webb, scheduled for March 28. Include the key agenda items: production environment access, rollback procedures, and the Oracle decommission risk.")
BEAT_EXPECTED+=("vault_create_note")

BEAT_NAMES+=("beat7-pipeline")
BEAT_PROMPTS+=("Give me a full pipeline overview: active projects, pending proposals, outstanding billing, and team utilization.")
BEAT_EXPECTED+=("policy,search")

echo ""
echo "Running ${#BEAT_NAMES[@]} beats sequentially..."
echo ""

for i in "${!BEAT_NAMES[@]}"; do
  beat_name="${BEAT_NAMES[$i]}"
  prompt="${BEAT_PROMPTS[$i]}"
  expected="${BEAT_EXPECTED[$i]}"

  echo "--- Beat $((i+1)): $beat_name ---"
  echo "Expected tools: $expected"

  # Run claude with the prompt
  mkdir -p "$RESULTS_DIR/raw"
  if claude -p "$prompt" \
    --output-format stream-json \
    --no-session-persistence \
    --permission-mode bypassPermissions \
    --mcp-config <(echo "$mcp_config") \
    --strict-mcp-config \
    --verbose \
    --model "$MODEL" \
    > "$RESULTS_DIR/raw/${beat_name}.jsonl" 2>"$RESULTS_DIR/raw/${beat_name}.stderr"; then
    echo "  -> Completed (output: ${beat_name}.jsonl)"
  else
    echo "  -> FAILED (exit code: $?)"
  fi

  # Sleep between beats to let watcher re-index
  if [ "$i" -lt "$((${#BEAT_NAMES[@]} - 1))" ]; then
    echo "  -> Sleeping ${SLEEP_BETWEEN}s for watcher..."
    sleep "$SLEEP_BETWEEN"
  fi
done

echo ""
echo "=== All beats complete ==="
echo "Results: $RESULTS_DIR"
echo ""

# Restore vault to clean state (undo demo modifications)
echo "Restoring vault to clean state..."
cd "$DEMO_DIR"
git checkout -- . 2>/dev/null || true
# Remove daily notes created during the run
rm -f daily-notes/2026-03-20.md
echo "Vault restored."
echo ""

# Run analysis if script exists
if [ -f "$SCRIPT_DIR/analyze-demo-test.py" ]; then
  echo "Running analysis..."
  python3 "$SCRIPT_DIR/analyze-demo-test.py" "$RESULTS_DIR" || echo "WARN: analysis failed — raw results at $RESULTS_DIR/raw/"
fi
