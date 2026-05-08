#!/usr/bin/env bash
# Flywheel MCP installer (POSIX).
#
# Single job: write/merge Flywheel into <vault>/.mcp.json so the Flywheel MCP
# server is registered for the user's client (Claude Code, Codex, etc).
#
# The Flywheel agent skill (SKILL.md) is installed separately via:
#   npx -y skills add velvetmonkey/flywheel-memory -g
# Run that first; this script only handles the MCP wiring step.
#
# Safe to invoke via:
#   bash <(curl -fsSL .../install.sh)        # process substitution
#   curl -fsSL .../install.sh | bash         # pure pipe
#   bash /path/to/cloned/repo/.../install.sh # in-tree
# All three shapes write the same .mcp.json.

set -euo pipefail

VAULT="${1:-$PWD}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required for JSON merging but was not found on PATH" >&2
  exit 1
fi

if [ ! -d "$VAULT" ]; then
  echo "error: vault directory does not exist: $VAULT" >&2
  exit 1
fi

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

echo
echo "Flywheel MCP wired into $MCP_FILE"
echo
echo "Next steps:"
echo "  1. If you haven't installed the agent skill: npx -y skills add velvetmonkey/flywheel-memory -g"
echo "  2. Exit your current Claude Code or Codex session if one is running."
echo "  3. Re-launch the client from this directory: \`claude\` or \`codex\`."
echo "  4. The Flywheel MCP server starts on first tool call (~3-5s warmup)."
echo
echo "Do NOT continue in the same session — MCP servers register at client startup only."
