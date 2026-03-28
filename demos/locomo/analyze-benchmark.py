#!/usr/bin/env python3
"""Analyze LoCoMo end-to-end benchmark results.

Parses stream-json JSONL output from claude -p runs, computes:
  1. Evidence recall (did tools access the right session notes?)
  2. Answer quality — LLM-as-judge accuracy (primary) + token F1 (diagnostic)

Usage:
    python3 analyze-benchmark.py <results_dir> <ground_truth.json> [--judge] [--judge-model MODEL]
"""

import json
import math
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


ARTICLES = {'a', 'an', 'the'}


def wilson_ci(correct, total, z=1.96):
    """Wilson score interval (95% CI) for a binomial proportion."""
    if total == 0:
        return (0.0, 0.0)
    p = correct / total
    denom = 1 + z * z / total
    centre = p + z * z / (2 * total)
    spread = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
    lo = (centre - spread) / denom
    hi = (centre + spread) / denom
    return (max(0.0, lo), min(1.0, hi))


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


# ---------------------------------------------------------------------------
# Phase 1: Compute evidence recall + token F1 metrics
# ---------------------------------------------------------------------------

def compute_metrics(results_dir, gt_path):
    """Compute evidence recall and token F1 for all questions. Returns structured data."""
    results_dir = Path(results_dir)
    raw_dir = results_dir / 'raw'

    gt = json.load(open(gt_path))
    questions = gt['questions']

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

        # Answer quality (token F1)
        cat_num = q.get('category_num', 0)
        if cat_num == 5:
            answer_score = adversarial_score(answer)
        else:
            answer_score = token_f1(answer, q.get('answer', ''))

        cat_answer[category]['score_sum'] += answer_score
        cat_answer[category]['count'] += 1

        per_question.append({
            'index': i,
            'question': q['question'],
            'answer': answer,
            'ground_truth': q.get('answer', ''),
            'category': category,
            'category_num': q.get('category_num', 0),
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

    return {
        'gt': gt,
        'per_question': per_question,
        'total_cost': total_cost,
        'cat_evidence': dict(cat_evidence),
        'cat_answer': dict(cat_answer),
        'overall_evidence_recall': overall_evidence_recall,
        'overall_answer_score': overall_answer_score,
    }


# ---------------------------------------------------------------------------
# Phase 2: LLM-as-judge scoring
# ---------------------------------------------------------------------------

def judge_answers(per_question, judge_model='haiku'):
    """LLM-as-judge scoring: ask Claude to evaluate each answer as correct/wrong.

    Comparable to Mem0 evaluation methodology.
    Returns judge data dict (also usable standalone).
    """
    import subprocess

    cat_accuracy = defaultdict(lambda: {'correct': 0, 'total': 0})
    judge_results = []

    for pq in per_question:
        answer = pq['answer']
        category = pq['category']

        if not answer:
            judge_results.append({'index': pq['index'], 'correct': 0, 'category': category})
            cat_accuracy[category]['total'] += 1
            continue

        # For adversarial: use our existing detector
        if pq['category_num'] == 5:
            score = adversarial_score(answer)
            judge_results.append({'index': pq['index'], 'correct': score, 'category': category})
            cat_accuracy[category]['correct'] += int(score)
            cat_accuracy[category]['total'] += 1
            continue

        ground_truth = pq['ground_truth']
        question = pq['question']

        # LLM-as-judge prompt
        prompt = f"""Judge whether the predicted answer is correct given the ground truth.
CORRECT: prediction conveys the same core fact as the ground truth, even if more verbose.
WRONG: prediction contradicts the ground truth, gives a different answer, or says info is unavailable when it exists.

Question: {question}
Ground truth: {ground_truth}
Prediction: {answer[:500]}

Reply with exactly one word: CORRECT or WRONG"""

        try:
            result = subprocess.run(
                ['claude', '-p', prompt, '--model', judge_model, '--no-session-persistence'],
                capture_output=True, text=True, timeout=30
            )
            verdict = result.stdout.strip().upper()
            is_correct = 1 if 'CORRECT' in verdict else 0
        except Exception:
            is_correct = 0

        judge_results.append({'index': pq['index'], 'correct': is_correct, 'category': category})
        cat_accuracy[category]['correct'] += is_correct
        cat_accuracy[category]['total'] += 1

        padded = f'{pq["index"]:04d}'
        symbol = '+' if is_correct else '-'
        print(f'  q{padded} [{category}]: {symbol}', file=sys.stderr)

    # Aggregate
    total_correct = sum(s['correct'] for s in cat_accuracy.values())
    total_count = sum(s['total'] for s in cat_accuracy.values())
    overall_acc = total_correct / total_count if total_count > 0 else 0
    overall_lo, overall_hi = wilson_ci(total_correct, total_count)

    return {
        'judge_model': judge_model,
        'overall_accuracy': round(overall_acc, 4),
        'overall_ci_95': [round(overall_lo, 4), round(overall_hi, 4)],
        'total_correct': total_correct,
        'total_scored': total_count,
        'by_category': {
            k: {
                'accuracy': round(v['correct'] / v['total'], 4) if v['total'] else 0,
                'ci_95': [round(x, 4) for x in wilson_ci(v['correct'], v['total'])],
                **v,
            }
            for k, v in cat_accuracy.items()
        },
        'per_question': judge_results,
    }


# ---------------------------------------------------------------------------
# Phase 3: Write combined report + analysis JSON
# ---------------------------------------------------------------------------

def write_report(results_dir, metrics, judge_data=None):
    """Write report.md and analysis.json with judge as primary (when available)."""
    results_dir = Path(results_dir)
    gt = metrics['gt']
    per_question = metrics['per_question']
    scored_count = len(per_question)

    lines = []
    lines.append('# LoCoMo End-to-End Benchmark')
    lines.append('')
    lines.append(f'**Date:** {datetime.now().strftime("%Y-%m-%d %H:%M")}')
    lines.append(f'**Questions Scored:** {scored_count} / {len(gt["questions"])}')
    lines.append(f'**Vault Mode:** {gt.get("vault_mode", "dialog")}')
    lines.append(f'**Sessions:** {gt.get("total_sessions", "?")}')
    lines.append(f'**Total Cost:** ${metrics["total_cost"]:.2f}')
    lines.append('')

    # --- Overall Results ---
    lines.append('## Overall Results')
    lines.append('')
    lines.append('| Metric | Value |')
    lines.append('|--------|-------|')

    if judge_data:
        acc = judge_data['overall_accuracy']
        lo, hi = judge_data['overall_ci_95']
        n_correct = judge_data['total_correct']
        n_total = judge_data['total_scored']
        lines.append(f'| Answer Accuracy | **{acc:.1%}** ({n_correct}/{n_total}, LLM-as-judge) &mdash; 95% CI [{lo:.1%}, {hi:.1%}] |')

    er = metrics['overall_evidence_recall']
    total_found = sum(s['found'] for s in metrics['cat_evidence'].values())
    total_relevant = sum(s['relevant'] for s in metrics['cat_evidence'].values())
    lines.append(f'| Evidence Recall | **{er:.1%}** ({total_found}/{total_relevant} evidence sessions found) |')

    f1 = metrics['overall_answer_score']
    label = 'diagnostic' if judge_data else 'token F1'
    lines.append(f'| Token F1 | {f1:.3f} ({label}) |')

    if scored_count > 0:
        lines.append(f'| Avg Cost/Question | ${metrics["total_cost"]/scored_count:.3f} |')
    lines.append('')

    # --- By Category ---
    lines.append('## By Category')
    lines.append('')

    # Build header
    if judge_data:
        lines.append('| Category | Questions | Accuracy (judge) | 95% CI | Evidence Recall | Token F1 |')
        lines.append('|----------|-----------|------------------|--------|-----------------|----------|')
    else:
        lines.append('| Category | Questions | Evidence Recall | Avg Score |')
        lines.append('|----------|-----------|-----------------|-----------|')

    all_cats = sorted(set(list(metrics['cat_evidence'].keys()) + list(metrics['cat_answer'].keys())))
    for cat in all_cats:
        ev = metrics['cat_evidence'].get(cat, {'found': 0, 'relevant': 0, 'count': 0})
        ans = metrics['cat_answer'].get(cat, {'score_sum': 0, 'count': 0})
        n = ev['count'] or ans['count']
        er_cat = ev['found'] / ev['relevant'] if ev['relevant'] > 0 else 0
        f1_cat = ans['score_sum'] / ans['count'] if ans['count'] > 0 else 0
        metric_type = 'adversarial' if cat == 'adversarial' else 'F1'

        if judge_data:
            jcat = judge_data['by_category'].get(cat, {})
            acc_cat = jcat.get('accuracy', 0)
            ci = jcat.get('ci_95', [0, 0])
            lines.append(f'| {cat} | {n} | {acc_cat:.1%} | [{ci[0]:.1%}, {ci[1]:.1%}] | {er_cat:.1%} | {f1_cat:.3f} ({metric_type}) |')
        else:
            lines.append(f'| {cat} | {n} | {er_cat:.1%} ({ev["found"]}/{ev["relevant"]}) | {f1_cat:.3f} ({metric_type}) |')
    lines.append('')

    # --- Worst evidence recall ---
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

    if judge_data:
        lines.append(f'*Judge model: {judge_data["judge_model"]}*')
        lines.append('')

    report = '\n'.join(lines)
    print(report)

    # Write report.md
    report_path = results_dir / 'report.md'
    with open(report_path, 'w') as f:
        f.write(report)
    print(f'\nReport: {report_path}', file=sys.stderr)

    # Write analysis.json
    analysis = {
        'generated': datetime.now().isoformat(),
        'dataset': 'locomo10',
        'vault_mode': gt.get('vault_mode', 'dialog'),
        'total_questions': len(gt['questions']),
        'scored_questions': scored_count,
        'total_sessions': gt.get('total_sessions', 0),
        'overall_evidence_recall': round(metrics['overall_evidence_recall'], 4),
        'overall_token_f1': round(metrics['overall_answer_score'], 4),
        'total_cost_usd': round(metrics['total_cost'], 4),
        'by_category_evidence': {
            k: {'recall': round(v['found'] / v['relevant'], 4) if v['relevant'] else 0, **v}
            for k, v in metrics['cat_evidence'].items()
        },
        'by_category_answer': {
            k: {'avg_f1': round(v['score_sum'] / v['count'], 4) if v['count'] else 0, **v}
            for k, v in metrics['cat_answer'].items()
        },
        'per_question': [
            {k: v for k, v in q.items() if k not in ('answer', 'ground_truth', 'question')}
            for q in per_question
        ],
    }

    # Backward compat: keep overall_answer_score as alias for token F1
    analysis['overall_answer_score'] = analysis['overall_token_f1']

    if judge_data:
        analysis['primary_answer_metric'] = 'judge_accuracy'
        analysis['judge_model'] = judge_data['judge_model']
        analysis['overall_judge_accuracy'] = judge_data['overall_accuracy']
        analysis['overall_judge_ci_95'] = judge_data['overall_ci_95']
        for cat, jcat in judge_data['by_category'].items():
            if cat in analysis['by_category_answer']:
                analysis['by_category_answer'][cat]['judge_accuracy'] = jcat['accuracy']
                analysis['by_category_answer'][cat]['judge_ci_95'] = jcat['ci_95']
    else:
        analysis['primary_answer_metric'] = 'token_f1'

    analysis_path = results_dir / 'analysis.json'
    with open(analysis_path, 'w') as f:
        json.dump(analysis, f, indent=2)
    print(f'Analysis: {analysis_path}', file=sys.stderr)

    # Write standalone judge-results.json (if judge ran)
    if judge_data:
        judge_path = results_dir / 'judge-results.json'
        with open(judge_path, 'w') as f:
            json.dump(judge_data, f, indent=2)
        print(f'Judge results: {judge_path}', file=sys.stderr)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: analyze-benchmark.py <results_dir> <ground_truth.json> [--judge] [--judge-model MODEL]', file=sys.stderr)
        sys.exit(1)

    results_dir = sys.argv[1]
    gt_path = sys.argv[2]

    raw_dir = Path(results_dir) / 'raw'
    if not raw_dir.exists():
        print(f'No raw directory at {raw_dir}', file=sys.stderr)
        sys.exit(1)

    # Phase 1: compute evidence recall + token F1
    print('Computing metrics...', file=sys.stderr)
    metrics = compute_metrics(results_dir, gt_path)

    # Phase 2: run judge (if requested)
    judge_data = None
    if '--judge' in sys.argv:
        judge_model = 'haiku'
        if '--judge-model' in sys.argv:
            idx = sys.argv.index('--judge-model')
            if idx + 1 < len(sys.argv):
                judge_model = sys.argv[idx + 1]
        print(f'\n=== Running LLM-as-Judge Scoring (model: {judge_model}) ===\n', file=sys.stderr)
        judge_data = judge_answers(metrics['per_question'], judge_model=judge_model)

    # Phase 3: write combined report
    write_report(results_dir, metrics, judge_data)
