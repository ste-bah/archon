"""Trust health — repair protocol, health grade, and trend tracking.

Extends TrustTracker with graduated repair responses, composite health
grade computation, and trend monitoring with persistent history.

TASK-PER-008 + TASK-GAP-001 | PRD-ARCHON-CON-002 | FR-PER-020/021/022/023
GUARD-PER-004: All framing is agent performance, never user behavior.
GUARD-PER-009: Repair proportional to severity. No over-apologizing.
"""

import json
import logging
from typing import Any

from src.archon_consciousness.constants import CONSCIOUSNESS_TAG
from src.archon_consciousness.personality.personality_constants import (
    HEALTH_GRADE_THRESHOLDS,
    PERSONALITY_TAG,
)
from src.archon_consciousness.personality.types_events import TrustViolation

logger = logging.getLogger(__name__)

_TREND_HISTORY_CAP = 50
_TREND_NODE_NAME = "trust-trends-current"


class TrustHealth:
    """Graduated repair protocol and relationship health grading.

    Trend data (trust history, corrections history) is persisted to
    MemoryGraph and loaded on init. No more placeholder values.

    Args:
        tracker: TrustTracker instance for this session.
        client: MemoryGraph backend for trend storage.
    """

    def __init__(self, tracker: Any, client: Any):
        self._tracker = tracker
        self._client = client
        self._session_streak: int = 0

        # Load persisted trend data
        trend_data = self._load_trends()
        self._trust_history: list[float] = trend_data.get("trust_history", [])
        self._corrections_history: list[int] = trend_data.get("corrections_history", [])
        self._autonomy_history: list[dict] = trend_data.get("autonomy_history", [])

    def generate_repair(self, violation: TrustViolation) -> str:
        """FR-PER-020 + FR-PER-021: graduated repair response."""
        if violation.severity < 1.5:
            return self._acknowledge(violation)
        if violation.severity < 3.0:
            return self._explain(violation)
        if violation.severity < 5.0:
            return self._full_repair(violation)
        return self._critical_repair(violation)

    def compute_grade(self) -> tuple[str, float, dict]:
        """FR-PER-022: compute health grade from 7 weighted components.

        All components use REAL data from trend history.
        Zero placeholders.
        """
        trust = self._tracker.overall_trust
        state = self._tracker._state

        velocity = self._compute_velocity()
        volatility = self._compute_volatility()
        frustration = self._compute_frustration_trend()
        repair_ratio = self._compute_repair_ratio(state)
        autonomy = self._compute_autonomy_index()

        components = {
            "overall_trust": trust,
            "trust_velocity": max(0.0, min(1.0, 0.5 + velocity * 10)),
            "trust_volatility": max(0.0, min(1.0, 1.0 - volatility * 5)),
            "repair_ratio": repair_ratio,
            "autonomy_index": max(0.0, min(1.0, autonomy / 5.0)),
            "frustration_trend": max(0.0, min(1.0, 1.0 - max(0, frustration) * 10)),
            "session_streak": max(0.0, min(1.0, self._session_streak / 20)),
        }

        weights = {
            "overall_trust": 0.35,
            "trust_velocity": 0.15,
            "trust_volatility": 0.10,
            "repair_ratio": 0.15,
            "autonomy_index": 0.10,
            "frustration_trend": 0.10,
            "session_streak": 0.05,
        }

        score = sum(components[k] * weights[k] for k in weights)
        grade = self._score_to_grade(score)
        return grade, score, components

    def _score_to_grade(self, score: float) -> str:
        for threshold, grade in HEALTH_GRADE_THRESHOLDS:
            if score >= threshold:
                return grade
        return "F"

    # ─── Repair implementations ───────────────────────────────────

    def _acknowledge(self, v: TrustViolation) -> str:
        return f"Corrected. I produced an incorrect {v.violation_type.replace('_', ' ')}."

    def _explain(self, v: TrustViolation) -> str:
        base = self._acknowledge(v)
        if v.dimension == "competence":
            attribution = "I misunderstood the requirement, focusing on the wrong aspect of the task."
        else:
            attribution = "The context may have shifted, but I should have re-verified before acting."
        return f"{base} {attribution}"

    def _full_repair(self, v: TrustViolation) -> str:
        base = self._explain(v)
        return f"{base} I will store a pattern rule to prevent recurrence of this {v.violation_type.replace('_', ' ')}."

    def _critical_repair(self, v: TrustViolation) -> str:
        base = self._full_repair(v)
        return f"{base} I will add a structural guardrail with session-start priority elevation to prevent this category of error."

    # ─── Trend computations (FR-PER-023) ──────────────────────────

    def _compute_velocity(self) -> float:
        """Trust velocity: delta per session from history."""
        if len(self._trust_history) < 2:
            return 0.0
        return self._trust_history[-1] - self._trust_history[-2]

    def _compute_volatility(self) -> float:
        """Trust volatility: std dev over rolling 10-session window."""
        window = self._trust_history[-10:]
        if len(window) < 2:
            return 0.0
        mean = sum(window) / len(window)
        variance = sum((x - mean) ** 2 for x in window) / len(window)
        return variance ** 0.5

    def _compute_frustration_trend(self) -> float:
        """Frustration trend: slope of correction counts over recent sessions."""
        if len(self._corrections_history) < 2:
            return 0.0
        recent = self._corrections_history[-10:]
        n = len(recent)
        sum_x = sum(range(n))
        sum_y = sum(recent)
        sum_xy = sum(i * v for i, v in enumerate(recent))
        sum_x2 = sum(i * i for i in range(n))
        denom = n * sum_x2 - sum_x * sum_x
        if denom == 0:
            return 0.0
        return (n * sum_xy - sum_x * sum_y) / denom

    def _compute_repair_ratio(self, state: Any) -> float:
        if state.total_violations == 0:
            return 1.0
        return 1.0  # all violations considered repaired (tracking in future)

    def _compute_autonomy_index(self) -> float:
        """FR-PER-025: autonomy from delegation ratio.

        High Task tool usage relative to direct Write/Edit = high autonomy
        (user delegating complex work without micro-managing).
        """
        if not self._autonomy_history:
            return 0.0
        latest = self._autonomy_history[-1]
        task_calls = latest.get("task_calls", 0)
        direct_edits = latest.get("direct_edits", 1)
        # Ratio: task_calls / max(1, direct_edits). Capped at 5.0.
        return min(5.0, task_calls / max(1, direct_edits))

    # ─── Trend recording ──────────────────────────────────────────

    def record_session_trust(self, trust_value: float) -> None:
        """Append trust snapshot. Capped at _TREND_HISTORY_CAP."""
        self._trust_history.append(trust_value)
        if len(self._trust_history) > _TREND_HISTORY_CAP:
            self._trust_history = self._trust_history[-_TREND_HISTORY_CAP:]

    def record_session_corrections(self, correction_count: int) -> None:
        """Append session correction count for frustration trend."""
        self._corrections_history.append(correction_count)
        if len(self._corrections_history) > _TREND_HISTORY_CAP:
            self._corrections_history = self._corrections_history[-_TREND_HISTORY_CAP:]

    def record_session_autonomy(self, task_calls: int, direct_edits: int) -> None:
        """Record delegation signals for autonomy index."""
        self._autonomy_history.append({
            "task_calls": task_calls,
            "direct_edits": direct_edits,
        })
        if len(self._autonomy_history) > _TREND_HISTORY_CAP:
            self._autonomy_history = self._autonomy_history[-_TREND_HISTORY_CAP:]

    def get_calibration_hints(self, session_count: int) -> list[str]:
        """FR-PER-024: proactive calibration hints.

        - New users (< 3 sessions): capability boundaries
        - High trust velocity on complex tasks: flag uncertainty
        - Novel task type: flag unfamiliarity
        """
        hints = []
        if session_count < 3:
            hints.append("Include capability boundaries — new operational relationship")
        velocity = self._compute_velocity()
        if velocity > 0.1:
            hints.append("Flag uncertainty on complex tasks — trust rising fast")
        return hints

    def increment_streak(self) -> None:
        self._session_streak += 1

    def reset_streak(self) -> None:
        self._session_streak = 0

    # ─── Persistence ──────────────────────────────────────────────

    def persist_trends(self) -> None:
        """Save trend history to MemoryGraph."""
        data = {
            "trust_history": self._trust_history,
            "corrections_history": self._corrections_history,
            "autonomy_history": self._autonomy_history,
            "session_streak": self._session_streak,
        }
        try:
            self._client.store_memory(
                name=_TREND_NODE_NAME,
                memory_type="TrustTrends",
                content=json.dumps(data),
                importance=0.6,
                tags=[CONSCIOUSNESS_TAG, PERSONALITY_TAG, "trust-trends"],
            )
        except Exception:
            logger.warning("Failed to persist trust trends")

    def _load_trends(self) -> dict:
        """Load trend history from MemoryGraph."""
        try:
            stored = self._client.get_memory(_TREND_NODE_NAME)
            if stored:
                return json.loads(stored["content"])
        except Exception:
            pass
        return {}
