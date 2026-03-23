#!/usr/bin/env python3
"""Analyze LoCoMo end-to-end benchmark results.

Parses stream-json JSONL output from claude -p runs, computes:
  1. Evidence recall (did tools access the right session notes?)
  2. Answer quality (token F1 for categories 1-4, adversarial detection for cat 5)

Usage:
    python3 analyze-benchmark.py <results_dir> <ground_truth.json>
"""

import json
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path


ARTICLES = {'a', 'an', 'the'}


def normalize_answer(text):
    """Lowercase, strip articles/punctuation/whitespace."""
    text = str(text).lower()
    text = re.sub(r'[^\w\s]', ' ', text)
    tokens = [t for t in text.split() if t and t not in ARTICLES]
    return ' '.join(tokens)


def token_f1(prediction, ground_truth):
    """Token-level F1 between prediction and ground truth."""
    pred_tokens = normalize_answer(prediction).split()
    truth_tokens = normalize_answer(ground_truth).split()

    if not truth_tokens and not pred_tokens:
        return 1.0
    if not truth_tokens or not pred_tokens:
        return 0.0

    from collections import Counter
    pred_counts = Counter(pred_tokens)
    truth_counts = Counter(truth_tokens)

    common = 0
    for token, count in pred_counts.items():
        common += min(count, truth_counts.get(token, 0))

    precision = common / len(pred_tokens)
    recall = common / len(truth_tokens)
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


NO_INFO_PATTERNS = [
    r'no information',
    r'not (?:enough |sufficient )?information',
    r'cannot (?:be |find|determine)',
    r'not (?:mentioned|found|available|specified|stated|provided)',
    r"(?:doesn't|does not|don't|do not) (?:mention|contain|have|include|provide|specify)",
    r'unanswerable',
    r'(?:no|isn\'t any|is no) (?:relevant )?(?:evidence|data|record)',
]


def adversarial_score(prediction):
    """1 if response correctly indicates no info available, 0 otherwise."""
    for pattern in NO_INFO_PATTERNS:
        if re.search(pattern, prediction, re.IGNORECASE):
            return 1.0
    return 0.0


def extract_accessed_paths(jsonl_path):
    """Extract note paths accessed via Flywheel tools from stream-json JSONL."""
    paths = set()
    api_cost = 0.0
    tools_used = []
    final_answer = ''

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

                # Tool inputs
                if obj.get('type') == 'assistant':
                    for block in obj.get('message', {}).get('content', []):
                        if isinstance(block, dict):
                            if block.get('type') == 'tool_use':
                                name = block.get('name', '').replace('mcp__flywheel__', '')
                                tools_used.append(name)
                                inp = block.get('input', {})
                                for key in ('path', 'note_path', 'source', 'target', 'query'):
                                    if isinstance(inp.get(key), str) and inp[key].endswith('.md'):
                                        paths.add(inp[key])
                            elif block.get('type') == 'text':
                                final_answer = block['text']

                # Tool results
                elif obj.get('type') == 'user':
                    for block in obj.get('message', {}).get('content', []):
                        if isinstance(block, dict) and block.get('type') == 'tool_result':
                            content = block.get('content', [])
                            text = ''
                            if isinstance(content, list):
                                for c in content:
                                    if isinstance(c, dict) and c.get('type') == 'text':
                                        text += c['text']
                            elif isinstance(content, str):
                                text = content
                            if text:
                                try:
                                    data = json.loads(text)
                                    _extract_paths(data, paths)
                                except (json.JSONDecodeError, ValueError):
                                    pass
                                for m in re.finditer(r'"path"\s*:\s*"([^"]+\.md)"', text):
                                    paths.add(m.group(1))

                # Cost
                elif obj.get('type') == 'result':
                    api_cost = obj.get('total_cost_usd', 0)
                    # Also capture final text from result
                    result_text = obj.get('result', '')
                    if result_text:
                        final_answer = result_text

    except FileNotFoundError:
        pass

    return paths, api_cost, tools_used, final_answer


def _extract_paths(data, paths):
    """Recursively extract 'path' fields from JSON search results."""
    if isinstance(data, dict):
        if 'path' in data and isinstance(data['path'], str) and data['path'].endswith('.md'):
            paths.add(data['path'])
        for v in data.values():
            _extract_paths(v, paths)
    elif isinstance(data, list):
        for item in data:
            _extract_paths(item, paths)


def main():
    if len(sys.argv) < 3:
        print('Usage: analyze-benchmark.py <results_dir> <ground_truth.json>', file=sys.stderr)
        sys.exit(1)

    results_dir = Path(sys.argv[1])
    gt_path = sys.argv[2]
    raw_dir = results_dir / 'raw'

    if not raw_dir.exists():
        print(f'No raw directory at {raw_dir}', file=sys.stderr)
        sys.exit(1)

    gt = json.load(open(gt_path))
    questions = gt['questions']

    # Process each question
    per_question = []
    total_cost = 0.0
    cat_evidence = defaultdict(lambda: {'found': 0, 'relevant': 0, 'count': 0})
    cat_answer = defaultdict(lambda: {'score_sum': 0.0, 'count': 0})

    for i, q in enumerate(questions):
        # Support both 3-digit (legacy) and 4-digit (balanced) filenames
        jsonl_path = raw_dir / f'q{i:04d}.jsonl'
        if not jsonl_path.exists():
            jsonl_path = raw_dir / f'q{i:03d}.jsonl'

        # Skip questions without result files (subset runs)
        if not jsonl_path.exists():
            continue

        accessed_paths, cost, tools, answer = extract_accessed_paths(str(jsonl_path))
        total_cost += cost

        # Evidence recall
        relevant = set(q.get('evidence_paths', []))
        found = relevant & accessed_paths
        evidence_recall = len(found) / len(relevant) if relevant else 0

        category = q['category']
        cat_evidence[category]['found'] += len(found)
        cat_evidence[category]['relevant'] += len(relevant)
        cat_evidence[category]['count'] += 1

        # Answer quality
        cat_num = q.get('category_num', 0)
        if cat_num == 5:
            answer_score = adversarial_score(answer)
        else:
            answer_score = token_f1(answer, q.get('answer', ''))

        cat_answer[category]['score_sum'] += answer_score
        cat_answer[category]['count'] += 1

        per_question.append({
            'question': q['question'][:80],
            'category': category,
            'evidence_recall': round(evidence_recall, 3),
            'answer_f1': round(answer_score, 3),
            'tools_used': tools,
            'paths_accessed': len(accessed_paths),
            'cost_usd': round(cost, 4),
        })

    # Aggregate
    total_found = sum(s['found'] for s in cat_evidence.values())
    total_relevant = sum(s['relevant'] for s in cat_evidence.values())
    overall_evidence_recall = total_found / total_relevant if total_relevant > 0 else 0

    total_answer_sum = sum(s['score_sum'] for s in cat_answer.values())
    total_answer_count = sum(s['count'] for s in cat_answer.values())
    overall_answer_score = total_answer_sum / total_answer_count if total_answer_count > 0 else 0

    # Report
    lines = []
    lines.append('# LoCoMo End-to-End Benchmark')
    lines.append('')
    lines.append(f'**Date:** {datetime.now().strftime("%Y-%m-%d %H:%M")}')
    scored_count = len(per_question)
    lines.append(f'**Questions Scored:** {scored_count} / {len(questions)}')
    lines.append(f'**Vault Mode:** {gt.get("vault_mode", "dialog")}')
    lines.append(f'**Sessions:** {gt.get("total_sessions", "?")}')
    lines.append(f'**Total Cost:** ${total_cost:.2f}')
    lines.append('')

    lines.append('## Overall Results')
    lines.append('')
    lines.append('| Metric | Value |')
    lines.append('|--------|-------|')
    lines.append(f'| Evidence Recall | **{overall_evidence_recall:.1%}** ({total_found}/{total_relevant} evidence sessions found) |')
    lines.append(f'| Answer Score | **{overall_answer_score:.3f}** (F1 for cat 1-4, adversarial detection for cat 5) |')
    lines.append(f'| Avg Cost/Question | ${total_cost/scored_count:.3f} |' if scored_count > 0 else '| Avg Cost/Question | N/A |')
    lines.append('')

    lines.append('## By Category — Evidence Recall')
    lines.append('')
    lines.append('| Category | Questions | Evidence Recall |')
    lines.append('|----------|-----------|-----------------|')
    for cat, stats in sorted(cat_evidence.items()):
        r = stats['found'] / stats['relevant'] if stats['relevant'] > 0 else 0
        lines.append(f'| {cat} | {stats["count"]} | {r:.1%} ({stats["found"]}/{stats["relevant"]}) |')
    lines.append('')

    lines.append('## By Category — Answer Quality')
    lines.append('')
    lines.append('| Category | Questions | Avg Score |')
    lines.append('|----------|-----------|-----------|')
    for cat, stats in sorted(cat_answer.items()):
        avg = stats['score_sum'] / stats['count'] if stats['count'] > 0 else 0
        metric = 'adversarial accuracy' if cat == 'adversarial' else 'token F1'
        lines.append(f'| {cat} | {stats["count"]} | {avg:.3f} ({metric}) |')
    lines.append('')

    # Worst evidence recall
    missed = [q for q in per_question if q['evidence_recall'] < 1.0 and q['category'] != 'adversarial']
    missed.sort(key=lambda x: x['evidence_recall'])
    if missed:
        lines.append('## Lowest Evidence Recall (worst 10)')
        lines.append('')
        lines.append('| Question | Category | Recall | F1 |')
        lines.append('|----------|----------|--------|----|')
        for q in missed[:10]:
            lines.append(f'| {q["question"][:55]}... | {q["category"]} | {q["evidence_recall"]:.0%} | {q["answer_f1"]:.2f} |')
        lines.append('')

    report = '\n'.join(lines)
    print(report)

    # Write files
    report_path = results_dir / 'report.md'
    with open(report_path, 'w') as f:
        f.write(report)
    print(f'\nReport: {report_path}', file=sys.stderr)

    analysis_path = results_dir / 'analysis.json'
    with open(analysis_path, 'w') as f:
        json.dump({
            'generated': datetime.now().isoformat(),
            'dataset': 'locomo10',
            'vault_mode': gt.get('vault_mode', 'dialog'),
            'total_questions': len(questions),
            'scored_questions': scored_count,
            'total_sessions': gt.get('total_sessions', 0),
            'overall_evidence_recall': round(overall_evidence_recall, 4),
            'overall_answer_score': round(overall_answer_score, 4),
            'total_cost_usd': round(total_cost, 4),
            'by_category_evidence': {
                k: {'recall': round(v['found']/v['relevant'], 4) if v['relevant'] else 0, **v}
                for k, v in cat_evidence.items()
            },
            'by_category_answer': {
                k: {'avg_score': round(v['score_sum']/v['count'], 4) if v['count'] else 0, **v}
                for k, v in cat_answer.items()
            },
            'per_question': per_question,
        }, f, indent=2)
    print(f'Analysis: {analysis_path}', file=sys.stderr)


def judge_answers(results_dir, gt_path):
    """LLM-as-judge scoring: ask Claude to evaluate each answer as correct/wrong.

    Creates a judge-results.json with binary accuracy per question.
    Comparable to Ori Mnemos / Mem0 evaluation methodology.
    """
    import subprocess

    results_dir = Path(results_dir)
    gt = json.load(open(gt_path))
    questions = gt['questions']
    raw_dir = results_dir / 'raw'

    judge_results = []
    cat_accuracy = defaultdict(lambda: {'correct': 0, 'total': 0})

    for i, q in enumerate(questions):
        jsonl_path = raw_dir / f'q{i:04d}.jsonl'
        if not jsonl_path.exists():
            jsonl_path = raw_dir / f'q{i:03d}.jsonl'
        if not jsonl_path.exists():
            continue

        _, _, _, answer = extract_accessed_paths(str(jsonl_path))
        if not answer:
            judge_results.append({'index': i, 'correct': 0, 'category': q['category']})
            cat_accuracy[q['category']]['total'] += 1
            continue

        ground_truth = str(q.get('answer', ''))
        category = q['category']

        # For adversarial: use our existing detector
        if q.get('category_num') == 5:
            score = adversarial_score(answer)
            judge_results.append({'index': i, 'correct': score, 'category': category})
            cat_accuracy[category]['correct'] += int(score)
            cat_accuracy[category]['total'] += 1
            continue

        # LLM-as-judge prompt
        prompt = f"""Judge whether the predicted answer is correct given the ground truth.
A prediction is CORRECT if it conveys the same core information as the ground truth, even if worded differently or more verbose.
A prediction is WRONG if it contradicts the ground truth, gives a different answer, or says the information is not available when it is.

Ground truth: {ground_truth}
Prediction: {answer[:500]}

Reply with exactly one word: CORRECT or WRONG"""

        try:
            result = subprocess.run(
                ['claude', '-p', prompt, '--model', 'haiku', '--no-session-persistence'],
                capture_output=True, text=True, timeout=30
            )
            verdict = result.stdout.strip().upper()
            is_correct = 1 if 'CORRECT' in verdict else 0
        except Exception:
            is_correct = 0

        judge_results.append({'index': i, 'correct': is_correct, 'category': category})
        cat_accuracy[category]['correct'] += is_correct
        cat_accuracy[category]['total'] += 1

        padded = f'{i:04d}'
        symbol = '+' if is_correct else '-'
        print(f'  q{padded} [{category}]: {symbol}', file=sys.stderr)

    # Report
    total_correct = sum(s['correct'] for s in cat_accuracy.values())
    total_count = sum(s['total'] for s in cat_accuracy.values())
    overall_acc = total_correct / total_count if total_count > 0 else 0

    lines = []
    lines.append('')
    lines.append('## LLM-as-Judge Answer Accuracy')
    lines.append('')
    lines.append(f'**Overall: {overall_acc:.1%}** ({total_correct}/{total_count})')
    lines.append('')
    lines.append('| Category | Questions | Accuracy |')
    lines.append('|----------|-----------|----------|')
    for cat, stats in sorted(cat_accuracy.items()):
        acc = stats['correct'] / stats['total'] if stats['total'] > 0 else 0
        lines.append(f'| {cat} | {stats["total"]} | {acc:.1%} ({stats["correct"]}/{stats["total"]}) |')
    lines.append('')

    judge_report = '\n'.join(lines)
    print(judge_report)

    # Append to existing report
    report_path = results_dir / 'report.md'
    with open(report_path, 'a') as f:
        f.write(judge_report)

    # Write judge results
    judge_path = results_dir / 'judge-results.json'
    with open(judge_path, 'w') as f:
        json.dump({
            'overall_accuracy': round(overall_acc, 4),
            'total_correct': total_correct,
            'total_scored': total_count,
            'by_category': {
                k: {'accuracy': round(v['correct']/v['total'], 4) if v['total'] else 0, **v}
                for k, v in cat_accuracy.items()
            },
            'per_question': judge_results,
        }, f, indent=2)

    print(f'\nJudge results: {judge_path}', file=sys.stderr)
    return overall_acc, cat_accuracy


if __name__ == '__main__':
    main()

    # Run LLM-as-judge if --judge flag is passed
    if '--judge' in sys.argv:
        print('\n=== Running LLM-as-Judge Scoring ===\n', file=sys.stderr)
        judge_answers(sys.argv[1], sys.argv[2])
