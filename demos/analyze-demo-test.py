#!/usr/bin/env python3
"""Analyze demo test results — extract tool calls per beat and verify expectations."""

import json
import sys
import os
from pathlib import Path

# Expected tools per beat (any of these counts as a pass)
EXPECTED_TOOLS = {
    "beat1-brief": {"brief"},
    "beat2-billing": {"recall", "search"},
    "beat3-tasks": {"policy", "vault_add_task"},
    "beat4-showstopper": {"vault_add_to_section"},
    "beat5-assign": {"vault_update_frontmatter"},
    "beat6-meeting": {"vault_create_note"},
    "beat7-pipeline": {"policy", "search", "recall"},
}


def extract_tool_calls(jsonl_path: str) -> list[str]:
    """Extract flywheel tool names from a stream-json JSONL file."""
    tools = []
    try:
        with open(jsonl_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue

                # stream-json format: look for tool_use events
                if event.get("type") == "tool_use":
                    tool_name = event.get("name", "")
                    # Only count flywheel tools (prefixed with mcp__ or known names)
                    if tool_name.startswith("mcp__flywheel__"):
                        tools.append(tool_name.replace("mcp__flywheel__", ""))
                    elif tool_name in EXPECTED_TOOLS.get("beat1-brief", set()) | \
                         EXPECTED_TOOLS.get("beat2-billing", set()) | \
                         {"vault_add_to_section", "vault_create_note",
                          "vault_update_frontmatter", "vault_add_task", "policy"}:
                        tools.append(tool_name)

                # Also check content_block_start with tool_use type
                if event.get("type") == "content_block_start":
                    cb = event.get("content_block", {})
                    if cb.get("type") == "tool_use":
                        tool_name = cb.get("name", "")
                        if tool_name.startswith("mcp__flywheel__"):
                            tools.append(tool_name.replace("mcp__flywheel__", ""))

    except FileNotFoundError:
        pass
    return tools


def main():
    if len(sys.argv) < 2:
        print("Usage: analyze-demo-test.py <results-dir>")
        sys.exit(1)

    results_dir = Path(sys.argv[1])
    raw_dir = results_dir / "raw"

    if not raw_dir.exists():
        print(f"No raw directory found at {raw_dir}")
        sys.exit(1)

    print("=" * 70)
    print("Demo Beat Analysis")
    print("=" * 70)
    print()

    total = 0
    passed = 0
    results = []

    for beat_name in sorted(EXPECTED_TOOLS.keys()):
        jsonl_path = raw_dir / f"{beat_name}.jsonl"
        tools_used = extract_tool_calls(str(jsonl_path))
        expected = EXPECTED_TOOLS[beat_name]

        # Pass if ANY expected tool was used
        tools_set = set(tools_used)
        hit = expected & tools_set
        status = "PASS" if hit else "FAIL"

        total += 1
        if hit:
            passed += 1

        results.append({
            "beat": beat_name,
            "tools_used": tools_used,
            "expected": sorted(expected),
            "hit": sorted(hit),
            "status": status,
        })

        # Print row
        tools_str = ", ".join(tools_used) if tools_used else "(none)"
        expected_str = ", ".join(sorted(expected))
        print(f"  {beat_name:20s}  {status:4s}  tools=[{tools_str}]  expected=[{expected_str}]")

    print()
    print(f"  {passed}/{total} beats passed")
    print()

    # Write summary JSON
    summary_path = results_dir / "analysis.json"
    with open(summary_path, "w") as f:
        json.dump({
            "total": total,
            "passed": passed,
            "beats": results,
        }, f, indent=2)
    print(f"  Summary written to {summary_path}")

    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
