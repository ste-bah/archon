"""Event and tracking personality type definitions.

4 dataclasses: TrustViolation, CuriosityEncounter, InterruptEvent,
PersonalityTraitSet. These represent discrete events or accumulated
tracking records.

For core state types see types.py.

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
    CURIOSITY_SIGNAL_TYPES,
    INTERRUPT_CHANNELS,
    INTERRUPT_TRIGGER_TYPES,
    NODE_PREFIX_CURIOSITY,
    NODE_PREFIX_INTERRUPT,
    NODE_PREFIX_TRAIT_SET,
    NODE_PREFIX_TRUST_VIOLATION,
    PERSONALITY_TAG,
    PERSONALITY_TRAITS,
    REPAIR_LEVELS,
    TRIGGER_SOURCES,
    TRUST_DIMENSIONS,
    VIOLATION_TYPES,
    validate_beta_param,
    validate_bounded_str,
    validate_max_length_str,
    validate_positive_float,
    validate_signed_float,
)


# ─── TrustViolation (FR-PER-019) ─────────────────────────────────


@dataclass
class TrustViolation:
    """Classified trust violation with severity and repair tracking.

    10 fields. Stored under NAMESPACE_TRUST_VIOLATIONS.
    """

    violation_id: str
    session_id: str
    timestamp: datetime
    violation_type: str
    dimension: str
    severity: float
    description: str
    repair_level: str
    repair_action: str
    resolved: bool

    def __post_init__(self):
        validate_nonempty_str(self.violation_id, "violation_id")
        validate_nonempty_str(self.session_id, "session_id")
        validate_datetime(self.timestamp, "timestamp")
        validate_enum_str(self.violation_type, "violation_type", tuple(VIOLATION_TYPES))
        validate_enum_str(self.dimension, "dimension", tuple(TRUST_DIMENSIONS))
        validate_positive_float(self.severity, "severity")
        validate_max_length_str(self.description, "description", 500)
        validate_enum_str(self.repair_level, "repair_level", tuple(REPAIR_LEVELS))
        if not isinstance(self.repair_action, str):
            raise TypeError(f"repair_action must be str, got {type(self.repair_action).__name__}")
        if not isinstance(self.resolved, bool):
            raise TypeError(f"resolved must be bool, got {type(self.resolved).__name__}")

    def to_dict(self) -> dict:
        return {
            "violation_id": self.violation_id,
            "session_id": self.session_id,
            "timestamp": datetime_to_str(self.timestamp),
            "violation_type": self.violation_type,
            "dimension": self.dimension,
            "severity": self.severity,
            "description": self.description,
            "repair_level": self.repair_level,
            "repair_action": self.repair_action,
            "resolved": self.resolved,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TrustViolation":
        return cls(
            violation_id=d["violation_id"],
            session_id=d["session_id"],
            timestamp=str_to_datetime(d["timestamp"]),
            violation_type=d["violation_type"],
            dimension=d["dimension"],
            severity=d["severity"],
            description=d["description"],
            repair_level=d["repair_level"],
            repair_action=d.get("repair_action", ""),
            resolved=d.get("resolved", False),
        )

    def to_memorygraph_params(self) -> dict:
        return {
            "name": f"{NODE_PREFIX_TRUST_VIOLATION}-{self.violation_id}",
            "memory_type": "TrustViolation",
            "content": json.dumps(self.to_dict()),
            "importance": min(1.0, 0.5 + self.severity * 0.1),
            "tags": [CONSCIOUSNESS_TAG, PERSONALITY_TAG, "trust-violation"],
        }


# ─── CuriosityEncounter (FR-PER-026) ─────────────────────────────


@dataclass
class CuriosityEncounter:
    """Flagged knowledge gap or curiosity signal.

    11 fields. Stored under NAMESPACE_CURIOSITY_ENCOUNTERS.
    """

    encounter_id: str
    session_id: str
    timestamp: datetime
    signal_type: str
    topic: str
    confidence_at_flag: float
    context_summary: str
    interest_score: float
    study_sessions: int
    compression_progress: float
    suppressed: bool

    def __post_init__(self):
        validate_nonempty_str(self.encounter_id, "encounter_id")
        validate_nonempty_str(self.session_id, "session_id")
        validate_datetime(self.timestamp, "timestamp")
        validate_enum_str(self.signal_type, "signal_type", tuple(CURIOSITY_SIGNAL_TYPES))
        validate_max_length_str(self.topic, "topic", 200)
        validate_float_field(self.confidence_at_flag, "confidence_at_flag", 0.0, 1.0)
        validate_bounded_str(self.context_summary, "context_summary", 500)
        validate_float_field(self.interest_score, "interest_score", 0.0, 100.0)
        validate_int_field(self.study_sessions, "study_sessions", min_val=0)
        validate_signed_float(self.compression_progress, "compression_progress", -100.0, 100.0)
        if not isinstance(self.suppressed, bool):
            raise TypeError(f"suppressed must be bool, got {type(self.suppressed).__name__}")

    def to_dict(self) -> dict:
        return {
            "encounter_id": self.encounter_id,
            "session_id": self.session_id,
            "timestamp": datetime_to_str(self.timestamp),
            "signal_type": self.signal_type,
            "topic": self.topic,
            "confidence_at_flag": self.confidence_at_flag,
            "context_summary": self.context_summary,
            "interest_score": self.interest_score,
            "study_sessions": self.study_sessions,
            "compression_progress": self.compression_progress,
            "suppressed": self.suppressed,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "CuriosityEncounter":
        return cls(
            encounter_id=d["encounter_id"],
            session_id=d["session_id"],
            timestamp=str_to_datetime(d["timestamp"]),
            signal_type=d["signal_type"],
            topic=d["topic"],
            confidence_at_flag=d["confidence_at_flag"],
            context_summary=d.get("context_summary", ""),
            interest_score=d["interest_score"],
            study_sessions=d.get("study_sessions", 0),
            compression_progress=d.get("compression_progress", 0.0),
            suppressed=d.get("suppressed", False),
        )

    def to_memorygraph_params(self) -> dict:
        return {
            "name": f"{NODE_PREFIX_CURIOSITY}-{self.encounter_id}",
            "memory_type": "CuriosityEncounter",
            "content": json.dumps(self.to_dict()),
            "importance": min(1.0, self.interest_score),
            "tags": [CONSCIOUSNESS_TAG, PERSONALITY_TAG, "curiosity",
                     f"curiosity:{self.signal_type}"],
        }


# ─── InterruptEvent (FR-PER-038) ─────────────────────────────────


@dataclass
class InterruptEvent:
    """Metacognitive interrupt record.

    11 fields. Stored under NAMESPACE_METACOGNITION.
    """

    interrupt_id: str
    session_id: str
    turn_number: int
    timestamp: datetime
    channel: str
    trigger_type: str
    trigger_source: str
    composite_score: float
    context_patch: str
    external_signal: str
    action_index: int

    def __post_init__(self):
        validate_nonempty_str(self.interrupt_id, "interrupt_id")
        validate_nonempty_str(self.session_id, "session_id")
        validate_int_field(self.turn_number, "turn_number", min_val=0)
        validate_datetime(self.timestamp, "timestamp")
        validate_enum_str(self.channel, "channel", tuple(INTERRUPT_CHANNELS))
        validate_enum_str(self.trigger_type, "trigger_type", tuple(INTERRUPT_TRIGGER_TYPES))
        validate_enum_str(self.trigger_source, "trigger_source", tuple(TRIGGER_SOURCES))
        validate_float_field(self.composite_score, "composite_score", 0.0, 1.0)
        validate_bounded_str(self.context_patch, "context_patch", 500)
        if not isinstance(self.external_signal, str):
            raise TypeError(
                f"external_signal must be str, got {type(self.external_signal).__name__}")
        validate_int_field(self.action_index, "action_index", min_val=0)

    def to_dict(self) -> dict:
        return {
            "interrupt_id": self.interrupt_id,
            "session_id": self.session_id,
            "turn_number": self.turn_number,
            "timestamp": datetime_to_str(self.timestamp),
            "channel": self.channel,
            "trigger_type": self.trigger_type,
            "trigger_source": self.trigger_source,
            "composite_score": self.composite_score,
            "context_patch": self.context_patch,
            "external_signal": self.external_signal,
            "action_index": self.action_index,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "InterruptEvent":
        return cls(
            interrupt_id=d["interrupt_id"],
            session_id=d["session_id"],
            turn_number=d["turn_number"],
            timestamp=str_to_datetime(d["timestamp"]),
            channel=d["channel"],
            trigger_type=d["trigger_type"],
            trigger_source=d["trigger_source"],
            composite_score=d["composite_score"],
            context_patch=d["context_patch"],
            external_signal=d.get("external_signal", ""),
            action_index=d["action_index"],
        )

    def to_memorygraph_params(self) -> dict:
        return {
            "name": f"{NODE_PREFIX_INTERRUPT}-{self.interrupt_id}",
            "memory_type": "InterruptEvent",
            "content": json.dumps(self.to_dict()),
            "importance": 0.7,
            "tags": [CONSCIOUSNESS_TAG, PERSONALITY_TAG, "metacognition",
                     f"trigger:{self.trigger_source}"],
        }


# ─── PersonalityTraitSet (FR-PER-045) ────────────────────────────


@dataclass
class PersonalityTraitSet:
    """6-dimensional personality trait Beta distributions (OCEAN + HH).

    16 fields. Stored under NAMESPACE_TRAITS.
    """

    openness_alpha: float
    openness_beta: float
    conscientiousness_alpha: float
    conscientiousness_beta: float
    extraversion_alpha: float
    extraversion_beta: float
    agreeableness_alpha: float
    agreeableness_beta: float
    neuroticism_alpha: float
    neuroticism_beta: float
    honesty_humility_alpha: float
    honesty_humility_beta: float
    session_count: int
    last_updated: datetime
    last_narrative: str
    last_narrative_session: int

    def __post_init__(self):
        for trait in PERSONALITY_TRAITS:
            validate_beta_param(getattr(self, f"{trait}_alpha"), f"{trait}_alpha")
            validate_beta_param(getattr(self, f"{trait}_beta"), f"{trait}_beta")
        validate_int_field(self.session_count, "session_count", min_val=0)
        validate_datetime(self.last_updated, "last_updated")
        if not isinstance(self.last_narrative, str):
            raise TypeError(
                f"last_narrative must be str, got {type(self.last_narrative).__name__}")
        validate_int_field(self.last_narrative_session, "last_narrative_session", min_val=0)

    @property
    def trait_means(self) -> dict[str, float]:
        """Compute mean for each trait: alpha / (alpha + beta)."""
        return {
            trait: (
                getattr(self, f"{trait}_alpha")
                / (getattr(self, f"{trait}_alpha") + getattr(self, f"{trait}_beta"))
            )
            for trait in PERSONALITY_TRAITS
        }

    def to_dict(self) -> dict:
        d: dict = {}
        for trait in PERSONALITY_TRAITS:
            d[f"{trait}_alpha"] = getattr(self, f"{trait}_alpha")
            d[f"{trait}_beta"] = getattr(self, f"{trait}_beta")
        d["session_count"] = self.session_count
        d["last_updated"] = datetime_to_str(self.last_updated)
        d["last_narrative"] = self.last_narrative
        d["last_narrative_session"] = self.last_narrative_session
        d["trait_means"] = self.trait_means
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "PersonalityTraitSet":
        kwargs: dict = {}
        for trait in PERSONALITY_TRAITS:
            kwargs[f"{trait}_alpha"] = d[f"{trait}_alpha"]
            kwargs[f"{trait}_beta"] = d[f"{trait}_beta"]
        kwargs["session_count"] = d["session_count"]
        kwargs["last_updated"] = str_to_datetime(d["last_updated"])
        kwargs["last_narrative"] = d.get("last_narrative", "")
        kwargs["last_narrative_session"] = d.get("last_narrative_session", 0)
        return cls(**kwargs)

    def to_memorygraph_params(self) -> dict:
        return {
            "name": f"{NODE_PREFIX_TRAIT_SET}-current",
            "memory_type": "PersonalityTraitSet",
            "content": json.dumps(self.to_dict()),
            "importance": 0.8,
            "tags": [CONSCIOUSNESS_TAG, PERSONALITY_TAG, "traits"],
        }
