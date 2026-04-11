#!/usr/bin/env python3
"""Analyze bundle adoption test results — measure tool coverage per bundle."""

import json
import sys
import os
import glob
import argparse
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# Full tool → category mapping — canonical source is packages/mcp-server/src/config.ts (TOOL_CATEGORY).
# Keep this dict in sync when tools are added or removed.
TOOL_CATEGORY = {
    # search (3 tools)
    "search": "search",
    "init_semantic": "search",
    "discover_tools": "search",
    # read (3 tools)
    "get_note_structure": "read",
    "get_section_content": "read",
    "find_sections": "read",
    # write (7 tools)
    "vault_add_to_section": "write",
    "vault_remove_from_section": "write",
    "vault_replace_in_section": "write",
    "vault_update_frontmatter": "write",
    "vault_create_note": "write",
    "vault_undo_last_mutation": "write",
    "policy": "write",
    # graph (6 tools)
    "graph_analysis": "graph",
    "semantic_analysis": "graph",
    "get_connection_strength": "graph",
    "list_entities": "graph",
    "get_link_path": "graph",
    "get_common_neighbors": "graph",
    # schema (7 tools)
    "vault_schema": "schema",
    "schema_conventions": "schema",
    "schema_validate": "schema",
    "note_intelligence": "schema",
    "rename_field": "schema",
    "migrate_field_values": "schema",
    "rename_tag": "schema",
    # wikilinks (7 tools)
    "suggest_wikilinks": "wikilinks",
    "validate_links": "wikilinks",
    "wikilink_feedback": "wikilinks",
    "discover_stub_candidates": "wikilinks",
    "discover_cooccurrence_gaps": "wikilinks",
    "suggest_entity_aliases": "wikilinks",
    "unlinked_mentions_report": "wikilinks",
    # corrections (4 tools)
    "vault_record_correction": "corrections",
    "vault_list_corrections": "corrections",
    "vault_resolve_correction": "corrections",
    "absorb_as_alias": "corrections",
    # tasks (3 tools)
    "tasks": "tasks",
    "vault_toggle_task": "tasks",
    "vault_add_task": "tasks",
    # memory (2 tools)
    "memory": "memory",
    "brief": "memory",
    # note-ops (4 tools)
    "vault_delete_note": "note-ops",
    "vault_move_note": "note-ops",
    "vault_rename_note": "note-ops",
    "merge_entities": "note-ops",
    # temporal (3 tools)
    "get_context_around_date": "temporal",
    "predict_stale_notes": "temporal",
    "track_concept_evolution": "temporal",
    # diagnostics (16 tools)
    "refresh_index": "diagnostics",
    "vault_growth": "diagnostics",
    "flywheel_config": "diagnostics",
    "server_log": "diagnostics",
    "suggest_entity_merges": "diagnostics",
    "dismiss_merge_suggestion": "diagnostics",
    "vault_init": "diagnostics",
    "flywheel_doctor": "diagnostics",
    "flywheel_trust_report": "diagnostics",
    "flywheel_benchmark": "diagnostics",
    "pipeline_status": "diagnostics",
    "vault_session_history": "diagnostics",
    "vault_entity_history": "diagnostics",
    "flywheel_learning_report": "diagnostics",
    "flywheel_calibration_export": "diagnostics",
    "tool_selection_feedback": "diagnostics",
}

# Reverse: category → list of tools
CATEGORY_TOOLS = defaultdict(list)
for tool, cat in TOOL_CATEGORY.items():
    CATEGORY_TOOLS[cat].append(tool)

# Bundle definitions: bundle name → target category
BUNDLE_TARGET = {
    "search": "search",
    "read": "read",
    "write": "write",
    "graph": "graph",
    "schema": "schema",
    "wikilinks": "wikilinks",
    "corrections": "corrections",
    "tasks": "tasks",
    "memory": "memory",
    "note-ops": "note-ops",
    "temporal": "temporal",
    "diagnostics": "diagnostics",
}


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


def normalize_tool(name):
    """Strip mcp__flywheel__ prefix from tool names."""
    return name.replace("mcp__flywheel__", "")


def analyze_bundle_run(tools, target_bundle):
    """Analyze a single run against its target bundle."""
    target_category = BUNDLE_TARGET.get(target_bundle)
    target_tools = set(CATEGORY_TOOLS.get(target_category, []))

    normalized = [normalize_tool(t) for t in tools]

    # Which target-bundle tools were called
    used_target = [t for t in normalized if t in target_tools]
    unused_target = target_tools - set(used_target)

    # Other tools by category
    other_by_cat = defaultdict(list)
    for t in normalized:
        if t not in target_tools:
            cat = TOOL_CATEGORY.get(t, "builtin")
            other_by_cat[cat].append(t)

    adoption_hit = len(used_target) > 0

    return {
        "sequence": normalized,
        "target_tools_used": sorted(set(used_target)),
        "target_tools_unused": sorted(unused_target),
        "other_by_category": dict(other_by_cat),
        "adoption_hit": adoption_hit,
        "distinct_target": len(set(used_target)),
        "total_target": len(target_tools),
    }


def short_tool(name):
    """Shorten tool names for display."""
    return name.replace("mcp__flywheel__", "fw:")


def parse_results_dir(results_dir):
    """Parse all JSONL files grouped by bundle."""
    raw_dir = os.path.join(results_dir, "raw")
    bundles = defaultdict(list)

    for filepath in sorted(glob.glob(os.path.join(raw_dir, "*.jsonl"))):
        basename = os.path.basename(filepath)
        # Format: bundlename_runN.jsonl
        parts = basename.rsplit("_run", 1)
        if len(parts) != 2:
            continue
        bundle_name = parts[0]
        tools = extract_tool_calls(filepath)
        run_result = analyze_bundle_run(tools, bundle_name)
        run_result["file"] = basename
        bundles[bundle_name].append(run_result)

    return bundles


def generate_report(bundles, results_dir):
    """Generate markdown report from parsed results."""
    dirname = os.path.basename(results_dir)
    total_runs = sum(len(runs) for runs in bundles.values())

    lines = []
    lines.append("# Bundle Adoption Test Report")
    lines.append("")
    lines.append(f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}  ")
    lines.append(f"**Runs/bundle:** {max(len(r) for r in bundles.values()) if bundles else 0}  ")
    lines.append(f"**Bundles tested:** {len(bundles)}  ")
    lines.append(f"**Total runs:** {total_runs}  ")
    lines.append(f"**Results dir:** `{dirname}`")
    lines.append("")

    # Per-bundle detail
    lines.append("## Per-Bundle Results")
    lines.append("")

    for bundle_name in sorted(bundles.keys()):
        runs = bundles[bundle_name]
        target_cat = BUNDLE_TARGET.get(bundle_name, "?")
        target_tools = CATEGORY_TOOLS.get(target_cat, [])

        lines.append(f"### {bundle_name}")
        lines.append(f"> Category: `{target_cat}` ({len(target_tools)} tools)")
        lines.append("")
        lines.append("| Run | Target Tools Used | Other Tools | Hit? | Sequence |")
        lines.append("|-----|-------------------|-------------|------|----------|")

        for i, r in enumerate(runs, 1):
            target_str = ", ".join(r["target_tools_used"]) if r["target_tools_used"] else "(none)"
            other_parts = []
            for cat, tools in sorted(r["other_by_category"].items()):
                other_parts.append(f"{cat}:{len(tools)}")
            other_str = ", ".join(other_parts) if other_parts else "(none)"
            hit = "Yes" if r["adoption_hit"] else "No"
            seq = " -> ".join(r["sequence"][:8])
            if len(r["sequence"]) > 8:
                seq += f" (+{len(r['sequence']) - 8})"
            lines.append(f"| {i} | {target_str} | {other_str} | {hit} | {seq} |")

        lines.append("")

    # Adoption summary table
    lines.append("## Adoption Summary")
    lines.append("")
    lines.append("| Bundle | Tools Available | Adoption Rate | Distinct Tools Hit | Tools Never Used |")
    lines.append("|--------|---------------|---------------|-------------------|------------------|")

    total_adopted = 0
    for bundle_name in sorted(bundles.keys()):
        runs = bundles[bundle_name]
        target_cat = BUNDLE_TARGET.get(bundle_name, "?")
        target_tools = CATEGORY_TOOLS.get(target_cat, [])

        hits = sum(1 for r in runs if r["adoption_hit"])
        total = len(runs)
        rate = f"{hits}/{total} ({100 * hits // total}%)" if total > 0 else "0/0"
        if hits > 0:
            total_adopted += 1

        all_used = set()
        for r in runs:
            all_used.update(r["target_tools_used"])
        distinct = len(all_used)
        never_used = sorted(set(target_tools) - all_used)
        never_str = ", ".join(never_used) if never_used else "(all used)"

        lines.append(f"| {bundle_name} | {len(target_tools)} | {rate} | {distinct}/{len(target_tools)} | {never_str} |")

    lines.append("")

    # Full coverage matrix
    lines.append("## Full Coverage Matrix")
    lines.append("")
    lines.append("| Tool | Category | Times Used |")
    lines.append("|------|----------|-----------|")

    tool_usage = defaultdict(int)
    for runs in bundles.values():
        for r in runs:
            for t in r["sequence"]:
                tool_usage[t] += 1

    # Show flywheel tools sorted by category then name
    for cat in ["search", "read", "write", "graph", "schema", "wikilinks",
                "corrections", "tasks", "memory", "note-ops", "temporal", "diagnostics"]:
        for tool in sorted(CATEGORY_TOOLS[cat]):
            count = tool_usage.get(tool, 0)
            lines.append(f"| {tool} | {cat} | {count} |")

    # Also show builtin tools
    for tool in sorted(tool_usage.keys()):
        if tool not in TOOL_CATEGORY:
            lines.append(f"| {tool} | builtin | {tool_usage[tool]} |")

    lines.append("")

    # Overall summary
    flywheel_tools_used = set()
    for runs in bundles.values():
        for r in runs:
            for t in r["sequence"]:
                if t in TOOL_CATEGORY:
                    flywheel_tools_used.add(t)

    lines.append("## Overall")
    lines.append("")
    lines.append(f"- **Bundles adopted:** {total_adopted}/{len(bundles)}")
    lines.append(f"- **Flywheel tools used:** {len(flywheel_tools_used)}/{len(TOOL_CATEGORY)}")
    lines.append("")

    return "\n".join(lines)


def update_docs(report_content, docs_path):
    """Update docs/TESTING.md between sentinel comments."""
    begin = "<!-- BEGIN BUNDLE TEST RESULTS -->"
    end = "<!-- END BUNDLE TEST RESULTS -->"

    with open(docs_path) as f:
        content = f.read()

    if begin not in content or end not in content:
        # Insert before "## Running the Tests"
        marker = "## Running the Tests"
        if marker in content:
            section = f"""## Tool Adoption

Live testing verifies that Claude discovers and uses flywheel tools when enabled.

### Bundle Adoption

Each of 12 tool bundles tested with a targeted prompt against carter-strategy vault.

{begin}
{report_content}
{end}

### Demo Beat Coverage

9-beat sequential demo across retrieval, learning loop, and operational beats.

<!-- BEGIN DEMO TEST RESULTS -->
Run `bash demos/run-demo-test.sh` to populate.
<!-- END DEMO TEST RESULTS -->

Source: [`demos/`](../demos/)

---

"""
            content = content.replace(marker, section + marker)
        else:
            content += f"\n{begin}\n{report_content}\n{end}\n"
    else:
        before = content[: content.index(begin) + len(begin)]
        after = content[content.index(end) :]
        content = before + "\n" + report_content + "\n" + after

    with open(docs_path, "w") as f:
        f.write(content)

    print(f"Updated {docs_path}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Analyze bundle adoption test results")
    parser.add_argument("results_dir", help="Path to results directory")
    parser.add_argument("--update-docs", metavar="PATH", help="Update TESTING.md at PATH with results")
    args = parser.parse_args()

    bundles = parse_results_dir(args.results_dir)

    if not bundles:
        print("No results found in", args.results_dir, file=sys.stderr)
        sys.exit(1)

    report = generate_report(bundles, args.results_dir)
    print(report)

    # Write report to file
    report_path = os.path.join(args.results_dir, "report.md")
    with open(report_path, "w") as f:
        f.write(report)
    print(f"Report written to {report_path}", file=sys.stderr)

    if args.update_docs:
        update_docs(report, args.update_docs)


if __name__ == "__main__":
    main()
