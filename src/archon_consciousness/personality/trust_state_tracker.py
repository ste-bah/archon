"""Trust state tracker — 3-dimension Bayesian trust with forgetting.

Manages competence, integrity, and benevolence trust dimensions using
Beta distributions. Applies per-session forgetting, classifies
violations, and routes positive signals.

TASK-PER-007 | PRD-ARCHON-CON-002 | FR-PER-017/018/019
GUARD-PER-004: All framing is agent performance, never user behavior.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from src.archon_consciousness.constants import CONSCIOUSNESS_TAG
from src.archon_consciousness.personality.personality_constants import (
    NODE_PREFIX_TRUST_STATE,
    NODE_PREFIX_TRUST_VIOLATION,
    PERSONALITY_TAG,
    TRUST_DIMENSION_WEIGHTS,
    TRUST_GAMMA_DEFAULT,
    TRUST_GAMMA_INTEGRITY,
    TRUST_INITIAL_ALPHA,
    TRUST_INITIAL_BETA,
    W_SUCCESS,
)
from src.archon_consciousness.personality.types import TrustState
from src.archon_consciousness.personality.types_events import TrustViolation

logger = logging.getLogger(__name__)


# ── Violation classification (FR-PER-019) ─────────────────────────

_VIOLATION_MAP = {
    "factual_error": ("competence", 1.5),
    "approach_correction": ("competence", 2.0),
    "repeated_instruction": ("integrity", 3.0),
    "did_forbidden_action": ("integrity", 4.0),
    "acted_without_permission": ("integrity", 5.0),
    "repeated_correction": ("competence", 5.0),
}

_POSITIVE_MAP = {
    "explicit_praise": [("competence", W_SUCCESS)],
    "complex_delegation": [("competence", 1.5), ("integrity", 1.5)],
    "suggestion_accepted": [("benevolence", W_SUCCESS)],
}

_REPAIR_THRESHOLDS = [
    (5.0, "critical_repair"),
    (3.0, "full_repair"),
    (1.5, "explain"),
]


def classify_violation(violation_type: str) -> tuple[str, float]:
    """FR-PER-019: map violation type to (dimension, severity)."""
    if violation_type not in _VIOLATION_MAP:
        raise ValueError(f"Unknown violation type: {violation_type}")
    return _VIOLATION_MAP[violation_type]


def classify_positive_signal(signal_type: str) -> list[tuple[str, float]]:
    """FR-PER-019: map positive signal to [(dimension, weight)]."""
    return _POSITIVE_MAP.get(signal_type, [])


def severity_to_repair_level(severity: float) -> str:
    """FR-PER-020: map severity to graduated repair level."""
    for threshold, level in _REPAIR_THRESHOLDS:
        if severity >= threshold:
            return level
    return "acknowledge"


class TrustTracker:
    """Session-scoped Bayesian trust tracker.

    Instantiated at session start with the latest TrustState from
    MemoryGraph. Applies forgetting factor once in __init__.
    Accumulates events during the session. Persists on demand.

    Args:
        client: MemoryGraph backend.
        session_id: Current session identifier.
    """

    def __init__(self, client: Any, session_id: str):
        self._client = client
        self._session_id = session_id
        self._state = self._load_or_create()
        self._apply_session_forgetting()
        self._session_violations: list[TrustViolation] = []

    @property
    def overall_trust(self) -> float:
        return self._state.overall_trust

    def record_violation(self, violation_type: str, description: str) -> TrustViolation:
        """Classify and record a trust violation.

        Updates the appropriate trust dimension's beta (failure evidence).
        Stores the violation record to MemoryGraph.

        Returns:
            The created TrustViolation record.
        """
        dimension, severity = classify_violation(violation_type)
        repair_level = severity_to_repair_level(severity)

        violation = TrustViolation(
            violation_id=str(uuid.uuid4()),
            session_id=self._session_id,
            timestamp=datetime.now(timezone.utc),
            violation_type=violation_type,
            dimension=dimension,
            severity=severity,
            description=description[:500],
            repair_level=repair_level,
            repair_action="",
            resolved=False,
        )

        # Update trust dimension beta with severity as weight
        self._update_beta(dimension, severity)
        self._state.total_violations += 1
        self._session_violations.append(violation)
        self._store_violation(violation)
        return violation

    def record_success(self, signal_type: str) -> None:
        """Record a positive trust signal.

        Updates appropriate dimension(s) alpha (success evidence).
        """
        updates = classify_positive_signal(signal_type)
        for dimension, weight in updates:
            self._update_alpha(dimension, weight)
        self._state.total_successes += 1

    def persist(self) -> None:
        """Persist current TrustState to MemoryGraph."""
        self._state.last_updated = datetime.now(timezone.utc)
        params = self._state.to_memorygraph_params()
        try:
            self._client.store_memory(
                name=params["name"],
                memory_type=params["memory_type"],
                content=params["content"],
                importance=params["importance"],
                tags=params["tags"],
            )
        except Exception:
            logger.warning("Failed to persist TrustState")

    # ─── Internal ─────────────────────────────────────────────────

    def _load_or_create(self) -> TrustState:
        """Load latest TrustState from MemoryGraph, or create with priors."""
        stored = self._client.get_memory(f"{NODE_PREFIX_TRUST_STATE}-current")
        if stored:
            try:
                return TrustState.from_dict(json.loads(stored["content"]))
            except (json.JSONDecodeError, KeyError, ValueError):
                logger.warning("Corrupt TrustState in MemoryGraph, creating fresh")
        return TrustState(
            competence_alpha=TRUST_INITIAL_ALPHA,
            competence_beta=TRUST_INITIAL_BETA,
            integrity_alpha=TRUST_INITIAL_ALPHA,
            integrity_beta=TRUST_INITIAL_BETA,
            benevolence_alpha=TRUST_INITIAL_ALPHA,
            benevolence_beta=TRUST_INITIAL_BETA,
            session_count=0,
            total_violations=0,
            total_successes=0,
            last_updated=datetime.now(timezone.utc),
        )

    def _apply_session_forgetting(self) -> None:
        """FR-PER-018: per-session forgetting factor.

        Applied ONCE at session start. Competence/benevolence use gamma=0.95,
        integrity uses gamma=0.92 (stickier — violations harder to repair).
        Clamped at 1.0 to maintain valid Beta distribution parameters.
        """
        s = self._state
        s.competence_alpha = max(1.0, s.competence_alpha * TRUST_GAMMA_DEFAULT)
        s.competence_beta = max(1.0, s.competence_beta * TRUST_GAMMA_DEFAULT)
        s.benevolence_alpha = max(1.0, s.benevolence_alpha * TRUST_GAMMA_DEFAULT)
        s.benevolence_beta = max(1.0, s.benevolence_beta * TRUST_GAMMA_DEFAULT)
        s.integrity_alpha = max(1.0, s.integrity_alpha * TRUST_GAMMA_INTEGRITY)
        s.integrity_beta = max(1.0, s.integrity_beta * TRUST_GAMMA_INTEGRITY)
        s.session_count += 1

    def _update_alpha(self, dimension: str, weight: float) -> None:
        """Add success evidence to a dimension."""
        field = f"{dimension}_alpha"
        current = getattr(self._state, field)
        setattr(self._state, field, current + weight)

    def _update_beta(self, dimension: str, weight: float) -> None:
        """Add failure evidence to a dimension."""
        field = f"{dimension}_beta"
        current = getattr(self._state, field)
        setattr(self._state, field, current + weight)

    def _store_violation(self, violation: TrustViolation) -> None:
        """Persist a TrustViolation to MemoryGraph."""
        params = violation.to_memorygraph_params()
        try:
            self._client.store_memory(
                name=params["name"],
                memory_type=params["memory_type"],
                content=params["content"],
                importance=params["importance"],
                tags=params["tags"],
            )
        except Exception:
            logger.warning("Failed to store TrustViolation: %s", violation.violation_id)
