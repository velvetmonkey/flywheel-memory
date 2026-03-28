#!/usr/bin/env bash
# End-to-end HotpotQA benchmark with retrieval, answer artifacts, and judge.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LIB_DIR="$REPO_DIR/demos/lib"
MCP_SERVER="$REPO_DIR/packages/mcp-server/dist/index.js"
VAULT_DIR="$SCRIPT_DIR/vault"
GROUND_TRUTH="$SCRIPT_DIR/ground-truth.json"
MODEL="${MODEL:-sonnet}"
COUNT="${COUNT:-50}"
SEED="${SEED:-42}"
JUDGE="${JUDGE:-1}"
JUDGE_MODEL="${JUDGE_MODEL:-haiku}"
ANSWER_EXTRACT="${ANSWER_EXTRACT:-1}"
EXTRACT_MODEL="${EXTRACT_MODEL:-haiku}"
ANSWER_MAX_TOKENS="${ANSWER_MAX_TOKENS:-10}"
ANSWER_MAX_CHARS="${ANSWER_MAX_CHARS:-100}"
ANSWER_MAX_SENTENCES="${ANSWER_MAX_SENTENCES:-1}"
QUESTION_TIMEOUT="${QUESTION_TIMEOUT:-180}"
EXTRACT_TIMEOUT="${EXTRACT_TIMEOUT:-30}"
JUDGE_TIMEOUT="${JUDGE_TIMEOUT:-30}"
FORCE_REBUILD="${FORCE_REBUILD:-0}"
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
RESULTS_DIR="${RESUME:-$SCRIPT_DIR/results/run-$TIMESTAMP}"
RAW_DIR="$RESULTS_DIR/raw"
ANSWERS_DIR="$RESULTS_DIR/answers"

if [[ ! -f "$MCP_SERVER" ]]; then
  echo "ERROR: MCP server not built. Run: cd $REPO_DIR && npm run build"
  exit 1
fi

mkdir -p "$RAW_DIR" "$ANSWERS_DIR"

rebuild_reason=""
if [[ "$FORCE_REBUILD" == "1" ]]; then
  rebuild_reason="force_rebuild"
elif [[ ! -d "$VAULT_DIR" || ! -f "$GROUND_TRUTH" ]]; then
  rebuild_reason="missing_vault_or_ground_truth"
else
  rebuild_reason="$(python3 - <<PY
import json
from pathlib import Path
gt = Path("$GROUND_TRUTH")
try:
    data = json.load(gt.open())
except Exception:
    print("invalid_ground_truth")
    raise SystemExit
build = data.get("build_config", {})
if int(data.get("count", -1)) != int("$COUNT"):
    print("count_mismatch")
elif int(data.get("seed", -1)) != int("$SEED"):
    print("seed_mismatch")
elif build.get("count") not in (None, int("$COUNT")):
    print("build_config_count_mismatch")
elif build.get("seed") not in (None, int("$SEED")):
    print("build_config_seed_mismatch")
else:
    print("")
PY
)"
fi

if [[ -n "$rebuild_reason" ]]; then
  echo "Building HotpotQA vault (reason=$rebuild_reason, count=$COUNT, seed=$SEED)..."
  node "$SCRIPT_DIR/build-vault.js" --count "$COUNT" --seed "$SEED"
fi

QUESTION_COUNT=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['count'])")

python3 - <<PY > "$RESULTS_DIR/run-config.json"
import json, subprocess
from datetime import datetime
config = {
    "dataset": "hotpot_dev_distractor_v1",
    "generated": datetime.now().isoformat(),
    "count": int("$QUESTION_COUNT"),
    "seed": int("$SEED"),
    "model": "$MODEL",
    "judge": bool(int("$JUDGE")),
    "judge_model": "$JUDGE_MODEL",
    "answer_extract": bool(int("$ANSWER_EXTRACT")),
    "extract_model": "$EXTRACT_MODEL",
    "thresholds": {
        "max_tokens": int("$ANSWER_MAX_TOKENS"),
        "max_chars": int("$ANSWER_MAX_CHARS"),
        "max_sentences": int("$ANSWER_MAX_SENTENCES"),
    },
    "timeouts": {
        "question": int("$QUESTION_TIMEOUT"),
        "extract": int("$EXTRACT_TIMEOUT"),
        "judge": int("$JUDGE_TIMEOUT"),
    },
    "resume": bool("${RESUME:+1}" != ""),
    "force_rebuild": bool(int("$FORCE_REBUILD")),
    "git_commit": subprocess.run(
        ["git", "-C", "$REPO_DIR", "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip() or "unknown",
}
print(json.dumps(config, indent=2))
PY

echo ""
echo "=== HotpotQA End-to-End Benchmark ==="
echo "Questions:     $QUESTION_COUNT"
echo "Model:         $MODEL"
echo "Judge:         $JUDGE ($JUDGE_MODEL)"
echo "Extract:       $ANSWER_EXTRACT ($EXTRACT_MODEL)"
echo "Results:       $RESULTS_DIR"
echo ""

mcp_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$VAULT_DIR","FLYWHEEL_TOOLS":"default"}}}}
EOF
)

warmup_config=$(cat <<EOF
{"mcpServers":{"flywheel":{"command":"node","args":["$MCP_SERVER"],"env":{"PROJECT_PATH":"$VAULT_DIR","FLYWHEEL_TOOLS":"full"}}}}
EOF
)

if [[ -n "${RESUME:-}" ]] && [[ -f "$RESULTS_DIR/warmup.jsonl" ]]; then
  echo "Resuming — skipping warmup"
else
  echo "Pre-warming vault: index + auto-link + embeddings..."
  if claude -p "Bootstrap this vault for benchmarking. Run these steps in order:
1. Call health_check and report entity_count and note_count.
2. Call vault_init with mode='enrich' and dry_run=false.
3. Call refresh_index.
4. Call init_semantic and wait for completion.
5. Call health_check and confirm fts5_ready=true and embeddings_ready=true.
Report final status." \
    --output-format stream-json \
    --no-session-persistence \
    --permission-mode bypassPermissions \
    --mcp-config <(echo "$warmup_config") \
    --strict-mcp-config \
    --model haiku \
    > "$RESULTS_DIR/warmup.jsonl" 2>"$RESULTS_DIR/warmup.stderr"; then
    echo "Vault pre-warmed"
  else
    echo "ERROR: Pre-warm failed. See $RESULTS_DIR/warmup.stderr"
    exit 1
  fi
fi
echo ""

for i in $(seq 0 $((QUESTION_COUNT - 1))); do
  padded=$(printf "%03d" "$i")
  raw_path="$RAW_DIR/q${padded}.jsonl"
  stderr_path="$RAW_DIR/q${padded}.stderr"
  answer_path="$ANSWERS_DIR/q${padded}.json"

  if [[ -f "$answer_path" ]] && python3 - <<PY
import json, sys
data = json.load(open("$answer_path"))
ok = data.get("generation_status") == "completed"
if int("$JUDGE"):
    ok = ok and data.get("judge_status") == "scored"
sys.exit(0 if ok else 1)
PY
  then
    echo "  q${padded}: skip (artifact complete)"
    continue
  fi

  question=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['questions'][$i]['question'])")
  answer=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['questions'][$i]['answer'])")
  qtype=$(python3 -c "import json; print(json.load(open('$GROUND_TRUTH'))['questions'][$i]['type'])")

  echo -n "  q${padded} [${qtype}]: "

  if timeout "$QUESTION_TIMEOUT" claude -p "Answer this question using the Flywheel MCP tools search, get_note_structure, get_section_content, and find_sections.
Search first, then read the most relevant notes to verify the answer.
For bridge questions, search again using facts from the first document to find the second.

Question: $question

Return exactly one final line in this format:
ANSWER: <short answer>

Rules:
- Output the shortest standalone answer possible.
- Do not include any explanation before or after the ANSWER line.
- If the answer is not supported by the vault, reply exactly:
ANSWER: Not stated in the vault." \
    --output-format stream-json \
    --no-session-persistence \
    --permission-mode bypassPermissions \
    --mcp-config <(echo "$mcp_config") \
    --strict-mcp-config \
    --disallowedTools "ToolSearch,Agent,Bash,Glob,Grep,Read,WebSearch,WebFetch" \
    --model "$MODEL" \
    > "$raw_path" 2>"$stderr_path"; then
    echo "generated"
  else
    echo "FAILED generation"
  fi

  if python3 "$LIB_DIR/answer_layer.py" process \
    --dataset hotpot_dev_distractor_v1 \
    --jsonl "$raw_path" \
    --output "$answer_path" \
    --question "$question" \
    --ground-truth "$answer" \
    --category "$qtype" \
    --answer-extract "$ANSWER_EXTRACT" \
    --extract-model "$EXTRACT_MODEL" \
    --judge "$JUDGE" \
    --judge-model "$JUDGE_MODEL" \
    --answer-max-tokens "$ANSWER_MAX_TOKENS" \
    --answer-max-chars "$ANSWER_MAX_CHARS" \
    --answer-max-sentences "$ANSWER_MAX_SENTENCES" \
    --extract-timeout "$EXTRACT_TIMEOUT" \
    --judge-timeout "$JUDGE_TIMEOUT" \
    > /dev/null 2>"$ANSWERS_DIR/q${padded}.process.stderr"; then
    :
  else
    echo "  q${padded}: answer-layer processing failed"
  fi
done

echo ""
echo "=== All questions complete ==="
echo ""

python3 "$SCRIPT_DIR/analyze-benchmark.py" "$RESULTS_DIR" "$GROUND_TRUTH"
