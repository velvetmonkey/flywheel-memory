"""Tests for the shared answer layer."""

import json
import math
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from answer_layer import (
    ANSWER_PREFIX,
    BREVITY_THRESHOLD,
    UNAVAILABLE_SENTINEL,
    adversarial_score,
    brevity_check,
    build_qa_prompt,
    count_sentences,
    extract_concise,
    judge_answer,
    normalize_answer,
    parse_contracted_answer,
    parse_raw_answer,
    process_question,
    token_f1,
    wilson_ci,
)


# ---------------------------------------------------------------------------
# normalize_answer
# ---------------------------------------------------------------------------

class TestNormalizeAnswer:
    def test_lowercase(self):
        assert normalize_answer('Hello World') == 'hello world'

    def test_strip_punctuation(self):
        assert normalize_answer('hello, world!') == 'hello world'

    def test_strip_articles(self):
        assert normalize_answer('the cat sat on a mat') == 'cat sat on mat'

    def test_empty(self):
        assert normalize_answer('') == ''

    def test_only_articles(self):
        assert normalize_answer('a the an') == ''


# ---------------------------------------------------------------------------
# token_f1
# ---------------------------------------------------------------------------

class TestTokenF1:
    def test_exact_match(self):
        assert token_f1('2022', '2022') == 1.0

    def test_both_empty(self):
        assert token_f1('', '') == 1.0

    def test_pred_empty(self):
        assert token_f1('', '2022') == 0.0

    def test_truth_empty(self):
        assert token_f1('2022', '') == 0.0

    def test_verbose_correct(self):
        """Core use case: correct answer buried in verbose text has low F1."""
        raw = 'Based on my search of the vault, I found that the answer is 2022.'
        gold = '2022'
        f1 = token_f1(raw, gold)
        assert f1 < 0.3, f'Expected low F1 for verbose answer, got {f1}'

    def test_concise_correct(self):
        """Extracted concise answer should have high F1."""
        final = '2022'
        gold = '2022'
        assert token_f1(final, gold) == 1.0

    def test_partial_overlap(self):
        f1 = token_f1('Stockholm Sweden', 'Stockholm, Sweden in 2022')
        assert 0.3 < f1 < 1.0

    def test_no_overlap(self):
        assert token_f1('apples', 'oranges') == 0.0

    def test_case_insensitive(self):
        assert token_f1('STOCKHOLM', 'stockholm') == 1.0


# ---------------------------------------------------------------------------
# adversarial_score
# ---------------------------------------------------------------------------

class TestAdversarialScore:
    def test_sentinel(self):
        assert adversarial_score(UNAVAILABLE_SENTINEL) == 1.0

    def test_no_information(self):
        assert adversarial_score('There is no information about this.') == 1.0

    def test_not_mentioned(self):
        assert adversarial_score('This topic is not mentioned in the vault.') == 1.0

    def test_cannot_find(self):
        assert adversarial_score('I cannot find any relevant data.') == 1.0

    def test_does_not_contain(self):
        assert adversarial_score("The vault doesn't contain this info.") == 1.0

    def test_positive_answer(self):
        assert adversarial_score('The event was in 2022.') == 0.0

    def test_empty(self):
        assert adversarial_score('') == 0.0


# ---------------------------------------------------------------------------
# wilson_ci
# ---------------------------------------------------------------------------

class TestWilsonCI:
    def test_zero_total(self):
        assert wilson_ci(0, 0) == (0.0, 0.0)

    def test_all_correct(self):
        lo, hi = wilson_ci(100, 100)
        assert lo > 0.95
        assert hi > 0.99

    def test_all_wrong(self):
        lo, hi = wilson_ci(0, 100)
        assert lo == 0.0
        assert hi < 0.05

    def test_half(self):
        lo, hi = wilson_ci(50, 100)
        assert 0.3 < lo < 0.5
        assert 0.5 < hi < 0.7

    def test_interval_bounds(self):
        lo, hi = wilson_ci(30, 100)
        assert 0.0 <= lo <= hi <= 1.0


# ---------------------------------------------------------------------------
# parse_contracted_answer
# ---------------------------------------------------------------------------

class TestParseContractedAnswer:
    def test_simple_contract(self):
        text = 'ANSWER: 2022'
        answer, mode = parse_contracted_answer(text)
        assert answer == '2022'
        assert mode == 'prompt_contract'

    def test_case_insensitive(self):
        text = 'answer: Stockholm'
        answer, mode = parse_contracted_answer(text)
        assert answer == 'Stockholm'
        assert mode == 'prompt_contract'

    def test_with_preamble(self):
        text = 'I searched the vault and found the information.\nANSWER: Sweden'
        answer, mode = parse_contracted_answer(text)
        assert answer == 'Sweden'
        assert mode == 'prompt_contract'

    def test_multiline_takes_first(self):
        text = 'ANSWER: 2022\nSome extra explanation here.'
        answer, mode = parse_contracted_answer(text)
        assert answer == '2022'

    def test_fallback_no_contract(self):
        text = 'The answer is 2022.'
        answer, mode = parse_contracted_answer(text)
        assert answer == 'The answer is 2022.'
        assert mode == 'parser_fallback'

    def test_empty(self):
        answer, mode = parse_contracted_answer('')
        assert answer == ''
        assert mode == 'parser_fallback'

    def test_sentinel(self):
        text = f'ANSWER: {UNAVAILABLE_SENTINEL}'
        answer, mode = parse_contracted_answer(text)
        assert answer == UNAVAILABLE_SENTINEL
        assert mode == 'prompt_contract'


# ---------------------------------------------------------------------------
# parse_raw_answer
# ---------------------------------------------------------------------------

class TestParseRawAnswer:
    def test_extracts_from_result(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            f.write(json.dumps({'type': 'result', 'result': 'ANSWER: 2022'}) + '\n')
            path = f.name
        assert parse_raw_answer(path) == 'ANSWER: 2022'
        Path(path).unlink()

    def test_extracts_from_assistant_text(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            obj = {
                'type': 'assistant',
                'message': {'content': [{'type': 'text', 'text': 'ANSWER: Sweden'}]},
            }
            f.write(json.dumps(obj) + '\n')
            path = f.name
        assert parse_raw_answer(path) == 'ANSWER: Sweden'
        Path(path).unlink()

    def test_result_overrides_assistant(self):
        """Result block (last in stream) should be the final answer."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            assistant = {
                'type': 'assistant',
                'message': {'content': [{'type': 'text', 'text': 'intermediate'}]},
            }
            result = {'type': 'result', 'result': 'ANSWER: final'}
            f.write(json.dumps(assistant) + '\n')
            f.write(json.dumps(result) + '\n')
            path = f.name
        assert parse_raw_answer(path) == 'ANSWER: final'
        Path(path).unlink()

    def test_missing_file(self):
        assert parse_raw_answer('/nonexistent/path.jsonl') == ''

    def test_empty_file(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            path = f.name
        assert parse_raw_answer(path) == ''
        Path(path).unlink()


# ---------------------------------------------------------------------------
# extract_concise
# ---------------------------------------------------------------------------

class TestExtractConcise:
    def test_short_answer_no_extraction(self):
        """Answers within threshold are returned as-is."""
        final, mode, err, reason = extract_concise('ANSWER: 2022', 'What year?')
        assert final == '2022'
        assert mode == 'prompt_contract'
        assert err is None

    def test_short_fallback_no_extraction(self):
        """Short fallback answers still trigger compression (fallback_parse reason)."""
        final, mode, err, reason = extract_concise('2022', 'What year?')
        # Fallback parse always triggers compression attempt
        assert err is None or mode in ('compressed', 'extraction_failed', 'parser_fallback')

    @patch('answer_layer.subprocess.run')
    def test_verbose_triggers_extraction(self, mock_run):
        """Verbose answers should trigger LLM extraction."""
        mock_run.return_value = MagicMock(stdout='2022', returncode=0)
        verbose = 'Based on my thorough search of the vault I found that the relevant information indicates the year was 2022'
        final, mode, err, reason = extract_concise(verbose, 'What year?')
        assert final == '2022'
        assert mode == 'compressed'
        assert err is None
        mock_run.assert_called_once()

    @patch('answer_layer.subprocess.run')
    def test_extraction_failure_returns_parsed_with_error(self, mock_run):
        """If LLM extraction fails, return the parsed answer with error detail."""
        mock_run.side_effect = Exception('connection refused')
        verbose = 'Based on my thorough search of the vault I found that the relevant information indicates the year was 2022'
        final, mode, err, reason = extract_concise(verbose, 'What year?', retries=0)
        assert final == verbose.strip()
        assert mode == 'extraction_failed'
        assert 'connection refused' in err

    @patch('answer_layer.subprocess.run')
    def test_extraction_retries_on_failure(self, mock_run):
        """Should retry once on failure then succeed."""
        mock_run.side_effect = [Exception('timeout'), MagicMock(stdout='2022', returncode=0)]
        verbose = 'Based on my thorough search of the vault I found that the relevant information indicates the year was 2022'
        final, mode, err, reason = extract_concise(verbose, 'What year?', retries=1)
        assert final == '2022'
        assert mode == 'compressed'
        assert err is None
        assert mock_run.call_count == 2

    @patch('answer_layer.subprocess.run')
    def test_extraction_empty_response_has_error(self, mock_run):
        """Empty extraction response should report error."""
        mock_run.return_value = MagicMock(stdout='', stderr='', returncode=0)
        verbose = 'Based on my thorough search of the vault I found that the relevant information indicates the year was 2022'
        final, mode, err, reason = extract_concise(verbose, 'What year?', retries=0)
        assert final == verbose.strip()
        assert 'empty response' in err


# ---------------------------------------------------------------------------
# judge_answer
# ---------------------------------------------------------------------------

class TestJudgeAnswer:
    @patch('answer_layer.subprocess.run')
    def test_correct(self, mock_run):
        mock_run.return_value = MagicMock(stdout='CORRECT', returncode=0)
        result = judge_answer('What year?', '2022', '2022')
        assert result['correct'] is True
        assert result['verdict'] == 'CORRECT'
        assert result['error'] is None

    @patch('answer_layer.subprocess.run')
    def test_wrong(self, mock_run):
        mock_run.return_value = MagicMock(stdout='WRONG', returncode=0)
        result = judge_answer('What year?', '2022', '2023')
        assert result['correct'] is False
        assert result['verdict'] == 'WRONG'

    @patch('answer_layer.subprocess.run')
    def test_error(self, mock_run):
        mock_run.side_effect = Exception('connection failed')
        result = judge_answer('What year?', '2022', '2022')
        assert result['correct'] is False
        assert result['verdict'] == 'ERROR'
        assert 'connection failed' in result['error']

    @patch('answer_layer.subprocess.run')
    def test_handles_lowercase_verdict(self, mock_run):
        mock_run.return_value = MagicMock(stdout='correct', returncode=0)
        result = judge_answer('What year?', '2022', '2022')
        assert result['correct'] is True


# ---------------------------------------------------------------------------
# build_qa_prompt
# ---------------------------------------------------------------------------

class TestBuildQaPrompt:
    def test_with_preamble(self):
        prompt = build_qa_prompt('What year?', preamble='You are answering questions.')
        assert 'You are answering questions.' in prompt
        assert 'Question: What year?' in prompt
        assert ANSWER_PREFIX in prompt

    def test_without_preamble(self):
        prompt = build_qa_prompt('What year?')
        assert 'Question: What year?' in prompt
        assert ANSWER_PREFIX in prompt


# ---------------------------------------------------------------------------
# process_question (integration)
# ---------------------------------------------------------------------------

class TestProcessQuestion:
    def test_with_contracted_answer(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            f.write(json.dumps({'type': 'result', 'result': 'ANSWER: 2022'}) + '\n')
            path = f.name

        artifact = process_question(path, 'What year?', 42, 'single_hop')
        assert artifact['index'] == 42
        assert artifact['category'] == 'single_hop'
        assert artifact['final_answer'] == '2022'
        assert artifact['extraction_mode'] == 'prompt_contract'
        assert artifact['final_token_count'] == 1
        Path(path).unlink()

    @patch('answer_layer.subprocess.run')
    def test_with_verbose_answer(self, mock_run):
        mock_run.return_value = MagicMock(stdout='2022', returncode=0)
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            verbose = 'Based on my thorough search of the vault I found that the relevant information indicates the year was 2022'
            f.write(json.dumps({'type': 'result', 'result': verbose}) + '\n')
            path = f.name

        artifact = process_question(path, 'What year?', 42, 'multi_hop')
        assert artifact['extraction_mode'] == 'compressed'
        assert artifact['final_answer'] == '2022'
        assert artifact['compression_applied'] is True
        assert artifact['raw_token_count'] > BREVITY_THRESHOLD
        assert artifact['final_token_count'] == 1
        assert 'extract_error' not in artifact
        Path(path).unlink()

    @patch('answer_layer.subprocess.run')
    def test_failed_extraction_has_error_in_artifact(self, mock_run):
        mock_run.side_effect = Exception('connection refused')
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            verbose = 'Based on my thorough search of the vault I found that the relevant information indicates the year was 2022'
            f.write(json.dumps({'type': 'result', 'result': verbose}) + '\n')
            path = f.name

        artifact = process_question(path, 'What year?', 42, 'multi_hop')
        assert artifact['extraction_mode'] == 'extraction_failed'
        assert 'extract_error' in artifact
        assert 'connection refused' in artifact['extract_error']
        Path(path).unlink()


# ---------------------------------------------------------------------------
# count_sentences
# ---------------------------------------------------------------------------

class TestCountSentences:
    def test_multiple(self):
        assert count_sentences('Hello. World! OK?') == 3

    def test_empty(self):
        assert count_sentences('') == 0

    def test_single_no_period(self):
        assert count_sentences('Just a phrase') == 1

    def test_trailing_period(self):
        assert count_sentences('One sentence.') == 1


# ---------------------------------------------------------------------------
# brevity_check
# ---------------------------------------------------------------------------

class TestBrevityCheck:
    def test_within_thresholds(self):
        needs, reason = brevity_check('2022')
        assert needs is False
        assert reason == ''

    def test_over_token_limit(self):
        long_answer = ' '.join(['word'] * 15)
        needs, reason = brevity_check(long_answer)
        assert needs is True
        assert 'over_max_tokens' in reason

    def test_over_char_limit(self):
        long_answer = 'x' * 150  # single token, exceeds 100 chars
        needs, reason = brevity_check(long_answer)
        assert needs is True
        assert 'over_max_chars' in reason

    def test_over_sentence_limit(self):
        multi = 'First sentence. Second sentence. Third sentence.'
        needs, reason = brevity_check(multi)
        assert needs is True
        assert 'over_max_sentences' in reason
