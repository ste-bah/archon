"""Core personality type definitions: state snapshots and preference models.

4 dataclasses: AgentSelfState, OutcomeRecord, PreferenceEntry, TrustState.
These represent ongoing state (current snapshot or accumulated model).

For event/tracking types see types_events.py.

TASK-PER-001 | PRD-ARCHON-CON-002 v1.3
"""

import json
from dataclasses import dataclass
from datetime import datetime

from src.archon_consciousness.constants import CONSCIOUSNESS_TAG
from src.archon_consciousness.validation import (
    datetime_to_str,
    str_to_datetime,
    validate_datetime,
    validate_enum_str,
    validate_float_field,
    validate_int_field,
    validate_nonempty_str,
)

from src.archon_consciousness.personality.personality_constants import (
    AGENT_STATES,
    NODE_PREFIX_OUTCOME,
    NODE_PREFIX_PREFERENCE,
    NODE_PREFIX_SELF_STATE,
    NODE_PREFIX_TRUST_STATE,
    PERSONALITY_TAG,
    TRUST_DIMENSION_WEIGHTS,
    validate_beta_param,
    validate_dict_field,
    validate_signed_float,
)

# Re-export all constants so downstream code can still
# `from ...types import AGENT_STATES` etc.
from src.archon_consciousness.personality.personality_constants import *  # noqa: F401, F403


# ─── AgentSelfState (FR-PER-008) ──────────────────────────────────


@dataclass
class AgentSelfState:
    """Per-turn computed operational state snapshot.

    14 fields. Stored under NAMESPACE_SELF_STATE.
    """

    session_id: str
    turn_number: int
    timestamp: datetime
    confidence_score: float
    anxiety_score: float
    frustration_score: float
    engagement_score: float
    caution_score: float
    primary_state: str
    mood_valence: float
    mood_arousal: float
    signals_snapshot: dict
    somatic_marker_value: float
    somatic_marker_count: int

    def __post_init__(self):
        validate_nonempty_str(self.session_id, "session_id")
        validate_int_field(self.turn_number, "turn_number", min_val=0)
        validate_datetime(self.timestamp, "timestamp")
        validate_float_field(self.confidence_score, "confidence_score", 0.0, 1.0)
        validate_float_field(self.anxiety_score, "anxiety_score", 0.0, 1.0)
        validate_float_field(self.frustration_score, "frustration_score", 0.0, 1.0)
        validate_float_field(self.engagement_score, "engagement_score", 0.0, 1.0)
        validate_float_field(self.caution_score, "caution_score", 0.0, 1.0)
        validate_enum_str(self.primary_state, "primary_state", tuple(AGENT_STATES))
        validate_signed_float(self.mood_valence, "mood_valence", -1.0, 1.0)
        validate_float_field(self.mood_arousal, "mood_arousal", 0.0, 1.0)
        validate_dict_field(self.signals_snapshot, "signals_snapshot")
        validate_signed_float(self.somatic_marker_value, "somatic_marker_value", -1.0, 1.0)
        validate_int_field(self.somatic_marker_count, "somatic_marker_count", min_val=0)

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "turn_number": self.turn_number,
            "timestamp": datetime_to_str(self.timestamp),
            "confidence_score": self.confidence_score,
            "anxiety_score": self.anxiety_score,
            "frustration_score": self.frustration_score,
            "engagement_score": self.engagement_score,
            "caution_score": self.caution_score,
            "primary_state": self.primary_state,
            "mood_valence": self.mood_valence,
            "mood_arousal": self.mood_arousal,
            "signals_snapshot": dict(self.signals_snapshot),
            "somatic_marker_value": self.somatic_marker_value,
            "somatic_marker_count": self.somatic_marker_count,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AgentSelfState":
        return cls(
            session_id=d["session_id"],
            turn_number=d["turn_number"],
            timestamp=str_to_datetime(d["timestamp"]),
            confidence_score=d["confidence_score"],
            anxiety_score=d["anxiety_score"],
            frustration_score=d["frustration_score"],
            engagement_score=d["engagement_score"],
            caution_score=d["caution_score"],
            primary_state=d["primary_state"],
            mood_valence=d["mood_valence"],
            mood_arousal=d["mood_arousal"],
            signals_snapshot=d["signals_snapshot"],
            somatic_marker_value=d["somatic_marker_value"],
            somatic_marker_count=d["somatic_marker_count"],
        )

    def to_memorygraph_params(self) -> dict:
        return {
            "name": f"{NODE_PREFIX_SELF_STATE}-{self.session_id}-t{self.turn_number}",
            "memory_type": "AgentSelfState",
            "content": json.dumps(self.to_dict()),
            "importance": 0.3,
            "tags": [CONSCIOUSNESS_TAG, PERSONALITY_TAG, "self-state"],
        }


# ─── OutcomeRecord (FR-PER-015) ──────────────────────────────────


@dataclass
class OutcomeRecord:
    """Structured task outcome for preference engine.

    9 fields. Stored under NAMESPACE_OUTCOMES.
    """

    task_id: str
    timestamp: datetime
    context_key: str
    approach_used: str
    success: bool
    quality_score: float
    iterations: int
    user_feedback: str
    self_assessed_confidence: float

    def __post_init__(self):
        validate_nonempty_str(self.task_id, "task_id")
        validate_datetime(self.timestamp, "timestamp")
        validate_nonempty_str(self.context_key, "context_key")
        validate_nonempty_str(self.approach_used, "approach_used")
        if not isinstance(self.success, bool):
            raise TypeError(f"success must be bool, got {type(self.success).__name__}")
        validate_float_field(self.quality_score, "quality_score", 0.0, 1.0)
        validate_int_field(self.iterations, "iterations", min_val=1)
        if not isinstance(self.user_feedback, str):
            raise TypeError(f"user_feedback must be str, got {type(self.user_feedback).__name__}")
        validate_float_field(self.self_assessed_confidence, "self_assessed_confidence", 0.0, 1.0)

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "timestamp": datetime_to_str(self.timestamp),
            "context_key": self.context_key,
            "approach_used": self.approach_used,
            "success": self.success,
            "quality_score": self.quality_score,
            "iterations": self.iterations,
            "user_feedback": self.user_feedback,
            "self_assessed_confidence": self.self_assessed_confidence,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "OutcomeRecord":
        return cls(
            task_id=d["task_id"],
            timestamp=str_to_datetime(d["timestamp"]),
            context_key=d["context_key"],
            approach_used=d["approach_used"],
            success=d["success"],
            quality_score=d["quality_score"],
            iterations=d["iterations"],
            user_feedback=d.get("user_feedback", ""),
            self_assessed_confidence=d["self_assessed_confidence"],
        )

    def to_memorygraph_params(self) -> dict:
        return {
            "name": f"{NODE_PREFIX_OUTCOME}-{self.task_id}",
            "memory_type": "OutcomeRecord",
            "content": json.dumps(self.to_dict()),
            "importance": 0.5,
            "tags": [CONSCIOUSNESS_TAG, PERSONALITY_TAG, "outcome"],
        }


# ─── PreferenceEntry (FR-PER-009) ─────────────────────────────────


@dataclass
class PreferenceEntry:
    """Beta(alpha, beta) distribution per (approach, context_category) pair.

    6 stored fields + 2 computed properties. Stored under NAMESPACE_PREFERENCES.
    """

    approach: str
    context_category: str
    alpha: float
    beta: float
    last_used: datetime
    created_at: datetime

    def __post_init__(self):
        validate_nonempty_str(self.approach, "approach")
        validate_nonempty_str(self.context_category, "context_category")
        validate_beta_param(self.alpha, "alpha")
        validate_beta_param(self.beta, "beta")
        validate_datetime(self.last_used, "last_used")
        validate_datetime(self.created_at, "created_at")

    @property
    def evidence_count(self) -> int:
        """Derived: total observations = alpha + beta - 2 (prior is Beta(1,1))."""
        return int(self.alpha + self.beta - 2)

    @property
    def mean(self) -> float:
        """Beta distribution mean = alpha / (alpha + beta)."""
        return self.alpha / (self.alpha + self.beta)

    def to_dict(self) -> dict:
        return {
            "approach": self.approach,
            "context_category": self.context_category,
            "alpha": self.alpha,
            "beta": self.beta,
            "evidence_count": self.evidence_count,
            "last_used": datetime_to_str(self.last_used),
            "created_at": datetime_to_str(self.created_at),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "PreferenceEntry":
        return cls(
            approach=d["approach"],
            context_category=d["context_category"],
            alpha=d["alpha"],
            beta=d["beta"],
            last_used=str_to_datetime(d["last_used"]),
            created_at=str_to_datetime(d["created_at"]),
        )

    def to_memorygraph_params(self) -> dict:
        key = f"{self.approach}:{self.context_category}"
        return {
            "name": f"{NODE_PREFIX_PREFERENCE}-{key}",
            "memory_type": "PreferenceEntry",
            "content": json.dumps(self.to_dict()),
            "importance": 0.5,
            "tags": [CONSCIOUSNESS_TAG, PERSONALITY_TAG, "preference"],
        }


# ─── TrustState (FR-PER-017) ─────────────────────────────────────


@dataclass
class TrustState:
    """Three-dimension Bayesian trust model.

    10 stored fields + 4 computed properties. Stored under NAMESPACE_TRUST.
    """

    competence_alpha: float
    competence_beta: float
    integrity_alpha: float
    integrity_beta: float
    benevolence_alpha: float
    benevolence_beta: float
    session_count: int
    total_violations: int
    total_successes: int
    last_updated: datetime

    def __post_init__(self):
        validate_beta_param(self.competence_alpha, "competence_alpha")
        validate_beta_param(self.competence_beta, "competence_beta")
        validate_beta_param(self.integrity_alpha, "integrity_alpha")
        validate_beta_param(self.integrity_beta, "integrity_beta")
        validate_beta_param(self.benevolence_alpha, "benevolence_alpha")
        validate_beta_param(self.benevolence_beta, "benevolence_beta")
        validate_int_field(self.session_count, "session_count", min_val=0)
        validate_int_field(self.total_violations, "total_violations", min_val=0)
        validate_int_field(self.total_successes, "total_successes", min_val=0)
        validate_datetime(self.last_updated, "last_updated")

    @property
    def competence_trust(self) -> float:
        return self.competence_alpha / (self.competence_alpha + self.competence_beta)

    @property
    def integrity_trust(self) -> float:
        return self.integrity_alpha / (self.integrity_alpha + self.integrity_beta)

    @property
    def benevolence_trust(self) -> float:
        return self.benevolence_alpha / (self.benevolence_alpha + self.benevolence_beta)

    @property
    def overall_trust(self) -> float:
        """FR-PER-017: weighted sum across dimensions."""
        return (
            TRUST_DIMENSION_WEIGHTS["competence"] * self.competence_trust
            + TRUST_DIMENSION_WEIGHTS["integrity"] * self.integrity_trust
            + TRUST_DIMENSION_WEIGHTS["benevolence"] * self.benevolence_trust
        )

    def to_dict(self) -> dict:
        return {
            "competence_alpha": self.competence_alpha,
            "competence_beta": self.competence_beta,
            "integrity_alpha": self.integrity_alpha,
            "integrity_beta": self.integrity_beta,
            "benevolence_alpha": self.benevolence_alpha,
            "benevolence_beta": self.benevolence_beta,
            "session_count": self.session_count,
            "total_violations": self.total_violations,
            "total_successes": self.total_successes,
            "last_updated": datetime_to_str(self.last_updated),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TrustState":
        return cls(
            competence_alpha=d["competence_alpha"],
            competence_beta=d["competence_beta"],
            integrity_alpha=d["integrity_alpha"],
            integrity_beta=d["integrity_beta"],
            benevolence_alpha=d["benevolence_alpha"],
            benevolence_beta=d["benevolence_beta"],
            session_count=d["session_count"],
            total_violations=d["total_violations"],
            total_successes=d["total_successes"],
            last_updated=str_to_datetime(d["last_updated"]),
        )

    def to_memorygraph_params(self) -> dict:
        return {
            "name": f"{NODE_PREFIX_TRUST_STATE}-current",
            "memory_type": "TrustState",
            "content": json.dumps(self.to_dict()),
            "importance": 0.8,
            "tags": [CONSCIOUSNESS_TAG, PERSONALITY_TAG, "trust"],
        }
