"""Shared fixtures for personality subsystem tests.

Provides factory functions producing valid default instances of each
personality dataclass. Extends the parent conftest's MockMemoryGraph
and MockLanceDB fixtures.
"""

from datetime import datetime, timezone

import pytest


def make_agent_self_state(**overrides):
    """Factory for AgentSelfState with valid defaults."""
    from src.archon_consciousness.personality.types import AgentSelfState

    defaults = {
        "session_id": "session-001",
        "turn_number": 0,
        "timestamp": datetime.now(timezone.utc),
        "confidence_score": 0.5,
        "anxiety_score": 0.2,
        "frustration_score": 0.1,
        "engagement_score": 0.3,
        "caution_score": 0.15,
        "primary_state": "neutral",
        "mood_valence": 0.0,
        "mood_arousal": 0.3,
        "signals_snapshot": {"correction_count": 0, "correction_rate": 0.0},
        "somatic_marker_value": 0.0,
        "somatic_marker_count": 0,
    }
    defaults.update(overrides)
    return AgentSelfState(**defaults)


def make_outcome_record(**overrides):
    """Factory for OutcomeRecord with valid defaults."""
    from src.archon_consciousness.personality.types import OutcomeRecord

    defaults = {
        "task_id": "task-001",
        "timestamp": datetime.now(timezone.utc),
        "context_key": "debugging:backend:python",
        "approach_used": "tdd-first",
        "success": True,
        "quality_score": 0.8,
        "iterations": 1,
        "user_feedback": "",
        "self_assessed_confidence": 0.7,
    }
    defaults.update(overrides)
    return OutcomeRecord(**defaults)


def make_preference_entry(**overrides):
    """Factory for PreferenceEntry with valid defaults."""
    from src.archon_consciousness.personality.types import PreferenceEntry

    defaults = {
        "approach": "tdd-first",
        "context_category": "debugging:backend:python",
        "alpha": 3.0,
        "beta": 2.0,
        "last_used": datetime.now(timezone.utc),
        "created_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return PreferenceEntry(**defaults)


def make_trust_state(**overrides):
    """Factory for TrustState with valid defaults (initial priors)."""
    from src.archon_consciousness.personality.types import TrustState

    defaults = {
        "competence_alpha": 2.0,
        "competence_beta": 1.0,
        "integrity_alpha": 2.0,
        "integrity_beta": 1.0,
        "benevolence_alpha": 2.0,
        "benevolence_beta": 1.0,
        "session_count": 0,
        "total_violations": 0,
        "total_successes": 0,
        "last_updated": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    return TrustState(**defaults)


def make_trust_violation(**overrides):
    """Factory for TrustViolation with valid defaults."""
    from src.archon_consciousness.personality.types_events import TrustViolation

    defaults = {
        "violation_id": "v-001",
        "session_id": "session-001",
        "timestamp": datetime.now(timezone.utc),
        "violation_type": "factual_error",
        "dimension": "competence",
        "severity": 1.5,
        "description": "Incorrect function signature suggested",
        "repair_level": "explain",
        "repair_action": "Corrected the signature",
        "resolved": False,
    }
    defaults.update(overrides)
    return TrustViolation(**defaults)


def make_curiosity_encounter(**overrides):
    """Factory for CuriosityEncounter with valid defaults."""
    from src.archon_consciousness.personality.types_events import CuriosityEncounter

    defaults = {
        "encounter_id": "e-001",
        "session_id": "session-001",
        "timestamp": datetime.now(timezone.utc),
        "signal_type": "knowledge_gap",
        "topic": "HNSW index tuning",
        "confidence_at_flag": 0.3,
        "context_summary": "Encountered while optimizing vector search",
        "interest_score": 0.7,
        "study_sessions": 0,
        "compression_progress": 0.0,
        "suppressed": False,
    }
    defaults.update(overrides)
    return CuriosityEncounter(**defaults)


def make_interrupt_event(**overrides):
    """Factory for InterruptEvent with valid defaults."""
    from src.archon_consciousness.personality.types_events import InterruptEvent

    defaults = {
        "interrupt_id": "i-001",
        "session_id": "session-001",
        "turn_number": 5,
        "timestamp": datetime.now(timezone.utc),
        "channel": "fast",
        "trigger_type": "hard",
        "trigger_source": "episode_match",
        "composite_score": 0.0,
        "context_patch": "[METACOGNITIVE INTERRUPT: episode_match] Signal: similar failure",
        "external_signal": "episode-xyz matched at 0.91",
        "action_index": 5,
    }
    defaults.update(overrides)
    return InterruptEvent(**defaults)


def make_personality_trait_set(**overrides):
    """Factory for PersonalityTraitSet with valid defaults (seed values)."""
    from src.archon_consciousness.personality.types_events import PersonalityTraitSet

    defaults = {
        "openness_alpha": 3.5,
        "openness_beta": 2.0,
        "conscientiousness_alpha": 4.5,
        "conscientiousness_beta": 1.5,
        "extraversion_alpha": 1.5,
        "extraversion_beta": 3.5,
        "agreeableness_alpha": 2.0,
        "agreeableness_beta": 3.0,
        "neuroticism_alpha": 2.5,
        "neuroticism_beta": 2.5,
        "honesty_humility_alpha": 5.0,
        "honesty_humility_beta": 1.5,
        "session_count": 0,
        "last_updated": datetime.now(timezone.utc),
        "last_narrative": "",
        "last_narrative_session": 0,
    }
    defaults.update(overrides)
    return PersonalityTraitSet(**defaults)
