"""Tests for benchmark cost tracker."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts" / "benchmark"))
from cost_tracker import CostTracker


SONNET_PRICING = {"input_per_mtok": 3.00, "output_per_mtok": 15.00}
OPUS_PRICING = {"input_per_mtok": 15.00, "output_per_mtok": 75.00}


class TestEstimateTaskCost:
    def test_sonnet_50k_tokens(self):
        tracker = CostTracker(SONNET_PRICING, run_ceiling=6.0)
        cost = tracker.estimate_task_cost(50000)
        # input: 50000/1M * 3.00 = 0.15
        # output: 50000*0.2/1M * 15.00 = 0.15
        assert abs(cost - 0.30) < 0.001

    def test_opus_50k_tokens(self):
        tracker = CostTracker(OPUS_PRICING, run_ceiling=17.0)
        cost = tracker.estimate_task_cost(50000)
        # input: 50000/1M * 15.00 = 0.75
        # output: 50000*0.2/1M * 75.00 = 0.75
        assert abs(cost - 1.50) < 0.001

    def test_zero_tokens(self):
        tracker = CostTracker(SONNET_PRICING, run_ceiling=6.0)
        assert tracker.estimate_task_cost(0) == 0.0


class TestCanAfford:
    def test_under_ceiling(self):
        tracker = CostTracker(SONNET_PRICING, run_ceiling=6.0)
        assert tracker.can_afford(5.0) is True

    def test_at_ceiling(self):
        tracker = CostTracker(SONNET_PRICING, run_ceiling=6.0)
        assert tracker.can_afford(6.0) is True

    def test_over_ceiling(self):
        tracker = CostTracker(SONNET_PRICING, run_ceiling=6.0)
        assert tracker.can_afford(6.01) is False

    def test_accumulation_over_ceiling(self):
        tracker = CostTracker(SONNET_PRICING, run_ceiling=1.0)
        tracker.record_usage({"input_tokens": 100000, "output_tokens": 50000})
        # Cost: 100K/1M*3 + 50K/1M*15 = 0.3 + 0.75 = 1.05
        assert tracker.can_afford(0.01) is False


class TestRecordUsage:
    def test_accumulates_total(self):
        tracker = CostTracker(SONNET_PRICING, run_ceiling=100.0)
        tracker.record_usage({"input_tokens": 1000000, "output_tokens": 0})
        assert abs(tracker.running_total - 3.0) < 0.001
        tracker.record_usage({"input_tokens": 0, "output_tokens": 1000000})
        assert abs(tracker.running_total - 18.0) < 0.001

    def test_sets_last_task_cost(self):
        tracker = CostTracker(SONNET_PRICING, run_ceiling=100.0)
        tracker.record_usage({"input_tokens": 1000000, "output_tokens": 0})
        assert abs(tracker.last_task_cost - 3.0) < 0.001

    def test_appends_to_task_costs(self):
        tracker = CostTracker(SONNET_PRICING, run_ceiling=100.0)
        tracker.record_usage({"input_tokens": 1000, "output_tokens": 500})
        assert len(tracker.task_costs) == 1
        assert tracker.task_costs[0]["input_tokens"] == 1000
        assert tracker.task_costs[0]["output_tokens"] == 500

    def test_returns_cost(self):
        tracker = CostTracker(SONNET_PRICING, run_ceiling=100.0)
        cost = tracker.record_usage({"input_tokens": 1000000, "output_tokens": 0})
        assert abs(cost - 3.0) < 0.001

    def test_missing_keys_default_zero(self):
        tracker = CostTracker(SONNET_PRICING, run_ceiling=100.0)
        cost = tracker.record_usage({})
        assert cost == 0.0


class TestGetSummary:
    def test_remaining_budget(self):
        tracker = CostTracker(SONNET_PRICING, run_ceiling=6.0)
        tracker.record_usage({"input_tokens": 1000000, "output_tokens": 0})
        summary = tracker.get_summary()
        assert abs(summary["remaining_budget_usd"] - 3.0) < 0.001
        assert summary["run_ceiling_usd"] == 6.0
        assert summary["tasks_costed"] == 1

    def test_empty_tracker(self):
        tracker = CostTracker(SONNET_PRICING, run_ceiling=6.0)
        summary = tracker.get_summary()
        assert summary["running_total_usd"] == 0.0
        assert summary["remaining_budget_usd"] == 6.0
        assert summary["tasks_costed"] == 0
