"""EWMA-based regression detection for benchmark results.

Follows the same pattern as PatternTracker in
src/archon_consciousness/pattern_tracker.py.
"""

from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class EWMAState:
    """Persistent EWMA state for a benchmark suite."""
    ewma_value: float
    last_score: float
    last_run_date: str
    consecutive_low_count: int
    run_count: int
    alpha: float = 0.3


def compute_ewma(
    current_score: float,
    previous_ewma: float,
    alpha: float = 0.3,
) -> float:
    """Compute Exponential Weighted Moving Average.

    EWMA(t) = alpha * value(t) + (1 - alpha) * EWMA(t-1)
    """
    return alpha * current_score + (1 - alpha) * previous_ewma


def detect_regression(
    current_score: float,
    ewma_value: float,
    warning_threshold: float = 0.10,
    critical_threshold: float = 0.25,
) -> dict:
    """Compare current score against EWMA baseline.

    REQ-BENCH-005:
      - > 10% drop from EWMA -> warning
      - > 25% drop from EWMA -> critical
    EC-BENCH-002: ewma_value <= 0 -> insufficient_data
    """
    if ewma_value <= 0.0:
        return {
            "status": "insufficient_data",
            "current_score": current_score,
            "ewma_baseline": ewma_value,
            "pct_change": 0.0,
            "severity": None,
        }

    pct_change = (current_score - ewma_value) / ewma_value

    if pct_change < -critical_threshold:
        status = "critical"
        severity = "critical"
    elif pct_change < -warning_threshold:
        status = "warning"
        severity = "warning"
    else:
        status = "stable"
        severity = None

    return {
        "status": status,
        "current_score": round(current_score, 4),
        "ewma_baseline": round(ewma_value, 4),
        "pct_change": round(pct_change, 4),
        "severity": severity,
    }


def update_ewma_state(
    state: EWMAState,
    current_score: float,
    low_score_threshold: float = 0.1,
) -> EWMAState:
    """Update EWMA state with a new run result."""
    new_ewma = compute_ewma(current_score, state.ewma_value, state.alpha)

    if current_score < low_score_threshold:
        consecutive_low = state.consecutive_low_count + 1
    else:
        consecutive_low = 0

    return EWMAState(
        ewma_value=new_ewma,
        last_score=current_score,
        last_run_date=datetime.now(timezone.utc).isoformat(),
        consecutive_low_count=consecutive_low,
        run_count=state.run_count + 1,
        alpha=state.alpha,
    )


def get_benchmark_trend(
    results: list[dict],
    alpha: float = 0.3,
) -> list[dict]:
    """Compute EWMA trend line from historical results.

    Args:
        results: List of {"run_date": str, "score": float}, sorted by date ascending.
        alpha:   EWMA smoothing factor.

    Returns:
        List of {"run_date", "score", "ewma"} for each point.
    """
    if not results:
        return []

    trend = []
    ewma = results[0]["score"]
    for r in results:
        ewma = alpha * r["score"] + (1 - alpha) * ewma
        trend.append({
            "run_date": r["run_date"],
            "score": round(r["score"], 4),
            "ewma": round(ewma, 4),
        })
    return trend
