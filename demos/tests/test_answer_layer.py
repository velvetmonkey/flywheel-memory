import json
import sys
import tempfile
import unittest
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parents[1] / "lib"
if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

from answer_layer import (  # noqa: E402
    Thresholds,
    UNAVAILABLE_SENTINEL,
    adversarial_score,
    build_answer_artifact,
    parse_contract_answer,
    parse_stream_json,
    token_f1,
)


class AnswerLayerTest(unittest.TestCase):
    def write_jsonl(self, rows):
        temp_dir = tempfile.TemporaryDirectory()
        path = Path(temp_dir.name) / "sample.jsonl"
        with path.open("w") as handle:
            for row in rows:
                handle.write(json.dumps(row) + "\n")
        return temp_dir, path

    def test_parse_stream_json_prefers_result_text(self):
        temp_dir, path = self.write_jsonl([
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "intermediate"}]}},
            {"type": "result", "result": "ANSWER: final", "total_cost_usd": 0.123},
        ])
        try:
            parsed = parse_stream_json(path)
            self.assertEqual(parsed["raw_answer"], "ANSWER: final")
            self.assertEqual(parsed["total_cost_usd"], 0.123)
        finally:
            temp_dir.cleanup()

    def test_build_answer_artifact_parser_fallback_trigger(self):
        temp_dir, path = self.write_jsonl([
            {"type": "result", "result": "This answer ignored the contract.", "total_cost_usd": 0.01},
        ])
        try:
            artifact = build_answer_artifact(
                dataset="locomo10",
                jsonl_path=path,
                question="What year?",
                ground_truth="2022",
                answer_extract=False,
                judge=False,
                thresholds=Thresholds(max_tokens=10, max_chars=100, max_sentences=1),
            )
            self.assertEqual(artifact["extraction_mode"], "parser_fallback")
            self.assertEqual(artifact["compression_reason"], "parser_fallback")
            self.assertEqual(artifact["generation_status"], "completed")
        finally:
            temp_dir.cleanup()

    def test_parse_contract_answer(self):
        answer, followed = parse_contract_answer("ANSWER: 2022")
        self.assertTrue(followed)
        self.assertEqual(answer, "2022")

    def test_adversarial_sentinel_scores_correctly(self):
        self.assertEqual(adversarial_score(UNAVAILABLE_SENTINEL), 1.0)

    def test_token_f1_distinguishes_verbose_answer(self):
        self.assertLess(token_f1("The answer is 2022.", "2022"), 1.0)


if __name__ == "__main__":
    unittest.main()
