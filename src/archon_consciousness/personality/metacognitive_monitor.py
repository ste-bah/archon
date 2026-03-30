"""Metacognitive monitor — slow channel + interrupt controller.

Combines fast channel signals with confidence trajectory tracking
to produce event-driven metacognitive interrupts. Rate-limited.

TASK-PER-011 | PRD-ARCHON-CON-002 | FR-PER-035/036/037/038/039/040
GUARD-PER-007: Interrupts never modify files or execute tools.
FR-PER-039: Never run scheduled/periodic reflection.
FR-PER-040: Confidence alone cannot trigger interrupt.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from src.archon_consciousness.constants import CONSCIOUSNESS_TAG
from src.archon_consciousness.personality.fast_channel import FastChannel
from src.archon_consciousness.personality.personality_constants import (
    EPISODE_SIMILARITY_THRESHOLD,
    INTERRUPT_ESCALATED_THRESHOLD,
    INTERRUPT_MAX_PER_WINDOW,
    INTERRUPT_SOFT_THRESHOLD,
    NODE_PREFIX_INTERRUPT,
    PERSONALITY_TAG,
)
from src.archon_consciousness.personality.types_events import InterruptEvent

logger = logging.getLogger(__name__)


def generate_context_patch(trigger_source: str, detail: str) -> str:
    """FR-PER-038: lightweight context patch. Returns string, NO side effects.

    Max ~500 chars / ~150 tokens. Never user-facing.
    """
    detail_truncated = detail[:200] if detail else "unknown"
    return (
        f"[METACOGNITIVE INTERRUPT: {trigger_source}] "
        f"Signal: {detail_truncated} "
        f"Recommended: Pause and verify before proceeding."
    )


class SlowChannel:
    """FR-PER-035: confidence trajectory tracker.

    EWMA confidence score (alpha=0.3) updated per action.
    Fires trigger when: 3+ consecutive drops or absolute < 0.3.
    """

    def __init__(self):
        self._confidence_ewma: float = 0.5
        self._confidence_drops: int = 0
        self._last_confidence: float = 0.5

    def update_confidence(self, action_outcome_confidence: float) -> None:
        """Update EWMA and track consecutive drops."""
        self._confidence_ewma = (
            0.3 * action_outcome_confidence + 0.7 * self._confidence_ewma
        )
        if self._confidence_ewma < self._last_confidence:
            self._confidence_drops += 1
        else:
            self._confidence_drops = 0
        self._last_confidence = self._confidence_ewma

    @property
    def should_trigger(self) -> bool:
        """3+ consecutive drops or absolute < 0.3."""
        return self._confidence_drops >= 3 or self._confidence_ewma < 0.3


class MetacognitiveMonitor:
    """Orchestrates fast + slow channels with rate-limited interrupts.

    FR-PER-036: hard triggers (any one fires) + soft triggers (composite > threshold).
    FR-PER-037: max 3 interrupts per 20 actions, threshold escalation.
    FR-PER-040: confidence alone cannot trigger (must have external signal).

    Args:
        fast: FastChannel instance.
        client: MemoryGraph backend for interrupt storage.
        session_id: Current session identifier.
    """

    def __init__(self, fast: FastChannel, client: Any, session_id: str):
        self._fast = fast
        self._client = client
        self._session_id = session_id
        self._slow = SlowChannel()
        self._action_count: int = 0
        self._interrupt_count: int = 0
        self._threshold: float = INTERRUPT_SOFT_THRESHOLD  # 0.6

    def on_pre_action(
        self,
        action_type: str,
        target: str,
        error_msg: str = "",
    ) -> str | None:
        """Called before every tool call. Returns context patch or None.

        Runs fast channel checks. Hard triggers fire immediately.
        """
        self._action_count += 1
        result = self._fast.check(action_type, target, error_msg)

        # Hard triggers (FR-PER-036): any one fires
        if result.episode_similarity > EPISODE_SIMILARITY_THRESHOLD:
            return self._fire_interrupt(
                "episode_match", result.episode_match or "matched episode",
            )
        if result.rule_violation:
            return self._fire_interrupt("rule_violation", result.rule_violation)
        if result.anomaly_type == "revert_cycle":
            return self._fire_interrupt("revert_cycle", "revert-edit-revert detected")

        return None

    def on_phase_boundary(
        self,
        action_outcome_confidence: float,
        recent_error_count: int,
    ) -> str | None:
        """Called at natural breakpoints. Checks slow channel + soft triggers."""
        self._slow.update_confidence(action_outcome_confidence)

        # Compute soft composite (FR-PER-036)
        confidence_component = (1 - self._slow._confidence_ewma) * 0.4
        error_component = min(1.0, recent_error_count / 3) * 0.15
        confidence_drops_component = min(1.0, self._slow._confidence_drops / 3) * 0.15

        # Action anomaly from recent window
        anomaly_score = 0.0
        if self._fast._window:
            errors = [a[2] for a in self._fast._window
                      if a[2] not in ("success", "pending", "")]
            if errors:
                anomaly_score = 0.3

        composite = (
            anomaly_score
            + confidence_component
            + error_component
            + confidence_drops_component
        )

        # FR-PER-040: MUST have at least one non-confidence external signal
        has_external = (
            anomaly_score > 0
            or error_component > 0
            or recent_error_count > 0
        )

        if composite > self._threshold and has_external:
            return self._fire_interrupt(
                "soft_composite", f"composite={composite:.2f}",
            )
        return None

    def _fire_interrupt(self, trigger_source: str, detail: str) -> str | None:
        """Rate-limited interrupt firing (FR-PER-037)."""
        if self._interrupt_count >= INTERRUPT_MAX_PER_WINDOW:
            return None  # suppressed

        self._interrupt_count += 1

        # Escalate threshold after reaching max
        if self._interrupt_count >= INTERRUPT_MAX_PER_WINDOW:
            self._threshold = INTERRUPT_ESCALATED_THRESHOLD

        # Generate context patch (FR-PER-038)
        patch = generate_context_patch(trigger_source, detail)

        # Determine channel and trigger type
        is_hard = trigger_source in ("episode_match", "rule_violation", "revert_cycle")

        # Store interrupt event
        event = InterruptEvent(
            interrupt_id=str(uuid.uuid4()),
            session_id=self._session_id,
            turn_number=self._action_count,
            timestamp=datetime.now(timezone.utc),
            channel="fast" if is_hard else "slow",
            trigger_type="hard" if is_hard else "soft",
            trigger_source=trigger_source,
            composite_score=0.0,
            context_patch=patch[:500],
            external_signal=detail[:200],
            action_index=self._action_count,
        )
        self._store_interrupt(event)
        return patch

    def reset_phase(self) -> None:
        """Reset rate limiter at phase boundary (FR-PER-037)."""
        self._action_count = 0
        self._interrupt_count = 0
        self._threshold = INTERRUPT_SOFT_THRESHOLD

    def _store_interrupt(self, event: InterruptEvent) -> None:
        """Persist interrupt event to MemoryGraph."""
        params = event.to_memorygraph_params()
        try:
            self._client.store_memory(
                name=params["name"],
                memory_type=params["memory_type"],
                content=params["content"],
                importance=params["importance"],
                tags=params["tags"],
            )
        except Exception:
            logger.warning("Failed to store InterruptEvent: %s", event.interrupt_id)
