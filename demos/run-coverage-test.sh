#!/usr/bin/env bash
# Full tool coverage test — one targeted prompt per default-visible flywheel tool (65 visible).
# Canonical tool source: packages/mcp-server/src/config.ts (TOOL_CATEGORY).
# discover_tools is disclosure-only and excluded from this coverage surface.
#
# Usage:
#   demos/run-coverage-test.sh                        # default: 1 run, sonnet
#   RUNS=2 demos/run-coverage-test.sh
#   SKIP_TO=30 demos/run-coverage-test.sh             # resume from tool #30

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_SERVER="$REPO_ROOT/packages/mcp-server/dist/index.js"
DEMO_DIR="$SCRIPT_DIR/carter-strategy"
RUNS=${RUNS:-1}
MODEL="sonnet"
SKIP_TO=${SKIP_TO:-1}
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
RESULTS_DIR="$SCRIPT_DIR/test-results/coverage-$TIMESTAMP"

# Tool definitions: tool_name|FLYWHEEL_TOOLS|prompt|resets(yes/no)
# One entry per default-visible flywheel tool, organized by category.
TOOLS=(
  # --- search (2) ---
  'search|default|How much have I billed Acme Corp?|no'
  'init_semantic|default|Build a semantic search index for this vault so I can do similarity searches|no'

  # --- read (1) ---
  'read|structure|Show me the full structure and content of the note at clients/Acme Corp.md|no'
  'read|section|Show me just the content of the Notes section in the Acme Corp file|no'
  'read|sections|Find all sections with Status in the heading across every note in the vault|no'

  # --- write (7) ---
  'edit_section|default|Add a line saying Reviewed Q1 billing with Sarah under the Notes section in the Acme Corp file|yes'
  'edit_section|default|Remove the line saying "This is a test line." from the Notes section of clients/Acme Corp.md|yes'
  'edit_section|default|Replace the entire Status section content in the Data Migration project note with Phase 3 - UAT Complete|yes'
  'vault_update_frontmatter|default|Set the frontmatter status field to reviewed in clients/Acme Corp.md|yes'
  'note|default|Create a new meeting note called Weekly Standup 2026-03-21 in the meetings folder with agenda items for billing review and project updates|yes'
  'correct|default|Add a test line to the Notes section of Acme Corp, then immediately undo that last change|yes'
  'policy|default|Create and execute a policy that adds a Review Notes section to every client note in the clients folder|yes'

  # --- graph (6) ---
  'graph|default,graph|Analyze the overall graph structure of this vault and show me clusters, bridges, and hub nodes|no'
  'semantic_analysis|default,graph|Run a semantic analysis on this vault to find topic clusters and conceptual bridges between notes|no'
  'graph|default,graph|How strong is the connection between Acme Corp and Sarah Mitchell? Give me the strength score.|no'
  'entity|default,graph|List all entities in this vault with their categories|no'
  'graph|default,graph|Find the shortest link path between Sarah Mitchell and TechStart Inc through the vault graph|no'
  'graph|default,graph|What are the common neighbors shared between Acme Corp and Data Migration in the vault graph?|no'

  # --- schema (7) ---
  'schema|default,schema|Show me the frontmatter schema used across this vault - what fields exist and their types|no'
  'schema|default,schema|What frontmatter conventions and patterns are used across the notes in this vault?|no'
  'schema|default,schema|Validate all client notes against this schema: required fields are type, status, and contact. Status must be one of active, inactive, or prospect. Report any violations.|no'
  'schema|default,schema|Give me a full intelligence report on the Acme Corp client note - completeness, quality, suggestions|no'
  'schema|default,schema|Rename the frontmatter field type to note_type across all notes in the vault|yes'
  'schema|default,schema|Migrate all frontmatter status values from active to in-progress across the vault|yes'
  'schema|default,schema|Rename the tag #client to #customer across all notes in the vault|yes'

  # --- wikilinks (7) ---
  'link|default,wikilinks|Suggest wikilinks that should be added to the Data Migration project note|no'
  'link|default,wikilinks|Check all wikilinks in the vault for broken or invalid links|no'
  'link|default,wikilinks|Record positive feedback for the entity Sarah Mitchell appearing in the Acme Corp note|yes'
  'link|default,wikilinks|What entities are mentioned frequently in notes but do not have their own dedicated note yet?|no'
  'link|default,wikilinks|Find entity pairs that frequently co-occur in notes but are not directly linked to each other|no'
  'link|default,wikilinks|Suggest alternate name aliases for entities in this vault that might be referred to differently|no'
  'unlinked_mentions_report|default,wikilinks|Generate a full report of all unlinked entity mentions across every note in the vault|no'

  # --- corrections (4) ---
  'correct|default,corrections|Record a correction: the wikilink Data Migration in the Acme Corp note should point to Acme Data Migration instead|yes'
  'correct|default,corrections|List all pending corrections in this vault|no'
  'correct|default,corrections|First record a correction that Migration should actually be Data Migration, then resolve that correction|yes'
  'entity|default,corrections|Absorb the name SM as an alias for the entity Sarah Mitchell|yes'

  # --- tasks (3) ---
  'tasks|default|Show me all open tasks across every note in the vault|no'
  'vault_add_task|default|Add a task to the Acme Corp note saying Follow up with Sarah about Q1 billing, due next Wednesday|yes'
  'tasks|default|Mark the task "Final production environment access" as complete in projects/Acme Data Migration.md|yes'

  # --- memory (3) ---
  'memory|default,memory|Use the vault memory tool to store an observation: the Acme Data Migration cutover is confirmed for March 28-29 and all UAT has passed|yes'
  'search|default,memory|Search for everything relevant about billing, invoices, and payment status in this vault|no'
  'memory|default,memory|Brief me on the current state of this vault - what is happening, what needs attention|no'

  # --- note-ops (4) ---
  'note|default,note-ops|Delete the note at admin/Business Goals 2026.md from the vault|yes'
  'note|default,note-ops|Move the note at projects/Cloud Strategy Template.md to knowledge/Cloud Strategy Engagement Template.md|yes'
  'note|default,note-ops|Rename the note at admin/Business Goals 2026.md to 2026 Business Goals|yes'
  'entity|default,note-ops|The Cloud Strategy Template note is really about the Acme Data Migration. Merge Cloud Strategy Template into Acme Data Migration.|yes'

  # --- temporal (3) ---
  'insights|default,temporal|What was happening in this vault around January 2026? Show me the context.|no'
  'insights|default,temporal|Which notes in this vault are most likely to be stale or outdated?|no'
  'insights|default,temporal|How has the concept of Data Migration evolved over time in this vault?|no'

  # --- diagnostics (16) ---
  'refresh_index|default,diagnostics|Refresh the vault index to make sure everything is up to date|no'
  'insights|default,diagnostics|Show me how this vault has grown over time - note creation and link trends|no'
  'doctor|default,diagnostics|Show me the current flywheel configuration settings for this vault|no'
  'doctor|default,diagnostics|Show me the recent flywheel server log entries|no'
  'suggest_entity_merges|default,diagnostics|Are there any duplicate or similar entities in this vault that should be merged?|no'
  'dismiss_merge_suggestion|default,diagnostics|Check for entity merge suggestions, then dismiss any that are not relevant|no'
  'vault_init|default,diagnostics|Initialize this vault with flywheel enrichment and wikilinks|yes'
  'doctor|default,diagnostics|Run the flywheel doctor diagnostic to check for any issues with this vault|no'
  'doctor|default,diagnostics|Show me the current pipeline status for this vault|no'
  'flywheel_trust_report|default,diagnostics|Generate a trust report for this vault showing scoring reliability and safety metrics|no'
  'flywheel_benchmark|default,diagnostics|Run a benchmark test on this vault to measure search and scoring performance|no'
  'vault_session_history|default,diagnostics|Show me the session history for this vault - what queries and operations have been run|no'
  'vault_entity_history|default,diagnostics|Show me the history of the Acme Corp entity - how it has changed over time|no'
  'flywheel_learning_report|default,diagnostics|Generate a learning report showing how the scoring system has improved over time|no'
  'flywheel_calibration_export|default,diagnostics|Export the calibration data for this vault so I can analyze scoring patterns|no'
  'tool_selection_feedback|default,diagnostics|Record positive tool selection feedback: the search tool was correctly chosen, mode report, tool_name search, correct true|no'
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

echo "=== Full Tool Coverage Test ==="
echo "Model:      $MODEL"
echo "Runs/tool:  $RUNS"
echo "Tools:      ${#TOOLS[@]}"
echo "Total:      $((${#TOOLS[@]} * RUNS)) runs"
echo "Skip to:    $SKIP_TO"
echo "Output:     $RESULTS_DIR"
echo ""

completed=0
total=$((${#TOOLS[@]} * RUNS))
tool_num=0

for entry in "${TOOLS[@]}"; do
  IFS='|' read -r tool_name tools_env prompt resets <<< "$entry"
  tool_num=$((tool_num + 1))

  if [[ "$tool_num" -lt "$SKIP_TO" ]]; then
    completed=$((completed + RUNS))
    continue
  fi

  # Clean state between every tool test
  rm -f "$DEMO_DIR/.flywheel/state.db" "$DEMO_DIR/.flywheel/state.db-wal" "$DEMO_DIR/.flywheel/state.db-shm"

  # Build MCP config
  mcp_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$DEMO_DIR","FLYWHEEL_TOOLS":"$tools_env"}}}}
EOF
  )

  for run in $(seq 1 "$RUNS"); do
    out="$RESULTS_DIR/raw/${tool_name}_run${run}.jsonl"
    completed=$((completed + 1))
    echo "[$completed/$total] #$tool_num $tool_name (run $run/$RUNS)..."

    cd "$DEMO_DIR"
    timeout 120 claude -p "$prompt" \
      --output-format stream-json \
      --verbose \
      --no-session-persistence \
      --permission-mode bypassPermissions \
      --mcp-config <(echo "$mcp_config") \
      --strict-mcp-config \
      --model "$MODEL" \
      2>/dev/null > "$out" || true

    # Reset vault for write tools
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

python3 "$SCRIPT_DIR/analyze-coverage-test.py" "$RESULTS_DIR"

echo ""
echo "Report: $RESULTS_DIR/report.md"
