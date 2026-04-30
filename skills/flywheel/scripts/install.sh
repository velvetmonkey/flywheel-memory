#!/usr/bin/env bash
# Flywheel MCP installer (POSIX).
#
# Primary job: write/merge Flywheel into <vault>/.mcp.json so the Flywheel
# MCP server is registered for the user's client (Claude Code, Codex, etc).
#
# Secondary: also drop SKILL.md into <vault>/.claude/skills/flywheel/ at
# project scope as a fallback for users who haven't installed the skill
# via `npx skills add velvetmonkey/flywheel-memory`. If the user already
# ran the canonical skill install, this overwrite is harmless.
#
# Optional --codex flag also installs to ~/.codex/skills/flywheel/.

set -euo pipefail

VAULT=""
INSTALL_CODEX=false
for arg in "$@"; do
  case "$arg" in
    --codex) INSTALL_CODEX=true ;;
    --*) echo "error: unknown flag: $arg" >&2; exit 1 ;;
    *) if [ -z "$VAULT" ]; then VAULT="$arg"; else echo "error: unexpected argument: $arg" >&2; exit 1; fi ;;
  esac
done
VAULT="${VAULT:-$PWD}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required for JSON merging but was not found on PATH" >&2
  exit 1
fi

if [ ! -d "$VAULT" ]; then
  echo "error: vault directory does not exist: $VAULT" >&2
  exit 1
fi

cd "$VAULT"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$(cd "$SCRIPT_DIR/.." && pwd)/SKILL.md"

if [ ! -f "$SKILL_SRC" ]; then
  echo "error: SKILL.md not found at $SKILL_SRC" >&2
  echo "  this script expects to live at <repo>/skills/flywheel/scripts/install.sh" >&2
  exit 1
fi

# 1. Merge Flywheel into .mcp.json
MCP_FILE="$VAULT/.mcp.json"
python3 - "$MCP_FILE" <<'PY'
import json, os, sys
path = sys.argv[1]
snippet = {
    "command": "npx",
    "args": ["-y", "@velvetmonkey/flywheel-memory"],
}
if os.path.exists(path):
    with open(path) as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            sys.exit(f"error: existing {path} is not valid JSON: {e}")
else:
    data = {}
servers = data.setdefault("mcpServers", {})
existing = servers.get("flywheel")
if existing == snippet:
    print(f"  unchanged: {path} already has the canonical Flywheel block")
else:
    servers["flywheel"] = snippet
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    print(f"  written:   {path}")
PY

# 2. Install SKILL.md into vault's .claude/skills/flywheel/
SKILL_DEST_DIR="$VAULT/.claude/skills/flywheel"
mkdir -p "$SKILL_DEST_DIR"
cp "$SKILL_SRC" "$SKILL_DEST_DIR/SKILL.md"
echo "  installed: $SKILL_DEST_DIR/SKILL.md"

# 3. Optional Codex install
if [ "$INSTALL_CODEX" = true ]; then
  CODEX_DIR="$HOME/.codex/skills/flywheel"
  mkdir -p "$CODEX_DIR"
  cp "$SKILL_SRC" "$CODEX_DIR/SKILL.md"
  echo "  installed: $CODEX_DIR/SKILL.md (codex)"
fi

echo
echo "Flywheel skill installed."
echo
echo "Next steps:"
echo "  1. Exit your current Claude Code or Codex session if one is running."
echo "  2. Re-launch the client from this directory: \`claude\` or \`codex\`."
echo "  3. The Flywheel MCP server starts on first tool call (~3-5s warmup)."
echo
echo "Do NOT continue in the same session — MCP servers register at client startup only."
