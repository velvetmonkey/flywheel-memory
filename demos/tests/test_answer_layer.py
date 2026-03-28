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
    extraction_reason,
    load_answer_artifact,
    normalize_answer,
    parse_contract_answer,
    parse_stream_json,
    save_answer_artifact,
    sentence_count,
    token_count,
    token_f1,
)


class AnswerLayerTest(unittest.TestCase):
    def write_jsonl(self, rows):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        path = Path(temp_dir.name) / "sample.jsonl"
        with path.open("w") as handle:
            for row in rows:
                handle.write(json.dumps(row) + "\n")
        return path

    # ── existing tests (structural fix: removed try/finally) ──

    def test_parse_stream_json_prefers_result_text(self):
        path = self.write_jsonl([
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "intermediate"}]}},
            {"type": "result", "result": "ANSWER: final", "total_cost_usd": 0.123},
        ])
        parsed = parse_stream_json(path)
        self.assertEqual(parsed["raw_answer"], "ANSWER: final")
        self.assertEqual(parsed["total_cost_usd"], 0.123)

    def test_build_answer_artifact_parser_fallback_trigger(self):
        path = self.write_jsonl([
            {"type": "result", "result": "This answer ignored the contract.", "total_cost_usd": 0.01},
        ])
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

    def test_parse_contract_answer(self):
        answer, followed = parse_contract_answer("ANSWER: 2022")
        self.assertTrue(followed)
        self.assertEqual(answer, "2022")

    def test_adversarial_sentinel_scores_correctly(self):
        self.assertEqual(adversarial_score(UNAVAILABLE_SENTINEL), 1.0)

    def test_token_f1_distinguishes_verbose_answer(self):
        self.assertLess(token_f1("The answer is 2022.", "2022"), 1.0)

    # ── P1: scoring function edge cases ──

    def test_token_f1_identical(self):
        self.assertEqual(token_f1("2022", "2022"), 1.0)

    def test_token_f1_empty_both(self):
        self.assertEqual(token_f1("", ""), 1.0)

    def test_token_f1_empty_prediction(self):
        self.assertEqual(token_f1("", "2022"), 0.0)

    def test_token_f1_empty_truth(self):
        self.assertEqual(token_f1("2022", ""), 0.0)

    def test_adversarial_no_info_patterns(self):
        phrases = [
            "I cannot find that information",
            "The vault does not mention this topic",
            "There is no relevant evidence",
            "not enough information to answer",
            "This question is unanswerable",
        ]
        for phrase in phrases:
            with self.subTest(phrase=phrase):
                self.assertEqual(adversarial_score(phrase), 1.0)

    def test_adversarial_normal_answer(self):
        self.assertEqual(adversarial_score("Blake Shelton"), 0.0)

    def test_normalize_removes_articles_and_punctuation(self):
        self.assertEqual(normalize_answer("The year is 2022."), "year is 2022")

    def test_normalize_none(self):
        self.assertEqual(normalize_answer(None), "")

    # ── P2: JSONL parsing ──

    def test_parse_stream_json_missing_file(self):
        parsed = parse_stream_json("/nonexistent/path/to/file.jsonl")
        self.assertFalse(parsed["result_seen"])
        self.assertEqual(parsed["raw_answer"], "")
        self.assertEqual(parsed["accessed_paths"], [])

    def test_parse_stream_json_empty_file(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        path = Path(temp_dir.name) / "empty.jsonl"
        path.write_text("")
        parsed = parse_stream_json(path)
        self.assertFalse(parsed["result_seen"])
        self.assertEqual(parsed["raw_answer"], "")

    def test_parse_stream_json_extracts_tool_paths(self):
        path = self.write_jsonl([
            {
                "type": "assistant",
                "message": {"content": [
                    {"type": "tool_use", "name": "mcp__flywheel__search", "input": {"path": "notes/foo.md"}},
                ]},
            },
            {
                "type": "user",
                "message": {"content": [
                    {
                        "type": "tool_result",
                        "content": [{"type": "text", "text": json.dumps({"results": [{"path": "notes/bar.md"}]})}],
                    },
                ]},
            },
            {"type": "result", "result": "ANSWER: done", "total_cost_usd": 0.01},
        ])
        parsed = parse_stream_json(path)
        self.assertIn("notes/foo.md", parsed["accessed_paths"])
        self.assertIn("notes/bar.md", parsed["accessed_paths"])

    def test_parse_contract_answer_no_prefix(self):
        answer, followed = parse_contract_answer("Just some text")
        self.assertFalse(followed)
        self.assertEqual(answer, "Just some text")

    def test_parse_contract_answer_empty(self):
        answer, followed = parse_contract_answer("")
        self.assertFalse(followed)
        self.assertEqual(answer, "")

    # ── P3: artifact construction modes ──

    def test_extraction_reason_token_limit(self):
        long_answer = " ".join(["word"] * 15)
        reason = extraction_reason(long_answer, used_fallback=False, thresholds=Thresholds())
        self.assertEqual(reason, "token_limit")

    def test_extraction_reason_char_limit(self):
        long_answer = "x" * 150  # single token, exceeds 100 chars
        reason = extraction_reason(long_answer, used_fallback=False, thresholds=Thresholds())
        self.assertEqual(reason, "char_limit")

    def test_extraction_reason_within_thresholds(self):
        reason = extraction_reason("2022", used_fallback=False, thresholds=Thresholds())
        self.assertIsNone(reason)

    def test_build_artifact_generation_failed(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        path = Path(temp_dir.name) / "empty.jsonl"
        path.write_text("")
        artifact = build_answer_artifact(
            dataset="locomo10",
            jsonl_path=path,
            question="What year?",
            ground_truth="2022",
            answer_extract=False,
            judge=False,
        )
        self.assertEqual(artifact["generation_status"], "failed")
        self.assertEqual(artifact["extraction_mode"], "generation_failed")
        self.assertEqual(artifact["final_answer"], "")

    def test_build_artifact_contract_happy_path(self):
        path = self.write_jsonl([
            {"type": "result", "result": "ANSWER: 2022", "total_cost_usd": 0.05},
        ])
        artifact = build_answer_artifact(
            dataset="hotpotqa",
            jsonl_path=path,
            question="What year?",
            ground_truth="2022",
            answer_extract=False,
            judge=False,
        )
        self.assertEqual(artifact["extraction_mode"], "prompt_contract")
        self.assertTrue(artifact["contract_followed"])
        self.assertEqual(artifact["final_answer"], "2022")
        self.assertIsNone(artifact["compression_reason"])

    # ── P4: helpers ──

    def test_artifact_save_load_roundtrip(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        artifact = {"dataset": "test", "question": "Q?", "judge_correct": 1}
        out_path = Path(temp_dir.name) / "artifact.json"
        save_answer_artifact(out_path, artifact)
        loaded = load_answer_artifact(out_path)
        self.assertEqual(loaded, artifact)

    def test_sentence_count(self):
        self.assertEqual(sentence_count("Hello. World! OK?"), 3)
        self.assertEqual(sentence_count(""), 0)

    def test_token_count(self):
        self.assertEqual(token_count("one two three"), 3)
        self.assertEqual(token_count(""), 0)


if __name__ == "__main__":
    unittest.main()
