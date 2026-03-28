"""Integration tests for benchmark analyzers."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

DEMOS_DIR = Path(__file__).resolve().parents[1]


def make_jsonl(path: Path, answer: str, md_path: str, cost: float = 0.01):
    """Write a minimal stream-json JSONL for one benchmark question."""
    rows = [
        {
            'type': 'assistant',
            'message': {
                'content': [
                    {'type': 'tool_use', 'name': 'mcp__flywheel__search', 'input': {}},
                    {'type': 'text', 'text': f'ANSWER: {answer}'},
                ]
            },
        },
        {
            'type': 'user',
            'message': {
                'content': [
                    {
                        'type': 'tool_result',
                        'content': [{'type': 'text', 'text': json.dumps({'results': [{'path': md_path}]})}],
                    }
                ]
            },
        },
        {'type': 'result', 'result': f'ANSWER: {answer}', 'total_cost_usd': cost},
    ]
    with path.open('w') as handle:
        for row in rows:
            handle.write(json.dumps(row) + '\n')


class TestLoCoMoAnalyzer:
    def test_raw_only_run(self):
        """Analyzer produces valid analysis.json from raw JSONL without artifacts."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            results_dir = tmp_dir / 'results'
            raw_dir = results_dir / 'raw'
            raw_dir.mkdir(parents=True)
            gt_path = tmp_dir / 'ground-truth.json'
            make_jsonl(raw_dir / 'q0000.jsonl', '2022', 'conversations/foo/session-01.md')
            gt_path.write_text(json.dumps({
                'dataset': 'locomo10',
                'vault_mode': 'dialog',
                'total_sessions': 1,
                'questions': [{
                    'question': 'When?',
                    'answer': '2022',
                    'category': 'single_hop',
                    'category_num': 2,
                    'evidence_paths': ['conversations/foo/session-01.md'],
                }],
            }))

            subprocess.run(
                [sys.executable, str(DEMOS_DIR / 'locomo' / 'analyze-benchmark.py'), str(results_dir), str(gt_path)],
                check=True, capture_output=True, text=True,
            )

            analysis = json.loads((results_dir / 'analysis.json').read_text())
            assert analysis['scored_questions'] == 1
            assert analysis['overall_evidence_recall'] == 1.0
            assert 'overall_final_token_f1' in analysis
            assert 'answer_layer_diagnostics' in analysis

    def test_multi_question_mixed(self):
        """Analyzer handles multiple questions with different categories."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            results_dir = tmp_dir / 'results'
            raw_dir = results_dir / 'raw'
            raw_dir.mkdir(parents=True)
            gt_path = tmp_dir / 'ground-truth.json'

            make_jsonl(raw_dir / 'q0000.jsonl', '2022', 'conversations/a/session-01.md', cost=0.05)
            make_jsonl(raw_dir / 'q0001.jsonl', 'Paris', 'conversations/b/session-01.md', cost=0.03)
            make_jsonl(raw_dir / 'q0002.jsonl', 'Not stated in the vault.', 'conversations/c/session-01.md', cost=0.02)

            gt_path.write_text(json.dumps({
                'dataset': 'locomo10',
                'vault_mode': 'dialog',
                'total_sessions': 3,
                'questions': [
                    {
                        'question': 'What year did they move?',
                        'answer': '2022',
                        'category': 'single_hop',
                        'category_num': 2,
                        'evidence_paths': ['conversations/a/session-01.md'],
                    },
                    {
                        'question': 'Where did they go?',
                        'answer': 'London',
                        'category': 'multi_hop',
                        'category_num': 3,
                        'evidence_paths': ['conversations/b/session-01.md'],
                    },
                    {
                        'question': 'What is the phone number?',
                        'answer': 'adversarial',
                        'category': 'adversarial',
                        'category_num': 5,
                        'evidence_paths': [],
                    },
                ],
            }))

            subprocess.run(
                [sys.executable, str(DEMOS_DIR / 'locomo' / 'analyze-benchmark.py'), str(results_dir), str(gt_path)],
                check=True, capture_output=True, text=True,
            )

            analysis = json.loads((results_dir / 'analysis.json').read_text())
            assert analysis['scored_questions'] == 3
            assert 'by_category_answer' in analysis
            assert 'by_category_evidence' in analysis
            # All three categories should appear
            for cat in ('single_hop', 'multi_hop', 'adversarial'):
                assert cat in analysis['by_category_answer']


class TestHotpotQAAnalyzer:
    def test_raw_only_run(self):
        """Analyzer produces valid analysis.json from raw JSONL."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            results_dir = tmp_dir / 'results'
            raw_dir = results_dir / 'raw'
            raw_dir.mkdir(parents=True)
            gt_path = tmp_dir / 'ground-truth.json'
            make_jsonl(raw_dir / 'q000.jsonl', 'Blake Shelton', 'docs/Blake Shelton.md')
            gt_path.write_text(json.dumps({
                'dataset': 'hotpot_dev_distractor_v1',
                'total_docs': 1,
                'questions': [{
                    'id': 'q1',
                    'question': 'Who?',
                    'answer': 'Blake Shelton',
                    'type': 'bridge',
                    'level': 'hard',
                    'supporting_paths': ['docs/Blake Shelton.md'],
                }],
            }))

            subprocess.run(
                [sys.executable, str(DEMOS_DIR / 'hotpotqa' / 'analyze-benchmark.py'), str(results_dir), str(gt_path)],
                check=True, capture_output=True, text=True,
            )

            analysis = json.loads((results_dir / 'analysis.json').read_text())
            assert analysis['overall_recall'] == 1.0
            assert 'per_question' in analysis
