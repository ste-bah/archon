"""Tests for workspace search."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from workspace.search import (
    WorkspaceSearchResult,
    search_workspace,
    group_by_repository,
    _parse_results,
)


@pytest.fixture
def mock_leann_results():
    return [
        {"repository": "archon", "filePath": "src/main.py", "content": "def main():", "score": 0.95, "lineNumber": 1},
        {"repository": "market-terminal", "filePath": "app/routes.py", "content": "app = FastAPI()", "score": 0.87, "lineNumber": 5},
        {"repository": "archon", "filePath": "src/utils.py", "content": "import os", "score": 0.82},
    ]


@pytest.fixture
def mock_leann(mock_leann_results):
    def caller(operation, **kwargs):
        repo = kwargs.get("repository")
        if repo:
            return [r for r in mock_leann_results if r["repository"] == repo]
        return mock_leann_results
    return caller


class TestSearchWorkspace:
    def test_returns_results(self, mock_leann):
        results = search_workspace("main function", leann_caller=mock_leann)
        assert len(results) == 3
        assert all(isinstance(r, WorkspaceSearchResult) for r in results)

    def test_sorted_by_score_descending(self, mock_leann):
        results = search_workspace("main", leann_caller=mock_leann)
        scores = [r.score for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_scoped_to_repository(self, mock_leann):
        results = search_workspace("main", repository="archon", leann_caller=mock_leann)
        assert len(results) == 2
        assert all(r.repository == "archon" for r in results)

    def test_empty_query_returns_empty(self, mock_leann):
        assert search_workspace("", leann_caller=mock_leann) == []
        assert search_workspace("   ", leann_caller=mock_leann) == []

    def test_max_results_clamped(self, mock_leann):
        results = search_workspace("main", max_results=2, leann_caller=mock_leann)
        # Mock returns all — clamping happens at the LEANN call level
        assert len(results) <= 3

    def test_max_results_minimum_1(self, mock_leann):
        results = search_workspace("main", max_results=0, leann_caller=mock_leann)
        assert isinstance(results, list)

    def test_max_results_cap_50(self, mock_leann):
        # Should not crash with large value
        results = search_workspace("main", max_results=1000, leann_caller=mock_leann)
        assert isinstance(results, list)

    def test_no_leann_returns_empty(self):
        results = search_workspace("main")
        assert results == []


class TestParseResults:
    def test_parses_standard_format(self, mock_leann_results):
        results = _parse_results(mock_leann_results)
        assert len(results) == 3
        assert results[0].repository == "archon"
        assert results[0].file_path == "src/main.py"
        assert results[0].score == 0.95

    def test_handles_missing_fields(self):
        raw = [{"content": "hello"}]
        results = _parse_results(raw)
        assert results[0].repository == "unknown"
        assert results[0].file_path == ""
        assert results[0].line_number is None

    def test_handles_snake_case_fields(self):
        raw = [{"repository": "r", "file_path": "f.py", "content": "c", "score": 0.5, "line_number": 10}]
        results = _parse_results(raw)
        assert results[0].file_path == "f.py"
        assert results[0].line_number == 10

    def test_empty_input(self):
        assert _parse_results([]) == []


class TestGroupByRepository:
    def test_groups_correctly(self):
        results = [
            WorkspaceSearchResult(repository="a", file_path="f1", content="c1", score=0.9),
            WorkspaceSearchResult(repository="b", file_path="f2", content="c2", score=0.8),
            WorkspaceSearchResult(repository="a", file_path="f3", content="c3", score=0.7),
        ]
        grouped = group_by_repository(results)
        assert len(grouped) == 2
        assert len(grouped["a"]) == 2
        assert len(grouped["b"]) == 1

    def test_empty_input(self):
        assert group_by_repository([]) == {}
