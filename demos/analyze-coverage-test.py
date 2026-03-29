#!/usr/bin/env python3
"""Analyze per-tool coverage test results — check if each target tool was adopted."""

import json
import sys
import os
import glob
import argparse
from collections import defaultdict
from datetime import datetime

# Full tool -> category mapping mirroring packages/mcp-server/src/index.ts:345-438
TOOL_CATEGORY = {
    "search": "search", "init_semantic": "search", "find_similar": "search",
    "get_note_structure": "read", "get_section_content": "read", "find_sections": "read",
    "vault_add_to_section": "write", "vault_remove_from_section": "write",
    "vault_replace_in_section": "write", "vault_update_frontmatter": "write",
    "vault_create_note": "write", "vault_undo_last_mutation": "write", "policy": "write",
    "graph_analysis": "graph", "semantic_analysis": "graph", "get_backlinks": "graph",
    "get_forward_links": "graph", "get_connection_strength": "graph", "list_entities": "graph",
    "get_link_path": "graph", "get_common_neighbors": "graph", "get_weighted_links": "graph",
    "get_strong_connections": "graph",
    "export_graph": "graph",
    "vault_schema": "schema", "schema_conventions": "schema", "schema_validate": "schema",
    "note_intelligence": "schema", "rename_field": "schema", "migrate_field_values": "schema",
    "rename_tag": "schema",
    "suggest_wikilinks": "wikilinks", "validate_links": "wikilinks",
    "wikilink_feedback": "wikilinks", "discover_stub_candidates": "wikilinks",
    "discover_cooccurrence_gaps": "wikilinks", "suggest_entity_aliases": "wikilinks",
    "unlinked_mentions_report": "wikilinks",
    "vault_record_correction": "corrections", "vault_list_corrections": "corrections",
    "vault_resolve_correction": "corrections", "absorb_as_alias": "corrections",
    "tasks": "tasks", "vault_toggle_task": "tasks", "vault_add_task": "tasks",
    "memory": "memory", "brief": "memory",
    "vault_delete_note": "note-ops", "vault_move_note": "note-ops",
    "vault_rename_note": "note-ops", "merge_entities": "note-ops",
    "get_context_around_date": "temporal", "predict_stale_notes": "temporal",
    "track_concept_evolution": "temporal", "temporal_summary": "temporal",
    "health_check": "diagnostics", "get_vault_stats": "diagnostics",
    "get_folder_structure": "diagnostics", "refresh_index": "diagnostics",
    "get_all_entities": "diagnostics", "get_unlinked_mentions": "diagnostics",
    "vault_growth": "diagnostics", "vault_activity": "diagnostics",
    "flywheel_config": "diagnostics", "server_log": "diagnostics",
    "suggest_entity_merges": "diagnostics", "dismiss_merge_suggestion": "diagnostics",
    "vault_init": "diagnostics", "flywheel_doctor": "diagnostics",
    "pipeline_status": "diagnostics",
    "flywheel_trust_report": "diagnostics", "flywheel_benchmark": "diagnostics",
    "vault_session_history": "diagnostics", "vault_entity_history": "diagnostics",
    "flywheel_learning_report": "diagnostics", "flywheel_calibration_export": "diagnostics",
}

# Category display order
CATEGORY_ORDER = [
    "search", "read", "write", "graph", "schema", "wikilinks",
    "corrections", "tasks", "memory", "note-ops", "temporal", "diagnostics",
]


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
    return name.replace("mcp__flywheel__", "")


def parse_results(results_dir):
    """Parse all JSONL files, grouped by target tool name."""
    raw_dir = os.path.join(results_dir, "raw")
    tools = defaultdict(list)

    for filepath in sorted(glob.glob(os.path.join(raw_dir, "*.jsonl"))):
        basename = os.path.basename(filepath)
        parts = basename.rsplit("_run", 1)
        if len(parts) != 2:
            continue
        target_tool = parts[0]
        raw_calls = extract_tool_calls(filepath)
        normalized = [normalize_tool(t) for t in raw_calls]
        tools[target_tool].append({
            "file": basename,
            "calls": normalized,
            "hit": target_tool in normalized,
        })

    return tools


def generate_report(tools, results_dir):
    """Generate markdown coverage report."""
    dirname = os.path.basename(results_dir)
    total_tools = len(tools)
    total_runs = sum(len(runs) for runs in tools.values())
    runs_per = max(len(r) for r in tools.values()) if tools else 0

    lines = []
    lines.append("# Tool Coverage Test Report")
    lines.append("")
    lines.append(f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}  ")
    lines.append(f"**Runs/tool:** {runs_per}  ")
    lines.append(f"**Tools tested:** {total_tools}  ")
    lines.append(f"**Total runs:** {total_runs}  ")
    lines.append(f"**Results dir:** `{dirname}`")
    lines.append("")

    # Per-category results
    hits = 0
    misses = []
    cat_results = defaultdict(list)

    for target_tool in sorted(tools.keys()):
        cat = TOOL_CATEGORY.get(target_tool, "unknown")
        runs = tools[target_tool]
        any_hit = any(r["hit"] for r in runs)
        hit_count = sum(1 for r in runs if r["hit"])
        total = len(runs)

        if any_hit:
            hits += 1
        else:
            misses.append(target_tool)

        cat_results[cat].append({
            "tool": target_tool,
            "hit_count": hit_count,
            "total": total,
            "any_hit": any_hit,
            "runs": runs,
        })

    lines.append("## Results by Category")
    lines.append("")

    for cat in CATEGORY_ORDER:
        if cat not in cat_results:
            continue
        results = cat_results[cat]
        cat_hits = sum(1 for r in results if r["any_hit"])
        cat_total = len(results)

        lines.append(f"### {cat} ({cat_hits}/{cat_total})")
        lines.append("")
        lines.append("| Tool | Hit Rate | Status | Tools Called |")
        lines.append("|------|---------|--------|-------------|")

        for r in results:
            rate = f"{r['hit_count']}/{r['total']}"
            status = "PASS" if r["any_hit"] else "FAIL"
            # Show unique flywheel tools called across runs
            all_calls = set()
            for run in r["runs"]:
                all_calls.update(t for t in run["calls"] if t in TOOL_CATEGORY)
            calls_str = ", ".join(sorted(all_calls)) if all_calls else "(none)"
            lines.append(f"| {r['tool']} | {rate} | {status} | {calls_str} |")

        lines.append("")

    # Summary
    lines.append("## Summary")
    lines.append("")
    lines.append(f"**Coverage: {hits}/{total_tools} tools adopted ({100 * hits // total_tools if total_tools else 0}%)**")
    lines.append("")

    if misses:
        lines.append("### Tools Never Adopted")
        lines.append("")
        for t in sorted(misses):
            cat = TOOL_CATEGORY.get(t, "?")
            lines.append(f"- `{t}` ({cat})")
        lines.append("")

    # Category summary table
    lines.append("### Per-Category Summary")
    lines.append("")
    lines.append("| Category | Tools | Adopted | Rate |")
    lines.append("|----------|-------|---------|------|")

    for cat in CATEGORY_ORDER:
        if cat not in cat_results:
            continue
        results = cat_results[cat]
        cat_hits = sum(1 for r in results if r["any_hit"])
        cat_total = len(results)
        pct = f"{100 * cat_hits // cat_total}%" if cat_total else "0%"
        lines.append(f"| {cat} | {cat_total} | {cat_hits} | {pct} |")

    lines.append("")
    return "\n".join(lines)


def update_docs(report_content, docs_path):
    """Update docs/TESTING.md between sentinel comments."""
    begin = "<!-- BEGIN COVERAGE TEST RESULTS -->"
    end = "<!-- END COVERAGE TEST RESULTS -->"

    with open(docs_path) as f:
        content = f.read()

    if begin not in content or end not in content:
        # Insert before END BUNDLE TEST RESULTS or before Running the Tests
        marker = "<!-- END BUNDLE TEST RESULTS -->"
        if marker in content:
            insert_after = content.index(marker) + len(marker)
            section = f"""

### Per-Tool Coverage

Each of 69 tools tested with a targeted prompt against carter-strategy vault.

{begin}
{report_content}
{end}
"""
            content = content[:insert_after] + section + content[insert_after:]
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
    parser = argparse.ArgumentParser(description="Analyze per-tool coverage test results")
    parser.add_argument("results_dir", help="Path to results directory")
    parser.add_argument("--update-docs", metavar="PATH", help="Update TESTING.md at PATH")
    args = parser.parse_args()

    tools = parse_results(args.results_dir)

    if not tools:
        print("No results found in", args.results_dir, file=sys.stderr)
        sys.exit(1)

    report = generate_report(tools, args.results_dir)
    print(report)

    # Write report file
    report_path = os.path.join(args.results_dir, "report.md")
    with open(report_path, "w") as f:
        f.write(report)
    print(f"Report written to {report_path}", file=sys.stderr)

    # Write JSON summary
    summary = {}
    for target_tool, runs in tools.items():
        summary[target_tool] = {
            "hit_count": sum(1 for r in runs if r["hit"]),
            "total": len(runs),
            "adopted": any(r["hit"] for r in runs),
        }
    summary_path = os.path.join(args.results_dir, "analysis.json")
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"Summary written to {summary_path}", file=sys.stderr)

    if args.update_docs:
        update_docs(report, args.update_docs)

    # Exit with failure if any tools missed
    total = len(tools)
    hits = sum(1 for t in tools.values() if any(r["hit"] for r in t))
    sys.exit(0 if hits == total else 1)


if __name__ == "__main__":
    main()
