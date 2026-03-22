#!/usr/bin/env python3
"""Analyze HotpotQA end-to-end benchmark results.

Parses stream-json JSONL output from claude -p runs, extracts which
note paths appeared in Flywheel tool results, and computes retrieval
metrics against ground truth.

Usage:
    python3 analyze-benchmark.py <results_dir> <ground_truth.json>
"""

import json
import sys
import os
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from math import log2


def extract_accessed_paths(jsonl_path):
    """Extract note paths accessed via Flywheel tools from stream-json JSONL.

    Extracts paths from:
    - tool_use inputs (path, note_path params)
    - tool_result JSON content (search results with "path" fields)
    - tool_result text content (regex fallback for .md paths)
    """
    paths = set()
    api_cost = 0.0
    tools_used = []

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

                # Extract paths from tool inputs
                if obj.get("type") == "assistant":
                    for block in obj.get("message", {}).get("content", []):
                        if isinstance(block, dict) and block.get("type") == "tool_use":
                            name = block.get("name", "").replace("mcp__flywheel__", "")
                            tools_used.append(name)
                            inp = block.get("input", {})
                            for key in ("path", "note_path", "source", "target"):
                                if isinstance(inp.get(key), str) and inp[key].endswith(".md"):
                                    paths.add(inp[key])

                # Extract paths from tool results
                elif obj.get("type") == "user":
                    for block in obj.get("message", {}).get("content", []):
                        if isinstance(block, dict) and block.get("type") == "tool_result":
                            content = block.get("content", [])
                            text = ""
                            if isinstance(content, list):
                                for c in content:
                                    if isinstance(c, dict) and c.get("type") == "text":
                                        text += c["text"]
                            elif isinstance(content, str):
                                text = content

                            if not text:
                                continue

                            # Try to parse as JSON and extract "path" fields from results
                            try:
                                data = json.loads(text)
                                _extract_paths_from_json(data, paths)
                            except (json.JSONDecodeError, ValueError):
                                pass

                            # Regex fallback: find .md paths in raw text
                            for m in re.finditer(r'"path"\s*:\s*"([^"]+\.md)"', text):
                                paths.add(m.group(1))

                # Extract cost
                elif obj.get("type") == "result":
                    api_cost = obj.get("total_cost_usd", 0)

    except FileNotFoundError:
        pass

    return paths, api_cost, tools_used


def _extract_paths_from_json(data, paths):
    """Recursively extract 'path' fields from JSON search results."""
    if isinstance(data, dict):
        if "path" in data and isinstance(data["path"], str) and data["path"].endswith(".md"):
            paths.add(data["path"])
        for v in data.values():
            _extract_paths_from_json(v, paths)
    elif isinstance(data, list):
        for item in data:
            _extract_paths_from_json(item, paths)


def recall_at_k(retrieved, relevant, k):
    """Fraction of relevant docs found in top-k (order doesn't matter for set retrieval)."""
    if not relevant:
        return 0.0
    found = len(relevant & retrieved)
    return found / len(relevant)


def main():
    if len(sys.argv) < 3:
        print("Usage: analyze-benchmark.py <results_dir> <ground_truth.json>", file=sys.stderr)
        sys.exit(1)

    results_dir = Path(sys.argv[1])
    gt_path = sys.argv[2]

    raw_dir = results_dir / "raw"
    if not raw_dir.exists():
        print(f"No raw directory at {raw_dir}", file=sys.stderr)
        sys.exit(1)

    gt = json.load(open(gt_path))
    questions = gt["questions"]

    # Process each question
    per_question = []
    total_cost = 0.0
    total_found = 0
    total_relevant = 0
    type_stats = defaultdict(lambda: {"found": 0, "relevant": 0, "count": 0})
    level_stats = defaultdict(lambda: {"found": 0, "relevant": 0, "count": 0})

    for i, q in enumerate(questions):
        padded = f"{i:03d}"
        jsonl_path = raw_dir / f"q{padded}.jsonl"

        accessed_paths, cost, tools = extract_accessed_paths(str(jsonl_path))
        total_cost += cost

        # Ground truth paths
        relevant = set(q["supporting_paths"])
        found = relevant & accessed_paths
        recall = len(found) / len(relevant) if relevant else 0

        total_found += len(found)
        total_relevant += len(relevant)

        qtype = q.get("type", "unknown")
        qlevel = q.get("level", "unknown")
        type_stats[qtype]["found"] += len(found)
        type_stats[qtype]["relevant"] += len(relevant)
        type_stats[qtype]["count"] += 1
        level_stats[qlevel]["found"] += len(found)
        level_stats[qlevel]["relevant"] += len(relevant)
        level_stats[qlevel]["count"] += 1

        per_question.append({
            "id": q["id"],
            "question": q["question"][:80],
            "type": qtype,
            "level": qlevel,
            "supporting_docs": len(relevant),
            "docs_found": len(found),
            "docs_missed": sorted(relevant - accessed_paths),
            "recall": round(recall, 3),
            "tools_used": tools,
            "paths_accessed": len(accessed_paths),
            "cost_usd": round(cost, 4),
        })

    # Aggregate metrics
    overall_recall = total_found / total_relevant if total_relevant > 0 else 0
    questions_with_full_recall = sum(1 for q in per_question if q["recall"] == 1.0)
    questions_with_any_recall = sum(1 for q in per_question if q["recall"] > 0)

    # Print report
    lines = []
    lines.append("# HotpotQA End-to-End Benchmark")
    lines.append("")
    lines.append(f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"**Questions:** {len(questions)}")
    lines.append(f"**Documents:** {gt['total_docs']}")
    lines.append(f"**Total Cost:** ${total_cost:.2f}")
    lines.append("")

    lines.append("## Overall Results")
    lines.append("")
    lines.append(f"| Metric | Value |")
    lines.append(f"|--------|-------|")
    lines.append(f"| Document Recall | **{overall_recall:.1%}** ({total_found}/{total_relevant} supporting docs found) |")
    lines.append(f"| Full Recall (both docs found) | {questions_with_full_recall}/{len(questions)} ({questions_with_full_recall/len(questions):.1%}) |")
    lines.append(f"| Partial Recall (≥1 doc found) | {questions_with_any_recall}/{len(questions)} ({questions_with_any_recall/len(questions):.1%}) |")
    lines.append(f"| Avg Cost/Question | ${total_cost/len(questions):.3f} |")
    lines.append("")

    lines.append("## By Type")
    lines.append("")
    lines.append("| Type | Questions | Recall |")
    lines.append("|------|-----------|--------|")
    for qtype, stats in sorted(type_stats.items()):
        r = stats["found"] / stats["relevant"] if stats["relevant"] > 0 else 0
        lines.append(f"| {qtype} | {stats['count']} | {r:.1%} ({stats['found']}/{stats['relevant']}) |")
    lines.append("")

    lines.append("## By Level")
    lines.append("")
    lines.append("| Level | Questions | Recall |")
    lines.append("|-------|-----------|--------|")
    for qlevel, stats in sorted(level_stats.items()):
        r = stats["found"] / stats["relevant"] if stats["relevant"] > 0 else 0
        lines.append(f"| {qlevel} | {stats['count']} | {r:.1%} ({stats['found']}/{stats['relevant']}) |")
    lines.append("")

    # Worst performers
    missed = [q for q in per_question if q["recall"] < 1.0]
    missed.sort(key=lambda x: x["recall"])
    if missed:
        lines.append("## Missed Documents (worst 10)")
        lines.append("")
        lines.append("| Question | Type | Recall | Missed |")
        lines.append("|----------|------|--------|--------|")
        for q in missed[:10]:
            lines.append(f"| {q['question'][:60]}... | {q['type']} | {q['recall']:.0%} | {', '.join(q['docs_missed'][:2])} |")
        lines.append("")

    report = "\n".join(lines)
    print(report)

    # Write files
    report_path = results_dir / "report.md"
    with open(report_path, "w") as f:
        f.write(report)
    print(f"\nReport: {report_path}", file=sys.stderr)

    analysis_path = results_dir / "analysis.json"
    with open(analysis_path, "w") as f:
        json.dump({
            "generated": datetime.now().isoformat(),
            "dataset": "hotpot_dev_distractor_v1",
            "total_questions": len(questions),
            "total_documents": gt["total_docs"],
            "overall_recall": round(overall_recall, 4),
            "full_recall_count": questions_with_full_recall,
            "partial_recall_count": questions_with_any_recall,
            "total_cost_usd": round(total_cost, 4),
            "by_type": {k: {"recall": round(v["found"]/v["relevant"], 4) if v["relevant"] else 0, **v}
                        for k, v in type_stats.items()},
            "by_level": {k: {"recall": round(v["found"]/v["relevant"], 4) if v["relevant"] else 0, **v}
                         for k, v in level_stats.items()},
            "per_question": per_question,
        }, f, indent=2)
    print(f"Analysis: {analysis_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
