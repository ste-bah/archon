"""Tests for benchmark scheduler — config, circuit breaker, monthly cap, alerts."""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts" / "benchmark"))
from regression import EWMAState
from scheduler import (
    DEFAULT_CONFIG,
    _compute_trend,
    check_circuit_breaker,
    load_config,
    resume_schedule,
    save_config,
)


@pytest.fixture
def config_dir(tmp_path, monkeypatch):
    """Redirect config to temp directory."""
    config_path = tmp_path / "config.json"
    monkeypatch.setattr("scheduler.CONFIG_PATH", config_path)
    return config_path


class TestLoadConfig:
    def test_creates_default_if_missing(self, config_dir):
        config = load_config()
        assert config["monthly_cost_cap_usd"] == 25.0
        assert config["model"] == "sonnet"
        assert config_dir.exists()

    def test_reads_existing(self, config_dir):
        config_dir.write_text(json.dumps({"monthly_cost_cap_usd": 50.0, "model": "opus"}))
        config = load_config()
        assert config["monthly_cost_cap_usd"] == 50.0
        assert config["model"] == "opus"

    def test_merges_missing_keys(self, config_dir):
        config_dir.write_text(json.dumps({"model": "opus"}))
        config = load_config()
        assert config["model"] == "opus"
        assert config["monthly_cost_cap_usd"] == 25.0  # default filled in


class TestSaveConfig:
    def test_round_trip(self, config_dir):
        original = dict(DEFAULT_CONFIG)
        original["monthly_cost_cap_usd"] = 42.0
        save_config(original)
        loaded = load_config()
        assert loaded["monthly_cost_cap_usd"] == 42.0


class TestCheckCircuitBreaker:
    def test_trips_at_two_consecutive(self, config_dir):
        state = EWMAState(
            ewma_value=0.05, last_score=0.05,
            last_run_date="2026-03-30", consecutive_low_count=2,
            run_count=10, alpha=0.3,
        )
        result = check_circuit_breaker(state)
        assert result["tripped"] is True
        assert result["consecutive_low_count"] == 2
        # Verify config was updated
        config = json.loads(config_dir.read_text())
        assert config["paused"] is True

    def test_does_not_trip_at_one(self, config_dir):
        state = EWMAState(
            ewma_value=0.5, last_score=0.05,
            last_run_date="2026-03-30", consecutive_low_count=1,
            run_count=10, alpha=0.3,
        )
        result = check_circuit_breaker(state)
        assert result["tripped"] is False

    def test_does_not_trip_at_zero(self, config_dir):
        state = EWMAState(
            ewma_value=0.8, last_score=0.8,
            last_run_date="2026-03-30", consecutive_low_count=0,
            run_count=10, alpha=0.3,
        )
        result = check_circuit_breaker(state)
        assert result["tripped"] is False

    def test_none_state_graceful(self, config_dir):
        result = check_circuit_breaker(None)
        assert result["tripped"] is False
        assert result["consecutive_low_count"] == 0

    def test_trips_at_three_consecutive(self, config_dir):
        state = EWMAState(
            ewma_value=0.03, last_score=0.02,
            last_run_date="2026-03-30", consecutive_low_count=3,
            run_count=10, alpha=0.3,
        )
        result = check_circuit_breaker(state)
        assert result["tripped"] is True


class TestResumeSchedule:
    def test_unpauses(self, config_dir):
        save_config({**DEFAULT_CONFIG, "paused": True, "pause_reason": "breaker"})
        result = resume_schedule()
        assert result["unpaused"] is True
        config = load_config()
        assert config["paused"] is False
        assert config["pause_reason"] is None

    def test_already_unpaused(self, config_dir):
        save_config({**DEFAULT_CONFIG, "paused": False})
        result = resume_schedule()
        assert result["unpaused"] is False


class TestComputeTrend:
    def test_improving(self):
        # Second half lower than first half → improving (fewer corrections = better)
        values = [10, 12, 11, 5, 4, 3]
        assert _compute_trend(values) == "improving"

    def test_regressing(self):
        # Second half higher than first half → regressing
        values = [3, 4, 5, 10, 12, 11]
        assert _compute_trend(values) == "regressing"

    def test_stable(self):
        values = [5.0, 5.1, 4.9, 5.0, 5.1, 4.9]
        assert _compute_trend(values) == "stable"

    def test_insufficient_data(self):
        assert _compute_trend([1, 2]) == "insufficient_data"
        assert _compute_trend([]) == "insufficient_data"

    def test_single_value(self):
        assert _compute_trend([5]) == "insufficient_data"

    def test_three_values_minimum(self):
        result = _compute_trend([10, 5, 3])
        assert result in ("improving", "stable", "regressing")

    def test_zero_first_half(self):
        values = [0, 0, 0, 5, 5, 5]
        assert _compute_trend(values) == "stable"
