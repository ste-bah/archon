"""Benchmark scheduling, circuit breaker, and monthly cost cap.

EC-BENCH-006: 2 consecutive runs < 0.1 -> pause schedule + alert.
Section 7B:   Monthly hard cap $25 default, enforced before each run.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

CONFIG_PATH = Path.home() / ".archon" / "benchmark" / "config.json"

DEFAULT_CONFIG = {
    "monthly_cost_cap_usd": 25.0,
    "per_run_ceiling_usd": 6.0,
    "model": "sonnet",
    "alpha": 0.3,
    "paused": False,
    "pause_reason": None,
    "schedule": "weekly",
    "schedule_day": "sunday",
    "schedule_hour": 2,
}


def load_config() -> dict:
    """Load benchmark config. Creates default if file missing."""
    if not CONFIG_PATH.exists():
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_PATH, "w") as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)
        return dict(DEFAULT_CONFIG)

    with open(CONFIG_PATH) as f:
        config = json.load(f)
    for key, default in DEFAULT_CONFIG.items():
        config.setdefault(key, default)
    return config


def save_config(config: dict) -> None:
    """Save config to disk."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


def check_circuit_breaker(ewma_state) -> dict:
    """Check if circuit breaker should activate.

    EC-BENCH-006: 2 consecutive runs < 0.1 -> pause + alert.
    """
    if ewma_state is None:
        return {"tripped": False, "consecutive_low_count": 0, "message": None}

    if ewma_state.consecutive_low_count >= 2:
        config = load_config()
        config["paused"] = True
        config["pause_reason"] = (
            "Benchmark circuit breaker activated. "
            f"{ewma_state.consecutive_low_count} consecutive runs scored < 0.1. "
            "Investigate model configuration."
        )
        save_config(config)

        return {
            "tripped": True,
            "consecutive_low_count": ewma_state.consecutive_low_count,
            "message": config["pause_reason"],
        }

    return {
        "tripped": False,
        "consecutive_low_count": ewma_state.consecutive_low_count,
        "message": None,
    }


def resume_schedule() -> dict:
    """Manually unpause after circuit breaker trip. HC-008."""
    config = load_config()
    was_paused = config.get("paused", False)
    config["paused"] = False
    config["pause_reason"] = None
    save_config(config)
    return {"unpaused": was_paused, "config": config}


def _compute_trend(values: list[float]) -> str:
    """Simple trend classification from a list of values."""
    if len(values) < 3:
        return "insufficient_data"
    half = len(values) // 2
    first_half = sum(values[:half]) / half
    second_half = sum(values[half:]) / (len(values) - half)
    if first_half == 0:
        return "stable"
    pct_change = (second_half - first_half) / first_half
    if pct_change < -0.1:
        return "improving"
    elif pct_change > 0.1:
        return "regressing"
    return "stable"
