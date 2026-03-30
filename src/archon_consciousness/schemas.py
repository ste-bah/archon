"""Schema dataclasses for all Archon Consciousness node types.

Each dataclass represents a MemoryGraph node label with:
- Typed fields with __post_init__ validation (fail-fast)
- to_dict() for JSON serialization
- from_dict() classmethod for deserialization
- to_memorygraph_params() for MCP store_memory calls

7 node types: Episode, PatternScore, ValuesNode, EmotionalState,
Reflection, Intent, SessionEvent.

Validation helpers are in validation.py (extracted for 500-line limit).
"""

import json
import math
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from src.archon_consciousness.constants import (
    CONFIDENCE_MAX,
    CONFIDENCE_MIN,
    CONSCIOUSNESS_TAG,
    EMOTIONAL_STATES,
    EMOTIONAL_VALENCES,
    EPISODE_KEYWORDS_MAX,
    EVENT_TYPES,
    IMPORTANCE_DEFAULT,
    IMPORTANCE_MAX,
    IMPORTANCE_MIN,
    INTENT_TIERS,
    NODE_PREFIX_EMOTIONAL_STATE,
    NODE_PREFIX_EPISODE,
    NODE_PREFIX_INTENT,
    NODE_PREFIX_PATTERN_SCORE,
    NODE_PREFIX_REFLECTION,
    NODE_PREFIX_SESSION_EVENT,
    NODE_PREFIX_VALUES_NODE,
    RULE_STATUSES,
    SCORE_MAX,
    SCORE_MIN,
    TIERS,
    TREND_CLASSIFICATIONS,
)
from src.archon_consciousness.validation import (
    datetime_to_str,
    str_to_datetime,
    validate_datetime,
    validate_enum_str,
    validate_float_field,
    validate_int_field,
    validate_nonempty_str,
    validate_rule_id,
    validate_str_list,
)


# ─── Episode ───────────────────────────────────────────────────────


@dataclass
class Episode:
    """A structured memory of a specific event.

    11 fields per PRD FR-CON-001.
    """

    timestamp: datetime
    trigger: str
    context: str
    action_taken: str
    outcome: str
    emotional_valence: str
    lesson_extracted: str
    keywords: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    occurrence_count: int = 1
    importance: float = IMPORTANCE_DEFAULT
    _id: str = field(default_factory=lambda: str(uuid.uuid4()), repr=False)

    def __post_init__(self):
        validate_datetime(self.timestamp, "timestamp")
        validate_nonempty_str(self.trigger, "trigger")
        validate_nonempty_str(self.context, "context")
        validate_nonempty_str(self.action_taken, "action_taken")
        validate_nonempty_str(self.outcome, "outcome")
        validate_enum_str(self.emotional_valence, "emotional_valence", EMOTIONAL_VALENCES)
        validate_nonempty_str(self.lesson_extracted, "lesson_extracted")
        validate_str_list(self.keywords, "keywords", max_len=EPISODE_KEYWORDS_MAX)
        validate_str_list(self.tags, "tags")
        validate_int_field(self.occurrence_count, "occurrence_count", min_val=1)
        validate_float_field(self.importance, "importance", IMPORTANCE_MIN, IMPORTANCE_MAX)

    def to_dict(self) -> dict:
        return {
            "id": self._id,
            "timestamp": datetime_to_str(self.timestamp),
            "trigger": self.trigger,
            "context": self.context,
            "action_taken": self.action_taken,
            "outcome": self.outcome,
            "emotional_valence": self.emotional_valence,
            "lesson_extracted": self.lesson_extracted,
            "keywords": list(self.keywords),
            "tags": list(self.tags),
            "occurrence_count": self.occurrence_count,
            "importance": self.importance,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Episode":
        return cls(
            timestamp=str_to_datetime(d["timestamp"]),
            trigger=d["trigger"],
            context=d["context"],
            action_taken=d["action_taken"],
            outcome=d["outcome"],
            emotional_valence=d["emotional_valence"],
            lesson_extracted=d["lesson_extracted"],
            keywords=d.get("keywords", []),
            tags=d.get("tags", []),
            occurrence_count=d.get("occurrence_count", 1),
            importance=d.get("importance", IMPORTANCE_DEFAULT),
            _id=d.get("id", str(uuid.uuid4())),
        )

    def to_memorygraph_params(self) -> dict:
        return {
            "name": f"{NODE_PREFIX_EPISODE}-{self._id}",
            "memory_type": "Episode",
            "content": json.dumps(self.to_dict()),
            "importance": self.importance,
            "tags": [CONSCIOUSNESS_TAG, "episode"],
        }


# ─── PatternScore ──────────────────────────────────────────────────


@dataclass
class PatternScore:
    """Per-rule compliance score tracked over time.

    Fields per PRD FR-CON-009, FR-CON-010.
    """

    rule_id: str
    score: float
    last_tested_session: Optional[str] = None
    tested_session_count: int = 0
    last_delta: Optional[float] = None
    trend: str = "insufficient_data"
    status: str = "active"

    def __post_init__(self):
        validate_rule_id(self.rule_id)
        validate_float_field(self.score, "score", SCORE_MIN, SCORE_MAX)
        validate_int_field(self.tested_session_count, "tested_session_count", min_val=0)
        validate_enum_str(self.trend, "trend", TREND_CLASSIFICATIONS)
        validate_enum_str(self.status, "status", RULE_STATUSES)
        if self.last_delta is not None:
            validate_float_field(self.last_delta, "last_delta", -1.0, 1.0)

    def to_dict(self) -> dict:
        return {
            "rule_id": self.rule_id,
            "score": self.score,
            "last_tested_session": self.last_tested_session,
            "tested_session_count": self.tested_session_count,
            "last_delta": self.last_delta,
            "trend": self.trend,
            "status": self.status,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "PatternScore":
        return cls(
            rule_id=d["rule_id"],
            score=d["score"],
            last_tested_session=d.get("last_tested_session"),
            tested_session_count=d.get("tested_session_count", 0),
            last_delta=d.get("last_delta"),
            trend=d.get("trend", "insufficient_data"),
            status=d.get("status", "active"),
        )

    def to_memorygraph_params(self) -> dict:
        return {
            "name": f"{NODE_PREFIX_PATTERN_SCORE}-{self.rule_id}",
            "memory_type": "PatternScore",
            "content": json.dumps(self.to_dict()),
            "importance": 0.5,
            "tags": [CONSCIOUSNESS_TAG, "pattern-score"],
        }


# ─── ValuesNode ────────────────────────────────────────────────────


@dataclass
class ValuesNode:
    """A behavioral rule node in the values DAG.

    Fields per PRD FR-CON-013, FR-CON-028.
    """

    rule_id: str
    rule_text: str
    tier: str
    status: str = "active"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self):
        validate_rule_id(self.rule_id)
        validate_nonempty_str(self.rule_text, "rule_text")
        validate_enum_str(self.tier, "tier", TIERS)
        validate_enum_str(self.status, "status", RULE_STATUSES)
        validate_datetime(self.created_at, "created_at")

    def to_dict(self) -> dict:
        return {
            "rule_id": self.rule_id,
            "rule_text": self.rule_text,
            "tier": self.tier,
            "status": self.status,
            "created_at": datetime_to_str(self.created_at),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ValuesNode":
        return cls(
            rule_id=d["rule_id"],
            rule_text=d["rule_text"],
            tier=d["tier"],
            status=d.get("status", "active"),
            created_at=str_to_datetime(d["created_at"]),
        )

    def to_memorygraph_params(self) -> dict:
        return {
            "name": f"{NODE_PREFIX_VALUES_NODE}-{self.rule_id}",
            "memory_type": "ValuesNode",
            "content": json.dumps(self.to_dict()),
            "importance": 0.8,
            "tags": [CONSCIOUSNESS_TAG, "values-node"],
        }


# ─── EmotionalState ────────────────────────────────────────────────


@dataclass
class EmotionalState:
    """A logged emotional state transition.

    Fields per PRD FR-CON-008.
    """

    timestamp: datetime
    previous_state: str
    new_state: str
    confidence: float
    evidence: str

    def __post_init__(self):
        validate_datetime(self.timestamp, "timestamp")
        validate_enum_str(self.previous_state, "previous_state", EMOTIONAL_STATES)
        validate_enum_str(self.new_state, "new_state", EMOTIONAL_STATES)
        validate_float_field(self.confidence, "confidence", CONFIDENCE_MIN, CONFIDENCE_MAX)
        validate_nonempty_str(self.evidence, "evidence")

    def to_dict(self) -> dict:
        return {
            "timestamp": datetime_to_str(self.timestamp),
            "previous_state": self.previous_state,
            "new_state": self.new_state,
            "confidence": self.confidence,
            "evidence": self.evidence,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "EmotionalState":
        return cls(
            timestamp=str_to_datetime(d["timestamp"]),
            previous_state=d["previous_state"],
            new_state=d["new_state"],
            confidence=d["confidence"],
            evidence=d["evidence"],
        )

    def to_memorygraph_params(self) -> dict:
        uid = str(uuid.uuid4())[:16]
        return {
            "name": f"{NODE_PREFIX_EMOTIONAL_STATE}-{uid}",
            "memory_type": "EmotionalState",
            "content": json.dumps(self.to_dict()),
            "importance": 0.3,
            "tags": [CONSCIOUSNESS_TAG, "emotional-state"],
        }


# ─── Reflection ────────────────────────────────────────────────────


@dataclass
class Reflection:
    """A session-end self-assessment.

    Fields per PRD FR-CON-017, FR-CON-018.
    """

    session_id: str
    duration: float
    partial: bool
    items: list[dict] = field(default_factory=list)

    def __post_init__(self):
        validate_nonempty_str(self.session_id, "session_id")
        if isinstance(self.duration, bool):
            raise TypeError("duration must be float, got bool")
        if not isinstance(self.duration, (int, float)):
            raise TypeError(f"duration must be float, got {type(self.duration).__name__}")
        if math.isnan(self.duration) or math.isinf(self.duration):
            raise ValueError(f"duration must be finite, got {self.duration}")
        if self.duration < 0:
            raise ValueError(f"duration must be >= 0, got {self.duration}")
        if not isinstance(self.partial, bool):
            raise TypeError(f"partial must be bool, got {type(self.partial).__name__}")
        if not isinstance(self.items, list):
            raise TypeError(f"items must be list, got {type(self.items).__name__}")
        for i, item in enumerate(self.items):
            if not isinstance(item, dict):
                raise TypeError(f"items[{i}] must be dict, got {type(item).__name__}")

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "duration": self.duration,
            "partial": self.partial,
            "items": list(self.items),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Reflection":
        return cls(
            session_id=d["session_id"],
            duration=d["duration"],
            partial=d["partial"],
            items=d.get("items", []),
        )

    def to_memorygraph_params(self) -> dict:
        return {
            "name": f"{NODE_PREFIX_REFLECTION}-{self.session_id}",
            "memory_type": "Reflection",
            "content": json.dumps(self.to_dict()),
            "importance": 0.7,
            "tags": [CONSCIOUSNESS_TAG, "reflection"],
        }


# ─── Intent ────────────────────────────────────────────────────────


@dataclass
class Intent:
    """An inferred user goal in the intent model.

    Fields per PRD FR-CON-021, FR-CON-022.
    """

    goal_id: str
    description: str
    tier: str  # "persistent" or "session"
    confidence: float
    status: str = "active"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self):
        validate_nonempty_str(self.goal_id, "goal_id")
        validate_nonempty_str(self.description, "description")
        validate_enum_str(self.tier, "tier", INTENT_TIERS)
        validate_float_field(self.confidence, "confidence", CONFIDENCE_MIN, CONFIDENCE_MAX)
        validate_enum_str(self.status, "status", RULE_STATUSES)
        validate_datetime(self.created_at, "created_at")

    def to_dict(self) -> dict:
        return {
            "goal_id": self.goal_id,
            "description": self.description,
            "tier": self.tier,
            "confidence": self.confidence,
            "status": self.status,
            "created_at": datetime_to_str(self.created_at),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Intent":
        return cls(
            goal_id=d["goal_id"],
            description=d["description"],
            tier=d["tier"],
            confidence=d["confidence"],
            status=d.get("status", "active"),
            created_at=str_to_datetime(d["created_at"]),
        )

    def to_memorygraph_params(self) -> dict:
        return {
            "name": f"{NODE_PREFIX_INTENT}-{self.goal_id}",
            "memory_type": "Intent",
            "content": json.dumps(self.to_dict()),
            "importance": 0.6,
            "tags": [CONSCIOUSNESS_TAG, "intent"],
        }


# ─── SessionEvent ──────────────────────────────────────────────────


@dataclass
class SessionEvent:
    """A key event logged during a session.

    Fields per PRD FR-CON-025.
    """

    session_id: str
    sequence_number: int
    event_type: str
    content: str
    timestamp: datetime

    def __post_init__(self):
        validate_nonempty_str(self.session_id, "session_id")
        validate_int_field(self.sequence_number, "sequence_number", min_val=0)
        validate_enum_str(self.event_type, "event_type", EVENT_TYPES)
        validate_nonempty_str(self.content, "content")
        validate_datetime(self.timestamp, "timestamp")

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "sequence_number": self.sequence_number,
            "event_type": self.event_type,
            "content": self.content,
            "timestamp": datetime_to_str(self.timestamp),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "SessionEvent":
        return cls(
            session_id=d["session_id"],
            sequence_number=d["sequence_number"],
            event_type=d["event_type"],
            content=d["content"],
            timestamp=str_to_datetime(d["timestamp"]),
        )

    def to_memorygraph_params(self) -> dict:
        return {
            "name": f"{NODE_PREFIX_SESSION_EVENT}-{self.session_id}-{self.sequence_number:04d}",
            "memory_type": "SessionEvent",
            "content": json.dumps(self.to_dict()),
            "importance": 0.3,
            "tags": [CONSCIOUSNESS_TAG, "session-event"],
        }
