#!/usr/bin/env python3
"""Analyze demo test results — extract tool calls per beat, verify expectations, and report category coverage."""

import json
import sys
import os
import argparse
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# Full tool -> category mapping mirroring packages/mcp-server/src/index.ts:345-438
TOOL_CATEGORY = {
    # search (3 tools)
    "search": "search",
    "init_semantic": "search",
    "find_similar": "search",
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
    # graph (10 tools)
    "graph_analysis": "graph",
    "semantic_analysis": "graph",
    "get_backlinks": "graph",
    "get_forward_links": "graph",
    "get_connection_strength": "graph",
    "list_entities": "graph",
    "get_link_path": "graph",
    "get_common_neighbors": "graph",
    "get_weighted_links": "graph",
    "get_strong_connections": "graph",
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
    # memory (3 tools)
    "memory": "memory",
    "recall": "memory",
    "brief": "memory",
    # note-ops (4 tools)
    "vault_delete_note": "note-ops",
    "vault_move_note": "note-ops",
    "vault_rename_note": "note-ops",
    "merge_entities": "note-ops",
    # temporal (4 tools)
    "get_context_around_date": "temporal",
    "predict_stale_notes": "temporal",
    "track_concept_evolution": "temporal",
    "temporal_summary": "temporal",
    # diagnostics (14 tools)
    "health_check": "diagnostics",
    "get_vault_stats": "diagnostics",
    "get_folder_structure": "diagnostics",
    "refresh_index": "diagnostics",
    "get_all_entities": "diagnostics",
    "get_unlinked_mentions": "diagnostics",
    "vault_growth": "diagnostics",
    "vault_activity": "diagnostics",
    "flywheel_config": "diagnostics",
    "server_log": "diagnostics",
    "suggest_entity_merges": "diagnostics",
    "dismiss_merge_suggestion": "diagnostics",
    "vault_init": "diagnostics",
    "flywheel_doctor": "diagnostics",
}

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


def extract_tool_calls(jsonl_path):
    """Extract ALL tool names from a stream-json JSONL file (flywheel + builtin)."""
    tools = []
    try:
        with open(jsonl_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("type") == "assistant":
                    for block in obj.get("message", {}).get("content", []):
                        if isinstance(block, dict) and block.get("type") == "tool_use":
                            tools.append(block["name"])
    except FileNotFoundError:
        pass
    return tools


def normalize_tool(name):
    """Strip mcp__flywheel__ prefix."""
    return name.replace("mcp__flywheel__", "")


def categorize_tool(name):
    """Return category for a tool name."""
    normalized = normalize_tool(name)
    return TOOL_CATEGORY.get(normalized, "builtin")


def main():
    parser = argparse.ArgumentParser(description="Analyze demo beat test results")
    parser.add_argument("results_dir", help="Path to results directory")
    parser.add_argument("--update-docs", metavar="PATH", help="Update TESTING.md at PATH with results")
    args = parser.parse_args()

    results_dir = Path(args.results_dir)
    raw_dir = results_dir / "raw"

    if not raw_dir.exists():
        print(f"No raw directory found at {raw_dir}", file=sys.stderr)
        sys.exit(1)

    lines = []
    lines.append("# Demo Beat Analysis")
    lines.append("")
    lines.append(f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}  ")
    lines.append(f"**Results dir:** `{results_dir.name}`")
    lines.append("")

    total = 0
    passed = 0
    results = []
    all_tools_used = defaultdict(int)
    category_usage_per_beat = {}

    lines.append("## Per-Beat Results")
    lines.append("")
    lines.append("| Beat | Status | Expected | Tools Used | Categories |")
    lines.append("|------|--------|----------|------------|------------|")

    for beat_name in sorted(EXPECTED_TOOLS.keys()):
        jsonl_path = raw_dir / f"{beat_name}.jsonl"
        raw_tools = extract_tool_calls(str(jsonl_path))
        normalized = [normalize_tool(t) for t in raw_tools]
        expected = EXPECTED_TOOLS[beat_name]

        # Track all tools
        for t in normalized:
            all_tools_used[t] += 1

        # Category breakdown for this beat
        beat_cats = defaultdict(list)
        for t in normalized:
            cat = TOOL_CATEGORY.get(t, "builtin")
            beat_cats[cat].append(t)
        category_usage_per_beat[beat_name] = dict(beat_cats)

        # Pass if ANY expected tool was used
        tools_set = set(normalized)
        hit = expected & tools_set
        status = "PASS" if hit else "FAIL"

        total += 1
        if hit:
            passed += 1

        results.append({
            "beat": beat_name,
            "tools_used": normalized,
            "expected": sorted(expected),
            "hit": sorted(hit),
            "status": status,
        })

        tools_str = ", ".join(normalized) if normalized else "(none)"
        expected_str = ", ".join(sorted(expected))
        cat_parts = [f"{cat}:{len(ts)}" for cat, ts in sorted(beat_cats.items())]
        cat_str = ", ".join(cat_parts) if cat_parts else "(none)"
        lines.append(f"| {beat_name} | {status} | {expected_str} | {tools_str} | {cat_str} |")

    lines.append("")
    lines.append(f"**{passed}/{total} beats passed**")
    lines.append("")

    # Per-beat category breakdown (detailed)
    lines.append("## Per-Beat Category Breakdown")
    lines.append("")

    for beat_name in sorted(category_usage_per_beat.keys()):
        cats = category_usage_per_beat[beat_name]
        lines.append(f"### {beat_name}")
        lines.append("")
        if cats:
            for cat in sorted(cats.keys()):
                tools = cats[cat]
                lines.append(f"- **{cat}**: {', '.join(tools)}")
        else:
            lines.append("- (no tools called)")
        lines.append("")

    # Aggregate category usage
    lines.append("## Aggregate Category Usage")
    lines.append("")
    lines.append("| Category | Tools Used | Distinct Tools |")
    lines.append("|----------|-----------|----------------|")

    cat_totals = defaultdict(int)
    cat_distinct = defaultdict(set)
    for t, count in all_tools_used.items():
        cat = TOOL_CATEGORY.get(t, "builtin")
        cat_totals[cat] += count
        cat_distinct[cat].add(t)

    for cat in ["search", "read", "write", "graph", "schema", "wikilinks",
                "corrections", "tasks", "memory", "note-ops", "temporal",
                "diagnostics", "builtin"]:
        if cat in cat_totals:
            lines.append(f"| {cat} | {cat_totals[cat]} | {len(cat_distinct[cat])} |")

    lines.append("")

    # Coverage
    flywheel_used = {t for t in all_tools_used if t in TOOL_CATEGORY}
    lines.append(f"**Coverage:** {len(flywheel_used)}/69 flywheel tools used")
    lines.append("")

    report = "\n".join(lines)

    # Print to stdout
    print(report)

    # Write report file
    report_path = results_dir / "report.md"
    with open(report_path, "w") as f:
        f.write(report)
    print(f"Report written to {report_path}", file=sys.stderr)

    # Write JSON summary
    summary_path = results_dir / "analysis.json"
    with open(summary_path, "w") as f:
        json.dump({
            "total": total,
            "passed": passed,
            "beats": results,
            "tool_usage": dict(all_tools_used),
            "flywheel_tools_used": len(flywheel_used),
        }, f, indent=2)
    print(f"Summary written to {summary_path}", file=sys.stderr)

    # Update docs if requested
    if args.update_docs:
        update_docs(report, args.update_docs)

    sys.exit(0 if passed == total else 1)


def update_docs(report_content, docs_path):
    """Update docs/TESTING.md between sentinel comments."""
    begin = "<!-- BEGIN DEMO TEST RESULTS -->"
    end = "<!-- END DEMO TEST RESULTS -->"

    with open(docs_path) as f:
        content = f.read()

    if begin not in content or end not in content:
        # Append if sentinels don't exist
        content += f"\n{begin}\n{report_content}\n{end}\n"
    else:
        before = content[: content.index(begin) + len(begin)]
        after = content[content.index(end) :]
        content = before + "\n" + report_content + "\n" + after

    with open(docs_path, "w") as f:
        f.write(content)

    print(f"Updated {docs_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
