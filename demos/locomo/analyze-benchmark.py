#!/usr/bin/env python3
"""Analyze LoCoMo end-to-end benchmark results.

Parses stream-json JSONL output from claude -p runs, computes:
  1. Evidence recall (did tools access the right session notes?)
  2. Answer quality — LLM-as-judge accuracy (primary) + token F1 (diagnostic)

Uses the shared answer layer for scoring and judging. Reads per-question
answer artifacts when available, falls back to JSONL parsing for old runs.

Usage:
    python3 analyze-benchmark.py <results_dir> <ground_truth.json> [--judge] [--judge-model MODEL]
"""

import json
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# Add demos/lib to path for answer_layer import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'lib'))

from answer_layer import (
    adversarial_score,
    brevity_check,
    judge_answer as al_judge_answer,
    normalize_answer,
    parse_raw_answer,
    parse_contracted_answer,
    token_f1,
    wilson_ci,
)


def extract_accessed_paths(jsonl_path):
    """Extract note paths and tool metadata from stream-json JSONL.

    Returns (paths, cost, tools_used). Answer extraction is handled
    by the answer layer, not this function.
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

                # Tool inputs
                if obj.get('type') == 'assistant':
                    for block in obj.get('message', {}).get('content', []):
                        if isinstance(block, dict) and block.get('type') == 'tool_use':
                            name = block.get('name', '').replace('mcp__flywheel__', '')
                            tools_used.append(name)
                            inp = block.get('input', {})
                            for key in ('path', 'note_path', 'source', 'target', 'query'):
                                if isinstance(inp.get(key), str) and inp[key].endswith('.md'):
                                    paths.add(inp[key])

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

    except FileNotFoundError:
        pass

    return paths, api_cost, tools_used


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
# Phase 1: Compute evidence recall + raw/final token F1 metrics
# ---------------------------------------------------------------------------

def compute_metrics(results_dir, gt_path):
    """Compute evidence recall and token F1 (raw + final) for all questions."""
    results_dir = Path(results_dir)
    raw_dir = results_dir / 'raw'
    answers_dir = results_dir / 'answers'

    gt = json.load(open(gt_path))
    questions = gt['questions']

    per_question = []
    total_cost = 0.0
    cat_evidence = defaultdict(lambda: {'found': 0, 'relevant': 0, 'count': 0})
    cat_raw_f1 = defaultdict(lambda: {'score_sum': 0.0, 'count': 0})
    cat_final_f1 = defaultdict(lambda: {'score_sum': 0.0, 'count': 0})

    for i, q in enumerate(questions):
        # Support both 3-digit (legacy) and 4-digit (balanced) filenames
        jsonl_path = raw_dir / f'q{i:04d}.jsonl'
        if not jsonl_path.exists():
            jsonl_path = raw_dir / f'q{i:03d}.jsonl'

        # Skip questions without result files (subset runs)
        if not jsonl_path.exists():
            continue

        accessed_paths, cost, tools = extract_accessed_paths(str(jsonl_path))
        total_cost += cost

        # Evidence recall
        relevant = set(q.get('evidence_paths', []))
        found = relevant & accessed_paths
        evidence_recall = len(found) / len(relevant) if relevant else 0

        category = q['category']
        cat_evidence[category]['found'] += len(found)
        cat_evidence[category]['relevant'] += len(relevant)
        cat_evidence[category]['count'] += 1

        # Load answer — prefer artifact, fall back to JSONL parsing
        artifact_path = answers_dir / f'q{i:04d}.json'
        if not artifact_path.exists():
            artifact_path = answers_dir / f'q{i:03d}.json'

        if artifact_path.exists():
            artifact = json.load(open(artifact_path))
            raw_answer = artifact.get('raw_answer', '')
            final_answer = artifact.get('final_answer', '')
            extraction_mode = artifact.get('extraction_mode', 'unknown')
            raw_token_count = artifact.get('raw_token_count', 0)
            final_token_count = artifact.get('final_token_count', 0)
            compression_applied = artifact.get('compression_applied', False)
            compression_reason = artifact.get('compression_reason', '')
        else:
            # Legacy: no artifact, parse from JSONL
            raw_answer = parse_raw_answer(str(jsonl_path))
            final_answer, extraction_mode = parse_contracted_answer(raw_answer)
            raw_token_count = len(normalize_answer(raw_answer).split())
            final_token_count = len(normalize_answer(final_answer).split())
            compression_applied = False
            compression_reason = ''

        # Answer quality scoring (raw and final)
        ground_truth = q.get('answer', '')
        cat_num = q.get('category_num', 0)

        if cat_num == 5:
            raw_score = adversarial_score(raw_answer)
            final_score = adversarial_score(final_answer)
        else:
            raw_score = token_f1(raw_answer, ground_truth)
            final_score = token_f1(final_answer, ground_truth)

        cat_raw_f1[category]['score_sum'] += raw_score
        cat_raw_f1[category]['count'] += 1
        cat_final_f1[category]['score_sum'] += final_score
        cat_final_f1[category]['count'] += 1

        per_question.append({
            'index': i,
            'question': q['question'],
            'raw_answer': raw_answer,
            'final_answer': final_answer,
            'ground_truth': ground_truth,
            'category': category,
            'category_num': cat_num,
            'extraction_mode': extraction_mode,
            'raw_token_count': raw_token_count,
            'final_token_count': final_token_count,
            'compression_applied': compression_applied,
            'compression_reason': compression_reason,
            'evidence_recall': round(evidence_recall, 3),
            'raw_token_f1': round(raw_score, 3),
            'final_token_f1': round(final_score, 3),
            'tools_used': tools,
            'paths_accessed': len(accessed_paths),
            'cost_usd': round(cost, 4),
        })

    # Aggregate
    total_found = sum(s['found'] for s in cat_evidence.values())
    total_relevant = sum(s['relevant'] for s in cat_evidence.values())
    overall_evidence_recall = total_found / total_relevant if total_relevant > 0 else 0

    def _avg(cat_dict):
        total_sum = sum(s['score_sum'] for s in cat_dict.values())
        total_count = sum(s['count'] for s in cat_dict.values())
        return total_sum / total_count if total_count > 0 else 0

    return {
        'gt': gt,
        'per_question': per_question,
        'total_cost': total_cost,
        'cat_evidence': dict(cat_evidence),
        'cat_raw_f1': dict(cat_raw_f1),
        'cat_final_f1': dict(cat_final_f1),
        'overall_evidence_recall': overall_evidence_recall,
        'overall_raw_token_f1': _avg(cat_raw_f1),
        'overall_final_token_f1': _avg(cat_final_f1),
    }


# ---------------------------------------------------------------------------
# Phase 2: LLM-as-judge scoring
# ---------------------------------------------------------------------------

def judge_answers(per_question, judge_model='haiku'):
    """LLM-as-judge scoring: evaluate each answer as correct/wrong.

    Judges against final_answer (extracted/compressed), not raw.
    Comparable to Mem0 evaluation methodology.
    """
    cat_accuracy = defaultdict(lambda: {'correct': 0, 'total': 0})
    judge_results = []

    for pq in per_question:
        final_answer = pq['final_answer']
        category = pq['category']

        if not final_answer:
            judge_results.append({'index': pq['index'], 'correct': 0, 'category': category})
            cat_accuracy[category]['total'] += 1
            continue

        # For adversarial: use our existing detector
        if pq['category_num'] == 5:
            score = adversarial_score(final_answer)
            judge_results.append({'index': pq['index'], 'correct': score, 'category': category})
            cat_accuracy[category]['correct'] += int(score)
            cat_accuracy[category]['total'] += 1
            continue

        # LLM-as-judge via answer layer
        verdict = al_judge_answer(
            pq['question'], pq['ground_truth'], final_answer, model=judge_model
        )
        is_correct = 1 if verdict['correct'] else 0

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

    raw_f1 = metrics['overall_raw_token_f1']
    final_f1 = metrics['overall_final_token_f1']
    lines.append(f'| Final Token F1 | {final_f1:.3f} (after extraction) |')
    lines.append(f'| Raw Token F1 | {raw_f1:.3f} (diagnostic) |')

    if scored_count > 0:
        lines.append(f'| Avg Cost/Question | ${metrics["total_cost"]/scored_count:.3f} |')
    lines.append('')

    # --- By Category ---
    lines.append('## By Category')
    lines.append('')

    if judge_data:
        lines.append('| Category | Questions | Accuracy | 95% CI | Evidence Recall | Final F1 | Raw F1 |')
        lines.append('|----------|-----------|----------|--------|-----------------|----------|--------|')
    else:
        lines.append('| Category | Questions | Evidence Recall | Final F1 | Raw F1 |')
        lines.append('|----------|-----------|-----------------|----------|--------|')

    all_cats = sorted(set(
        list(metrics['cat_evidence'].keys()) +
        list(metrics['cat_raw_f1'].keys()) +
        list(metrics['cat_final_f1'].keys())
    ))
    for cat in all_cats:
        ev = metrics['cat_evidence'].get(cat, {'found': 0, 'relevant': 0, 'count': 0})
        raw = metrics['cat_raw_f1'].get(cat, {'score_sum': 0, 'count': 0})
        final = metrics['cat_final_f1'].get(cat, {'score_sum': 0, 'count': 0})
        n = ev['count'] or raw['count']
        er_cat = ev['found'] / ev['relevant'] if ev['relevant'] > 0 else 0
        raw_f1_cat = raw['score_sum'] / raw['count'] if raw['count'] > 0 else 0
        final_f1_cat = final['score_sum'] / final['count'] if final['count'] > 0 else 0
        metric_type = 'adv' if cat == 'adversarial' else ''

        if judge_data:
            jcat = judge_data['by_category'].get(cat, {})
            acc_cat = jcat.get('accuracy', 0)
            ci = jcat.get('ci_95', [0, 0])
            lines.append(f'| {cat} | {n} | {acc_cat:.1%} | [{ci[0]:.1%}, {ci[1]:.1%}] | {er_cat:.1%} | {final_f1_cat:.3f} | {raw_f1_cat:.3f} |')
        else:
            lines.append(f'| {cat} | {n} | {er_cat:.1%} ({ev["found"]}/{ev["relevant"]}) | {final_f1_cat:.3f} | {raw_f1_cat:.3f} |')
    lines.append('')

    # --- Answer Layer Diagnostics ---
    modes = defaultdict(int)
    for q in per_question:
        modes[q.get('extraction_mode', 'unknown')] += 1
    compression_count = sum(1 for q in per_question if q.get('compression_applied', False))
    compression_rate = compression_count / scored_count if scored_count > 0 else 0
    avg_raw_tokens = sum(q.get('raw_token_count', 0) for q in per_question) / scored_count if scored_count > 0 else 0
    avg_final_tokens = sum(q.get('final_token_count', 0) for q in per_question) / scored_count if scored_count > 0 else 0

    if modes:
        lines.append('## Answer Layer Diagnostics')
        lines.append('')
        lines.append('| Metric | Value |')
        lines.append('|--------|-------|')
        mode_parts = ', '.join(f'{k}: {v}' for k, v in sorted(modes.items()))
        lines.append(f'| Extraction Modes | {mode_parts} |')
        lines.append(f'| Compression Rate | {compression_rate:.0%} ({compression_count}/{scored_count}) |')
        lines.append(f'| Avg Raw Tokens | {avg_raw_tokens:.1f} |')
        lines.append(f'| Avg Final Tokens | {avg_final_tokens:.1f} |')
        lines.append('')

    # --- Worst evidence recall ---
    missed = [q for q in per_question if q['evidence_recall'] < 1.0 and q['category'] != 'adversarial']
    missed.sort(key=lambda x: x['evidence_recall'])
    if missed:
        lines.append('## Lowest Evidence Recall (worst 10)')
        lines.append('')
        lines.append('| Question | Category | Recall | Final F1 |')
        lines.append('|----------|----------|--------|----------|')
        for q in missed[:10]:
            lines.append(f'| {q["question"][:55]}... | {q["category"]} | {q["evidence_recall"]:.0%} | {q["final_token_f1"]:.2f} |')
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
        'overall_final_token_f1': round(metrics['overall_final_token_f1'], 4),
        'overall_raw_token_f1': round(metrics['overall_raw_token_f1'], 4),
        'total_cost_usd': round(metrics['total_cost'], 4),
        'by_category_evidence': {
            k: {'recall': round(v['found'] / v['relevant'], 4) if v['relevant'] else 0, **v}
            for k, v in metrics['cat_evidence'].items()
        },
        'by_category_answer': {},
        'per_question': [
            {k: v for k, v in q.items() if k not in ('raw_answer', 'final_answer', 'ground_truth', 'question')}
            for q in per_question
        ],
    }

    # Merge raw/final F1 per category
    for cat in all_cats:
        raw = metrics['cat_raw_f1'].get(cat, {'score_sum': 0, 'count': 0})
        final = metrics['cat_final_f1'].get(cat, {'score_sum': 0, 'count': 0})
        entry = {
            'raw_f1': round(raw['score_sum'] / raw['count'], 4) if raw['count'] else 0,
            'final_f1': round(final['score_sum'] / final['count'], 4) if final['count'] else 0,
            'count': raw['count'],
        }
        analysis['by_category_answer'][cat] = entry

    # Backward compat: overall_answer_score = raw token F1 (one transition cycle)
    analysis['overall_answer_score'] = analysis['overall_raw_token_f1']
    # Backward compat: overall_token_f1 = raw token F1
    analysis['overall_token_f1'] = analysis['overall_raw_token_f1']

    # Adversarial accuracy (separate metric)
    adv_final = metrics['cat_final_f1'].get('adversarial', {'score_sum': 0, 'count': 0})
    if adv_final['count'] > 0:
        analysis['overall_adversarial_accuracy'] = round(adv_final['score_sum'] / adv_final['count'], 4)

    # Answer layer diagnostics
    analysis['answer_layer_diagnostics'] = {
        'extraction_modes': dict(modes),
        'compression_rate': round(compression_rate, 4),
        'avg_raw_tokens': round(avg_raw_tokens, 1),
        'avg_final_tokens': round(avg_final_tokens, 1),
    }

    if judge_data:
        analysis['primary_answer_metric'] = 'judge_accuracy'
        analysis['judge_model'] = judge_data['judge_model']
        analysis['overall_judge_accuracy'] = judge_data['overall_accuracy']
        analysis['overall_judge_ci_95'] = judge_data['overall_ci_95']
        analysis['judge_scored_count'] = judge_data['total_scored']
        analysis['judge_failed_count'] = sum(
            1 for jq in judge_data.get('per_question', [])
            if jq.get('correct') == 0 and not any(
                pq['index'] == jq['index'] and pq.get('category_num') == 5
                for pq in per_question
            )
        ) if judge_data.get('per_question') else 0
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

    # Phase 1: compute evidence recall + raw/final token F1
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
