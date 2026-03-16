#!/usr/bin/env python3
"""Analyze tool-test JSONL output and produce a markdown report."""
import json
import sys
import os
import glob
from collections import defaultdict
from datetime import datetime


def extract_tool_calls(filepath):
    """Extract ordered list of tool names from a stream-json JSONL file."""
    tools = []
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                if obj.get("type") == "assistant":
                    for block in obj.get("message", {}).get("content", []):
                        if isinstance(block, dict) and block.get("type") == "tool_use":
                            tools.append(block["name"])
            except (json.JSONDecodeError, KeyError):
                pass
    return tools


def classify(name):
    """Classify a tool call as flywheel, builtin file access, discovery, or other."""
    if name.startswith("mcp__flywheel__"):
        return "flywheel"
    if name in ("Read", "Glob", "Grep", "Bash"):
        return "builtin_file"
    if name == "ToolSearch":
        return "discovery"
    return "other"


def analyze_run(tools):
    """Compute metrics for a single run's tool calls."""
    classified = [(t, classify(t)) for t in tools]

    # First non-discovery tool
    first_real = next((t for t, c in classified if c != "discovery"), None)

    flywheel_count = sum(1 for _, c in classified if c == "flywheel")
    builtin_count = sum(1 for _, c in classified if c == "builtin_file")
    search_used = any(t == "mcp__flywheel__search" for t in tools)
    bypassed = not search_used and builtin_count > 0

    return {
        "sequence": tools,
        "first": first_real,
        "search_first": first_real == "mcp__flywheel__search",
        "search_used": search_used,
        "flywheel": flywheel_count,
        "builtin": builtin_count,
        "bypassed": bypassed,
    }


def parse_results_dir(results_dir):
    """Parse all JSONL files in raw/ subdirectory, grouped by demo."""
    raw_dir = os.path.join(results_dir, "raw")
    demos = defaultdict(list)

    for filepath in sorted(glob.glob(os.path.join(raw_dir, "*.jsonl"))):
        basename = os.path.basename(filepath)
        # Format: demoname_runN.jsonl
        parts = basename.rsplit("_run", 1)
        if len(parts) != 2:
            continue
        demo_name = parts[0]
        tools = extract_tool_calls(filepath)
        run_metrics = analyze_run(tools)
        run_metrics["file"] = basename
        demos[demo_name].append(run_metrics)

    return demos


DEMO_PROMPTS = {
    "carter-strategy": "How much have I billed Acme Corp?",
    "artemis-rocket": "What's blocking propulsion?",
    "startup-ops": "What's our MRR?",
    "nexus-lab": "How does AlphaFold connect to my experiment?",
    "solo-operator": "How's revenue looking?",
    "support-desk": "What's Sarah Chen's situation?",
    "zettelkasten": "How does spaced repetition connect to active recall?",
}


def short_tool(name):
    """Shorten tool names for display."""
    return name.replace("mcp__flywheel__", "fw:")


def generate_report(demos, results_dir):
    """Generate markdown report from parsed results."""
    # Infer metadata from directory name
    dirname = os.path.basename(results_dir)
    total_runs = sum(len(runs) for runs in demos.values())

    lines = []
    lines.append("# Tool-Usage Test Report")
    lines.append("")
    lines.append(f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}  ")
    lines.append(f"**Runs/demo:** {max(len(r) for r in demos.values()) if demos else 0}  ")
    lines.append(f"**Total runs:** {total_runs}  ")
    lines.append(f"**Results dir:** `{dirname}`")
    lines.append("")

    # Aggregate counters
    agg_search_first = 0
    agg_search_used = 0
    agg_bypassed = 0
    agg_flywheel = 0
    agg_builtin = 0

    lines.append("## Per-Demo Results")
    lines.append("")

    for demo_name in sorted(demos.keys()):
        runs = demos[demo_name]
        prompt = DEMO_PROMPTS.get(demo_name, "?")

        lines.append(f"### {demo_name}")
        lines.append(f"> {prompt}")
        lines.append("")
        lines.append("| Run | First Tool | Search? | Flywheel | Built-in | Bypassed? | Tool Sequence |")
        lines.append("|-----|-----------|---------|----------|----------|-----------|---------------|")

        for i, r in enumerate(runs, 1):
            first = short_tool(r["first"]) if r["first"] else "—"
            search = "Yes" if r["search_used"] else "No"
            bypassed = "YES" if r["bypassed"] else "No"
            seq = " → ".join(short_tool(t) for t in r["sequence"][:8])
            if len(r["sequence"]) > 8:
                seq += f" (+{len(r['sequence']) - 8})"

            lines.append(f"| {i} | {first} | {search} | {r['flywheel']} | {r['builtin']} | {bypassed} | {seq} |")

            agg_search_first += int(r["search_first"])
            agg_search_used += int(r["search_used"])
            agg_bypassed += int(r["bypassed"])
            agg_flywheel += r["flywheel"]
            agg_builtin += r["builtin"]

        lines.append("")

    # Aggregate
    lines.append("## Aggregate")
    lines.append("")
    lines.append("| Metric | Result | Baseline (pre-changes) |")
    lines.append("|--------|--------|------------------------|")

    if total_runs > 0:
        pct = lambda n: f"{n}/{total_runs} ({100*n//total_runs}%)"
        avg = lambda n: f"{n/total_runs:.1f}"

        lines.append(f"| Search used as first tool | {pct(agg_search_first)} | ~8/17 (47%) |")
        lines.append(f"| Search used at all | {pct(agg_search_used)} | — |")
        lines.append(f"| Bypassed flywheel entirely | {pct(agg_bypassed)} | 9/17 (53%) |")
        lines.append(f"| Avg flywheel calls/run | {avg(agg_flywheel)} | — |")
        lines.append(f"| Avg built-in file calls/run | {avg(agg_builtin)} | — |")
    else:
        lines.append("| No data | — | — |")

    lines.append("")

    # Per-demo bypass summary
    lines.append("## Per-Demo Bypass Summary")
    lines.append("")
    lines.append("| Demo | Bypass Rate | Notes |")
    lines.append("|------|------------|-------|")

    for demo_name in sorted(demos.keys()):
        runs = demos[demo_name]
        bypass_count = sum(1 for r in runs if r["bypassed"])
        total = len(runs)
        rate = f"{bypass_count}/{total}"
        status = "PASS" if bypass_count == 0 else "FAIL"
        lines.append(f"| {demo_name} | {rate} | {status} |")

    lines.append("")
    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print("Usage: analyze-tool-test.py <results-dir>", file=sys.stderr)
        sys.exit(1)

    results_dir = sys.argv[1]
    demos = parse_results_dir(results_dir)

    if not demos:
        print("No results found in", results_dir, file=sys.stderr)
        sys.exit(1)

    print(generate_report(demos, results_dir))


if __name__ == "__main__":
    main()
