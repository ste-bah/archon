"""Appraisal engine, state classifier, and turn valence computation.

Implements Scherer's Component Process Model (4-check appraisal),
weighted multi-signal state classification (6 categories), and
turn-level valence for session mood tracking.

All 3 public functions are pure — stateless, deterministic given
same inputs. Weights reference constants from personality_constants.

TASK-PER-003 | PRD-ARCHON-CON-002 | FR-PER-002, FR-PER-003, FR-PER-048
GUARD-PER-001: No "feel" language in code.
GUARD-PER-002: No LLM confidence self-query.
"""

from dataclasses import dataclass
from typing import Any

from src.archon_consciousness.personality.personality_constants import (
    AGENT_STATES,
    NEUTRAL_THRESHOLD,
)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  USER STATE HELPERS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def _user_frustrated_score(user_state: str) -> float:
    """Map v1 user emotional state to frustration signal [0, 1].

    Used by the frustrated state formula (FR-PER-003).
    """
    if user_state == "frustrated":
        return 1.0
    if user_state == "urgent":
        return 0.5
    return 0.0


def _user_in_flow_score(user_state: str) -> float:
    """Map v1 user emotional state to flow/engagement signal [0, 1].

    Used by the engaged state formula (FR-PER-003).
    """
    _FLOW_MAP = {
        "in_flow": 0.8,
        "exploring": 0.7,
        "neutral": 0.5,
        "confused": 0.3,
        "urgent": 0.2,
        "frustrated": 0.2,
    }
    return _FLOW_MAP.get(user_state, 0.2)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  STATE CLASSIFIER (FR-PER-003)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def compute_state_scores(
    signals: dict,
    collector: Any,
    task_context: str = "",
) -> dict[str, float]:
    """Compute weighted score for each of 5 non-neutral states.

    Uses exact weights from FR-PER-003. Each state's weights sum to 1.0.

    Args:
        signals: Dict with 12 keys from SignalCollector.collect().
        collector: SignalCollector instance (for helper functions).
        task_context: Current task description for novelty assessment.
            Empty string = no active task = novelty contributes 0.

    Returns:
        Dict mapping state name to score [0, 1] for 5 states.
    """
    correction_rate = signals["correction_rate"]
    plan_approval = signals["plan_approval_rate"]
    task_completion = signals["task_completion_rate"]
    past_success = signals["past_success_ratio"]
    user_state = signals["user_emotional_state"]

    return {
        "confident": (
            0.30 * task_completion
            + 0.25 * plan_approval
            + 0.20 * past_success
            + 0.15 * (1.0 - correction_rate)
            + 0.10 * collector.streak_bonus()
        ),
        "anxious": (
            0.35 * (1.0 - past_success)
            + 0.25 * correction_rate
            + 0.20 * collector.pattern_regression_score()
            + 0.20 * collector.streak_penalty()
        ),
        "frustrated": (
            0.30 * correction_rate
            + 0.25 * collector.streak_penalty()
            + 0.25 * _user_frustrated_score(user_state)
            + 0.20 * (1.0 - plan_approval)
        ),
        "engaged": (
            0.30 * collector.novelty_score(task_context)
            + 0.25 * plan_approval
            + 0.25 * _user_in_flow_score(user_state)
            + 0.20 * task_completion
        ),
        "cautious": (
            0.35 * collector.ambiguity_score()
            + 0.25 * collector.ambiguity_score()  # values_conflict uses same computation
            + 0.20 * (1.0 - past_success)
            + 0.20 * (1.0 if correction_rate > 0.3 else 0.0)
        ),
    }


def classify_state(scores: dict[str, float]) -> str:
    """Return the dominant state, or 'neutral' if all < NEUTRAL_THRESHOLD.

    FR-PER-003: threshold is 0.4. Scores >= 0.4 qualify as non-neutral.
    Winner-takes-all among qualifying states.
    """
    max_state = max(scores, key=scores.get)
    if scores[max_state] < NEUTRAL_THRESHOLD:
        return "neutral"
    return max_state


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  TURN VALENCE (FR-PER-048)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


def compute_turn_valence(scores: dict[str, float]) -> float:
    """Compute turn-level valence from state dimension scores.

    FR-PER-048:
        turn_valence = (confidence + engagement - anxiety - frustration - caution)
                       / max(sum_all_five, 0.01)

    Result is in [-1, 1]. This feeds the session-level mood EWMA
    (FR-PER-004) and is stored in AgentSelfState (FR-PER-008).
    """
    positive = scores["confident"] + scores["engaged"]
    negative = scores["anxious"] + scores["frustrated"] + scores["cautious"]
    total = positive + negative
    return (positive - negative) / max(total, 0.01)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  APPRAISAL ENGINE (FR-PER-002)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@dataclass(frozen=True)
class AppraisalVector:
    """Output of the 4-check Scherer CPM appraisal.

    All fields are computed from observable signals, never self-reported.
    """

    relevance: float    # [0, 1] — does this event affect the current task?
    implications: float # [-1, 1] — toward (+) or away (-) from goal?
    coping: float       # [0, 1] — are patterns/knowledge available?
    normative: float    # [0, 1] — does it align with values DAG?


class AppraisalEngine:
    """Scherer's Component Process Model adapted for agent context.

    4 sequential appraisal checks producing an AppraisalVector.
    All checks are rule-based (no LLM calls, GUARD-PER-002).
    The vector is stored for auditability but does not modify the
    state classifier weights (those are PRD-locked in FR-PER-003).

    FR-PER-002.
    """

    def appraise(self, signals: dict, collector: Any) -> AppraisalVector:
        """Run 4-check appraisal on current signals.

        Args:
            signals: Dict with 12 keys from SignalCollector.collect().
            collector: SignalCollector instance (for derived values).

        Returns:
            AppraisalVector with 4 computed dimensions.
        """
        relevance = self._check_relevance(signals)
        implications = self._check_implications(signals)
        coping = self._check_coping(signals, collector)
        normative = self._check_normative(signals)
        return AppraisalVector(
            relevance=relevance,
            implications=implications,
            coping=coping,
            normative=normative,
        )

    def _check_relevance(self, signals: dict) -> float:
        """Check 1: Does this event affect the current task?

        High when the session has active interactions. Low when idle.
        Uses total interaction count as proxy for task engagement.
        """
        interactions = (
            signals["correction_count"]
            + signals["consecutive_successes"]
            + signals["consecutive_corrections"]
        )
        total = signals.get("correction_count", 0)
        # Quick heuristic: more interactions = more relevance
        # Ramps from 0 to 1 over first 10 interactions
        raw = signals["correction_count"] + signals["consecutive_successes"]
        # Use correction_rate existence as proxy (if interactions > 0)
        if signals["correction_rate"] == 0.0 and signals["task_completion_rate"] == 0.0:
            # No corrections AND no task completions — either fresh or idle
            if signals["consecutive_successes"] == 0 and signals["consecutive_corrections"] == 0:
                return 0.0
        return min(1.0, (signals["correction_count"]
                         + signals["consecutive_successes"]
                         + signals["consecutive_corrections"]
                         + signals["values_violation_count"]) / 10.0)

    def _check_implications(self, signals: dict) -> float:
        """Check 2: Toward or away from goal?

        Positive when succeeding, negative when failing.
        """
        positive = signals["task_completion_rate"] + signals["plan_approval_rate"]
        negative = signals["correction_rate"] * 2  # corrections weigh more
        raw = (positive - negative) / max(positive + negative, 0.01)
        return max(-1.0, min(1.0, raw))

    def _check_coping(self, signals: dict, collector: Any) -> float:
        """Check 3: Are patterns/knowledge available in episodic memory?

        High when past success is high and pattern regression is low.
        """
        past_success = signals["past_success_ratio"]
        regression = collector.pattern_regression_score()
        return max(0.0, min(1.0, past_success * (1.0 - regression)))

    def _check_normative(self, signals: dict) -> float:
        """Check 4: Does this align with values DAG?

        High when no violations, decreasing with each violation.
        """
        violations = signals["values_violation_count"]
        return 1.0 / (1.0 + violations)
