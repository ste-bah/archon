"""Tests for personality type definitions and constants.

TDD test file — written BEFORE implementation.
Covers all 8 dataclasses, computed properties, validation guards,
constant spot-checks, and GUARD-PER-001 compliance.

TASK-PER-001 | PRD-ARCHON-CON-002
"""

import json
import math
from datetime import datetime, timezone

import pytest

from tests.archon_consciousness.personality.conftest import (
    make_agent_self_state,
    make_curiosity_encounter,
    make_interrupt_event,
    make_outcome_record,
    make_personality_trait_set,
    make_preference_entry,
    make_trust_state,
    make_trust_violation,
)


# ─── AgentSelfState ───────────────────────────────────────────────


class TestAgentSelfState:
    """FR-PER-008: per-turn emotional state record."""

    def test_valid_construction(self):
        state = make_agent_self_state()
        assert state.session_id == "session-001"
        assert state.primary_state == "neutral"

    def test_to_dict_serializable(self):
        state = make_agent_self_state()
        d = state.to_dict()
        json.dumps(d)  # must not raise

    def test_roundtrip(self):
        from src.archon_consciousness.personality.types import AgentSelfState

        original = make_agent_self_state()
        d = original.to_dict()
        restored = AgentSelfState.from_dict(d)
        assert restored.session_id == original.session_id
        assert restored.turn_number == original.turn_number
        assert restored.primary_state == original.primary_state
        assert abs(restored.confidence_score - original.confidence_score) < 1e-9
        assert abs(restored.mood_valence - original.mood_valence) < 1e-9

    def test_to_memorygraph_params(self):
        state = make_agent_self_state()
        params = state.to_memorygraph_params()
        assert "name" in params
        assert params["name"].startswith("selfstate-")
        assert params["memory_type"] == "AgentSelfState"
        assert "archon-consciousness" in params["tags"]
        json.loads(params["content"])  # content must be valid JSON

    def test_reject_empty_session_id(self):
        with pytest.raises(ValueError):
            make_agent_self_state(session_id="")

    def test_reject_negative_turn_number(self):
        with pytest.raises(ValueError):
            make_agent_self_state(turn_number=-1)

    def test_reject_bool_turn_number(self):
        with pytest.raises(TypeError):
            make_agent_self_state(turn_number=True)

    def test_reject_confidence_above_one(self):
        with pytest.raises(ValueError):
            make_agent_self_state(confidence_score=1.1)

    def test_reject_confidence_below_zero(self):
        with pytest.raises(ValueError):
            make_agent_self_state(confidence_score=-0.1)

    def test_reject_nan_confidence(self):
        with pytest.raises(ValueError):
            make_agent_self_state(confidence_score=float("nan"))

    def test_reject_inf_anxiety(self):
        with pytest.raises(ValueError):
            make_agent_self_state(anxiety_score=float("inf"))

    def test_reject_invalid_primary_state(self):
        with pytest.raises(ValueError):
            make_agent_self_state(primary_state="happy")

    def test_mood_valence_range(self):
        # Valid at boundaries
        make_agent_self_state(mood_valence=-1.0)
        make_agent_self_state(mood_valence=1.0)

    def test_reject_mood_valence_out_of_range(self):
        with pytest.raises(ValueError):
            make_agent_self_state(mood_valence=-1.1)
        with pytest.raises(ValueError):
            make_agent_self_state(mood_valence=1.1)

    def test_reject_non_dict_signals_snapshot(self):
        with pytest.raises(TypeError):
            make_agent_self_state(signals_snapshot="not a dict")

    def test_somatic_marker_value_range(self):
        make_agent_self_state(somatic_marker_value=-1.0)
        make_agent_self_state(somatic_marker_value=1.0)

    def test_reject_negative_somatic_marker_count(self):
        with pytest.raises(ValueError):
            make_agent_self_state(somatic_marker_count=-1)

    def test_all_score_fields_clamped_zero_one(self):
        """All 5 dimension scores must be [0, 1]."""
        for field_name in ("confidence_score", "anxiety_score", "frustration_score",
                           "engagement_score", "caution_score"):
            with pytest.raises(ValueError):
                make_agent_self_state(**{field_name: -0.01})
            with pytest.raises(ValueError):
                make_agent_self_state(**{field_name: 1.01})


# ─── OutcomeRecord ────────────────────────────────────────────────


class TestOutcomeRecord:
    """FR-PER-015: task outcome for preference engine."""

    def test_valid_construction(self):
        rec = make_outcome_record()
        assert rec.task_id == "task-001"
        assert rec.success is True

    def test_roundtrip(self):
        from src.archon_consciousness.personality.types import OutcomeRecord

        original = make_outcome_record()
        d = original.to_dict()
        restored = OutcomeRecord.from_dict(d)
        assert restored.task_id == original.task_id
        assert restored.quality_score == original.quality_score

    def test_to_memorygraph_params(self):
        rec = make_outcome_record()
        params = rec.to_memorygraph_params()
        assert params["name"].startswith("outcome-")

    def test_reject_empty_task_id(self):
        with pytest.raises(ValueError):
            make_outcome_record(task_id="")

    def test_reject_empty_approach(self):
        with pytest.raises(ValueError):
            make_outcome_record(approach_used="")

    def test_reject_quality_score_out_of_range(self):
        with pytest.raises(ValueError):
            make_outcome_record(quality_score=1.1)
        with pytest.raises(ValueError):
            make_outcome_record(quality_score=-0.1)

    def test_reject_nan_quality(self):
        with pytest.raises(ValueError):
            make_outcome_record(quality_score=float("nan"))

    def test_reject_zero_iterations(self):
        with pytest.raises(ValueError):
            make_outcome_record(iterations=0)

    def test_reject_bool_iterations(self):
        with pytest.raises(TypeError):
            make_outcome_record(iterations=True)

    def test_confidence_range(self):
        make_outcome_record(self_assessed_confidence=0.0)
        make_outcome_record(self_assessed_confidence=1.0)


# ─── PreferenceEntry ──────────────────────────────────────────────


class TestPreferenceEntry:
    """FR-PER-009: Beta(alpha, beta) per approach/context."""

    def test_valid_construction(self):
        entry = make_preference_entry()
        assert entry.approach == "tdd-first"
        assert entry.alpha >= 1.0

    def test_evidence_count_property(self):
        entry = make_preference_entry(alpha=6.0, beta=3.0)
        assert entry.evidence_count == 7  # 6 + 3 - 2

    def test_evidence_count_initial(self):
        entry = make_preference_entry(alpha=1.0, beta=1.0)
        assert entry.evidence_count == 0

    def test_mean_property(self):
        entry = make_preference_entry(alpha=4.0, beta=2.0)
        assert abs(entry.mean - (4.0 / 6.0)) < 1e-9

    def test_roundtrip(self):
        from src.archon_consciousness.personality.types import PreferenceEntry

        original = make_preference_entry(alpha=5.5, beta=3.5)
        d = original.to_dict()
        restored = PreferenceEntry.from_dict(d)
        assert abs(restored.alpha - original.alpha) < 1e-9
        assert abs(restored.beta - original.beta) < 1e-9

    def test_to_memorygraph_params(self):
        entry = make_preference_entry()
        params = entry.to_memorygraph_params()
        assert params["name"].startswith("preference-")

    def test_reject_alpha_below_one(self):
        with pytest.raises(ValueError):
            make_preference_entry(alpha=0.9)

    def test_reject_beta_below_one(self):
        with pytest.raises(ValueError):
            make_preference_entry(beta=0.5)

    def test_reject_nan_alpha(self):
        with pytest.raises(ValueError):
            make_preference_entry(alpha=float("nan"))

    def test_reject_empty_approach(self):
        with pytest.raises(ValueError):
            make_preference_entry(approach="")

    def test_reject_empty_context(self):
        with pytest.raises(ValueError):
            make_preference_entry(context_category="")


# ─── TrustState ───────────────────────────────────────────────────


class TestTrustState:
    """FR-PER-017: three-dimension Bayesian trust model."""

    def test_valid_construction(self):
        ts = make_trust_state()
        assert ts.competence_alpha == 2.0
        assert ts.integrity_beta == 1.0

    def test_competence_trust(self):
        ts = make_trust_state(competence_alpha=2.0, competence_beta=1.0)
        assert abs(ts.competence_trust - (2.0 / 3.0)) < 1e-9

    def test_integrity_trust(self):
        ts = make_trust_state(integrity_alpha=4.0, integrity_beta=1.0)
        assert abs(ts.integrity_trust - 0.8) < 1e-9

    def test_benevolence_trust(self):
        ts = make_trust_state(benevolence_alpha=3.0, benevolence_beta=3.0)
        assert abs(ts.benevolence_trust - 0.5) < 1e-9

    def test_overall_trust_initial_priors(self):
        """EC-PER-001: initial Beta(2,1) -> mean 0.667 per dimension."""
        ts = make_trust_state()
        expected = 0.30 * (2 / 3) + 0.45 * (2 / 3) + 0.25 * (2 / 3)
        assert abs(ts.overall_trust - expected) < 1e-9
        assert abs(ts.overall_trust - 2 / 3) < 1e-9  # all same -> weighted = same

    def test_overall_trust_weights(self):
        """FR-PER-017: weights 0.30/0.45/0.25."""
        ts = make_trust_state(
            competence_alpha=10.0, competence_beta=1.0,   # ~0.909
            integrity_alpha=1.0, integrity_beta=10.0,     # ~0.091
            benevolence_alpha=5.0, benevolence_beta=5.0,  # 0.500
        )
        comp = 10.0 / 11.0
        integ = 1.0 / 11.0
        benev = 5.0 / 10.0
        expected = 0.30 * comp + 0.45 * integ + 0.25 * benev
        assert abs(ts.overall_trust - expected) < 1e-9

    def test_roundtrip(self):
        from src.archon_consciousness.personality.types import TrustState

        original = make_trust_state(competence_alpha=5.5, total_violations=3)
        d = original.to_dict()
        restored = TrustState.from_dict(d)
        assert abs(restored.competence_alpha - 5.5) < 1e-9
        assert restored.total_violations == 3

    def test_to_memorygraph_params(self):
        ts = make_trust_state()
        params = ts.to_memorygraph_params()
        assert params["name"].startswith("truststate-")

    def test_reject_alpha_below_one(self):
        with pytest.raises(ValueError):
            make_trust_state(competence_alpha=0.5)

    def test_reject_negative_violations(self):
        with pytest.raises(ValueError):
            make_trust_state(total_violations=-1)

    def test_reject_bool_session_count(self):
        with pytest.raises(TypeError):
            make_trust_state(session_count=True)


# ─── TrustViolation ──────────────────────────────────────────────


class TestTrustViolation:
    """FR-PER-019: classified violation record."""

    def test_valid_construction(self):
        v = make_trust_violation()
        assert v.dimension == "competence"
        assert v.severity == 1.5

    def test_roundtrip(self):
        from src.archon_consciousness.personality.types_events import TrustViolation

        original = make_trust_violation(severity=4.0, dimension="integrity")
        d = original.to_dict()
        restored = TrustViolation.from_dict(d)
        assert restored.dimension == "integrity"
        assert restored.severity == 4.0

    def test_to_memorygraph_params(self):
        v = make_trust_violation()
        params = v.to_memorygraph_params()
        assert params["name"].startswith("trustviol-")

    def test_reject_invalid_violation_type(self):
        with pytest.raises(ValueError):
            make_trust_violation(violation_type="unknown_type")

    def test_reject_invalid_dimension(self):
        with pytest.raises(ValueError):
            make_trust_violation(dimension="loyalty")

    def test_reject_zero_severity(self):
        with pytest.raises(ValueError):
            make_trust_violation(severity=0.0)

    def test_reject_negative_severity(self):
        with pytest.raises(ValueError):
            make_trust_violation(severity=-1.0)

    def test_reject_invalid_repair_level(self):
        with pytest.raises(ValueError):
            make_trust_violation(repair_level="grovel")

    def test_reject_empty_description(self):
        with pytest.raises(ValueError):
            make_trust_violation(description="")

    def test_description_max_length(self):
        """Description truncated or rejected at 500 chars."""
        long_desc = "x" * 501
        with pytest.raises(ValueError):
            make_trust_violation(description=long_desc)


# ─── CuriosityEncounter ──────────────────────────────────────────


class TestCuriosityEncounter:
    """FR-PER-026: flagged knowledge gap."""

    def test_valid_construction(self):
        enc = make_curiosity_encounter()
        assert enc.signal_type == "knowledge_gap"
        assert enc.suppressed is False

    def test_roundtrip(self):
        from src.archon_consciousness.personality.types_events import CuriosityEncounter

        original = make_curiosity_encounter(interest_score=0.95)
        d = original.to_dict()
        restored = CuriosityEncounter.from_dict(d)
        assert abs(restored.interest_score - 0.95) < 1e-9

    def test_to_memorygraph_params(self):
        enc = make_curiosity_encounter()
        params = enc.to_memorygraph_params()
        assert params["name"].startswith("curiosity-")

    def test_reject_invalid_signal_type(self):
        with pytest.raises(ValueError):
            make_curiosity_encounter(signal_type="boredom")

    def test_reject_empty_topic(self):
        with pytest.raises(ValueError):
            make_curiosity_encounter(topic="")

    def test_topic_max_length(self):
        with pytest.raises(ValueError):
            make_curiosity_encounter(topic="x" * 201)

    def test_context_max_length(self):
        with pytest.raises(ValueError):
            make_curiosity_encounter(context_summary="x" * 501)

    def test_reject_negative_study_sessions(self):
        with pytest.raises(ValueError):
            make_curiosity_encounter(study_sessions=-1)

    def test_confidence_at_flag_range(self):
        make_curiosity_encounter(confidence_at_flag=0.0)
        make_curiosity_encounter(confidence_at_flag=1.0)
        with pytest.raises(ValueError):
            make_curiosity_encounter(confidence_at_flag=1.1)


# ─── InterruptEvent ───────────────────────────────────────────────


class TestInterruptEvent:
    """FR-PER-038: metacognitive interrupt record."""

    def test_valid_construction(self):
        ie = make_interrupt_event()
        assert ie.channel == "fast"
        assert ie.trigger_type == "hard"

    def test_roundtrip(self):
        from src.archon_consciousness.personality.types_events import InterruptEvent

        original = make_interrupt_event(composite_score=0.75)
        d = original.to_dict()
        restored = InterruptEvent.from_dict(d)
        assert abs(restored.composite_score - 0.75) < 1e-9

    def test_to_memorygraph_params(self):
        ie = make_interrupt_event()
        params = ie.to_memorygraph_params()
        assert params["name"].startswith("interrupt-")

    def test_reject_invalid_channel(self):
        with pytest.raises(ValueError):
            make_interrupt_event(channel="turbo")

    def test_reject_invalid_trigger_type(self):
        with pytest.raises(ValueError):
            make_interrupt_event(trigger_type="maybe")

    def test_reject_invalid_trigger_source(self):
        with pytest.raises(ValueError):
            make_interrupt_event(trigger_source="gut_feeling")

    def test_context_patch_max_length(self):
        with pytest.raises(ValueError):
            make_interrupt_event(context_patch="x" * 501)

    def test_reject_negative_action_index(self):
        with pytest.raises(ValueError):
            make_interrupt_event(action_index=-1)

    def test_composite_score_range(self):
        make_interrupt_event(composite_score=0.0)
        make_interrupt_event(composite_score=1.0)
        with pytest.raises(ValueError):
            make_interrupt_event(composite_score=1.1)


# ─── PersonalityTraitSet ─────────────────────────────────────────


class TestPersonalityTraitSet:
    """FR-PER-045: OCEAN + Honesty-Humility Beta distributions."""

    def test_valid_construction(self):
        pts = make_personality_trait_set()
        assert pts.session_count == 0

    def test_trait_means_property(self):
        pts = make_personality_trait_set(
            openness_alpha=3.0, openness_beta=2.0,
            conscientiousness_alpha=4.0, conscientiousness_beta=1.5,
        )
        means = pts.trait_means
        assert len(means) == 6
        assert abs(means["openness"] - 0.6) < 1e-9
        assert abs(means["conscientiousness"] - (4.0 / 5.5)) < 1e-9

    def test_roundtrip(self):
        from src.archon_consciousness.personality.types_events import PersonalityTraitSet

        original = make_personality_trait_set(session_count=15, last_narrative="Test narrative")
        d = original.to_dict()
        restored = PersonalityTraitSet.from_dict(d)
        assert restored.session_count == 15
        assert restored.last_narrative == "Test narrative"

    def test_to_memorygraph_params(self):
        pts = make_personality_trait_set()
        params = pts.to_memorygraph_params()
        assert params["name"].startswith("traitset-")

    def test_reject_alpha_below_one(self):
        with pytest.raises(ValueError):
            make_personality_trait_set(openness_alpha=0.5)

    def test_reject_beta_below_one(self):
        with pytest.raises(ValueError):
            make_personality_trait_set(neuroticism_beta=0.9)

    def test_all_trait_alphas_validated(self):
        """Every trait alpha must be >= 1.0."""
        trait_alpha_fields = [
            "openness_alpha", "conscientiousness_alpha", "extraversion_alpha",
            "agreeableness_alpha", "neuroticism_alpha", "honesty_humility_alpha",
        ]
        for field_name in trait_alpha_fields:
            with pytest.raises(ValueError):
                make_personality_trait_set(**{field_name: 0.5})

    def test_all_trait_betas_validated(self):
        """Every trait beta must be >= 1.0."""
        trait_beta_fields = [
            "openness_beta", "conscientiousness_beta", "extraversion_beta",
            "agreeableness_beta", "neuroticism_beta", "honesty_humility_beta",
        ]
        for field_name in trait_beta_fields:
            with pytest.raises(ValueError):
                make_personality_trait_set(**{field_name: 0.5})

    def test_reject_negative_session_count(self):
        with pytest.raises(ValueError):
            make_personality_trait_set(session_count=-1)

    def test_narrative_can_be_empty(self):
        pts = make_personality_trait_set(last_narrative="")
        assert pts.last_narrative == ""


# ─── Constants Spot-Checks ────────────────────────────────────────


class TestConstants:
    """Verify critical constants match PRD values exactly."""

    def test_agent_states(self):
        from src.archon_consciousness.personality.types import AGENT_STATES

        expected = {"confident", "anxious", "frustrated", "engaged", "cautious", "neutral"}
        assert AGENT_STATES == frozenset(expected)

    def test_neutral_threshold(self):
        from src.archon_consciousness.personality.types import NEUTRAL_THRESHOLD

        assert NEUTRAL_THRESHOLD == 0.4

    def test_trust_dimension_weights(self):
        from src.archon_consciousness.personality.types import TRUST_DIMENSION_WEIGHTS

        assert TRUST_DIMENSION_WEIGHTS == {"competence": 0.30, "integrity": 0.45, "benevolence": 0.25}
        assert abs(sum(TRUST_DIMENSION_WEIGHTS.values()) - 1.0) < 1e-9

    def test_trust_gamma_values(self):
        from src.archon_consciousness.personality.types import (
            TRUST_GAMMA_DEFAULT,
            TRUST_GAMMA_INTEGRITY,
        )

        assert TRUST_GAMMA_DEFAULT == 0.95
        assert TRUST_GAMMA_INTEGRITY == 0.92

    def test_trust_asymmetric_weights(self):
        from src.archon_consciousness.personality.types import (
            W_FAILURE_MAJOR,
            W_FAILURE_MINOR,
            W_FAILURE_REPEAT,
            W_SUCCESS,
        )

        assert W_SUCCESS == 1.0
        assert W_FAILURE_MINOR == 1.5
        assert W_FAILURE_MAJOR == 3.0
        assert W_FAILURE_REPEAT == 5.0

    def test_preference_cold_start(self):
        from src.archon_consciousness.personality.types import PREFERENCE_COLD_START_THRESHOLD

        assert PREFERENCE_COLD_START_THRESHOLD == 5

    def test_preference_decay_lambda(self):
        from src.archon_consciousness.personality.types import PREFERENCE_DECAY_LAMBDA

        expected = 30.0 / math.log(2)
        assert abs(PREFERENCE_DECAY_LAMBDA - expected) < 0.1

    def test_episode_similarity_threshold(self):
        from src.archon_consciousness.personality.types import EPISODE_SIMILARITY_THRESHOLD

        assert EPISODE_SIMILARITY_THRESHOLD == 0.85

    def test_interrupt_limits(self):
        from src.archon_consciousness.personality.types import (
            INTERRUPT_ESCALATED_THRESHOLD,
            INTERRUPT_MAX_PER_WINDOW,
            INTERRUPT_SOFT_THRESHOLD,
            INTERRUPT_WINDOW_SIZE,
        )

        assert INTERRUPT_MAX_PER_WINDOW == 3
        assert INTERRUPT_WINDOW_SIZE == 20
        assert INTERRUPT_SOFT_THRESHOLD == 0.6
        assert INTERRUPT_ESCALATED_THRESHOLD == 0.8

    def test_personality_constants(self):
        from src.archon_consciousness.personality.types import (
            PERSONALITY_GAMMA,
            PERSONALITY_MAX_DELTA,
            PERSONALITY_NARRATIVE_INTERVAL,
            PERSONALITY_TRAITS,
        )

        assert PERSONALITY_GAMMA == 0.98
        assert PERSONALITY_MAX_DELTA == 0.05
        assert PERSONALITY_NARRATIVE_INTERVAL == 10
        assert len(PERSONALITY_TRAITS) == 6

    def test_dampening_constants(self):
        from src.archon_consciousness.personality.types import DAMPENING_FLOOR, DAMPENING_RATE

        assert DAMPENING_RATE == 0.10
        assert DAMPENING_FLOOR == 0.50

    def test_health_grade_thresholds_sorted(self):
        from src.archon_consciousness.personality.types import HEALTH_GRADE_THRESHOLDS

        scores = [t[0] for t in HEALTH_GRADE_THRESHOLDS]
        assert scores == sorted(scores, reverse=True)

    def test_curiosity_constants(self):
        from src.archon_consciousness.personality.types import (
            CURIOSITY_LEARN_BUDGET_FRACTION,
            CURIOSITY_MAX_PER_SESSION,
            CURIOSITY_SIGNAL_TYPES,
            CURIOSITY_SUPPRESSION_THRESHOLD,
        )

        assert CURIOSITY_MAX_PER_SESSION == 3
        assert CURIOSITY_LEARN_BUDGET_FRACTION == 0.20
        assert CURIOSITY_SUPPRESSION_THRESHOLD == 3
        assert len(CURIOSITY_SIGNAL_TYPES) == 5

    def test_namespace_strings_all_prefixed(self):
        from src.archon_consciousness.personality import types

        namespaces = [
            types.NAMESPACE_SELF_STATE,
            types.NAMESPACE_PREFERENCES,
            types.NAMESPACE_PREFERENCES_ARTICULATED,
            types.NAMESPACE_TRUST,
            types.NAMESPACE_TRUST_TRENDS,
            types.NAMESPACE_TRUST_VIOLATIONS,
            types.NAMESPACE_CURIOSITY_ENCOUNTERS,
            types.NAMESPACE_CURIOSITY_QUEUE,
            types.NAMESPACE_METACOGNITION,
            types.NAMESPACE_TRAITS,
            types.NAMESPACE_NARRATIVE,
            types.NAMESPACE_OUTCOMES,
        ]
        assert len(namespaces) == 12
        for ns in namespaces:
            assert isinstance(ns, str)
            assert ns.startswith("archon/personality/")
            assert len(ns) > len("archon/personality/")

    def test_somatic_min_episodes(self):
        from src.archon_consciousness.personality.types import SOMATIC_MIN_EPISODES

        assert SOMATIC_MIN_EPISODES == 5

    def test_mere_exposure_decay(self):
        from src.archon_consciousness.personality.types import MERE_EXPOSURE_DECAY

        assert MERE_EXPOSURE_DECAY == 0.999

    def test_preference_certainty_override(self):
        from src.archon_consciousness.personality.types import PREFERENCE_CERTAINTY_OVERRIDE

        assert PREFERENCE_CERTAINTY_OVERRIDE == 20

    def test_mood_ewma_alpha(self):
        from src.archon_consciousness.personality.types import MOOD_EWMA_ALPHA

        assert MOOD_EWMA_ALPHA == 0.3
