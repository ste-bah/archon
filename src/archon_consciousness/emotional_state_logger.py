"""Emotional state transition logger.

Writes state transitions to MemoryGraph immediately (not batched).
State transitions are important enough to persist without delay.

Per FR-CON-008: log state transitions with timestamp, previous_state,
new_state, confidence, evidence.
"""

from datetime import datetime, timezone

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.schemas import EmotionalState


class EmotionalStateLogger:
    """Writes emotional state transitions to MemoryGraph.

    Unlike the SessionJournal, state transitions are written immediately
    (not batched) because they represent significant signal changes.

    Args:
        client: MemoryGraphClient for persistence.
    """

    def __init__(self, client: MemoryGraphClient):
        self._client = client

    def log_transition(
        self,
        previous_state: str,
        new_state: str,
        confidence: float,
        evidence: str,
    ) -> EmotionalState:
        """Log a state transition to MemoryGraph.

        Validates all fields via EmotionalState dataclass (fail-fast).
        Writes immediately — no batching.

        Args:
            previous_state: One of the 6 emotional states.
            new_state: One of the 6 emotional states.
            confidence: Classification confidence [0.0, 1.0].
            evidence: Text description of the signals that triggered the transition.

        Returns:
            The stored EmotionalState object.

        Raises:
            ValueError: If any field is invalid.
            TypeError: If confidence is bool or wrong type.
        """
        state = EmotionalState(
            timestamp=datetime.now(timezone.utc),
            previous_state=previous_state,
            new_state=new_state,
            confidence=confidence,
            evidence=evidence,
        )
        self._client.store_from_schema(state)
        return state
