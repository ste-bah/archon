"""Tests for PatternTracker — EWMA scoring, trends, alerts, priority.

Written BEFORE implementation (TDD).
Covers FR-CON-009, FR-CON-010, FR-CON-011, FR-CON-012, FR-CON-027.
"""

import json
import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.pattern_tracker import (
    PatternTracker,
    ewma,
    baseline_decay,
    linear_regression_slope,
    priority_score,
)


# ─── Pure Math Helpers ─────────────────────────────────────────────


class TestEWMA:
    """Test the EWMA formula as a pure function."""

    def test_correction_warmup(self):
        """score=0.5, obs=0.0, alpha=0.4 → 0.3."""
        assert ewma(0.0, 0.5, 0.4) == pytest.approx(0.3)

    def test_followed_warmup(self):
        """score=0.5, obs=1.0, alpha=0.4 → 0.7."""
        assert ewma(1.0, 0.5, 0.4) == pytest.approx(0.7)

    def test_nearmiss_standard(self):
        """score=0.5, obs=0.7, alpha=0.2 → 0.54."""
        assert ewma(0.7, 0.5, 0.2) == pytest.approx(0.54)

    def test_three_corrections_from_half(self):
        """3 consecutive corrections with warm-up alpha."""
        s = 0.5
        for _ in range(3):
            s = ewma(0.0, s, 0.4)
        assert s == pytest.approx(0.108)

    def test_clamp_floor(self):
        """Score never goes below 0.0 after clamping."""
        s = 0.01
        result = ewma(0.0, s, 0.4)
        assert result >= 0.0

    def test_clamp_ceiling(self):
        """Score never goes above 1.0 after clamping."""
        s = 0.99
        result = ewma(1.0, s, 0.4)
        assert result <= 1.0


class TestBaselineDecay:
    """Test baseline regression decay."""

    def test_decay_from_high(self):
        """score=0.9 → decays toward 0.5."""
        result = baseline_decay(0.9)
        assert result < 0.9
        assert result > 0.5

    def test_decay_from_low(self):
        """score=0.1 → decays toward 0.5 (upward)."""
        result = baseline_decay(0.1)
        assert result > 0.1
        assert result < 0.5

    def test_at_baseline_no_change(self):
        """score=0.5 → stays at 0.5."""
        assert baseline_decay(0.5) == pytest.approx(0.5)

    def test_200_sessions_from_high(self):
        """200 iterations from 0.9 → converges near 0.5."""
        s = 0.9
        for _ in range(200):
            s = baseline_decay(s)
        assert s == pytest.approx(0.5, abs=0.02)

    def test_200_sessions_from_low(self):
        """200 iterations from 0.1 → converges near 0.5."""
        s = 0.1
        for _ in range(200):
            s = baseline_decay(s)
        assert s == pytest.approx(0.5, abs=0.02)


class TestLinearRegressionSlope:
    """Test trend slope computation."""

    def test_monotonically_increasing(self):
        values = [0.3 + i * 0.02 for i in range(25)]
        slope = linear_regression_slope(values)
        assert slope > 0.01

    def test_monotonically_decreasing(self):
        values = [0.8 - i * 0.02 for i in range(25)]
        slope = linear_regression_slope(values)
        assert slope < -0.01

    def test_flat(self):
        values = [0.5] * 25
        slope = linear_regression_slope(values)
        assert abs(slope) < 0.001

    def test_noisy_upward(self):
        """Upward trend with noise."""
        import random
        random.seed(42)
        values = [0.3 + i * 0.015 + random.uniform(-0.01, 0.01) for i in range(25)]
        slope = linear_regression_slope(values)
        assert slope > 0.01

    def test_empty_returns_zero(self):
        assert linear_regression_slope([]) == 0.0

    def test_single_value_returns_zero(self):
        assert linear_regression_slope([0.5]) == 0.0


class TestPriorityScore:
    """Test spaced reinforcement priority formula."""

    def test_maximum(self):
        """score=0.0, sessions=10+, regression → 1.2."""
        p = priority_score(score=0.0, sessions_since=10, last_delta=-0.1)
        assert p == pytest.approx(1.2)

    def test_minimum(self):
        """score=1.0, sessions=0, no regression → 0.0."""
        p = priority_score(score=1.0, sessions_since=0, last_delta=0.05)
        assert p == pytest.approx(0.0)

    def test_typical(self):
        """score=0.5, sessions=5, no regression → 0.5."""
        p = priority_score(score=0.5, sessions_since=5, last_delta=0.01)
        assert p == pytest.approx(0.5)

    def test_regression_boost(self):
        """last_delta < 0 adds 0.2."""
        p_no = priority_score(score=0.5, sessions_since=0, last_delta=0.01)
        p_yes = priority_score(score=0.5, sessions_since=0, last_delta=-0.01)
        assert p_yes - p_no == pytest.approx(0.2)

    def test_sessions_capped_at_03(self):
        """sessions_since * 0.03 capped at 0.3."""
        p10 = priority_score(score=0.5, sessions_since=10, last_delta=None)
        p100 = priority_score(score=0.5, sessions_since=100, last_delta=None)
        assert p10 == p100  # Both hit the 0.3 cap

    def test_null_last_delta_no_boost(self):
        """None last_delta → no regression boost."""
        p = priority_score(score=0.5, sessions_since=0, last_delta=None)
        assert p == pytest.approx(0.35)


# ─── PatternTracker Class ─────────────────────────────────────────


class TestUpdateRuleScore:
    """Test PatternTracker.update_rule_score."""

    def _setup_tracker(self, mock_graph, session_num=1):
        """Create a tracker with one active rule."""
        client = MemoryGraphClient(mock_graph)
        # Create a PatternScore node
        mock_graph.store_memory(
            name="patternscore-test-rule",
            memory_type="PatternScore",
            content=json.dumps({
                "rule_id": "test-rule", "score": 0.5,
                "last_tested_session": None, "tested_session_count": 0,
                "last_delta": None, "trend": "insufficient_data",
                "status": "active", "score_history": [],
                "last_tested_session_num": None, "consecutive_drops": 0,
            }),
            importance=0.5, tags=["archon-consciousness", "pattern-score"],
        )
        return PatternTracker(client, current_session_num=session_num)

    def test_correction_updates_score(self, mock_graph):
        tracker = self._setup_tracker(mock_graph)
        new_score = tracker.update_rule_score("test-rule", 0.0)
        # Warm-up alpha=0.4: 0.4*0.0 + 0.6*0.5 = 0.3
        assert new_score == pytest.approx(0.3)

    def test_followed_updates_score(self, mock_graph):
        tracker = self._setup_tracker(mock_graph)
        new_score = tracker.update_rule_score("test-rule", 1.0)
        # Warm-up alpha=0.4: 0.4*1.0 + 0.6*0.5 = 0.7
        assert new_score == pytest.approx(0.7)

    def test_warmup_for_first_3_tested(self, mock_graph):
        """First 3 tested sessions use alpha=0.4."""
        tracker = self._setup_tracker(mock_graph)
        s1 = tracker.update_rule_score("test-rule", 1.0)  # session 1: alpha=0.4
        s2 = tracker.update_rule_score("test-rule", 1.0)  # session 2: alpha=0.4
        s3 = tracker.update_rule_score("test-rule", 1.0)  # session 3: alpha=0.4
        # After 3 follows: 0.5→0.7→0.82→0.892
        assert s3 == pytest.approx(0.892, abs=0.01)

    def test_session_4_uses_standard_alpha(self, mock_graph):
        """Session 4+ uses alpha=0.2."""
        tracker = self._setup_tracker(mock_graph)
        for _ in range(3):
            tracker.update_rule_score("test-rule", 1.0)  # warm-up
        s4 = tracker.update_rule_score("test-rule", 0.0)  # correction with alpha=0.2
        # 0.892 * 0.8 + 0.0 * 0.2 = 0.7136
        assert s4 == pytest.approx(0.7136, abs=0.01)

    def test_tested_session_count_increments(self, mock_graph):
        tracker = self._setup_tracker(mock_graph)
        tracker.update_rule_score("test-rule", 1.0)
        tracker.update_rule_score("test-rule", 0.7)
        data = tracker._load_tracker_data("test-rule")
        assert data["tested_session_count"] == 2

    def test_last_delta_computed(self, mock_graph):
        tracker = self._setup_tracker(mock_graph)
        tracker.update_rule_score("test-rule", 1.0)  # 0.5→0.7, delta=+0.2
        data = tracker._load_tracker_data("test-rule")
        assert data["last_delta"] == pytest.approx(0.2)

    def test_score_history_appended(self, mock_graph):
        tracker = self._setup_tracker(mock_graph)
        tracker.update_rule_score("test-rule", 1.0)
        tracker.update_rule_score("test-rule", 0.0)
        data = tracker._load_tracker_data("test-rule")
        assert len(data["score_history"]) == 2

    def test_consecutive_drops_tracked(self, mock_graph):
        tracker = self._setup_tracker(mock_graph)
        tracker.update_rule_score("test-rule", 1.0)  # up
        tracker.update_rule_score("test-rule", 0.0)  # down → 1 drop
        tracker.update_rule_score("test-rule", 0.0)  # down → 2 drops
        data = tracker._load_tracker_data("test-rule")
        assert data["consecutive_drops"] == 2

    def test_consecutive_drops_resets_on_rise(self, mock_graph):
        tracker = self._setup_tracker(mock_graph)
        tracker.update_rule_score("test-rule", 0.0)  # down
        tracker.update_rule_score("test-rule", 0.0)  # down
        tracker.update_rule_score("test-rule", 1.0)  # up → resets
        data = tracker._load_tracker_data("test-rule")
        assert data["consecutive_drops"] == 0


class TestApplyBaselineDecay:
    """Test baseline regression decay for untested rules."""

    def _setup_with_rules(self, mock_graph, rules):
        client = MemoryGraphClient(mock_graph)
        for rule_id, score in rules:
            mock_graph.store_memory(
                name=f"patternscore-{rule_id}",
                memory_type="PatternScore",
                content=json.dumps({
                    "rule_id": rule_id, "score": score,
                    "last_tested_session": None, "tested_session_count": 0,
                    "last_delta": None, "trend": "insufficient_data",
                    "status": "active", "score_history": [],
                    "last_tested_session_num": None, "consecutive_drops": 0,
                }),
                importance=0.5, tags=["archon-consciousness"],
            )
        return PatternTracker(client, current_session_num=1)

    def test_decay_applied_to_untested(self, mock_graph):
        tracker = self._setup_with_rules(mock_graph, [("rule-a", 0.9)])
        tracker.apply_baseline_decay(["rule-a"], tested_rule_ids=set())
        data = tracker._load_tracker_data("rule-a")
        expected = 0.5 + (0.9 - 0.5) * 0.98
        assert data["score"] == pytest.approx(expected)

    def test_tested_rules_skipped(self, mock_graph):
        tracker = self._setup_with_rules(mock_graph, [("rule-a", 0.9)])
        tracker.apply_baseline_decay(["rule-a"], tested_rule_ids={"rule-a"})
        data = tracker._load_tracker_data("rule-a")
        assert data["score"] == pytest.approx(0.9)  # unchanged

    def test_does_not_increment_tested_count(self, mock_graph):
        tracker = self._setup_with_rules(mock_graph, [("rule-a", 0.9)])
        tracker.apply_baseline_decay(["rule-a"], tested_rule_ids=set())
        data = tracker._load_tracker_data("rule-a")
        assert data["tested_session_count"] == 0


class TestClassifyTrends:
    """Test trend classification with linear regression."""

    def _setup_with_history(self, mock_graph, rule_id, history):
        client = MemoryGraphClient(mock_graph)
        mock_graph.store_memory(
            name=f"patternscore-{rule_id}",
            memory_type="PatternScore",
            content=json.dumps({
                "rule_id": rule_id, "score": history[-1] if history else 0.5,
                "last_tested_session": None, "tested_session_count": len(history),
                "last_delta": None, "trend": "insufficient_data",
                "status": "active", "score_history": history,
                "last_tested_session_num": None, "consecutive_drops": 0,
            }),
            importance=0.5, tags=["archon-consciousness"],
        )
        return PatternTracker(client, current_session_num=len(history) + 1)

    def test_improving(self, mock_graph):
        history = [0.3 + i * 0.02 for i in range(25)]
        tracker = self._setup_with_history(mock_graph, "rule-a", history)
        trends = tracker.classify_trends()
        assert trends["rule-a"] == "improving"

    def test_regressing(self, mock_graph):
        history = [0.8 - i * 0.02 for i in range(25)]
        tracker = self._setup_with_history(mock_graph, "rule-a", history)
        trends = tracker.classify_trends()
        assert trends["rule-a"] == "regressing"

    def test_stable(self, mock_graph):
        history = [0.5] * 25
        tracker = self._setup_with_history(mock_graph, "rule-a", history)
        trends = tracker.classify_trends()
        assert trends["rule-a"] == "stable"

    def test_insufficient_data(self, mock_graph):
        history = [0.5] * 19  # below 20 threshold
        tracker = self._setup_with_history(mock_graph, "rule-a", history)
        trends = tracker.classify_trends()
        assert trends["rule-a"] == "insufficient_data"


class TestCheckAlerts:
    """Test regression and atrophy alerts."""

    def _setup_rule(self, mock_graph, rule_id, score=0.5, consecutive_drops=0,
                    last_tested_num=None, session_num=50):
        client = MemoryGraphClient(mock_graph)
        mock_graph.store_memory(
            name=f"patternscore-{rule_id}",
            memory_type="PatternScore",
            content=json.dumps({
                "rule_id": rule_id, "score": score,
                "last_tested_session": None,
                "tested_session_count": 10,
                "last_delta": -0.05 if consecutive_drops > 0 else 0.05,
                "trend": "stable", "status": "active",
                "score_history": [score] * 10,
                "last_tested_session_num": last_tested_num,
                "consecutive_drops": consecutive_drops,
            }),
            importance=0.5, tags=["archon-consciousness"],
        )
        return PatternTracker(client, current_session_num=session_num)

    def test_regression_alert_fires(self, mock_graph):
        tracker = self._setup_rule(mock_graph, "rule-a", consecutive_drops=3)
        alerts = tracker.check_alerts()
        regression_alerts = [a for a in alerts if a["type"] == "regression"]
        assert len(regression_alerts) == 1

    def test_no_regression_with_2_drops(self, mock_graph):
        tracker = self._setup_rule(mock_graph, "rule-a", consecutive_drops=2)
        alerts = tracker.check_alerts()
        regression_alerts = [a for a in alerts if a["type"] == "regression"]
        assert len(regression_alerts) == 0

    def test_atrophy_alert_fires(self, mock_graph):
        tracker = self._setup_rule(
            mock_graph, "rule-a", score=0.8, last_tested_num=10, session_num=50,
        )
        alerts = tracker.check_alerts()
        atrophy_alerts = [a for a in alerts if a["type"] == "atrophy"]
        assert len(atrophy_alerts) == 1

    def test_no_atrophy_low_score(self, mock_graph):
        tracker = self._setup_rule(
            mock_graph, "rule-a", score=0.5, last_tested_num=10, session_num=50,
        )
        alerts = tracker.check_alerts()
        atrophy_alerts = [a for a in alerts if a["type"] == "atrophy"]
        assert len(atrophy_alerts) == 0

    def test_no_atrophy_recent(self, mock_graph):
        tracker = self._setup_rule(
            mock_graph, "rule-a", score=0.9, last_tested_num=45, session_num=50,
        )
        alerts = tracker.check_alerts()
        atrophy_alerts = [a for a in alerts if a["type"] == "atrophy"]
        assert len(atrophy_alerts) == 0

    def test_max_3_atrophy_alerts(self, mock_graph):
        """5 atrophying rules → only top 3 by score."""
        client = MemoryGraphClient(mock_graph)
        for i, score in enumerate([0.95, 0.90, 0.85, 0.80, 0.75]):
            mock_graph.store_memory(
                name=f"patternscore-rule-{i}",
                memory_type="PatternScore",
                content=json.dumps({
                    "rule_id": f"rule-{i}", "score": score,
                    "last_tested_session": None, "tested_session_count": 10,
                    "last_delta": 0.01, "trend": "stable", "status": "active",
                    "score_history": [score] * 10,
                    "last_tested_session_num": 5, "consecutive_drops": 0,
                }),
                importance=0.5, tags=["archon-consciousness"],
            )
        tracker = PatternTracker(client, current_session_num=50)
        alerts = tracker.check_alerts()
        atrophy_alerts = [a for a in alerts if a["type"] == "atrophy"]
        assert len(atrophy_alerts) == 3
        # Top 3 by score: 0.95, 0.90, 0.85
        scores = [a["score"] for a in atrophy_alerts]
        assert scores == sorted(scores, reverse=True)


class TestComputeInjectionPriority:
    """Test spaced reinforcement priority computation."""

    def _setup_rules(self, mock_graph, rules, session_num=50):
        client = MemoryGraphClient(mock_graph)
        for rule_id, score, last_tested_num, last_delta in rules:
            mock_graph.store_memory(
                name=f"patternscore-{rule_id}",
                memory_type="PatternScore",
                content=json.dumps({
                    "rule_id": rule_id, "score": score,
                    "last_tested_session": None, "tested_session_count": 10,
                    "last_delta": last_delta, "trend": "stable",
                    "status": "active", "score_history": [score] * 10,
                    "last_tested_session_num": last_tested_num,
                    "consecutive_drops": 0,
                }),
                importance=0.5, tags=["archon-consciousness"],
            )
        return PatternTracker(client, current_session_num=session_num)

    def test_sorted_by_priority_descending(self, mock_graph):
        rules = [
            ("rule-low", 0.2, 40, 0.01),   # high priority (low score)
            ("rule-high", 0.9, 49, 0.01),   # low priority (high score)
            ("rule-mid", 0.5, 45, 0.01),    # medium priority
        ]
        tracker = self._setup_rules(mock_graph, rules)
        result = tracker.compute_injection_priority()
        assert result[0]["rule_id"] == "rule-low"

    def test_max_10_returned(self, mock_graph):
        rules = [(f"rule-{i}", 0.3, 30, 0.01) for i in range(20)]
        tracker = self._setup_rules(mock_graph, rules)
        result = tracker.compute_injection_priority()
        assert len(result) <= 10

    def test_graduated_min_3(self, mock_graph):
        """Even if only 2 above threshold, return at least 3."""
        rules = [
            ("rule-a", 0.95, 49, 0.01),   # very low priority
            ("rule-b", 0.96, 49, 0.01),   # very low priority
            ("rule-c", 0.97, 49, 0.01),   # very low priority
        ]
        tracker = self._setup_rules(mock_graph, rules)
        result = tracker.compute_injection_priority()
        assert len(result) >= 3

    def test_high_scoring_slots_reserved(self, mock_graph):
        """At least 2 rules with score > 0.7 if they exist."""
        rules = [
            ("rule-low-1", 0.1, 30, -0.1),
            ("rule-low-2", 0.2, 35, -0.1),
            ("rule-low-3", 0.15, 32, -0.1),
            ("rule-high-1", 0.85, 10, 0.01),
            ("rule-high-2", 0.90, 5, 0.01),
        ]
        tracker = self._setup_rules(mock_graph, rules)
        result = tracker.compute_injection_priority()
        high_scoring = [r for r in result if r["score"] > 0.7]
        assert len(high_scoring) >= 2

    def test_empty_active_rules(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        tracker = PatternTracker(client, current_session_num=1)
        result = tracker.compute_injection_priority()
        assert result == []

    def test_reduced_reinforcement_annotation(self, mock_graph):
        """When fewer than 5 rules meet threshold, annotation present."""
        rules = [
            ("rule-a", 0.95, 49, 0.01),
            ("rule-b", 0.96, 49, 0.01),
            ("rule-c", 0.97, 49, 0.01),
        ]
        tracker = self._setup_rules(mock_graph, rules)
        result = tracker.compute_injection_priority()
        # All 3 rules have low priority → fewer than 5 meet threshold
        annotated = [r for r in result if "annotation" in r]
        assert len(annotated) > 0
        assert "reduced reinforcement" in annotated[0]["annotation"]


class TestArchivedRuleExclusion:
    """Test that archived rules are excluded from updates."""

    def test_update_archived_rule_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        mock_graph.store_memory(
            name="patternscore-archived-rule",
            memory_type="PatternScore",
            content=json.dumps({
                "rule_id": "archived-rule", "score": 0.5,
                "last_tested_session": None, "tested_session_count": 0,
                "last_delta": None, "trend": "frozen",
                "status": "archived", "score_history": [],
                "last_tested_session_num": None, "consecutive_drops": 0,
            }),
            importance=0.5, tags=["archon-consciousness"],
        )
        tracker = PatternTracker(client, current_session_num=1)
        with pytest.raises(ValueError, match="archived"):
            tracker.update_rule_score("archived-rule", 1.0)
