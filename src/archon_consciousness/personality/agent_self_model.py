"""Agent Self-Model orchestrator — the core of the operational state system.

Ties together signal collection, appraisal, state classification, mood
tracking, somatic markers, dampening, behavior hints, and MemoryGraph
storage into a single process_turn() method.

TASK-PER-004 | PRD-ARCHON-CON-002 | FR-PER-004/005/006/007/008
GUARD-PER-001: No "feel" language.
GUARD-PER-003: No unsolicited state disclosure.
"""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from src.archon_consciousness.personality.appraisal_engine import (
    AppraisalEngine,
    classify_state,
    compute_state_scores,
    compute_turn_valence,
)
from src.archon_consciousness.personality.personality_constants import (
    DAMPENING_FLOOR,
    DAMPENING_RATE,
    MOOD_EWMA_ALPHA,
    MOOD_THRESHOLD_ADJUSTMENT,
    SOMATIC_MIN_EPISODES,
)
from src.archon_consciousness.personality.signal_collector import SignalCollector
from src.archon_consciousness.personality.types import AgentSelfState

logger = logging.getLogger(__name__)

# ── Valence mapping for episode emotional_valence strings ─────────

_VALENCE_MAP = {
    "positive": 1.0,
    "negative": -1.0,
    "neutral": 0.0,
    "mixed": 0.0,
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  BEHAVIOR HINTS (FR-PER-006)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


@dataclass(frozen=True)
class BehaviorHints:
    """Structured behavioral modification hints derived from state.

    NO natural language — fields are constrained enum-like strings
    and booleans only. GUARD-PER-003 compliant.
    """

    validation_level: str       # "normal" | "extra" | "maximum"
    response_verbosity: str     # "concise" | "standard" | "detailed"
    exploration_mode: str       # "conservative" | "default" | "creative"
    should_present_options: bool
    should_retrieve_episodes: bool
    should_verify_values: bool
    influence_weight: float     # [0.5, 1.0] after dampening


# FR-PER-006: state-to-behavior mapping table
STATE_BEHAVIOR_MAP = {
    "confident": BehaviorHints(
        "normal", "concise", "default", False, False, False, 1.0),
    "anxious": BehaviorHints(
        "extra", "detailed", "conservative", True, True, False, 1.0),
    "frustrated": BehaviorHints(
        "maximum", "detailed", "conservative", True, True, True, 1.0),
    "engaged": BehaviorHints(
        "normal", "standard", "creative", True, False, False, 1.0),
    "cautious": BehaviorHints(
        "extra", "standard", "conservative", True, True, True, 1.0),
    "neutral": BehaviorHints(
        "normal", "standard", "default", False, False, False, 1.0),
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  AGENT SELF-MODEL
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


class AgentSelfModel:
    """Orchestrates per-turn operational state computation.

    Owns the session-scoped mood EWMA, dampening tracker, and somatic
    marker computation. Delegates signal collection to SignalCollector
    and state classification to AppraisalEngine.

    Args:
        collector: SignalCollector instance for this session.
        engine: AppraisalEngine instance.
        client: MemoryGraphClient for state persistence.
        lance: LanceDB backend for episode similarity (somatic markers).
    """

    def __init__(
        self,
        collector: SignalCollector,
        engine: AppraisalEngine,
        client: Any,
        lance: Any = None,
    ):
        self._collector = collector
        self._engine = engine
        self._client = client
        self._lance = lance

        # Session-scoped mood (FR-PER-004)
        self._mood_valence: float = 0.0

        # Dampening tracker (FR-PER-007)
        self._consecutive_state_count: int = 0
        self._last_state: str = "neutral"

        # Latest state for external access
        self.latest_state: AgentSelfState | None = None

    def process_turn(
        self,
        turn_number: int,
        session_id: str,
        task_context: str = "",
    ) -> tuple[AgentSelfState, BehaviorHints]:
        """Process a single turn through the full state pipeline.

        1. Collect signals
        2. Compute state scores (with task context for novelty)
        3. Apply mood bias (per-state thresholds)
        4. Classify state
        5. Compute turn valence
        6. Update mood EWMA
        7. Compute somatic marker
        8. Compute arousal
        9. Build AgentSelfState record
        10. Apply dampening + get behavior hints
        11. Store to MemoryGraph
        12. Return (state, hints)

        Returns:
            Tuple of (AgentSelfState, BehaviorHints).
        """
        # 1. Collect signals
        signals = self._collector.collect(task_context)

        # 2. Compute raw state scores
        raw_scores = compute_state_scores(signals, self._collector, task_context)

        # 3. Apply mood bias (FR-PER-004)
        biased_scores = self._apply_mood_bias(raw_scores)

        # 4. Classify state from biased scores
        primary_state = classify_state(biased_scores)

        # 5. Compute turn valence from RAW scores (not biased — FR-PER-048)
        turn_valence = compute_turn_valence(raw_scores)

        # 6. Update mood EWMA (FR-PER-004)
        self._mood_valence = (
            MOOD_EWMA_ALPHA * turn_valence
            + (1.0 - MOOD_EWMA_ALPHA) * self._mood_valence
        )

        # 7. Compute somatic marker (FR-PER-005)
        marker_value, marker_count = self._compute_somatic_marker(task_context)

        # 8. Compute arousal (magnitude of state activation)
        arousal = max(raw_scores.values()) if raw_scores else 0.0
        arousal = max(0.0, min(1.0, arousal))

        # 9. Build AgentSelfState record (FR-PER-008)
        state = AgentSelfState(
            session_id=session_id,
            turn_number=turn_number,
            timestamp=datetime.now(timezone.utc),
            confidence_score=raw_scores["confident"],
            anxiety_score=raw_scores["anxious"],
            frustration_score=raw_scores["frustrated"],
            engagement_score=raw_scores["engaged"],
            caution_score=raw_scores["cautious"],
            primary_state=primary_state,
            mood_valence=max(-1.0, min(1.0, self._mood_valence)),
            mood_arousal=arousal,
            signals_snapshot=signals,
            somatic_marker_value=marker_value,
            somatic_marker_count=marker_count,
        )

        # 10. Dampening + behavior hints (FR-PER-006 + FR-PER-007)
        hints = self._get_behavior_hints(primary_state)

        # 11. Store to MemoryGraph
        self._store_state(state)

        # 12. Track latest for external access
        self.latest_state = state

        return state, hints

    def _apply_mood_bias(self, scores: dict[str, float]) -> dict[str, float]:
        """FR-PER-004: per-state mood threshold modulation.

        Positive mood (valence > 0):
          - engagement, confident: +0.05 (easier to enter)
          - anxiety, frustrated: -0.05 (harder to enter)
        Negative mood (valence < 0):
          - anxiety, frustrated: +0.05
          - engagement, confident: -0.05
        Caution: NEVER modulated. Neutral threshold: unaffected.
        """
        adjusted = dict(scores)

        if self._mood_valence > 0:
            adjusted["confident"] = adjusted["confident"] + MOOD_THRESHOLD_ADJUSTMENT
            adjusted["engaged"] = adjusted["engaged"] + MOOD_THRESHOLD_ADJUSTMENT
            adjusted["anxious"] = adjusted["anxious"] - MOOD_THRESHOLD_ADJUSTMENT
            adjusted["frustrated"] = adjusted["frustrated"] - MOOD_THRESHOLD_ADJUSTMENT
        elif self._mood_valence < 0:
            adjusted["anxious"] = adjusted["anxious"] + MOOD_THRESHOLD_ADJUSTMENT
            adjusted["frustrated"] = adjusted["frustrated"] + MOOD_THRESHOLD_ADJUSTMENT
            adjusted["confident"] = adjusted["confident"] - MOOD_THRESHOLD_ADJUSTMENT
            adjusted["engaged"] = adjusted["engaged"] - MOOD_THRESHOLD_ADJUSTMENT
        # Caution: never modulated (stays as-is)

        # Clamp all to [0, 1]
        return {k: max(0.0, min(1.0, v)) for k, v in adjusted.items()}

    def _compute_somatic_marker(self, context: str) -> tuple[float, int]:
        """FR-PER-005: weighted average of similar episode emotional valences.

        Returns (marker_value, episode_count). marker_value is 0.0 if
        fewer than SOMATIC_MIN_EPISODES episodes found.
        """
        if not self._lance or not context:
            return 0.0, 0

        try:
            results = self._lance.search_similar(
                context, limit=20, collection="episodes",
            )
        except Exception:
            logger.warning("LanceDB search failed in somatic marker computation")
            return 0.0, 0

        if len(results) < SOMATIC_MIN_EPISODES:
            return 0.0, len(results)

        # Weighted average of valence using importance as weight
        total_weight = 0.0
        weighted_sum = 0.0
        for r in results:
            metadata = r.get("metadata", {})
            valence_str = metadata.get("emotional_valence", "neutral")
            valence_num = _VALENCE_MAP.get(valence_str, 0.0)
            importance = metadata.get("importance", 0.5)
            weight = max(0.01, importance)  # floor to prevent zero weight
            weighted_sum += valence_num * weight
            total_weight += weight

        if total_weight == 0:
            return 0.0, len(results)

        marker = weighted_sum / total_weight
        return max(-1.0, min(1.0, marker)), len(results)

    def _get_behavior_hints(self, state: str) -> BehaviorHints:
        """FR-PER-006 + FR-PER-007: behavior mapping with dampening.

        Tracks consecutive same-state turns. Each consecutive turn
        reduces influence by DAMPENING_RATE (10%). Floor at
        DAMPENING_FLOOR (50%). Resets on state change.
        """
        # Update dampening tracker
        if state == self._last_state:
            self._consecutive_state_count += 1
        else:
            self._consecutive_state_count = 1
            self._last_state = state

        # Compute dampened influence weight
        dampen_factor = max(
            DAMPENING_FLOOR,
            1.0 - DAMPENING_RATE * (self._consecutive_state_count - 1),
        )

        # Get base behavior for this state
        base = STATE_BEHAVIOR_MAP.get(state, STATE_BEHAVIOR_MAP["neutral"])

        return BehaviorHints(
            validation_level=base.validation_level,
            response_verbosity=base.response_verbosity,
            exploration_mode=base.exploration_mode,
            should_present_options=base.should_present_options,
            should_retrieve_episodes=base.should_retrieve_episodes,
            should_verify_values=base.should_verify_values,
            influence_weight=dampen_factor,
        )

    def _store_state(self, state: AgentSelfState) -> None:
        """Persist AgentSelfState to MemoryGraph."""
        params = state.to_memorygraph_params()
        try:
            self._client.store_memory(
                name=params["name"],
                memory_type=params["memory_type"],
                content=params["content"],
                importance=params["importance"],
                tags=params["tags"],
            )
        except Exception:
            logger.warning("Failed to store AgentSelfState to MemoryGraph")
