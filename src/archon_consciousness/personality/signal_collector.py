"""Behavioral signal collector for the agent emotional self-model.

Collects 12 observable behavioral signals from session counters and
v1 store reads. No LLM calls — all values are computed from observables.

Provides 5 helper functions for the appraisal engine (FR-PER-003):
streak_bonus, streak_penalty, pattern_regression_score, novelty_score,
ambiguity_score.

TASK-PER-002 | PRD-ARCHON-CON-002 | FR-PER-001
GUARD-PER-002: No codepath queries the LLM for confidence.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any

from src.archon_consciousness.constants import EMOTIONAL_STATES

logger = logging.getLogger(__name__)


def _safe_ratio(numerator: int, denominator: int) -> float:
    """Compute ratio, returning 0.0 when denominator is zero."""
    if denominator == 0:
        return 0.0
    return numerator / denominator


class SignalCollector:
    """Collects 12 behavioral signals from observable session data.

    Two data sources:
    1. Event-driven counters — incremented by hooks via record_*() methods
    2. Read-from-v1 — PatternTracker data in MemoryGraph, episodes in LanceDB

    Args:
        client: MemoryGraphClient for reading PatternScore nodes.
        lance: LanceDB backend for episode similarity search. Optional.
        session_start: Session start time. Defaults to now.
    """

    def __init__(
        self,
        client: Any,
        lance: Any = None,
        session_start: datetime | None = None,
    ):
        self._client = client
        self._lance = lance
        self._session_start = session_start or datetime.now(timezone.utc)

        # Session-scoped event counters
        self._corrections: int = 0
        self._total_interactions: int = 0
        self._plans_submitted: int = 0
        self._plans_approved: int = 0
        self._tasks_attempted: int = 0
        self._tasks_completed: int = 0
        self._values_violations: int = 0
        self._consecutive_successes: int = 0
        self._consecutive_corrections: int = 0
        self._unresolved_conflicts: int = 0
        self._total_conflicts: int = 0

        # User state (set by hook from v1 EmotionalStateDetector)
        self._user_emotional_state: str = "neutral"

    # ─── Event recording methods ──────────────────────────────────

    def record_correction(self) -> None:
        """Record a user correction. Increments correction counters,
        resets success streak."""
        self._corrections += 1
        self._total_interactions += 1
        self._consecutive_corrections += 1
        self._consecutive_successes = 0

    def record_success(self) -> None:
        """Record a successful action. Increments success streak,
        resets correction streak."""
        self._total_interactions += 1
        self._consecutive_successes += 1
        self._consecutive_corrections = 0

    def record_plan_submission(self, approved: bool) -> None:
        """Record a plan submission with approval result."""
        self._plans_submitted += 1
        if approved:
            self._plans_approved += 1

    def record_task_attempt(self, completed: bool) -> None:
        """Record a task attempt with completion result."""
        self._tasks_attempted += 1
        if completed:
            self._tasks_completed += 1

    def record_values_violation(self) -> None:
        """Record a values DAG violation in this session."""
        self._values_violations += 1

    def record_values_conflict(self, resolved: bool) -> None:
        """Record a values DAG conflict occurrence."""
        self._total_conflicts += 1
        if not resolved:
            self._unresolved_conflicts += 1

    def set_user_state(self, state: str) -> None:
        """Set the user's detected emotional state (from v1 detector).

        Raises:
            ValueError: If state is not a valid v1 emotional state.
        """
        if state not in EMOTIONAL_STATES:
            raise ValueError(
                f"Invalid user emotional state: '{state}'. "
                f"Must be one of {EMOTIONAL_STATES}"
            )
        self._user_emotional_state = state

    # ─── Signal collection ────────────────────────────────────────

    def collect(self, current_task_context: str = "") -> dict:
        """Snapshot all 12 behavioral signals. Returns a new dict each call.

        Args:
            current_task_context: Description of current task for episode
                similarity lookup. Optional.

        Returns:
            Dict with exactly 12 keys matching FR-PER-001 signal names.
        """
        return {
            "correction_count": self._corrections,
            "correction_rate": _safe_ratio(self._corrections, self._total_interactions),
            "plan_approval_rate": _safe_ratio(self._plans_approved, self._plans_submitted),
            "task_completion_rate": _safe_ratio(self._tasks_completed, self._tasks_attempted),
            "similar_task_history": self._compute_similar_task_history(current_task_context),
            "past_success_ratio": self._compute_past_success_ratio(current_task_context),
            "values_violation_count": self._values_violations,
            "session_duration": self._compute_session_duration(),
            "user_emotional_state": self._user_emotional_state,
            "pattern_score_trend": self._compute_pattern_score_trend(),
            "consecutive_successes": self._consecutive_successes,
            "consecutive_corrections": self._consecutive_corrections,
        }

    # ─── Helper functions for FR-PER-003 state classifier ────��────

    def streak_bonus(self) -> float:
        """FR-PER-003: min(1.0, consecutive_successes / 10)."""
        return min(1.0, self._consecutive_successes / 10)

    def streak_penalty(self) -> float:
        """FR-PER-003: min(1.0, consecutive_corrections / 5)."""
        return min(1.0, self._consecutive_corrections / 5)

    def pattern_regression_score(self) -> float:
        """FR-PER-003: count of regressing rules / total active rules.

        Reads PatternScore nodes from MemoryGraph. Returns 0.0 if no
        active rules exist.
        """
        all_scores = self._client.list_by_type("PatternScore")
        active_count = 0
        regressing_count = 0
        for mem in all_scores:
            try:
                data = json.loads(mem["content"])
            except (json.JSONDecodeError, KeyError):
                continue
            if data.get("status") != "active":
                continue
            active_count += 1
            if data.get("trend") == "regressing":
                regressing_count += 1
        return _safe_ratio(regressing_count, active_count)

    def novelty_score(self, current_task_context: str) -> float:
        """FR-PER-003: 1.0 - max_similarity from episodic retrieval.

        Returns 0.0 when no task context (no basis for assessment).
        Returns 1.0 when context exists but no episodes match or no lance.
        """
        if not current_task_context:
            return 0.0  # no basis for novelty assessment
        if not self._lance:
            return 1.0  # can't search, assume novel
        try:
            results = self._lance.search_similar(
                current_task_context, limit=1, collection="episodes",
            )
        except Exception:
            logger.warning("LanceDB search failed in novelty_score")
            return 1.0
        if not results:
            return 1.0
        max_similarity = results[0].get("relevance", 0.0)
        return max(0.0, 1.0 - max_similarity)

    def ambiguity_score(self) -> float:
        """FR-PER-003: unresolved_conflicts / max(1, total_conflicts)."""
        return _safe_ratio(self._unresolved_conflicts, max(1, self._total_conflicts))

    # ─── Internal computation methods ─────────────────────────────

    def _compute_session_duration(self) -> float:
        """Session duration in minutes since start."""
        delta = datetime.now(timezone.utc) - self._session_start
        return max(0.0, delta.total_seconds() / 60.0)

    def _compute_similar_task_history(self, context: str) -> float:
        """Max cosine similarity of current task to past episodes.

        Returns 0.0 if no lance backend or no context.
        """
        if not self._lance or not context:
            return 0.0
        try:
            results = self._lance.search_similar(
                context, limit=1, collection="episodes",
            )
        except Exception:
            return 0.0
        if not results:
            return 0.0
        return results[0].get("relevance", 0.0)

    def _compute_past_success_ratio(self, context: str) -> float:
        """Success ratio for similar tasks in episode store.

        Returns 0.0 if no lance backend, no context, or no episodes.
        """
        if not self._lance or not context:
            return 0.0
        try:
            results = self._lance.search_similar(
                context, limit=10, collection="episodes",
            )
        except Exception:
            return 0.0
        if not results:
            return 0.0
        successes = 0
        total = 0
        for r in results:
            outcome = r.get("metadata", {}).get("outcome")
            if outcome in ("positive", "negative"):
                total += 1
                if outcome == "positive":
                    successes += 1
        return _safe_ratio(successes, total)

    def _compute_pattern_score_trend(self) -> float:
        """Average pattern score trend slope across active rules.

        Positive = improving overall, negative = regressing overall.
        Returns 0.0 if no rules with score history.
        """
        all_scores = self._client.list_by_type("PatternScore")
        slopes = []
        for mem in all_scores:
            try:
                data = json.loads(mem["content"])
            except (json.JSONDecodeError, KeyError):
                continue
            if data.get("status") != "active":
                continue
            history = data.get("score_history", [])
            if len(history) < 2:
                continue
            slope = self._linear_slope(history)
            slopes.append(slope)
        if not slopes:
            return 0.0
        avg = sum(slopes) / len(slopes)
        return max(-1.0, min(1.0, avg))

    @staticmethod
    def _linear_slope(values: list[float]) -> float:
        """Least-squares linear regression slope."""
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
