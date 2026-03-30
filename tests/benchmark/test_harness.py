"""Tests for benchmark harness — task loading, schema validation, result storage."""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts" / "benchmark"))
from schemas import BenchmarkResult, BenchmarkTask


# ---------------------------------------------------------------------------
# BenchmarkTask
# ---------------------------------------------------------------------------


class TestBenchmarkTask:
    def test_create_minimal(self):
        task = BenchmarkTask(
            instance_id="test-001",
            task_type="bug_fix",
            problem_statement="Fix the bug",
        )
        assert task.instance_id == "test-001"
        assert task.max_tokens == 50000
        assert task.timeout_seconds == 300
        assert task.human_review is False
        assert task.metadata == {}

    def test_create_full(self):
        task = BenchmarkTask(
            instance_id="review-001",
            task_type="code_review",
            problem_statement="Review this code",
            gold_answer="SQL injection found",
            scoring_method="precision_recall",
            max_tokens=30000,
            timeout_seconds=120,
            human_review=False,
            metadata={"injected_bugs": [{"keywords": ["sql"]}]},
        )
        assert task.task_type == "code_review"
        assert task.scoring_method == "precision_recall"

    def test_from_dict(self):
        data = {
            "instance_id": "recall-001",
            "task_type": "memory_recall",
            "problem_statement": "What is X?",
            "gold_answer": "X is 42",
            "scoring_method": "exact_match",
        }
        task = BenchmarkTask(**data)
        assert task.gold_answer == "X is 42"

    def test_from_jsonl_line(self):
        line = json.dumps({
            "instance_id": "bugfix-001",
            "task_type": "bug_fix",
            "problem_statement": "Fix off-by-one",
            "gold_patch": "--- a/foo.py\n+++ b/foo.py",
            "scoring_method": "test_pass",
        })
        data = json.loads(line)
        task = BenchmarkTask(**data)
        assert task.instance_id == "bugfix-001"


# ---------------------------------------------------------------------------
# BenchmarkResult
# ---------------------------------------------------------------------------


class TestBenchmarkResult:
    def _make_result(self, **overrides):
        defaults = {
            "suite_id": "v1.0-bug_fix",
            "task_id": "bugfix-001",
            "run_date": datetime(2026, 3, 30, 12, 0, 0, tzinfo=timezone.utc),
            "model_version": "sonnet",
            "archon_version": "2.5.0",
            "score": 0.85,
            "tokens_used": 45000,
            "wall_clock_seconds": 120.5,
            "corrections_needed": 0,
            "details": {"tests_passed": 5, "tests_total": 6},
            "cost_usd": 0.25,
        }
        defaults.update(overrides)
        return BenchmarkResult(**defaults)

    def test_to_dict_serializes_date(self):
        result = self._make_result()
        d = result.to_dict()
        assert d["run_date"] == "2026-03-30T12:00:00+00:00"
        assert isinstance(d["details"], dict)

    def test_to_dict_json_serializable(self):
        result = self._make_result()
        json.dumps(result.to_dict())  # Should not raise

    def test_to_memorygraph_params(self):
        result = self._make_result()
        params = result.to_memorygraph_params()
        assert params["memory_type"] == "general"
        assert params["importance"] == 0.4
        assert "benchmark" in params["tags"]
        assert "suite:v1.0-bug_fix" in params["tags"]
        assert "model:sonnet" in params["tags"]
        assert "archon:2.5.0" in params["tags"]
        assert "benchmark-v1.0-bug_fix-bugfix-001-20260330" in params["name"]

    def test_to_memorygraph_content_is_json(self):
        result = self._make_result()
        params = result.to_memorygraph_params()
        parsed = json.loads(params["content"])
        assert parsed["score"] == 0.85
        assert parsed["task_id"] == "bugfix-001"


# ---------------------------------------------------------------------------
# Task loading (JSONL parsing)
# ---------------------------------------------------------------------------


class TestLoadTasks:
    def test_parse_valid_jsonl(self, tmp_path):
        jsonl = tmp_path / "tasks.jsonl"
        tasks_data = [
            {"instance_id": f"test-{i:03d}", "task_type": "bug_fix",
             "problem_statement": f"Fix bug {i}"}
            for i in range(5)
        ]
        jsonl.write_text("\n".join(json.dumps(t) for t in tasks_data))

        from schemas import BenchmarkTask
        tasks = []
        for line in jsonl.read_text().splitlines():
            if line.strip():
                tasks.append(BenchmarkTask(**json.loads(line)))
        assert len(tasks) == 5
        assert tasks[0].instance_id == "test-000"

    def test_skip_empty_lines(self, tmp_path):
        jsonl = tmp_path / "tasks.jsonl"
        jsonl.write_text(
            '{"instance_id":"a","task_type":"bug_fix","problem_statement":"x"}\n'
            '\n'
            '{"instance_id":"b","task_type":"bug_fix","problem_statement":"y"}\n'
        )
        tasks = []
        for line in jsonl.read_text().splitlines():
            if line.strip():
                tasks.append(BenchmarkTask(**json.loads(line)))
        assert len(tasks) == 2

    def test_invalid_json_raises(self):
        with pytest.raises(json.JSONDecodeError):
            json.loads("not valid json{")

    def test_missing_required_field_raises(self):
        with pytest.raises(TypeError):
            BenchmarkTask(instance_id="x")  # missing task_type, problem_statement
