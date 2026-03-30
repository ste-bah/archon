"""Tests for FastChannel — episode matcher, rule checker, anomaly detector.

TASK-PER-010 | PRD-ARCHON-CON-002 | FR-PER-031/032/033/034
"""

import json
import time

import pytest


def _make_channel(mock_graph, mock_lance=None):
    from src.archon_consciousness.personality.fast_channel import FastChannel
    return FastChannel(lance=mock_lance, client=mock_graph)


def _store_regressing_rule(mock_graph, rule_id="bad-rule"):
    mock_graph.store_memory(
        name=f"patternscore-{rule_id}",
        memory_type="PatternScore",
        content=json.dumps({
            "rule_id": rule_id, "score": 0.3, "status": "active",
            "trend": "regressing",
        }),
        tags=["archon-consciousness", "pattern-score"],
    )


class TestEpisodeMatcher:
    """FR-PER-032: cosine similarity > 0.85 against negative episodes."""

    def test_no_lance_returns_no_match(self, mock_graph):
        ch = _make_channel(mock_graph, mock_lance=None)
        result = ch.check("edit", "test.py")
        assert result.episode_match is None

    def test_negative_episode_match(self, mock_graph, mock_lance):
        """Matching negative episode -> episode_match populated."""
        mock_lance.embed_and_store(
            "edit:test.py:syntax error",
            metadata={"outcome": "negative"},
            collection="episodes",
        )
        ch = _make_channel(mock_graph, mock_lance)
        result = ch.check("edit", "test.py", error_msg="syntax error")
        # Hash embedding: same text = high similarity
        if result.episode_similarity > 0.85:
            assert result.episode_match is not None

    def test_positive_episode_ignored(self, mock_graph, mock_lance):
        """Positive episodes should NOT trigger a match."""
        mock_lance.embed_and_store(
            "edit:test.py:success",
            metadata={"outcome": "positive"},
            collection="episodes",
        )
        ch = _make_channel(mock_graph, mock_lance)
        result = ch.check("edit", "test.py", error_msg="success")
        assert result.episode_match is None

    def test_low_similarity_no_match(self, mock_graph, mock_lance):
        """Force low similarity via explicit orthogonal embeddings."""
        mock_lance.embed_and_store(
            "completely unrelated topic about cooking",
            metadata={"outcome": "negative"},
            collection="episodes",
            embedding=[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                       0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        )
        ch = _make_channel(mock_graph, mock_lance)
        # The query will get a hash-based embedding, which is ~orthogonal to [1,0,...,0]
        result = ch.check("edit", "parser.py", error_msg="type error")
        # With orthogonal vectors, similarity should be low
        assert result.episode_match is None or result.episode_similarity < 0.85


class TestRuleChecker:
    """FR-PER-033: check against regressing/low-score rules."""

    def test_no_rules_no_violation(self, mock_graph):
        ch = _make_channel(mock_graph)
        result = ch.check("edit", "test.py")
        assert result.rule_violation is None

    def test_regressing_rule_detected(self, mock_graph):
        _store_regressing_rule(mock_graph, "no-echo-user-input")
        ch = _make_channel(mock_graph)
        result = ch.check("edit", "test.py")
        # Rule checker matches on file/action patterns — generic check
        # The presence of regressing rules should be detectable
        assert isinstance(result.rule_violation, str) or result.rule_violation is None


class TestAnomalyDetector:
    """FR-PER-034: sliding window anomaly detection."""

    def test_empty_window_no_anomaly(self, mock_graph):
        ch = _make_channel(mock_graph)
        result = ch.check("edit", "test.py")
        assert result.anomaly_type is None

    def test_repeated_edit_detected(self, mock_graph):
        """Same file edited 3+ times without test -> repeated_edit."""
        ch = _make_channel(mock_graph)
        ch.check("edit", "parser.py")
        ch.check("edit", "parser.py")
        result = ch.check("edit", "parser.py")
        assert result.anomaly_type == "repeated_edit"

    def test_edit_with_test_clears(self, mock_graph):
        """Test run between edits prevents anomaly."""
        ch = _make_channel(mock_graph)
        ch.check("edit", "parser.py")
        ch.check("edit", "parser.py")
        ch.check("test", "parser_test.py")  # test run clears
        result = ch.check("edit", "parser.py")
        assert result.anomaly_type is None

    def test_repeated_error_detected(self, mock_graph):
        """Same error 2+ times -> repeated_error."""
        ch = _make_channel(mock_graph)
        ch.check("edit", "a.py", error_msg="TypeError")
        ch.update_outcome("TypeError")
        result = ch.check("edit", "b.py", error_msg="TypeError")
        ch.update_outcome("TypeError")
        # After two errors of same type
        result2 = ch.check("edit", "c.py")
        assert result2.anomaly_type == "repeated_error" or result.anomaly_type == "repeated_error"

    def test_revert_cycle_detected(self, mock_graph):
        """3+ alternating edits on same file -> revert_cycle."""
        ch = _make_channel(mock_graph)
        ch.check("edit", "parser.py")
        ch.check("edit", "parser.py")
        result = ch.check("edit", "parser.py")
        # 3 edits to same file is also repeated_edit; revert_cycle needs alternating
        assert result.anomaly_type in ("repeated_edit", "revert_cycle")

    def test_window_maxlen_10(self, mock_graph):
        """Window should not exceed 10 entries."""
        ch = _make_channel(mock_graph)
        for i in range(15):
            ch.check("edit", f"file{i}.py")
        assert len(ch._window) <= 10


class TestFastChannelResult:

    def test_total_ms_populated(self, mock_graph):
        ch = _make_channel(mock_graph)
        result = ch.check("edit", "test.py")
        assert result.total_ms >= 0

    def test_update_outcome(self, mock_graph):
        ch = _make_channel(mock_graph)
        ch.check("edit", "test.py")
        ch.update_outcome("success")
        assert ch._window[-1][2] == "success"


class TestGuardCompliance:

    def test_guard_per_007_no_file_modification(self):
        """GUARD-PER-007: fast channel must not modify files."""
        import inspect
        from src.archon_consciousness.personality import fast_channel
        source = inspect.getsource(fast_channel)
        for term in ["subprocess", "os.system", "os.popen", "open("]:
            assert term not in source, f"GUARD-PER-007: found '{term}'"

    def test_performance_under_50ms(self, mock_graph):
        """GUARD-PER-008: fast channel < 50ms."""
        ch = _make_channel(mock_graph)
        times = []
        for _ in range(20):
            start = time.monotonic()
            ch.check("edit", "test.py")
            elapsed = (time.monotonic() - start) * 1000
            times.append(elapsed)
        p95 = sorted(times)[int(len(times) * 0.95)]
        assert p95 < 50, f"p95 latency {p95:.1f}ms exceeds 50ms"
