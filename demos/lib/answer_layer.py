#!/usr/bin/env python3
"""Shared benchmark answer-layer utilities for demos.

This module centralizes:
  - stream-json parsing for Claude benchmark runs
  - answer extraction / contract parsing
  - concise-answer compression
  - judge scoring
  - token-F1 / refusal helpers
  - per-question artifact generation
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


UNAVAILABLE_SENTINEL = "Not stated in the vault."
ARTICLES = {"a", "an", "the"}
NO_INFO_PATTERNS = [
    r"no information",
    r"not (?:enough |sufficient )?information",
    r"cannot (?:be |find|determine)",
    r"not (?:mentioned|found|available|specified|stated|provided)",
    r"(?:doesn't|does not|don't|do not) (?:mention|contain|have|include|provide|specify)",
    r"unanswerable",
    r"(?:no|isn't any|is no) (?:relevant )?(?:evidence|data|record)",
]
ANSWER_LINE_RE = re.compile(r"^\s*ANSWER:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE | re.DOTALL)


@dataclass
class Thresholds:
    max_tokens: int = 10
    max_chars: int = 100
    max_sentences: int = 1


def normalize_answer(text: str) -> str:
    text = str(text or "").lower()
    text = re.sub(r"[^\w\s]", " ", text)
    tokens = [t for t in text.split() if t and t not in ARTICLES]
    return " ".join(tokens)


def token_count(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))


def sentence_count(text: str) -> int:
    stripped = (text or "").strip()
    if not stripped:
        return 0
    parts = [p for p in re.split(r"[.!?]+(?:\s+|$)", stripped) if p.strip()]
    return max(1, len(parts))


def token_f1(prediction: str, ground_truth: str) -> float:
    pred_tokens = normalize_answer(prediction).split()
    truth_tokens = normalize_answer(ground_truth).split()
    if not truth_tokens and not pred_tokens:
        return 1.0
    if not truth_tokens or not pred_tokens:
        return 0.0

    from collections import Counter

    pred_counts = Counter(pred_tokens)
    truth_counts = Counter(truth_tokens)
    common = sum(min(count, truth_counts.get(token, 0)) for token, count in pred_counts.items())
    precision = common / len(pred_tokens)
    recall = common / len(truth_tokens)
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def adversarial_score(prediction: str) -> float:
    if normalize_answer(prediction) == normalize_answer(UNAVAILABLE_SENTINEL):
        return 1.0
    for pattern in NO_INFO_PATTERNS:
        if re.search(pattern, prediction or "", re.IGNORECASE):
            return 1.0
    return 0.0


def _extract_paths(data: Any, paths: set[str]) -> None:
    if isinstance(data, dict):
        if "path" in data and isinstance(data["path"], str) and data["path"].endswith(".md"):
            paths.add(data["path"])
        for value in data.values():
            _extract_paths(value, paths)
    elif isinstance(data, list):
        for item in data:
            _extract_paths(item, paths)


def _collapse_text_blocks(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "".join(parts)


def parse_stream_json(jsonl_path: str | Path) -> dict[str, Any]:
    paths: set[str] = set()
    tools_used: list[str] = []
    assistant_texts: list[str] = []
    result_text = ""
    total_cost_usd = 0.0
    result_seen = False
    file_path = Path(jsonl_path)

    if not file_path.exists():
        return {
            "accessed_paths": [],
            "tools_used": [],
            "assistant_texts": [],
            "result_text": "",
            "raw_answer": "",
            "total_cost_usd": 0.0,
            "result_seen": False,
        }

    with file_path.open() as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            obj_type = obj.get("type")
            if obj_type == "assistant":
                for block in obj.get("message", {}).get("content", []):
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "tool_use":
                        name = block.get("name", "").replace("mcp__flywheel__", "")
                        tools_used.append(name)
                        inputs = block.get("input", {})
                        for key in ("path", "note_path", "source", "target", "query"):
                            value = inputs.get(key)
                            if isinstance(value, str) and value.endswith(".md"):
                                paths.add(value)
                    elif block.get("type") == "text":
                        text = block.get("text", "")
                        if text:
                            assistant_texts.append(text)
            elif obj_type == "user":
                for block in obj.get("message", {}).get("content", []):
                    if not isinstance(block, dict) or block.get("type") != "tool_result":
                        continue
                    text = _collapse_text_blocks(block.get("content", []))
                    if not text:
                        continue
                    try:
                        data = json.loads(text)
                        _extract_paths(data, paths)
                    except (json.JSONDecodeError, ValueError):
                        pass
                    for match in re.finditer(r'"path"\s*:\s*"([^"]+\.md)"', text):
                        paths.add(match.group(1))
            elif obj_type == "result":
                result_seen = True
                total_cost_usd = obj.get("total_cost_usd", 0.0) or 0.0
                result_text = obj.get("result", "") or ""

    if result_text:
        raw_answer = result_text.strip()
    elif assistant_texts:
        raw_answer = assistant_texts[-1].strip()
    else:
        raw_answer = ""
    return {
        "accessed_paths": sorted(paths),
        "tools_used": tools_used,
        "assistant_texts": assistant_texts,
        "result_text": result_text,
        "raw_answer": raw_answer,
        "total_cost_usd": round(float(total_cost_usd), 6),
        "result_seen": result_seen,
    }


def parse_contract_answer(raw_answer: str) -> tuple[str, bool]:
    if not raw_answer:
        return "", False
    match = ANSWER_LINE_RE.search(raw_answer)
    if not match:
        return raw_answer.strip(), False
    return match.group(1).strip(), True


def extraction_reason(answer: str, used_fallback: bool, thresholds: Thresholds) -> str | None:
    if not answer:
        return None
    if used_fallback:
        return "parser_fallback"
    if token_count(answer) > thresholds.max_tokens:
        return "token_limit"
    if len(answer) > thresholds.max_chars:
        return "char_limit"
    if sentence_count(answer) > thresholds.max_sentences:
        return "sentence_limit"
    return None


def run_claude_stream_json(prompt: str, model: str, timeout: int) -> tuple[str, float]:
    result = subprocess.run(
        [
            "claude",
            "-p",
            prompt,
            "--output-format",
            "stream-json",
            "--no-session-persistence",
            "--model",
            model,
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    text_out = ""
    cost = 0.0
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("type") == "assistant":
            for block in obj.get("message", {}).get("content", []):
                if isinstance(block, dict) and block.get("type") == "text":
                    text_out = block.get("text", "") or text_out
        elif obj.get("type") == "result":
            cost = float(obj.get("total_cost_usd", 0.0) or 0.0)
            if obj.get("result"):
                text_out = obj["result"]
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"claude exited {result.returncode}")
    return text_out.strip(), round(cost, 6)


def extract_concise_answer(question: str, answer: str, model: str, timeout: int) -> tuple[str, float]:
    prompt = f"""Rewrite the answer as the shortest standalone fact that still correctly answers the question.
Return exactly one line beginning with ANSWER:
Use "{UNAVAILABLE_SENTINEL}" if the answer is not supported.

Question: {question}
Answer: {answer}
"""
    text, cost = run_claude_stream_json(prompt, model=model, timeout=timeout)
    concise, _ = parse_contract_answer(text)
    return concise or text.strip(), cost


def judge_answer(question: str, ground_truth: str, answer: str, category_num: int | None,
                 model: str, timeout: int) -> tuple[str, float, int | None]:
    if category_num == 5:
        return "scored", 0.0, int(adversarial_score(answer))
    prompt = f"""Judge whether the predicted answer is correct given the ground truth.
A prediction is CORRECT if it conveys the same core information as the ground truth, even if phrased differently or more verbosely.
A prediction is WRONG if it contradicts the ground truth, gives a different answer, or says the information is unavailable when it is available.

Question: {question}
Ground truth: {ground_truth}
Prediction: {answer[:800]}

Reply with exactly one word: CORRECT or WRONG
"""
    try:
        verdict, cost = run_claude_stream_json(prompt, model=model, timeout=timeout)
    except Exception:
        return "failed", 0.0, None
    normalized = verdict.strip().upper()
    if "CORRECT" in normalized:
        return "scored", cost, 1
    if "WRONG" in normalized:
        return "scored", cost, 0
    return "failed", cost, None


def build_answer_artifact(
    *,
    dataset: str,
    jsonl_path: str | Path,
    question: str,
    ground_truth: str,
    category: str = "",
    category_num: int | None = None,
    answer_extract: bool = True,
    extract_model: str = "haiku",
    judge: bool = True,
    judge_model: str = "haiku",
    thresholds: Thresholds | None = None,
    extract_timeout: int = 30,
    judge_timeout: int = 30,
) -> dict[str, Any]:
    thresholds = thresholds or Thresholds()
    parsed = parse_stream_json(jsonl_path)
    raw_answer = parsed["raw_answer"].strip()
    parsed_answer, contract_followed = parse_contract_answer(raw_answer)
    raw_token_count = token_count(raw_answer)
    final_answer = parsed_answer
    compression_applied = False
    compression_reason = extraction_reason(parsed_answer, not contract_followed, thresholds)
    extraction_mode = "prompt_contract" if contract_followed else "parser_fallback"
    extraction_cost = 0.0
    generation_status = "completed" if parsed["result_seen"] or raw_answer else "failed"

    if generation_status == "failed":
        final_answer = ""
        extraction_mode = "generation_failed"
        compression_reason = None
    elif answer_extract and compression_reason:
        try:
            concise, extraction_cost = extract_concise_answer(
                question=question,
                answer=parsed_answer or raw_answer,
                model=extract_model,
                timeout=extract_timeout,
            )
            final_answer = concise.strip()
            extraction_mode = "llm_extract"
            compression_applied = normalize_answer(final_answer) != normalize_answer(parsed_answer)
        except Exception:
            final_answer = parsed_answer
            extraction_mode = "extraction_failed"
            compression_applied = False

    final_token_count = token_count(final_answer)

    judge_status = "skipped"
    judge_cost = 0.0
    judge_correct: int | None = None
    if generation_status == "completed" and judge:
        judge_status, judge_cost, judge_correct = judge_answer(
            question=question,
            ground_truth=ground_truth,
            answer=final_answer,
            category_num=category_num,
            model=judge_model,
            timeout=judge_timeout,
        )

    artifact = {
        "dataset": dataset,
        "question": question,
        "ground_truth": ground_truth,
        "category": category,
        "category_num": category_num,
        "generation_status": generation_status,
        "contract_followed": contract_followed,
        "raw_answer": raw_answer,
        "final_answer": final_answer,
        "extraction_mode": extraction_mode,
        "compression_applied": compression_applied,
        "compression_reason": compression_reason,
        "raw_token_count": raw_token_count,
        "final_token_count": final_token_count,
        "raw_char_count": len(raw_answer),
        "final_char_count": len(final_answer),
        "generation_cost_usd": parsed["total_cost_usd"],
        "extraction_cost_usd": round(extraction_cost, 6),
        "judge_cost_usd": round(judge_cost, 6),
        "total_cost_usd": round(parsed["total_cost_usd"] + extraction_cost + judge_cost, 6),
        "judge_status": judge_status,
        "judge_correct": judge_correct,
        "accessed_paths": parsed["accessed_paths"],
        "tools_used": parsed["tools_used"],
        "paths_accessed": len(parsed["accessed_paths"]),
    }
    return artifact


def save_answer_artifact(output_path: str | Path, artifact: dict[str, Any]) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as handle:
        json.dump(artifact, handle, indent=2)
        handle.write("\n")


def load_answer_artifact(path: str | Path) -> dict[str, Any]:
    with Path(path).open() as handle:
        return json.load(handle)


def _build_cli() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Benchmark answer-layer helper")
    sub = parser.add_subparsers(dest="command", required=True)

    process = sub.add_parser("process", help="Create a per-question answer artifact from raw JSONL")
    process.add_argument("--dataset", required=True)
    process.add_argument("--jsonl", required=True)
    process.add_argument("--output", required=True)
    process.add_argument("--question", required=True)
    process.add_argument("--ground-truth", required=True)
    process.add_argument("--category", default="")
    process.add_argument("--category-num", type=int)
    process.add_argument("--answer-extract", type=int, default=1)
    process.add_argument("--extract-model", default="haiku")
    process.add_argument("--judge", type=int, default=1)
    process.add_argument("--judge-model", default="haiku")
    process.add_argument("--answer-max-tokens", type=int, default=10)
    process.add_argument("--answer-max-chars", type=int, default=100)
    process.add_argument("--answer-max-sentences", type=int, default=1)
    process.add_argument("--extract-timeout", type=int, default=30)
    process.add_argument("--judge-timeout", type=int, default=30)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_cli()
    args = parser.parse_args(argv)

    if args.command == "process":
        artifact = build_answer_artifact(
            dataset=args.dataset,
            jsonl_path=args.jsonl,
            question=args.question,
            ground_truth=args.ground_truth,
            category=args.category,
            category_num=args.category_num,
            answer_extract=bool(args.answer_extract),
            extract_model=args.extract_model,
            judge=bool(args.judge),
            judge_model=args.judge_model,
            thresholds=Thresholds(
                max_tokens=args.answer_max_tokens,
                max_chars=args.answer_max_chars,
                max_sentences=args.answer_max_sentences,
            ),
            extract_timeout=args.extract_timeout,
            judge_timeout=args.judge_timeout,
        )
        save_answer_artifact(args.output, artifact)
        print(json.dumps(artifact, indent=2))
        return 0

    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    sys.exit(main())
