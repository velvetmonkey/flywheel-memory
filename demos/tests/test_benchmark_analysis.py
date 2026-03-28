import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

DEMOS_DIR = Path(__file__).resolve().parents[1]


class BenchmarkAnalysisTest(unittest.TestCase):
    def make_jsonl(self, path: Path, answer: str, md_path: str, cost: float = 0.01):
        rows = [
            {
                "type": "assistant",
                "message": {
                    "content": [
                        {"type": "tool_use", "name": "mcp__flywheel__search", "input": {}},
                        {"type": "text", "text": f"ANSWER: {answer}"},
                    ]
                },
            },
            {
                "type": "user",
                "message": {
                    "content": [
                        {
                            "type": "tool_result",
                            "content": [{"type": "text", "text": json.dumps({"results": [{"path": md_path}]})}],
                        }
                    ]
                },
            },
            {"type": "result", "result": f"ANSWER: {answer}", "total_cost_usd": cost},
        ]
        with path.open("w") as handle:
            for row in rows:
                handle.write(json.dumps(row) + "\n")

    def test_locomo_analyzer_supports_raw_only_runs(self):
        with tempfile.TemporaryDirectory() as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            results_dir = temp_dir / "results"
            raw_dir = results_dir / "raw"
            raw_dir.mkdir(parents=True)
            gt_path = temp_dir / "ground-truth.json"
            self.make_jsonl(raw_dir / "q0000.jsonl", "2022", "conversations/foo/session-01.md")
            gt_path.write_text(json.dumps({
                "dataset": "locomo10",
                "vault_mode": "dialog",
                "total_sessions": 1,
                "questions": [{
                    "question": "When?",
                    "answer": "2022",
                    "category": "single_hop",
                    "category_num": 2,
                    "evidence_paths": ["conversations/foo/session-01.md"],
                }],
            }))

            subprocess.run(
                [sys.executable, str(DEMOS_DIR / "locomo" / "analyze-benchmark.py"), str(results_dir), str(gt_path)],
                check=True,
                capture_output=True,
                text=True,
            )

            analysis = json.loads((results_dir / "analysis.json").read_text())
            self.assertEqual(analysis["primary_answer_metric"], "judge_accuracy")
            self.assertEqual(analysis["overall_evidence_recall"], 1.0)
            self.assertIn("overall_final_token_f1", analysis)

    def test_hotpot_analyzer_supports_raw_only_runs(self):
        with tempfile.TemporaryDirectory() as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            results_dir = temp_dir / "results"
            raw_dir = results_dir / "raw"
            raw_dir.mkdir(parents=True)
            gt_path = temp_dir / "ground-truth.json"
            self.make_jsonl(raw_dir / "q000.jsonl", "Blake Shelton", "docs/Blake Shelton.md")
            gt_path.write_text(json.dumps({
                "dataset": "hotpot_dev_distractor_v1",
                "total_docs": 1,
                "questions": [{
                    "id": "q1",
                    "question": "Who?",
                    "answer": "Blake Shelton",
                    "type": "bridge",
                    "level": "hard",
                    "supporting_paths": ["docs/Blake Shelton.md"],
                }],
            }))

            subprocess.run(
                [sys.executable, str(DEMOS_DIR / "hotpotqa" / "analyze-benchmark.py"), str(results_dir), str(gt_path)],
                check=True,
                capture_output=True,
                text=True,
            )

            analysis = json.loads((results_dir / "analysis.json").read_text())
            self.assertEqual(analysis["primary_answer_metric"], "judge_accuracy")
            self.assertEqual(analysis["overall_recall"], 1.0)
            self.assertIn("overall_final_token_f1", analysis)

    def test_locomo_analyzer_multi_question_mixed(self):
        with tempfile.TemporaryDirectory() as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            results_dir = temp_dir / "results"
            raw_dir = results_dir / "raw"
            raw_dir.mkdir(parents=True)
            gt_path = temp_dir / "ground-truth.json"

            # q0: correct answer, matching evidence
            self.make_jsonl(raw_dir / "q0000.jsonl", "2022", "conversations/a/session-01.md", cost=0.05)
            # q1: wrong answer, different evidence
            self.make_jsonl(raw_dir / "q0001.jsonl", "Paris", "conversations/b/session-01.md", cost=0.03)
            # q2: adversarial (category_num=5) — should use regex scoring, not judge
            self.make_jsonl(raw_dir / "q0002.jsonl", "Not stated in the vault.", "conversations/c/session-01.md", cost=0.02)

            gt_path.write_text(json.dumps({
                "dataset": "locomo10",
                "vault_mode": "dialog",
                "total_sessions": 3,
                "questions": [
                    {
                        "question": "What year did they move?",
                        "answer": "2022",
                        "category": "single_hop",
                        "category_num": 2,
                        "evidence_paths": ["conversations/a/session-01.md"],
                    },
                    {
                        "question": "Where did they go?",
                        "answer": "London",
                        "category": "multi_hop",
                        "category_num": 3,
                        "evidence_paths": ["conversations/b/session-01.md"],
                    },
                    {
                        "question": "What is the phone number?",
                        "answer": "adversarial",
                        "category": "adversarial",
                        "category_num": 5,
                        "evidence_paths": [],
                    },
                ],
            }))

            subprocess.run(
                [sys.executable, str(DEMOS_DIR / "locomo" / "analyze-benchmark.py"), str(results_dir), str(gt_path)],
                check=True,
                capture_output=True,
                text=True,
            )

            analysis = json.loads((results_dir / "analysis.json").read_text())
            self.assertEqual(analysis["scored_questions"], 3)
            self.assertIn("cost_breakdown", analysis)
            self.assertIn("by_category_answer", analysis)
            # adversarial question should be scored via regex (no judge needed)
            adv = analysis["by_category_answer"].get("adversarial", {})
            self.assertGreater(adv.get("count", 0), 0)


if __name__ == "__main__":
    unittest.main()
