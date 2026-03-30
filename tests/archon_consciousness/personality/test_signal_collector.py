"""Tests for SignalCollector — 12 behavioral signals + 5 helper functions.

TDD test file — written BEFORE implementation.
Tests cover event-driven counters, derived ratios, v1 store reads,
helper function formulas, and edge cases.

TASK-PER-002 | PRD-ARCHON-CON-002 | FR-PER-001
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

# Parent conftest provides mock_graph and mock_lance fixtures


# ─── Construction & Defaults ──────────────────────────────────────


class TestConstruction:
    """Fresh collector should return safe defaults for all 12 signals."""

    def test_fresh_collector_defaults(self, mock_graph, mock_lance):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph, lance=mock_lance)
        signals = sc.collect()
        assert signals["correction_count"] == 0
        assert signals["correction_rate"] == 0.0
        assert signals["plan_approval_rate"] == 0.0
        assert signals["task_completion_rate"] == 0.0
        assert signals["similar_task_history"] == 0.0
        assert signals["past_success_ratio"] == 0.0
        assert signals["values_violation_count"] == 0
        assert isinstance(signals["session_duration"], float)
        assert signals["session_duration"] >= 0.0
        assert signals["user_emotional_state"] == "neutral"
        assert signals["pattern_score_trend"] == 0.0
        assert signals["consecutive_successes"] == 0
        assert signals["consecutive_corrections"] == 0

    def test_collect_returns_12_keys(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        signals = sc.collect()
        assert len(signals) == 12

    def test_collect_returns_new_dict_each_call(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        d1 = sc.collect()
        d2 = sc.collect()
        assert d1 is not d2

    def test_no_lance_backend_still_works(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph, lance=None)
        signals = sc.collect()
        assert signals["similar_task_history"] == 0.0
        assert signals["past_success_ratio"] == 0.0


# ─── Event-Driven Counters ────────────────────────────────────────


class TestRecordCorrection:

    def test_increments_correction_count(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_correction()
        sc.record_correction()
        sc.record_correction()
        signals = sc.collect()
        assert signals["correction_count"] == 3

    def test_increments_correction_rate(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_correction()
        sc.record_success()
        signals = sc.collect()
        assert signals["correction_rate"] == 0.5  # 1 correction / 2 interactions

    def test_increments_consecutive_corrections(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_correction()
        sc.record_correction()
        signals = sc.collect()
        assert signals["consecutive_corrections"] == 2

    def test_resets_consecutive_successes(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_success()
        sc.record_success()
        assert sc.collect()["consecutive_successes"] == 2
        sc.record_correction()
        assert sc.collect()["consecutive_successes"] == 0


class TestRecordSuccess:

    def test_increments_consecutive_successes(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_success()
        sc.record_success()
        sc.record_success()
        assert sc.collect()["consecutive_successes"] == 3

    def test_resets_consecutive_corrections(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_correction()
        sc.record_correction()
        assert sc.collect()["consecutive_corrections"] == 2
        sc.record_success()
        assert sc.collect()["consecutive_corrections"] == 0

    def test_does_not_increment_correction_count(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_success()
        assert sc.collect()["correction_count"] == 0


class TestRecordPlan:

    def test_approved_plan(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_plan_submission(approved=True)
        assert sc.collect()["plan_approval_rate"] == 1.0

    def test_rejected_plan(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_plan_submission(approved=False)
        assert sc.collect()["plan_approval_rate"] == 0.0

    def test_mixed_plans(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_plan_submission(approved=True)
        sc.record_plan_submission(approved=False)
        sc.record_plan_submission(approved=True)
        assert abs(sc.collect()["plan_approval_rate"] - 2 / 3) < 1e-9


class TestRecordTask:

    def test_completed_task(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_task_attempt(completed=True)
        assert sc.collect()["task_completion_rate"] == 1.0

    def test_failed_task(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_task_attempt(completed=False)
        assert sc.collect()["task_completion_rate"] == 0.0


class TestRecordViolation:

    def test_increments_count(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_values_violation()
        sc.record_values_violation()
        assert sc.collect()["values_violation_count"] == 2


class TestUserEmotionalState:

    def test_default_is_neutral(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        assert sc.collect()["user_emotional_state"] == "neutral"

    def test_set_user_state(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.set_user_state("frustrated")
        assert sc.collect()["user_emotional_state"] == "frustrated"

    def test_reject_invalid_state(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector
        from src.archon_consciousness.constants import EMOTIONAL_STATES

        sc = SignalCollector(client=mock_graph)
        with pytest.raises(ValueError):
            sc.set_user_state("happy")


# ─── Safe Ratio ────────────────────────────────────────���──────────


class TestSafeRatio:

    def test_zero_denominator(self):
        from src.archon_consciousness.personality.signal_collector import _safe_ratio

        assert _safe_ratio(0, 0) == 0.0

    def test_nonzero_denominator(self):
        from src.archon_consciousness.personality.signal_collector import _safe_ratio

        assert _safe_ratio(3, 5) == 0.6

    def test_full_ratio(self):
        from src.archon_consciousness.personality.signal_collector import _safe_ratio

        assert _safe_ratio(7, 7) == 1.0


# ─── Helper Functions (FR-PER-003) ────────────────────────────────


class TestStreakBonus:

    def test_zero_streak(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        assert sc.streak_bonus() == 0.0

    def test_five_streak(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        for _ in range(5):
            sc.record_success()
        assert sc.streak_bonus() == 0.5

    def test_ten_streak_max(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        for _ in range(10):
            sc.record_success()
        assert sc.streak_bonus() == 1.0

    def test_above_ten_capped(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        for _ in range(15):
            sc.record_success()
        assert sc.streak_bonus() == 1.0


class TestStreakPenalty:

    def test_zero_streak(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        assert sc.streak_penalty() == 0.0

    def test_two_corrections(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_correction()
        sc.record_correction()
        assert sc.streak_penalty() == 0.4

    def test_five_corrections_max(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        for _ in range(5):
            sc.record_correction()
        assert sc.streak_penalty() == 1.0

    def test_above_five_capped(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        for _ in range(8):
            sc.record_correction()
        assert sc.streak_penalty() == 1.0


class TestPatternRegressionScore:

    def test_no_rules_returns_zero(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        assert sc.pattern_regression_score() == 0.0

    def test_two_of_five_regressing(self, mock_graph):
        """Populate MemoryGraph with 5 active rules, 2 regressing."""
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        for i, trend in enumerate(["improving", "regressing", "stable", "regressing", "stable"]):
            mock_graph.store_memory(
                name=f"patternscore-rule-{i}",
                memory_type="PatternScore",
                content=json.dumps({
                    "rule_id": f"rule-{i}", "score": 0.5,
                    "status": "active", "trend": trend,
                }),
                tags=["archon-consciousness", "pattern-score"],
            )
        sc = SignalCollector(client=mock_graph)
        assert abs(sc.pattern_regression_score() - 0.4) < 1e-9

    def test_archived_rules_excluded(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        mock_graph.store_memory(
            name="patternscore-rule-active",
            memory_type="PatternScore",
            content=json.dumps({"rule_id": "r1", "score": 0.5, "status": "active", "trend": "regressing"}),
            tags=["archon-consciousness", "pattern-score"],
        )
        mock_graph.store_memory(
            name="patternscore-rule-archived",
            memory_type="PatternScore",
            content=json.dumps({"rule_id": "r2", "score": 0.5, "status": "archived", "trend": "regressing"}),
            tags=["archon-consciousness", "pattern-score"],
        )
        sc = SignalCollector(client=mock_graph)
        assert sc.pattern_regression_score() == 1.0  # 1 regressing / 1 active


class TestNoveltyScore:

    def test_empty_context_returns_zero(self, mock_graph, mock_lance):
        """No task context = no basis for novelty assessment."""
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph, lance=mock_lance)
        assert sc.novelty_score("") == 0.0

    def test_no_episodes_returns_one(self, mock_graph, mock_lance):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph, lance=mock_lance)
        assert sc.novelty_score("new task") == 1.0

    def test_perfect_match_returns_zero(self, mock_graph, mock_lance):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        mock_lance.embed_and_store("exact same task", collection="episodes")
        sc = SignalCollector(client=mock_graph, lance=mock_lance)
        # Hash-based embedding: same text -> similarity ~1.0
        score = sc.novelty_score("exact same task")
        assert score < 0.1  # near zero novelty for identical text

    def test_no_lance_returns_one(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph, lance=None)
        assert sc.novelty_score("anything") == 1.0


class TestAmbiguityScore:

    def test_no_conflicts_returns_zero(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        assert sc.ambiguity_score() == 0.0

    def test_one_unresolved_of_two(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_values_conflict(resolved=False)
        sc.record_values_conflict(resolved=True)
        assert abs(sc.ambiguity_score() - 0.5) < 1e-9

    def test_all_resolved(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        sc.record_values_conflict(resolved=True)
        sc.record_values_conflict(resolved=True)
        assert sc.ambiguity_score() == 0.0


# ─── Session Duration ─────────────────────────────────────────────


class TestSessionDuration:

    def test_non_negative(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        assert sc.collect()["session_duration"] >= 0.0

    def test_custom_start_time(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        start = datetime.now(timezone.utc) - timedelta(minutes=30)
        sc = SignalCollector(client=mock_graph, session_start=start)
        duration = sc.collect()["session_duration"]
        assert 29.0 < duration < 31.0  # roughly 30 minutes


# ─── Pattern Score Trend ──────────────────────────────────────────


class TestPatternScoreTrend:

    def test_no_data_returns_zero(self, mock_graph):
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        assert sc.collect()["pattern_score_trend"] == 0.0

    def test_all_improving(self, mock_graph):
        """Average trend slope should be positive when all improving."""
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        for i in range(3):
            mock_graph.store_memory(
                name=f"patternscore-rule-{i}",
                memory_type="PatternScore",
                content=json.dumps({
                    "rule_id": f"rule-{i}", "score": 0.8,
                    "status": "active", "trend": "improving",
                    "score_history": [0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
                }),
                tags=["archon-consciousness", "pattern-score"],
            )
        sc = SignalCollector(client=mock_graph)
        trend = sc.collect()["pattern_score_trend"]
        assert trend > 0  # positive trend


# ─���─ Guard Compliance ─────────────────────────────────────────────


class TestGuardCompliance:

    def test_no_llm_confidence_query(self):
        """GUARD-PER-002: no codepath asks the LLM for confidence."""
        import inspect
        from src.archon_consciousness.personality import signal_collector

        source = inspect.getsource(signal_collector)
        forbidden = ["ask_llm", "query_confidence", "self_report", "how confident"]
        for term in forbidden:
            assert term not in source.lower(), f"GUARD-PER-002 violation: found '{term}'"
