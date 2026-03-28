#!/usr/bin/env python3
"""Analyze HotpotQA benchmark results with retrieval and answer metrics."""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parents[1] / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

from answer_layer import build_answer_artifact, load_answer_artifact, token_f1  # noqa: E402


def safe_div(num: float, den: float) -> float:
    return num / den if den else 0.0


def load_question_artifact(results_dir: Path, question_index: int, question: dict) -> dict:
    answers_dir = results_dir / "answers"
    padded = f"q{question_index:03d}"
    artifact_path = answers_dir / f"{padded}.json"
    if artifact_path.exists():
        return load_answer_artifact(artifact_path)

    raw_path = results_dir / "raw" / f"{padded}.jsonl"
    if not raw_path.exists():
        return {}

    return build_answer_artifact(
        dataset="hotpot_dev_distractor_v1",
        jsonl_path=raw_path,
        question=question["question"],
        ground_truth=str(question.get("answer", "")),
        answer_extract=False,
        judge=False,
    )


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: analyze-benchmark.py <results_dir> <ground_truth.json>", file=sys.stderr)
        sys.exit(1)

    results_dir = Path(sys.argv[1])
    gt = json.load(open(sys.argv[2]))
    questions = gt["questions"]

    per_question = []
    total_found = 0
    total_relevant = 0
    type_stats = defaultdict(lambda: {"found": 0, "relevant": 0, "count": 0, "correct": 0, "scored": 0})
    level_stats = defaultdict(lambda: {"found": 0, "relevant": 0, "count": 0, "correct": 0, "scored": 0})
    cost_breakdown = {"generation": 0.0, "extraction": 0.0, "judge": 0.0}
    answer_layer_counts = defaultdict(int)
    judge_failed = 0
    generation_failed = 0
    final_f1_sum = 0.0
    raw_f1_sum = 0.0

    for i, question in enumerate(questions):
        artifact = load_question_artifact(results_dir, i, question)
        if not artifact:
            continue

        relevant = set(question["supporting_paths"])
        accessed = set(artifact.get("accessed_paths", []))
        found = relevant & accessed
        recall = safe_div(len(found), len(relevant))
        total_found += len(found)
        total_relevant += len(relevant)

        qtype = question.get("type", "unknown")
        qlevel = question.get("level", "unknown")
        type_stats[qtype]["found"] += len(found)
        type_stats[qtype]["relevant"] += len(relevant)
        type_stats[qtype]["count"] += 1
        level_stats[qlevel]["found"] += len(found)
        level_stats[qlevel]["relevant"] += len(relevant)
        level_stats[qlevel]["count"] += 1

        raw_answer = artifact.get("raw_answer", "")
        final_answer = artifact.get("final_answer", raw_answer)
        ground_truth = str(question.get("answer", ""))
        raw_f1 = token_f1(raw_answer, ground_truth)
        final_f1 = token_f1(final_answer, ground_truth)
        raw_f1_sum += raw_f1
        final_f1_sum += final_f1

        judge_status = artifact.get("judge_status", "skipped")
        judge_correct = artifact.get("judge_correct")
        if judge_status == "scored" and judge_correct is not None:
            type_stats[qtype]["correct"] += int(judge_correct)
            type_stats[qtype]["scored"] += 1
            level_stats[qlevel]["correct"] += int(judge_correct)
            level_stats[qlevel]["scored"] += 1
        elif judge_status == "failed":
            judge_failed += 1

        if artifact.get("generation_status") == "failed":
            generation_failed += 1

        answer_layer_counts["questions"] += 1
        if artifact.get("contract_followed"):
            answer_layer_counts["contract_followed"] += 1
        mode = artifact.get("extraction_mode", "unknown")
        answer_layer_counts[f"mode_{mode}"] += 1
        if artifact.get("compression_applied"):
            answer_layer_counts["compression_applied"] += 1

        cost_breakdown["generation"] += float(artifact.get("generation_cost_usd", 0.0) or 0.0)
        cost_breakdown["extraction"] += float(artifact.get("extraction_cost_usd", 0.0) or 0.0)
        cost_breakdown["judge"] += float(artifact.get("judge_cost_usd", 0.0) or 0.0)

        per_question.append({
            "id": question["id"],
            "question": question["question"][:120],
            "type": qtype,
            "level": qlevel,
            "supporting_docs": len(relevant),
            "docs_found": len(found),
            "docs_missed": sorted(relevant - accessed),
            "recall": round(recall, 3),
            "judge_status": judge_status,
            "judge_correct": judge_correct,
            "raw_token_f1": round(raw_f1, 3),
            "final_token_f1": round(final_f1, 3),
            "extraction_mode": mode,
            "compression_applied": artifact.get("compression_applied", False),
            "raw_token_count": artifact.get("raw_token_count", 0),
            "final_token_count": artifact.get("final_token_count", 0),
            "cost_breakdown": {
                "generation": round(float(artifact.get("generation_cost_usd", 0.0) or 0.0), 6),
                "extraction": round(float(artifact.get("extraction_cost_usd", 0.0) or 0.0), 6),
                "judge": round(float(artifact.get("judge_cost_usd", 0.0) or 0.0), 6),
            },
        })

    if not per_question:
        print(f"No results found in {results_dir}", file=sys.stderr)
        sys.exit(1)

    overall_recall = safe_div(total_found, total_relevant)
    full_recall_count = sum(1 for q in per_question if q["recall"] == 1.0)
    partial_recall_count = sum(1 for q in per_question if q["recall"] > 0)
    judge_scored_count = sum(s["scored"] for s in type_stats.values())
    judge_correct_count = sum(s["correct"] for s in type_stats.values())
    overall_judge_accuracy = safe_div(judge_correct_count, judge_scored_count)
    overall_final_f1 = safe_div(final_f1_sum, len(per_question))
    overall_raw_f1 = safe_div(raw_f1_sum, len(per_question))
    total_cost = sum(cost_breakdown.values())
    avg_raw_tokens = safe_div(sum(q["raw_token_count"] for q in per_question), len(per_question))
    avg_final_tokens = safe_div(sum(q["final_token_count"] for q in per_question), len(per_question))

    lines = []
    lines.append("# HotpotQA End-to-End Benchmark")
    lines.append("")
    lines.append(f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"**Questions:** {len(per_question)} / {len(questions)}")
    lines.append(f"**Documents:** {gt['total_docs']}")
    lines.append(f"**Total Cost:** ${total_cost:.2f}")
    lines.append("")
    lines.append("## Overall")
    lines.append("")
    lines.append("| Metric | Value |")
    lines.append("|--------|-------|")
    lines.append(f"| Document Recall | **{overall_recall:.1%}** ({total_found}/{total_relevant}) |")
    lines.append(f"| Full Recall | {full_recall_count}/{len(per_question)} ({safe_div(full_recall_count, len(per_question)):.1%}) |")
    lines.append(f"| Partial Recall | {partial_recall_count}/{len(per_question)} ({safe_div(partial_recall_count, len(per_question)):.1%}) |")
    lines.append(f"| Judge Accuracy | **{overall_judge_accuracy:.1%}** ({judge_correct_count}/{judge_scored_count}) |")
    lines.append(f"| Final Token F1 | **{overall_final_f1:.3f}** |")
    lines.append(f"| Raw Token F1 | **{overall_raw_f1:.3f}** |")
    lines.append(f"| Avg Cost/Question | ${safe_div(total_cost, len(per_question)):.3f} |")
    lines.append("")
    lines.append("## Cost Breakdown")
    lines.append("")
    lines.append("| Component | Cost |")
    lines.append("|-----------|------|")
    lines.append(f"| Generation | ${cost_breakdown['generation']:.2f} |")
    lines.append(f"| Extraction | ${cost_breakdown['extraction']:.2f} |")
    lines.append(f"| Judge | ${cost_breakdown['judge']:.2f} |")
    lines.append("")
    lines.append("## By Type")
    lines.append("")
    lines.append("| Type | Questions | Recall | Judge Accuracy |")
    lines.append("|------|-----------|--------|----------------|")
    for qtype, stats in sorted(type_stats.items()):
        lines.append(
            f"| {qtype} | {stats['count']} | {safe_div(stats['found'], stats['relevant']):.1%} "
            f"({stats['found']}/{stats['relevant']}) | {safe_div(stats['correct'], stats['scored']):.1%} "
            f"({stats['correct']}/{stats['scored']}) |"
        )
    lines.append("")
    lines.append("## By Level")
    lines.append("")
    lines.append("| Level | Questions | Recall | Judge Accuracy |")
    lines.append("|-------|-----------|--------|----------------|")
    for qlevel, stats in sorted(level_stats.items()):
        lines.append(
            f"| {qlevel} | {stats['count']} | {safe_div(stats['found'], stats['relevant']):.1%} "
            f"({stats['found']}/{stats['relevant']}) | {safe_div(stats['correct'], stats['scored']):.1%} "
            f"({stats['correct']}/{stats['scored']}) |"
        )
    lines.append("")
    lines.append("## Answer Layer Diagnostics")
    lines.append("")
    lines.append("| Diagnostic | Value |")
    lines.append("|------------|-------|")
    lines.append(f"| Contract Compliance | {safe_div(answer_layer_counts['contract_followed'], len(per_question)):.1%} |")
    lines.append(f"| Prompt Contract Mode | {safe_div(answer_layer_counts['mode_prompt_contract'], len(per_question)):.1%} |")
    lines.append(f"| Parser Fallback Mode | {safe_div(answer_layer_counts['mode_parser_fallback'], len(per_question)):.1%} |")
    lines.append(f"| LLM Extraction Mode | {safe_div(answer_layer_counts['mode_llm_extract'], len(per_question)):.1%} |")
    lines.append(f"| Extraction Failed Mode | {safe_div(answer_layer_counts['mode_extraction_failed'], len(per_question)):.1%} |")
    lines.append(f"| Compression Applied | {safe_div(answer_layer_counts['compression_applied'], len(per_question)):.1%} |")
    lines.append(f"| Avg Raw Tokens | {avg_raw_tokens:.1f} |")
    lines.append(f"| Avg Final Tokens | {avg_final_tokens:.1f} |")
    lines.append(f"| Generation Failed | {generation_failed} |")
    lines.append(f"| Judge Failed | {judge_failed} |")
    lines.append("")

    missed = sorted([q for q in per_question if q["recall"] < 1.0], key=lambda item: item["recall"])
    if missed:
        lines.append("## Missed Documents")
        lines.append("")
        lines.append("| Question | Type | Recall | Missed |")
        lines.append("|----------|------|--------|--------|")
        for question in missed[:10]:
            lines.append(
                f"| {question['question'][:60]}... | {question['type']} | {question['recall']:.0%} | "
                f"{', '.join(question['docs_missed'][:2])} |"
            )
        lines.append("")

    report = "\n".join(lines)
    print(report)

    report_path = results_dir / "report.md"
    report_path.write_text(report)
    print(f"\nReport: {report_path}", file=sys.stderr)

    judge_results = {
        "judge_model": "artifact",
        "overall_accuracy": round(overall_judge_accuracy, 4),
        "total_correct": judge_correct_count,
        "total_scored": judge_scored_count,
        "failed_count": judge_failed,
        "per_question": [
            {
                "id": q["id"],
                "type": q["type"],
                "level": q["level"],
                "correct": q["judge_correct"],
                "status": q["judge_status"],
            }
            for q in per_question
        ],
    }
    (results_dir / "judge-results.json").write_text(json.dumps(judge_results, indent=2) + "\n")

    analysis = {
        "generated": datetime.now().isoformat(),
        "dataset": "hotpot_dev_distractor_v1",
        "total_questions": len(questions),
        "scored_questions": len(per_question),
        "total_documents": gt["total_docs"],
        "primary_answer_metric": "judge_accuracy",
        "overall_recall": round(overall_recall, 4),
        "overall_judge_accuracy": round(overall_judge_accuracy, 4),
        "overall_final_token_f1": round(overall_final_f1, 4),
        "overall_raw_token_f1": round(overall_raw_f1, 4),
        "overall_answer_score": round(overall_judge_accuracy, 4),
        "full_recall_count": full_recall_count,
        "partial_recall_count": partial_recall_count,
        "judge_scored_count": judge_scored_count,
        "judge_failed_count": judge_failed,
        "generation_failed_count": generation_failed,
        "total_cost_usd": round(total_cost, 4),
        "cost_breakdown": {k: round(v, 4) for k, v in cost_breakdown.items()},
        "answer_layer_diagnostics": {
            "contract_compliance_rate": round(safe_div(answer_layer_counts["contract_followed"], len(per_question)), 4),
            "prompt_contract_rate": round(safe_div(answer_layer_counts["mode_prompt_contract"], len(per_question)), 4),
            "parser_fallback_rate": round(safe_div(answer_layer_counts["mode_parser_fallback"], len(per_question)), 4),
            "llm_extract_rate": round(safe_div(answer_layer_counts["mode_llm_extract"], len(per_question)), 4),
            "extraction_failed_rate": round(safe_div(answer_layer_counts["mode_extraction_failed"], len(per_question)), 4),
            "compression_rate": round(safe_div(answer_layer_counts["compression_applied"], len(per_question)), 4),
            "avg_raw_tokens": round(avg_raw_tokens, 3),
            "avg_final_tokens": round(avg_final_tokens, 3),
        },
        "by_type": {
            k: {
                "recall": round(safe_div(v["found"], v["relevant"]), 4),
                "judge_accuracy": round(safe_div(v["correct"], v["scored"]), 4),
                **v,
            }
            for k, v in type_stats.items()
        },
        "by_level": {
            k: {
                "recall": round(safe_div(v["found"], v["relevant"]), 4),
                "judge_accuracy": round(safe_div(v["correct"], v["scored"]), 4),
                **v,
            }
            for k, v in level_stats.items()
        },
        "per_question": per_question,
    }
    analysis_path = results_dir / "analysis.json"
    analysis_path.write_text(json.dumps(analysis, indent=2) + "\n")
    print(f"Analysis: {analysis_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
