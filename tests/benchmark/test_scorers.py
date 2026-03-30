"""Tests for benchmark scoring functions."""

import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts" / "benchmark"))
from scorers import (
    _extract_findings,
    _extract_patch,
    _parse_pytest_summary,
    _simple_bleu,
    score_code_review,
    score_doc_gen,
    score_memory_recall,
    score_sec_analysis,
    score_task,
)
from schemas import BenchmarkTask


def _task(**overrides) -> BenchmarkTask:
    defaults = {
        "instance_id": "test-001",
        "task_type": "bug_fix",
        "problem_statement": "Fix the bug",
    }
    defaults.update(overrides)
    return BenchmarkTask(**defaults)


# ---------------------------------------------------------------------------
# _parse_pytest_summary
# ---------------------------------------------------------------------------


class TestParsePytestSummary:
    def test_passed_and_failed(self):
        assert _parse_pytest_summary("5 passed, 2 failed in 1.23s") == (5, 7)

    def test_passed_only(self):
        assert _parse_pytest_summary("7 passed in 0.5s") == (7, 7)

    def test_failed_only(self):
        assert _parse_pytest_summary("3 failed in 0.5s") == (0, 3)

    def test_no_results(self):
        assert _parse_pytest_summary("no tests ran") == (0, 0)

    def test_empty_string(self):
        assert _parse_pytest_summary("") == (0, 0)


# ---------------------------------------------------------------------------
# _extract_patch
# ---------------------------------------------------------------------------


class TestExtractPatch:
    def test_extracts_unified_diff(self):
        text = """Here is my fix:

--- a/src/pagination.py
+++ b/src/pagination.py
@@ -15,7 +15,7 @@
-    total_pages = total_items // page_size
+    total_pages = (total_items + page_size - 1) // page_size

Done."""
        patch = _extract_patch(text)
        assert "---" in patch
        assert "+++" in patch
        assert "total_pages" in patch

    def test_extracts_git_diff_format(self):
        text = """diff --git a/foo.py b/foo.py
--- a/foo.py
+++ b/foo.py
@@ -1 +1 @@
-old
+new"""
        patch = _extract_patch(text)
        assert "diff --git" in patch

    def test_no_diff_returns_empty(self):
        assert _extract_patch("No patch here, just text.") == ""

    def test_empty_input(self):
        assert _extract_patch("") == ""


# ---------------------------------------------------------------------------
# _simple_bleu
# ---------------------------------------------------------------------------


class TestSimpleBleu:
    def test_identical_texts(self):
        assert _simple_bleu("hello world", "hello world") == 1.0

    def test_empty_hypothesis(self):
        assert _simple_bleu("hello world", "") == 0.0

    def test_empty_reference(self):
        assert _simple_bleu("", "hello world") == 0.0

    def test_partial_overlap(self):
        score = _simple_bleu("the cat sat on the mat", "the cat on the floor")
        assert 0.0 < score < 1.0

    def test_no_overlap(self):
        score = _simple_bleu("alpha beta gamma", "delta epsilon zeta")
        assert score == 0.0

    def test_brevity_penalty(self):
        """Shorter hypothesis gets penalized."""
        full = _simple_bleu("a b c d e", "a b c d e")
        short = _simple_bleu("a b c d e", "a b c")
        assert short < full


# ---------------------------------------------------------------------------
# _extract_findings
# ---------------------------------------------------------------------------


class TestExtractFindings:
    def test_numbered_list(self):
        text = """Here are my findings:
1. SQL injection in login handler
2. Missing input validation on email field
3. Hardcoded API key in config.py"""
        findings = _extract_findings(text)
        assert len(findings) >= 3

    def test_bulleted_list(self):
        text = """Issues found:
- Buffer overflow in parse function
- Memory leak in connection pool
- Use-after-free in cleanup"""
        findings = _extract_findings(text)
        assert len(findings) >= 3

    def test_empty_text(self):
        assert _extract_findings("") == []

    def test_short_items_filtered(self):
        text = """
1. OK
2. This is a real finding about SQL injection
3. Fine"""
        findings = _extract_findings(text)
        # "OK" and "Fine" are < 10 chars, filtered out
        assert len(findings) >= 1


# ---------------------------------------------------------------------------
# score_memory_recall
# ---------------------------------------------------------------------------


class TestScoreMemoryRecall:
    def test_exact_match(self):
        task = _task(
            scoring_method="exact_match",
            gold_answer="The database connection pool size is 25",
        )
        score, details = score_memory_recall(task, "The database connection pool size is 25")
        assert score == 1.0
        assert details["correct"] is True

    def test_substring_match(self):
        task = _task(
            scoring_method="exact_match",
            gold_answer="pool size is 25",
        )
        score, _ = score_memory_recall(task, "The database connection pool size is 25 connections")
        assert score == 1.0

    def test_case_insensitive(self):
        task = _task(
            scoring_method="exact_match",
            gold_answer="POOL SIZE IS 25",
        )
        score, _ = score_memory_recall(task, "the pool size is 25")
        assert score == 1.0

    def test_no_match(self):
        task = _task(
            scoring_method="exact_match",
            gold_answer="pool size is 25",
        )
        score, details = score_memory_recall(task, "I don't know the answer")
        assert score == 0.0
        assert details["correct"] is False


# ---------------------------------------------------------------------------
# score_code_review
# ---------------------------------------------------------------------------


class TestScoreCodeReview:
    def test_perfect_review(self):
        task = _task(
            scoring_method="precision_recall",
            metadata={"injected_bugs": [
                {"keywords": ["sql", "injection"]},
                {"keywords": ["xss", "reflection"]},
            ]},
        )
        output = """1. SQL injection vulnerability in the login handler
2. XSS reflection attack on the search endpoint"""
        score, details = score_code_review(task, output)
        assert details["found_bugs"] == 2
        assert details["precision"] == 1.0
        assert details["recall"] == 1.0
        assert score == 1.0

    def test_no_bugs_found(self):
        task = _task(
            scoring_method="precision_recall",
            metadata={"injected_bugs": [{"keywords": ["sql", "injection"]}]},
        )
        score, details = score_code_review(task, "Code looks fine to me.")
        assert score == 0.0
        assert details["found_bugs"] == 0

    def test_partial_match(self):
        task = _task(
            scoring_method="precision_recall",
            metadata={"injected_bugs": [
                {"keywords": ["sql", "injection"]},
                {"keywords": ["xss"]},
                {"keywords": ["hardcoded", "secret"]},
            ]},
        )
        output = """1. SQL injection found in query builder
2. Some other unrelated issue"""
        score, details = score_code_review(task, output)
        assert details["found_bugs"] == 1
        assert details["recall"] < 1.0

    def test_no_injected_bugs_metadata(self):
        task = _task(scoring_method="precision_recall", metadata={})
        score, details = score_code_review(task, "stuff")
        assert score == 0.0
        assert "error" in details


# ---------------------------------------------------------------------------
# score_doc_gen
# ---------------------------------------------------------------------------


class TestScoreDocGen:
    def test_returns_bleu_and_human_review(self):
        task = _task(
            scoring_method="bleu",
            gold_answer="This is the reference documentation text.",
        )
        score, details = score_doc_gen(task, "This is the generated documentation text.")
        assert 0.0 <= score <= 1.0
        assert details["human_review"] is True
        assert "bleu_score" in details


# ---------------------------------------------------------------------------
# score_sec_analysis
# ---------------------------------------------------------------------------


class TestScoreSecAnalysis:
    def test_all_facts_found(self):
        task = _task(
            scoring_method="fact_extraction",
            metadata={
                "known_facts": ["revenue growth", "market share"],
                "known_metrics": ["$394B revenue"],
            },
        )
        output = "The company showed revenue growth and increased market share. Total $394B revenue reported."
        score, details = score_sec_analysis(task, output)
        assert score == 1.0
        assert details["facts_found"] == 3

    def test_no_facts_found(self):
        task = _task(
            scoring_method="fact_extraction",
            metadata={"known_facts": ["specific thing"], "known_metrics": []},
        )
        score, details = score_sec_analysis(task, "Nothing relevant here.")
        assert score == 0.0

    def test_no_metadata(self):
        task = _task(scoring_method="fact_extraction", metadata={})
        score, details = score_sec_analysis(task, "stuff")
        assert score == 0.0
        assert "error" in details


# ---------------------------------------------------------------------------
# score_task routing
# ---------------------------------------------------------------------------


class TestScoreTask:
    def test_routes_to_exact_match(self):
        task = _task(scoring_method="exact_match", gold_answer="hello")
        score, _ = score_task(task, "hello world")
        assert score == 1.0

    def test_unknown_method(self):
        task = _task(scoring_method="nonexistent")
        score, details = score_task(task, "output")
        assert score == 0.0
        assert "error" in details
