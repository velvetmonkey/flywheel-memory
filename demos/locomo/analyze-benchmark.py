#!/usr/bin/env python3
"""Analyze LoCoMo benchmark results with answer-layer artifacts when available."""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parents[1] / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

from answer_layer import adversarial_score, build_answer_artifact, load_answer_artifact, token_f1  # noqa: E402


def safe_div(num: float, den: float) -> float:
    return num / den if den else 0.0


def load_question_artifact(results_dir: Path, question_index: int, question: dict) -> dict:
    answers_dir = results_dir / "answers"
    padded4 = f"q{question_index:04d}"
    padded3 = f"q{question_index:03d}"
    for candidate in (answers_dir / f"{padded4}.json", answers_dir / f"{padded3}.json"):
        if candidate.exists():
            return load_answer_artifact(candidate)

    raw_dir = results_dir / "raw"
    raw_path = raw_dir / f"{padded4}.jsonl"
    if not raw_path.exists():
        raw_path = raw_dir / f"{padded3}.jsonl"
    if not raw_path.exists():
        return {}

    return build_answer_artifact(
        dataset="locomo10",
        jsonl_path=raw_path,
        question=question["question"],
        ground_truth=str(question.get("answer", "")),
        category=question.get("category", ""),
        category_num=question.get("category_num"),
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
    cat_evidence = defaultdict(lambda: {"found": 0, "relevant": 0, "count": 0})
    cat_judge = defaultdict(lambda: {"correct": 0, "scored": 0, "failed": 0, "count": 0})
    cat_final_f1 = defaultdict(lambda: {"sum": 0.0, "count": 0})
    cat_raw_f1 = defaultdict(lambda: {"sum": 0.0, "count": 0})

    answer_layer_counts = defaultdict(int)
    cost_breakdown = {"generation": 0.0, "extraction": 0.0, "judge": 0.0}
    generation_failed = 0
    judge_failed = 0

    for i, question in enumerate(questions):
        artifact = load_question_artifact(results_dir, i, question)
        if not artifact:
            continue

        relevant = set(question.get("evidence_paths", []))
        accessed = set(artifact.get("accessed_paths", []))
        found = relevant & accessed
        evidence_recall = safe_div(len(found), len(relevant))

        category = question["category"]
        cat_evidence[category]["found"] += len(found)
        cat_evidence[category]["relevant"] += len(relevant)
        cat_evidence[category]["count"] += 1

        raw_answer = artifact.get("raw_answer", "")
        final_answer = artifact.get("final_answer", raw_answer)
        if question.get("category_num") == 5:
            raw_f1 = adversarial_score(raw_answer)
            final_f1 = adversarial_score(final_answer)
        else:
            ground_truth = str(question.get("answer", ""))
            raw_f1 = token_f1(raw_answer, ground_truth)
            final_f1 = token_f1(final_answer, ground_truth)

        cat_raw_f1[category]["sum"] += raw_f1
        cat_raw_f1[category]["count"] += 1
        cat_final_f1[category]["sum"] += final_f1
        cat_final_f1[category]["count"] += 1

        judge_status = artifact.get("judge_status", "skipped")
        judge_correct = artifact.get("judge_correct")
        cat_judge[category]["count"] += 1
        if judge_status == "scored" and judge_correct is not None:
            cat_judge[category]["correct"] += int(judge_correct)
            cat_judge[category]["scored"] += 1
        elif judge_status == "failed":
            cat_judge[category]["failed"] += 1
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
            "index": i,
            "question": question["question"][:120],
            "category": category,
            "evidence_recall": round(evidence_recall, 3),
            "judge_status": judge_status,
            "judge_correct": judge_correct,
            "raw_token_f1": round(raw_f1, 3),
            "final_token_f1": round(final_f1, 3),
            "extraction_mode": mode,
            "compression_applied": artifact.get("compression_applied", False),
            "compression_reason": artifact.get("compression_reason"),
            "contract_followed": artifact.get("contract_followed", False),
            "raw_token_count": artifact.get("raw_token_count", 0),
            "final_token_count": artifact.get("final_token_count", 0),
            "generation_status": artifact.get("generation_status", "completed"),
            "cost_breakdown": {
                "generation": round(float(artifact.get("generation_cost_usd", 0.0) or 0.0), 6),
                "extraction": round(float(artifact.get("extraction_cost_usd", 0.0) or 0.0), 6),
                "judge": round(float(artifact.get("judge_cost_usd", 0.0) or 0.0), 6),
            },
        })

    if not per_question:
        print(f"No results found in {results_dir}", file=sys.stderr)
        sys.exit(1)

    total_found = sum(s["found"] for s in cat_evidence.values())
    total_relevant = sum(s["relevant"] for s in cat_evidence.values())
    overall_evidence_recall = safe_div(total_found, total_relevant)

    scored_count = sum(s["scored"] for s in cat_judge.values())
    correct_count = sum(s["correct"] for s in cat_judge.values())
    overall_judge_accuracy = safe_div(correct_count, scored_count)

    overall_raw_f1 = safe_div(sum(s["sum"] for s in cat_raw_f1.values()), sum(s["count"] for s in cat_raw_f1.values()))
    overall_final_f1 = safe_div(sum(s["sum"] for s in cat_final_f1.values()), sum(s["count"] for s in cat_final_f1.values()))

    adversarial_stats = cat_judge.get("adversarial", {"correct": 0, "scored": 0})
    overall_adversarial_accuracy = safe_div(adversarial_stats["correct"], adversarial_stats["scored"])

    total_cost = sum(cost_breakdown.values())
    avg_raw_tokens = safe_div(sum(q["raw_token_count"] for q in per_question), len(per_question))
    avg_final_tokens = safe_div(sum(q["final_token_count"] for q in per_question), len(per_question))

    lines = []
    lines.append("# LoCoMo End-to-End Benchmark")
    lines.append("")
    lines.append(f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"**Questions Scored:** {len(per_question)} / {len(questions)}")
    lines.append(f"**Vault Mode:** {gt.get('vault_mode', 'dialog')}")
    lines.append(f"**Sessions:** {gt.get('total_sessions', '?')}")
    lines.append(f"**Total Cost:** ${total_cost:.2f}")
    lines.append("")
    lines.append("## Overall")
    lines.append("")
    lines.append("| Metric | Value |")
    lines.append("|--------|-------|")
    lines.append(f"| Evidence Recall | **{overall_evidence_recall:.1%}** ({total_found}/{total_relevant}) |")
    lines.append(f"| Judge Accuracy | **{overall_judge_accuracy:.1%}** ({correct_count}/{scored_count}) |")
    lines.append(f"| Final Token F1 | **{overall_final_f1:.3f}** |")
    lines.append(f"| Raw Token F1 | **{overall_raw_f1:.3f}** |")
    lines.append(f"| Adversarial Accuracy | **{overall_adversarial_accuracy:.1%}** |")
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
    lines.append("## By Category")
    lines.append("")
    lines.append("| Category | Questions | Evidence Recall | Judge Accuracy | Final F1 | Raw F1 |")
    lines.append("|----------|-----------|-----------------|----------------|----------|--------|")
    for category in sorted(cat_evidence):
        evidence = cat_evidence[category]
        judge = cat_judge[category]
        lines.append(
            f"| {category} | {evidence['count']} | "
            f"{safe_div(evidence['found'], evidence['relevant']):.1%} ({evidence['found']}/{evidence['relevant']}) | "
            f"{safe_div(judge['correct'], judge['scored']):.1%} ({judge['correct']}/{judge['scored']}) | "
            f"{safe_div(cat_final_f1[category]['sum'], cat_final_f1[category]['count']):.3f} | "
            f"{safe_div(cat_raw_f1[category]['sum'], cat_raw_f1[category]['count']):.3f} |"
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

    wrong_high_recall = [q for q in per_question if q["judge_correct"] == 0 and q["evidence_recall"] >= 0.5]
    low_recall_wrong = [q for q in per_question if q["judge_correct"] == 0 and q["evidence_recall"] < 0.5]
    synth_gain = sorted(
        per_question,
        key=lambda q: q["final_token_f1"] - q["raw_token_f1"],
        reverse=True,
    )
    judge_failed_questions = [q for q in per_question if q["judge_status"] == "failed"]

    lines.append("## Error Slices")
    lines.append("")
    lines.append(f"- High recall / wrong answer: {len(wrong_high_recall)}")
    lines.append(f"- Low recall / wrong answer: {len(low_recall_wrong)}")
    lines.append(f"- Judge failed: {len(judge_failed_questions)}")
    if synth_gain:
        top_gain = synth_gain[0]
        lines.append(
            f"- Largest synthesis gain: q{top_gain['index']:04d} "
            f"({top_gain['raw_token_f1']:.2f} -> {top_gain['final_token_f1']:.2f}, mode={top_gain['extraction_mode']})"
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
        "total_correct": correct_count,
        "total_scored": scored_count,
        "failed_count": judge_failed,
        "per_question": [
            {
                "index": q["index"],
                "category": q["category"],
                "correct": q["judge_correct"],
                "status": q["judge_status"],
            }
            for q in per_question
        ],
    }
    (results_dir / "judge-results.json").write_text(json.dumps(judge_results, indent=2) + "\n")

    analysis = {
        "generated": datetime.now().isoformat(),
        "dataset": "locomo10",
        "vault_mode": gt.get("vault_mode", "dialog"),
        "total_questions": len(questions),
        "scored_questions": len(per_question),
        "total_sessions": gt.get("total_sessions", 0),
        "primary_answer_metric": "judge_accuracy",
        "overall_evidence_recall": round(overall_evidence_recall, 4),
        "overall_judge_accuracy": round(overall_judge_accuracy, 4),
        "overall_final_token_f1": round(overall_final_f1, 4),
        "overall_raw_token_f1": round(overall_raw_f1, 4),
        "overall_adversarial_accuracy": round(overall_adversarial_accuracy, 4),
        "overall_answer_score": round(overall_judge_accuracy, 4),
        "judge_scored_count": scored_count,
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
        "by_category_evidence": {
            k: {"recall": round(safe_div(v["found"], v["relevant"]), 4), **v}
            for k, v in cat_evidence.items()
        },
        "by_category_answer": {
            k: {
                "avg_score": round(safe_div(cat_judge[k]["correct"], cat_judge[k]["scored"]), 4),
                "judge_accuracy": round(safe_div(cat_judge[k]["correct"], cat_judge[k]["scored"]), 4),
                "final_token_f1": round(safe_div(cat_final_f1[k]["sum"], cat_final_f1[k]["count"]), 4),
                "raw_token_f1": round(safe_div(cat_raw_f1[k]["sum"], cat_raw_f1[k]["count"]), 4),
                "correct": cat_judge[k]["correct"],
                "scored": cat_judge[k]["scored"],
                "failed": cat_judge[k]["failed"],
                "count": cat_judge[k]["count"],
            }
            for k in cat_judge
        },
        "per_question": per_question,
    }
    analysis_path = results_dir / "analysis.json"
    analysis_path.write_text(json.dumps(analysis, indent=2) + "\n")
    print(f"Analysis: {analysis_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
