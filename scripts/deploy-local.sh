#!/usr/bin/env bash
#
# deploy-local.sh — versioned on-disk deploy of flywheel-memory.
#
# npm publishing retired 2026-06-06 (personal-engine pivot): consumers point
# at ~/flywheel/releases/current/... instead of the npm registry. Each deploy
# is a full clone of this repo at a release tag, npm ci'd and built, swapped
# in via an atomic `current` symlink flip. Rollback = repoint the symlink at
# a previous release dir and restart the unit.
#
# Usage:
#   scripts/deploy-local.sh [tag] [--prune]
#     tag      release tag to deploy (default: flywheel-memory-v<version from
#              packages/mcp-server/package.json on the current checkout>)
#     --prune  after a successful deploy, keep only the newest 3 release dirs
#
set -euo pipefail

REPO=/home/ben/src/flywheel-memory
ROOT=/home/ben/flywheel/releases
UNIT=flywheel-memory
HEALTH_URL=http://127.0.0.1:3111/health
SMOKE_PORT=3197

PRUNE=0
TAG=""
for arg in "$@"; do
  case "$arg" in
    --prune) PRUNE=1 ;;
    *) TAG="$arg" ;;
  esac
done

if [[ -z "$TAG" ]]; then
  VERSION=$(node -p "require('$REPO/packages/mcp-server/package.json').version")
  TAG="flywheel-memory-v$VERSION"
fi

if ! git -C "$REPO" rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "[deploy] ERROR: tag $TAG not found in $REPO" >&2
  exit 1
fi

DEST="$ROOT/$TAG"
TMP="$DEST.tmp"

if [[ -e "$DEST" ]]; then
  echo "[deploy] ERROR: $DEST already exists — already deployed (rm it to redeploy)" >&2
  exit 1
fi

mkdir -p "$ROOT"
rm -rf "$TMP"

cleanup() { rm -rf "$TMP"; }
trap cleanup ERR

echo "[deploy] cloning $TAG → $TMP"
git clone --quiet --no-hardlinks --depth 1 --branch "$TAG" "$REPO" "$TMP"

echo "[deploy] npm ci"
(cd "$TMP" && npm ci --silent)

# Our own vault-core must resolve to the workspace copy, never the registry.
CORE_LINK="$TMP/node_modules/@velvetmonkey/vault-core"
if [[ ! -L "$CORE_LINK" ]]; then
  echo "[deploy] vault-core not workspace-linked by npm ci — retrying with npm install"
  (cd "$TMP" && npm install --silent)
  if [[ ! -L "$CORE_LINK" ]]; then
    echo "[deploy] ERROR: @velvetmonkey/vault-core did not resolve to the workspace copy" >&2
    exit 1
  fi
fi
# npm ci also installs a NESTED registry copy under packages/mcp-server that
# SHADOWS the workspace symlink (known gotcha — same-version stale shadow).
# Remove it so module resolution falls through to packages/core.
rm -rf "$TMP/packages/mcp-server/node_modules/@velvetmonkey/vault-core"
RESOLVED=$(node -p "require.resolve('@velvetmonkey/vault-core/package.json', {paths:['$TMP/packages/mcp-server']})")
case "$RESOLVED" in
  "$TMP/packages/core/"*) echo "[deploy] vault-core resolves to workspace copy" ;;
  *)
    echo "[deploy] ERROR: vault-core resolves to $RESOLVED (not the workspace copy)" >&2
    exit 1
    ;;
esac

echo "[deploy] build"
(cd "$TMP" && npm run build --silent)

# bin wrapper must stay executable for FLYWHEEL_MEMORY_BIN consumers (flywheel-ideas)
chmod +x "$TMP/packages/mcp-server/bin/flywheel-memory.js"

echo "[deploy] smoke test (HTTP boot on :$SMOKE_PORT against throwaway vault)"
SMOKE_VAULT=$(mktemp -d)
echo "# smoke" > "$SMOKE_VAULT/smoke.md"
VAULT_PATH="$SMOKE_VAULT" FLYWHEEL_TRANSPORT=http FLYWHEEL_HTTP_PORT=$SMOKE_PORT \
  node "$TMP/packages/mcp-server/dist/index.js" >/dev/null 2>&1 &
SMOKE_PID=$!
SMOKE_OK=0
for _ in $(seq 1 60); do
  if curl -sf -m 2 "http://127.0.0.1:$SMOKE_PORT/health" | grep -q '"status":"ok"'; then
    SMOKE_OK=1
    break
  fi
  sleep 1
done
kill "$SMOKE_PID" 2>/dev/null || true
wait "$SMOKE_PID" 2>/dev/null || true
rm -rf "$SMOKE_VAULT"
if [[ "$SMOKE_OK" -ne 1 ]]; then
  echo "[deploy] ERROR: smoke test failed — build does not boot" >&2
  exit 1
fi
echo "[deploy] smoke test OK"

PREV=$(readlink -f "$ROOT/current" 2>/dev/null || true)
mv "$TMP" "$DEST"
ln -sfn "$DEST" "$ROOT/current"
echo "[deploy] current → $DEST"

if systemctl --user list-unit-files "$UNIT.service" --no-legend 2>/dev/null | grep -q "$UNIT"; then
  echo "[deploy] restarting $UNIT"
  systemctl --user restart "$UNIT"
  HEALTH_OK=0
  for _ in $(seq 1 60); do
    if curl -sf -m 2 "$HEALTH_URL" | grep -q '"status":"ok"'; then
      HEALTH_OK=1
      break
    fi
    sleep 1
  done
  if [[ "$HEALTH_OK" -ne 1 ]]; then
    echo "[deploy] ERROR: $UNIT unhealthy after restart." >&2
    if [[ -n "$PREV" && -d "$PREV" ]]; then
      echo "[deploy] rollback: ln -sfn $PREV $ROOT/current && systemctl --user restart $UNIT" >&2
    fi
    exit 1
  fi
  echo "[deploy] $UNIT healthy: $(curl -sf -m 2 "$HEALTH_URL" | head -c 120)"
else
  echo "[deploy] $UNIT.service not installed — skipping restart"
fi

if [[ "$PRUNE" -eq 1 ]]; then
  # Keep the newest 3 release dirs (never the current target)
  CURRENT_TARGET=$(readlink -f "$ROOT/current")
  mapfile -t OLD < <(ls -1dt "$ROOT"/flywheel-memory-v* 2>/dev/null | grep -v "\.tmp$" | tail -n +4)
  for d in "${OLD[@]:-}"; do
    [[ -z "$d" || "$d" == "$CURRENT_TARGET" ]] && continue
    echo "[deploy] pruning $d"
    rm -rf "$d"
  done
fi

echo "[deploy] done: $TAG"
[[ -n "$PREV" ]] && echo "[deploy] previous release: $PREV (rollback: ln -sfn <dir> $ROOT/current && systemctl --user restart $UNIT)"
exit 0
