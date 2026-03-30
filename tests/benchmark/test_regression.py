"""Tests for EWMA regression detection."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts" / "benchmark"))
from regression import (
    EWMAState,
    compute_ewma,
    detect_regression,
    get_benchmark_trend,
    update_ewma_state,
)


class TestComputeEwma:
    def test_basic_calculation(self):
        # 0.3 * 0.8 + 0.7 * 0.5 = 0.24 + 0.35 = 0.59
        result = compute_ewma(0.8, 0.5, alpha=0.3)
        assert abs(result - 0.59) < 0.001

    def test_stable_at_max(self):
        assert compute_ewma(1.0, 1.0, alpha=0.3) == 1.0

    def test_sharp_drop(self):
        # 0.3 * 0.0 + 0.7 * 1.0 = 0.7
        result = compute_ewma(0.0, 1.0, alpha=0.3)
        assert abs(result - 0.7) < 0.001

    def test_alpha_one_ignores_history(self):
        # alpha=1: 1.0 * 0.5 + 0.0 * 0.0 = 0.5
        assert compute_ewma(0.5, 0.0, alpha=1.0) == 0.5

    def test_alpha_zero_ignores_current(self):
        # alpha=0: 0.0 * 0.5 + 1.0 * 0.5 = 0.5
        assert compute_ewma(0.5, 0.5, alpha=0.0) == 0.5

    def test_alpha_zero_keeps_history(self):
        assert compute_ewma(0.0, 0.8, alpha=0.0) == 0.8


class TestDetectRegression:
    def test_warning_20pct_drop(self):
        # 0.8/1.0 = 0.8 → 20% drop > 10% threshold
        result = detect_regression(0.8, 1.0)
        assert result["status"] == "warning"
        assert result["severity"] == "warning"

    def test_critical_30pct_drop(self):
        # 0.7/1.0 = 0.7 → 30% drop > 25% threshold
        result = detect_regression(0.7, 1.0)
        assert result["status"] == "critical"
        assert result["severity"] == "critical"

    def test_stable_5pct_drop(self):
        # 0.95/1.0 = 0.95 → 5% drop < 10% threshold
        result = detect_regression(0.95, 1.0)
        assert result["status"] == "stable"
        assert result["severity"] is None

    def test_insufficient_data_zero_ewma(self):
        result = detect_regression(0.5, 0.0)
        assert result["status"] == "insufficient_data"
        assert result["severity"] is None

    def test_improvement_not_regression(self):
        result = detect_regression(1.0, 0.5)
        assert result["status"] == "stable"

    def test_exactly_at_warning_threshold(self):
        # 0.9/1.0 = 0.9 → exactly 10% drop
        result = detect_regression(0.9, 1.0)
        assert result["status"] == "stable"  # not strict < -0.10

    def test_just_below_warning(self):
        result = detect_regression(0.899, 1.0)
        assert result["status"] == "warning"

    def test_pct_change_negative_for_drop(self):
        result = detect_regression(0.7, 1.0)
        assert result["pct_change"] < 0

    def test_pct_change_positive_for_improvement(self):
        result = detect_regression(1.2, 1.0)
        assert result["pct_change"] > 0

    def test_negative_ewma(self):
        result = detect_regression(0.5, -0.1)
        assert result["status"] == "insufficient_data"


class TestUpdateEwmaState:
    def _initial_state(self, **overrides):
        defaults = {
            "ewma_value": 0.5,
            "last_score": 0.5,
            "last_run_date": "2026-03-01T00:00:00+00:00",
            "consecutive_low_count": 0,
            "run_count": 5,
            "alpha": 0.3,
        }
        defaults.update(overrides)
        return EWMAState(**defaults)

    def test_increments_run_count(self):
        state = self._initial_state()
        new = update_ewma_state(state, 0.6)
        assert new.run_count == 6

    def test_updates_ewma(self):
        state = self._initial_state(ewma_value=0.5)
        new = update_ewma_state(state, 0.8)
        expected = 0.3 * 0.8 + 0.7 * 0.5  # 0.59
        assert abs(new.ewma_value - expected) < 0.001

    def test_low_score_increments_consecutive(self):
        state = self._initial_state(consecutive_low_count=0)
        new = update_ewma_state(state, 0.05)
        assert new.consecutive_low_count == 1

    def test_good_score_resets_consecutive(self):
        state = self._initial_state(consecutive_low_count=3)
        new = update_ewma_state(state, 0.5)
        assert new.consecutive_low_count == 0

    def test_consecutive_accumulates(self):
        state = self._initial_state(consecutive_low_count=1)
        new = update_ewma_state(state, 0.05)
        assert new.consecutive_low_count == 2

    def test_preserves_alpha(self):
        state = self._initial_state(alpha=0.5)
        new = update_ewma_state(state, 0.7)
        assert new.alpha == 0.5

    def test_updates_last_score(self):
        state = self._initial_state()
        new = update_ewma_state(state, 0.77)
        assert new.last_score == 0.77


class TestGetBenchmarkTrend:
    def test_empty_results(self):
        assert get_benchmark_trend([]) == []

    def test_single_result(self):
        results = [{"run_date": "2026-03-01", "score": 0.8}]
        trend = get_benchmark_trend(results)
        assert len(trend) == 1
        assert trend[0]["ewma"] == 0.8

    def test_five_results(self):
        results = [
            {"run_date": f"2026-03-0{i+1}", "score": 0.5 + i * 0.1}
            for i in range(5)
        ]
        trend = get_benchmark_trend(results, alpha=0.3)
        assert len(trend) == 5
        # EWMA should be between min and max scores
        for t in trend:
            assert 0.0 <= t["ewma"] <= 1.0

    def test_ewma_smooths_outlier(self):
        results = [
            {"run_date": "2026-03-01", "score": 0.8},
            {"run_date": "2026-03-02", "score": 0.8},
            {"run_date": "2026-03-03", "score": 0.1},  # outlier
            {"run_date": "2026-03-04", "score": 0.8},
        ]
        trend = get_benchmark_trend(results, alpha=0.3)
        # After outlier, EWMA should not drop to 0.1 — smoothing keeps it higher
        assert trend[2]["ewma"] > 0.3

    def test_trend_preserves_dates(self):
        results = [{"run_date": "2026-03-15", "score": 0.9}]
        trend = get_benchmark_trend(results)
        assert trend[0]["run_date"] == "2026-03-15"
