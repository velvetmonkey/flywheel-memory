#!/usr/bin/env bash
# Compatibility wrapper — forwards to the canonical 9-beat runner.
# Keeps ./run-demo-test.sh and ./run-demo-test.sh --seed-only working
# from the carter-strategy directory (as referenced in DEMO-VIDEO-SCRIPT.md).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CANONICAL="$SCRIPT_DIR/../run-demo-test.sh"

if [[ ! -x "$CANONICAL" ]]; then
  echo "ERROR: canonical runner not found at $CANONICAL" >&2
  exit 1
fi

exec "$CANONICAL" "$@"
