"""Tests for PreferenceEngine — Beta model + Thompson Sampling.

TDD test file. Covers Bayesian updates, Thompson Sampling, cold-start
threshold, outcome storage, and preference persistence.

TASK-PER-005 | PRD-ARCHON-CON-002 | FR-PER-009/010/011/015
"""

import json
import random
from datetime import datetime, timezone

import pytest

from tests.archon_consciousness.personality.conftest import make_outcome_record


def _make_engine(mock_graph):
    from src.archon_consciousness.personality.preference_engine import PreferenceEngine
    return PreferenceEngine(client=mock_graph)


def _record_n_outcomes(engine, n, quality=0.8, approach="tdd", context="debug:backend:py"):
    """Record n outcomes with given quality for same approach/context."""
    for i in range(n):
        outcome = make_outcome_record(
            task_id=f"task-{i}", quality_score=quality,
            approach_used=approach, context_key=context,
        )
        engine.record_outcome(outcome)


class TestBayesianUpdate:
    """FR-PER-010: Beta distribution update rules."""

    def test_positive_outcome_increments_alpha(self, mock_graph):
        engine = _make_engine(mock_graph)
        outcome = make_outcome_record(quality_score=0.8)
        entry = engine.record_outcome(outcome)
        assert entry.alpha == 2.0  # 1.0 (prior) + 1.0

    def test_negative_outcome_increments_beta(self, mock_graph):
        engine = _make_engine(mock_graph)
        outcome = make_outcome_record(quality_score=0.4)
        entry = engine.record_outcome(outcome)
        assert entry.beta == 2.0

    def test_mixed_outcome_increments_both(self, mock_graph):
        engine = _make_engine(mock_graph)
        outcome = make_outcome_record(quality_score=0.6)
        entry = engine.record_outcome(outcome)
        assert entry.alpha == 1.5
        assert entry.beta == 1.5

    def test_boundary_0_7_is_positive(self, mock_graph):
        engine = _make_engine(mock_graph)
        outcome = make_outcome_record(quality_score=0.7)
        entry = engine.record_outcome(outcome)
        assert entry.alpha == 2.0  # >= 0.7 is positive

    def test_boundary_0_5_is_mixed(self, mock_graph):
        engine = _make_engine(mock_graph)
        outcome = make_outcome_record(quality_score=0.5)
        entry = engine.record_outcome(outcome)
        assert entry.alpha == 1.5  # >= 0.5 and < 0.7 is mixed

    def test_boundary_0_49_is_negative(self, mock_graph):
        engine = _make_engine(mock_graph)
        outcome = make_outcome_record(quality_score=0.49)
        entry = engine.record_outcome(outcome)
        assert entry.beta == 2.0  # < 0.5 is negative

    def test_multiple_updates_accumulate(self, mock_graph):
        engine = _make_engine(mock_graph)
        for q in [0.8, 0.9, 0.3, 0.6]:
            engine.record_outcome(make_outcome_record(quality_score=q))
        entries = engine.get_preferences("debugging:backend:python")
        assert len(entries) == 1
        e = entries[0]
        # 0.8: alpha+1, 0.9: alpha+1, 0.3: beta+1, 0.6: alpha+0.5,beta+0.5
        assert e.alpha == 3.5  # 1 + 1 + 1 + 0.5
        assert e.beta == 2.5   # 1 + 1 + 0.5

    def test_evidence_count_matches(self, mock_graph):
        engine = _make_engine(mock_graph)
        _record_n_outcomes(engine, 5, quality=0.8)
        entries = engine.get_preferences("debug:backend:py")
        assert entries[0].evidence_count == 5  # alpha=6, beta=1, 6+1-2=5


class TestThompsonSampling:
    """FR-PER-011: Thompson Sampling for approach selection."""

    def test_below_cold_start_returns_first(self, mock_graph):
        """< 5 evidence -> rule-based (first candidate)."""
        engine = _make_engine(mock_graph)
        _record_n_outcomes(engine, 3, approach="tdd")
        result = engine.select_approach("debug:backend:py", ["tdd", "impl-first"])
        assert result == "tdd"  # first candidate (rule-based)

    def test_above_cold_start_uses_sampling(self, mock_graph):
        """>=5 evidence -> Thompson Sampling."""
        engine = _make_engine(mock_graph)
        # Give approach A strong positive evidence
        _record_n_outcomes(engine, 10, quality=0.9, approach="approach-a", context="ctx")
        # Give approach B strong negative evidence
        _record_n_outcomes(engine, 10, quality=0.2, approach="approach-b", context="ctx")

        # Sample 50 times — approach A should win overwhelmingly
        random.seed(42)
        wins = {"approach-a": 0, "approach-b": 0}
        for _ in range(50):
            choice = engine.select_approach("ctx", ["approach-a", "approach-b"])
            wins[choice] += 1
        assert wins["approach-a"] > 40, f"A should dominate: {wins}"

    def test_empty_candidates_raises(self, mock_graph):
        engine = _make_engine(mock_graph)
        with pytest.raises(ValueError):
            engine.select_approach("ctx", [])

    def test_single_candidate_returns_it(self, mock_graph):
        engine = _make_engine(mock_graph)
        assert engine.select_approach("ctx", ["only-one"]) == "only-one"

    def test_independent_contexts(self, mock_graph):
        """Same approach in different contexts has independent distributions."""
        engine = _make_engine(mock_graph)
        _record_n_outcomes(engine, 10, quality=0.9, approach="tdd", context="ctx-a")
        _record_n_outcomes(engine, 10, quality=0.2, approach="tdd", context="ctx-b")
        prefs_a = engine.get_preferences("ctx-a")
        prefs_b = engine.get_preferences("ctx-b")
        assert prefs_a[0].alpha > prefs_a[0].beta  # strong positive
        assert prefs_b[0].beta > prefs_b[0].alpha  # strong negative


class TestOutcomeStorage:
    """FR-PER-015: outcome records persisted to MemoryGraph."""

    def test_outcome_stored(self, mock_graph):
        engine = _make_engine(mock_graph)
        outcome = make_outcome_record(task_id="store-test")
        engine.record_outcome(outcome)
        stored = mock_graph.get_memory("outcome-store-test")
        assert stored is not None
        content = json.loads(stored["content"])
        assert content["task_id"] == "store-test"

    def test_preference_entry_stored(self, mock_graph):
        engine = _make_engine(mock_graph)
        outcome = make_outcome_record()
        engine.record_outcome(outcome)
        # Check a preference entry was stored
        all_mems = mock_graph.list_by_type("PreferenceEntry")
        assert len(all_mems) >= 1


class TestPreferenceRetrieval:

    def test_get_preferences_empty(self, mock_graph):
        engine = _make_engine(mock_graph)
        assert engine.get_preferences("nonexistent") == []

    def test_get_strongest(self, mock_graph):
        engine = _make_engine(mock_graph)
        _record_n_outcomes(engine, 10, quality=0.9, approach="a", context="ctx")
        _record_n_outcomes(engine, 3, quality=0.9, approach="b", context="ctx")
        strongest = engine.get_strongest(limit=10)
        assert len(strongest) == 2
        assert strongest[0].evidence_count >= strongest[1].evidence_count

    def test_fresh_engine_no_preferences(self, mock_graph):
        engine = _make_engine(mock_graph)
        assert engine.get_strongest() == []
