#!/usr/bin/env python3
"""Shared answer layer for benchmark QA pipelines.

Owns answer shaping and answer-quality evaluation concerns.
Dataset-agnostic: LoCoMo uses it first, but any QA harness can adopt it.

Four concerns:
  1. Prompt contract — structured answer format for benchmark QA
  2. Raw answer parser — extract answers from Claude JSONL output
  3. Extraction/compression — compress verbose answers via LLM
  4. Judge helper — centralized LLM-as-judge verdict

Shared scoring utilities:
  - normalize_answer, token_f1, adversarial_score, wilson_ci
"""

import argparse
import json
import math
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

UNAVAILABLE_SENTINEL = 'Not stated in the vault.'

ANSWER_PREFIX = 'ANSWER:'

BREVITY_THRESHOLD = 10  # normalized token count above which extraction runs

ARTICLES = {'a', 'an', 'the'}

NO_INFO_PATTERNS = [
    r'no information',
    r'not (?:enough |sufficient )?information',
    r'cannot (?:be |find|determine)',
    r'not (?:mentioned|found|available|specified|stated|provided)',
    r"(?:doesn't|does not|don't|do not) (?:mention|contain|have|include|provide|specify)",
    r'unanswerable',
    r'(?:no|isn\'t any|is no) (?:relevant )?(?:evidence|data|record)',
    r'not stated in the vault',
]

ANSWER_CONTRACT = f"""After searching, provide your answer in this exact format:
{ANSWER_PREFIX} <your concise factual answer>

- Put ONLY the factual answer after {ANSWER_PREFIX} — no reasoning, no search explanation
- If the information is not in the vault: {ANSWER_PREFIX} {UNAVAILABLE_SENTINEL}"""


# ---------------------------------------------------------------------------
# Prompt contract
# ---------------------------------------------------------------------------

def build_qa_prompt(question, preamble=''):
    """Assemble a full QA prompt with the answer contract.

    Args:
        question: The question to answer.
        preamble: Dataset-specific instructions (vault structure, tool usage, etc.)
    """
    parts = []
    if preamble:
        parts.append(preamble.rstrip())
        parts.append('')
    parts.append(f'Question: {question}')
    parts.append('')
    parts.append(ANSWER_CONTRACT)
    return '\n'.join(parts)


# ---------------------------------------------------------------------------
# Scoring utilities
# ---------------------------------------------------------------------------

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


def adversarial_score(prediction):
    """1 if response correctly indicates no info available, 0 otherwise."""
    for pattern in NO_INFO_PATTERNS:
        if re.search(pattern, prediction, re.IGNORECASE):
            return 1.0
    return 0.0


# ---------------------------------------------------------------------------
# Raw answer parser
# ---------------------------------------------------------------------------

def parse_raw_answer(jsonl_path):
    """Extract the final answer text from a Claude stream-json JSONL file.

    Returns the raw answer string (empty string if not found).
    """
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

                if obj.get('type') == 'assistant':
                    for block in obj.get('message', {}).get('content', []):
                        if isinstance(block, dict) and block.get('type') == 'text':
                            final_answer = block['text']

                elif obj.get('type') == 'result':
                    result_text = obj.get('result', '')
                    if result_text:
                        final_answer = result_text

    except FileNotFoundError:
        pass

    return final_answer


def parse_contracted_answer(text):
    """Extract the answer from text following the ANSWER: contract.

    Returns (answer, extraction_mode) where mode is:
      - 'prompt_contract' if ANSWER: prefix found
      - 'parser_fallback' if not found (returns whole text stripped)
    """
    if not text:
        return '', 'parser_fallback'

    # Look for ANSWER: prefix (case-insensitive, may appear mid-text)
    match = re.search(r'(?:^|\n)\s*ANSWER:\s*(.+)', text, re.IGNORECASE)
    if match:
        answer = match.group(1).strip()
        # Handle multi-line: take only the first line after ANSWER:
        answer = answer.split('\n')[0].strip()
        return answer, 'prompt_contract'

    # Fallback: use the whole text stripped
    return text.strip(), 'parser_fallback'


# ---------------------------------------------------------------------------
# Extraction / compression
# ---------------------------------------------------------------------------

def extract_concise(raw_answer, question, model='haiku', retries=1):
    """Compress a verbose answer into a concise factual statement.

    Only runs LLM extraction when the answer exceeds BREVITY_THRESHOLD tokens.
    Returns (final_answer, extraction_mode, extract_error).
    """
    # First try contract parsing
    parsed, mode = parse_contracted_answer(raw_answer)

    # Check if already concise
    token_count = len(normalize_answer(parsed).split())
    if token_count <= BREVITY_THRESHOLD:
        return parsed, mode, None

    # LLM extraction for verbose answers
    prompt = f"""Extract ONLY the factual answer from this response. Reply with just the fact, nothing else.

Question: {question}
Response: {parsed[:500]}

Factual answer:"""

    last_error = None
    for attempt in range(1 + retries):
        try:
            result = subprocess.run(
                ['claude', '-p', prompt, '--model', model, '--no-session-persistence'],
                capture_output=True, text=True, timeout=30
            )
            extracted = result.stdout.strip()
            if extracted:
                return extracted, 'llm_extract', None
            last_error = f'empty response (exit {result.returncode})'
            if result.stderr.strip():
                last_error += f': {result.stderr.strip()[:200]}'
        except subprocess.TimeoutExpired:
            last_error = f'timeout on attempt {attempt + 1}'
        except Exception as e:
            last_error = f'{type(e).__name__}: {e}'

        if attempt < retries:
            print(f'  extract retry {attempt + 1}/{retries}: {last_error}', file=sys.stderr)

    # Extraction failed — return parsed as-is with error detail
    print(f'  extract failed ({token_count} tokens kept): {last_error}', file=sys.stderr)
    return parsed, mode, last_error


# ---------------------------------------------------------------------------
# Judge helper
# ---------------------------------------------------------------------------

def judge_answer(question, ground_truth, prediction, model='haiku'):
    """LLM-as-judge: evaluate whether prediction is correct.

    Returns dict with:
      - correct: bool
      - verdict: 'CORRECT' | 'WRONG' | 'ERROR'
      - error: str or None
    """
    prompt = f"""Judge whether the predicted answer is correct given the ground truth.
CORRECT: prediction conveys the same core fact as the ground truth, even if more verbose.
WRONG: prediction contradicts the ground truth, gives a different answer, or says info is unavailable when it exists.

Question: {question}
Ground truth: {ground_truth}
Prediction: {prediction[:500]}

Reply with exactly one word: CORRECT or WRONG"""

    try:
        result = subprocess.run(
            ['claude', '-p', prompt, '--model', model, '--no-session-persistence'],
            capture_output=True, text=True, timeout=30
        )
        verdict = result.stdout.strip().upper()
        is_correct = 'CORRECT' in verdict
        return {
            'correct': is_correct,
            'verdict': 'CORRECT' if is_correct else 'WRONG',
            'error': None,
        }
    except Exception as e:
        return {
            'correct': False,
            'verdict': 'ERROR',
            'error': str(e),
        }


# ---------------------------------------------------------------------------
# Per-question artifact
# ---------------------------------------------------------------------------

def process_question(jsonl_path, question, index, category, model='haiku'):
    """Parse and optionally extract a concise answer from a question's JSONL.

    Returns the answer artifact dict.
    """
    raw_answer = parse_raw_answer(jsonl_path)
    final_answer, extraction_mode, extract_error = extract_concise(
        raw_answer, question, model=model
    )

    raw_tokens = normalize_answer(raw_answer).split()
    final_tokens = normalize_answer(final_answer).split()

    artifact = {
        'index': index,
        'category': category,
        'question': question,
        'raw_answer': raw_answer,
        'final_answer': final_answer,
        'extraction_mode': extraction_mode,
        'raw_token_count': len(raw_tokens),
        'final_token_count': len(final_tokens),
        'normalized': raw_answer != final_answer,
    }
    if extract_error:
        artifact['extract_error'] = extract_error
    return artifact


# ---------------------------------------------------------------------------
# CLI interface
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='Answer layer CLI')
    sub = parser.add_subparsers(dest='command')

    ext = sub.add_parser('extract', help='Extract and compress answer from JSONL')
    ext.add_argument('--jsonl', required=True, help='Path to question JSONL')
    ext.add_argument('--question', required=True, help='Question text')
    ext.add_argument('--index', required=True, type=int, help='Question index')
    ext.add_argument('--category', required=True, help='Question category')
    ext.add_argument('--model', default='haiku', help='Model for extraction')
    ext.add_argument('--output', required=True, help='Output artifact path')

    args = parser.parse_args()

    if args.command == 'extract':
        artifact = process_question(
            args.jsonl, args.question, args.index, args.category, model=args.model
        )
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w') as f:
            json.dump(artifact, f, indent=2)
        mode = artifact['extraction_mode']
        raw_n = artifact['raw_token_count']
        final_n = artifact['final_token_count']
        print(f'{mode} ({raw_n} -> {final_n} tokens)', file=sys.stderr)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
