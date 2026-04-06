#!/usr/bin/env bash
# BYOV Evaluation — starts server, runs eval, stops server
# Usage: VAULT_PATH=/path/to/vault ./run-eval.sh [questions.jsonl]

set -euo pipefail

QUESTIONS="${1:-questions-example.jsonl}"
PORT="${FLYWHEEL_HTTP_PORT:-3111}"
URL="http://localhost:${PORT}"
VAULT="${VAULT_PATH:?Set VAULT_PATH to your vault directory}"

echo "Starting flywheel-memory server..."
VAULT_PATH="$VAULT" FLYWHEEL_TRANSPORT=http FLYWHEEL_HTTP_PORT="$PORT" \
  npx -y @velvetmonkey/flywheel-memory &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT

echo "Running evaluation..."
cd "$(dirname "$0")"
npx tsx ../../packages/bench/src/cli/byov.ts \
  --questions "$QUESTIONS" \
  --url "$URL" \
  --output results.json

echo "Results written to results.json"
cat results.json | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(\"\nEvidence recall: \" + (data.summary.evidence_recall * 100).toFixed(1) + '%');
  console.log('Keyword recall: ' + (data.summary.keyword_recall * 100).toFixed(1) + '%');
  console.log('Questions: ' + data.summary.total_questions);
"
