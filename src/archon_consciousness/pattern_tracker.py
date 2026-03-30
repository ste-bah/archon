"""Behavioral compliance pattern tracker for Archon Consciousness.

Tracks per-rule compliance scores via EWMA, detects trends and
regressions, computes spaced reinforcement priority for session-start
injection.

Implements FR-CON-009, FR-CON-010, FR-CON-011, FR-CON-012, FR-CON-027.
"""

import json
import logging
from typing import Optional

from src.archon_consciousness.constants import (
    CONSCIOUSNESS_TAG,
    NODE_PREFIX_PATTERN_SCORE,
    SCORE_MAX,
    SCORE_MIN,
)
from src.archon_consciousness.mcp_client import MemoryGraphClient

logger = logging.getLogger(__name__)

# ─── Constants ─────────────────────────────────────────────────────

_WARMUP_ALPHA = 0.4
_STANDARD_ALPHA = 0.2
_WARMUP_SESSIONS = 3
_DECAY_RATE = 0.98
_DECAY_BASELINE = 0.5
_TREND_MIN_SESSIONS = 20
_TREND_IMPROVING = 0.01
_TREND_REGRESSING = -0.01
_REGRESSION_CONSECUTIVE = 3
_ATROPHY_SESSIONS = 30
_ATROPHY_SCORE_MIN = 0.7
_MAX_ATROPHY_ALERTS = 3
_PRIORITY_SCORE_WEIGHT = 0.7
_PRIORITY_SESSION_WEIGHT = 0.03
_PRIORITY_SESSION_CAP = 0.3
_REGRESSION_BOOST = 0.2
_INJECTION_MIN = 3
_INJECTION_MAX = 10
_INJECTION_THRESHOLD = 0.05
_HIGH_SCORE_SLOTS = 2
_HIGH_SCORE_MIN = 0.7
_REDUCED_THRESHOLD = 5


# ─── Pure math helpers ─────────────────────────────────────────────


def ewma(observation: float, current_score: float, alpha: float) -> float:
    """Compute EWMA update. Returns clamped [0.0, 1.0]."""
    result = alpha * observation + (1.0 - alpha) * current_score
    return max(SCORE_MIN, min(SCORE_MAX, result))


def baseline_decay(score: float, rate: float = _DECAY_RATE) -> float:
    """Apply baseline regression decay toward 0.5."""
    return _DECAY_BASELINE + (score - _DECAY_BASELINE) * rate


def linear_regression_slope(values: list[float]) -> float:
    """Compute linear regression slope over indexed values.

    Uses least-squares: slope = (n*Σxy - Σx*Σy) / (n*Σx² - (Σx)²)
    """
    n = len(values)
    if n < 2:
        return 0.0
    sum_x = sum(range(n))
    sum_y = sum(values)
    sum_xy = sum(i * v for i, v in enumerate(values))
    sum_x2 = sum(i * i for i in range(n))
    denom = n * sum_x2 - sum_x * sum_x
    if denom == 0:
        return 0.0
    return (n * sum_xy - sum_x * sum_y) / denom


def priority_score(
    score: float,
    sessions_since: int,
    last_delta: Optional[float],
) -> float:
    """Compute spaced reinforcement priority. Range [0.0, 1.2]."""
    base = (1.0 - score) * _PRIORITY_SCORE_WEIGHT
    session_term = min(_PRIORITY_SESSION_CAP, sessions_since * _PRIORITY_SESSION_WEIGHT)
    boost = _REGRESSION_BOOST if (last_delta is not None and last_delta < 0) else 0.0
    return base + session_term + boost


# ─── PatternTracker class ─────────────────────────────────────────


class PatternTracker:
    """Manages per-rule compliance tracking, trends, and alerts.

    Stores data in MemoryGraph PatternScore nodes with additional
    tracker-managed fields (score_history, consecutive_drops, etc.).
    """

    def __init__(self, client: MemoryGraphClient, current_session_num: int):
        self._client = client
        self._session_num = current_session_num

    def update_rule_score(self, rule_id: str, observation: float) -> float:
        """Apply EWMA update for a tested rule. Returns new score.

        NOTE: Caller should average multiple observations per session
        before calling (FR-CON-010). This method applies one EWMA step.

        Raises:
            ValueError: If rule is archived or deprecated.
        """
        data = self._load_tracker_data(rule_id)
        if data.get("status") != "active":
            raise ValueError(f"Cannot update score for {data['status']} rule: {rule_id}")
        old_score = data["score"]
        alpha = self._get_alpha(data)
        new_score = ewma(observation, old_score, alpha)
        delta = new_score - old_score

        data["score"] = new_score
        data["last_delta"] = delta
        data["tested_session_count"] += 1
        data["last_tested_session_num"] = self._session_num
        data["score_history"].append(new_score)
        data["consecutive_drops"] = (
            data["consecutive_drops"] + 1 if delta < 0 else 0
        )
        self._save_tracker_data(rule_id, data)
        return new_score

    def apply_baseline_decay(
        self, active_rule_ids: list[str], tested_rule_ids: set[str],
    ) -> None:
        """Apply baseline decay to untested active rules."""
        for rule_id in active_rule_ids:
            if rule_id in tested_rule_ids:
                continue
            data = self._load_tracker_data(rule_id)
            if data["status"] != "active":
                continue
            data["score"] = baseline_decay(data["score"])
            self._save_tracker_data(rule_id, data)

    def classify_trends(self) -> dict[str, str]:
        """Classify trends for all active rules with enough data."""
        all_scores = self._client.list_by_type("PatternScore")
        trends = {}
        for mem in all_scores:
            data = json.loads(mem["content"])
            if data.get("status") != "active":
                continue
            rule_id = data["rule_id"]
            history = data.get("score_history", [])
            if len(history) < _TREND_MIN_SESSIONS:
                trends[rule_id] = "insufficient_data"
                continue
            slope = linear_regression_slope(history)
            if slope > _TREND_IMPROVING:
                trends[rule_id] = "improving"
            elif slope < _TREND_REGRESSING:
                trends[rule_id] = "regressing"
            else:
                trends[rule_id] = "stable"
        return trends

    def check_alerts(self) -> list[dict]:
        """Check for regression and atrophy alerts."""
        alerts = []
        all_scores = self._client.list_by_type("PatternScore")
        atrophy_candidates = []

        for mem in all_scores:
            data = json.loads(mem["content"])
            if data.get("status") != "active":
                continue
            rule_id = data["rule_id"]

            # Regression check
            if data.get("consecutive_drops", 0) >= _REGRESSION_CONSECUTIVE:
                alerts.append({
                    "type": "regression", "rule_id": rule_id,
                    "score": data["score"],
                    "details": f"{data['consecutive_drops']} consecutive drops",
                })

            # Atrophy check
            last_num = data.get("last_tested_session_num")
            if last_num is not None and data["score"] > _ATROPHY_SCORE_MIN:
                gap = self._session_num - last_num
                if gap > _ATROPHY_SESSIONS:
                    atrophy_candidates.append({
                        "type": "atrophy", "rule_id": rule_id,
                        "score": data["score"],
                        "details": f"Untested for {gap} sessions",
                    })

        # Cap atrophy alerts at 3, sorted by highest score
        atrophy_candidates.sort(key=lambda a: a["score"], reverse=True)
        alerts.extend(atrophy_candidates[:_MAX_ATROPHY_ALERTS])
        return alerts

    def compute_injection_priority(self) -> list[dict]:
        """Compute spaced reinforcement priority for session-start."""
        all_scores = self._client.list_by_type("PatternScore")
        candidates = []
        for mem in all_scores:
            data = json.loads(mem["content"])
            if data.get("status") != "active":
                continue
            last_num = data.get("last_tested_session_num")
            sessions_since = (
                self._session_num - last_num if last_num is not None
                else self._session_num
            )
            p = priority_score(data["score"], sessions_since, data.get("last_delta"))
            candidates.append({
                "rule_id": data["rule_id"], "score": data["score"],
                "priority": p, "sessions_since_tested": sessions_since,
            })

        return self._apply_graduated_injection(candidates)

    # ─── Internal helpers ──────────────────────────────────────────

    def _apply_graduated_injection(self, candidates: list[dict]) -> list[dict]:
        """Apply graduated injection rules (FR-CON-027)."""
        if not candidates:
            return []

        eligible = [c for c in candidates if c["priority"] >= _INJECTION_THRESHOLD]
        high_scoring = [c for c in candidates if c["score"] > _HIGH_SCORE_MIN]

        # Sort eligible by priority descending
        eligible.sort(key=lambda c: c["priority"], reverse=True)

        # Reserve 2 slots for high-scoring rules
        reserved = sorted(
            high_scoring,
            key=lambda c: c["sessions_since_tested"], reverse=True,
        )[:_HIGH_SCORE_SLOTS]
        reserved_ids = {r["rule_id"] for r in reserved}

        # Fill remaining slots from eligible (excluding reserved)
        remaining = [c for c in eligible if c["rule_id"] not in reserved_ids]
        remaining_slots = _INJECTION_MAX - len(reserved)
        result = list(reserved) + remaining[:remaining_slots]

        # Enforce minimum 3
        if len(result) < _INJECTION_MIN and candidates:
            all_sorted = sorted(candidates, key=lambda c: c["priority"], reverse=True)
            for c in all_sorted:
                if c["rule_id"] not in {r["rule_id"] for r in result}:
                    result.append(c)
                if len(result) >= _INJECTION_MIN:
                    break

        # Annotate if fewer than 5 rules meet threshold (graduated reduction)
        if len(eligible) < _REDUCED_THRESHOLD:
            for r in result:
                r["annotation"] = "Most rules tracking well; reduced reinforcement"

        result.sort(key=lambda c: c["priority"], reverse=True)
        return result[:_INJECTION_MAX]

    def _load_tracker_data(self, rule_id: str) -> dict:
        """Load full tracker data (PatternScore + extensions)."""
        mem = self._client.get(f"{NODE_PREFIX_PATTERN_SCORE}-{rule_id}")
        if mem is None:
            raise KeyError(f"PatternScore not found: {rule_id}")
        data = json.loads(mem["content"])
        # Ensure extension fields exist
        data.setdefault("score_history", [])
        data.setdefault("last_tested_session_num", None)
        data.setdefault("consecutive_drops", 0)
        return data

    def _save_tracker_data(self, rule_id: str, data: dict) -> None:
        """Persist tracker data back to MemoryGraph."""
        self._client.store(
            name=f"{NODE_PREFIX_PATTERN_SCORE}-{rule_id}",
            memory_type="PatternScore",
            content=json.dumps(data),
            importance=0.5,
            tags=[CONSCIOUSNESS_TAG, "pattern-score"],
        )

    def _get_alpha(self, data: dict) -> float:
        """Get EWMA alpha based on warm-up status."""
        if data["tested_session_count"] < _WARMUP_SESSIONS:
            return _WARMUP_ALPHA
        return _STANDARD_ALPHA
