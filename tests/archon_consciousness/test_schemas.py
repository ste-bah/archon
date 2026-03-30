"""Tests for Archon Consciousness schema dataclasses.

Tests validation, serialization, deserialization, and boundary
conditions for all 7 node types. Written BEFORE implementation (TDD).
"""

import json
import math
from datetime import datetime, timezone

import pytest

from src.archon_consciousness.constants import EDGE_TYPES, TIERS, EMOTIONAL_STATES, EVENT_TYPES
from src.archon_consciousness.schemas import (
    EmotionalState,
    Episode,
    Intent,
    PatternScore,
    Reflection,
    SessionEvent,
    ValuesNode,
)


# ─── Episode ───────────────────────────────────────────────────────


class TestConstants:
    """Verify constants match PRD-defined values."""

    def test_edge_types_match_prd(self):
        expected = {
            "STRICT_PRIORITY", "DEFEASIBLE_PRIORITY", "DEFEATS",
            "EVIDENCED_BY", "CONTRADICTED_BY", "SUPERSEDED_BY", "PINNED_BY",
        }
        assert set(EDGE_TYPES) == expected

    def test_tiers_match_prd(self):
        assert TIERS == ("safety", "ethics", "guidelines", "helpfulness")

    def test_emotional_states_match_prd(self):
        expected = {"frustrated", "exploring", "in_flow", "confused", "urgent", "neutral"}
        assert set(EMOTIONAL_STATES) == expected

    def test_event_types_match_prd(self):
        expected = {
            "correction", "decision", "state_change",
            "rule_applied", "novel_situation_encountered",
        }
        assert set(EVENT_TYPES) == expected


class TestEpisode:
    """Test Episode dataclass (11 fields)."""

    def _valid_episode(self, **overrides):
        defaults = {
            "timestamp": datetime(2026, 3, 28, 12, 0, 0, tzinfo=timezone.utc),
            "trigger": "User asked to implement without approval",
            "context": "Mid-session, pipeline was running",
            "action_taken": "Started implementing immediately",
            "outcome": "User corrected: always ask first",
            "emotional_valence": "negative",
            "lesson_extracted": "Always wait for explicit approval",
            "keywords": ["approval", "implement", "ask-first"],
            "tags": ["pipeline", "approval"],
            "occurrence_count": 1,
            "importance": 0.5,
        }
        defaults.update(overrides)
        return Episode(**defaults)

    def test_valid_construction(self):
        ep = self._valid_episode()
        assert ep.trigger == "User asked to implement without approval"
        assert ep.importance == 0.5
        assert ep.occurrence_count == 1

    def test_to_dict_round_trip(self):
        ep = self._valid_episode()
        d = ep.to_dict()
        ep2 = Episode.from_dict(d)
        assert ep2.trigger == ep.trigger
        assert ep2.importance == ep.importance
        assert ep2.keywords == ep.keywords
        assert ep2.tags == ep.tags

    def test_to_dict_json_serializable(self):
        ep = self._valid_episode()
        d = ep.to_dict()
        # Must not raise
        json_str = json.dumps(d)
        assert isinstance(json_str, str)

    def test_importance_min_boundary(self):
        ep = self._valid_episode(importance=0.0)
        assert ep.importance == 0.0

    def test_importance_max_boundary(self):
        ep = self._valid_episode(importance=1.0)
        assert ep.importance == 1.0

    def test_importance_below_min_raises(self):
        with pytest.raises(ValueError, match="importance"):
            self._valid_episode(importance=-0.1)

    def test_importance_above_max_raises(self):
        with pytest.raises(ValueError, match="importance"):
            self._valid_episode(importance=1.1)

    def test_importance_nan_raises(self):
        with pytest.raises(ValueError, match="importance"):
            self._valid_episode(importance=float("nan"))

    def test_importance_inf_raises(self):
        with pytest.raises(ValueError, match="importance"):
            self._valid_episode(importance=float("inf"))

    def test_importance_bool_raises(self):
        """bool is subclass of int in Python — must reject."""
        with pytest.raises(TypeError, match="importance"):
            self._valid_episode(importance=True)

    def test_occurrence_count_min(self):
        ep = self._valid_episode(occurrence_count=1)
        assert ep.occurrence_count == 1

    def test_occurrence_count_zero_raises(self):
        with pytest.raises(ValueError, match="occurrence_count"):
            self._valid_episode(occurrence_count=0)

    def test_occurrence_count_negative_raises(self):
        with pytest.raises(ValueError, match="occurrence_count"):
            self._valid_episode(occurrence_count=-1)

    def test_occurrence_count_bool_raises(self):
        with pytest.raises(TypeError, match="occurrence_count"):
            self._valid_episode(occurrence_count=True)

    def test_keywords_max_7(self):
        ep = self._valid_episode(keywords=["a", "b", "c", "d", "e", "f", "g"])
        assert len(ep.keywords) == 7

    def test_keywords_over_7_raises(self):
        with pytest.raises(ValueError, match="keywords"):
            self._valid_episode(keywords=["a"] * 8)

    def test_keywords_empty_allowed(self):
        """Fast-path stores empty keywords."""
        ep = self._valid_episode(keywords=[])
        assert ep.keywords == []

    def test_keywords_non_string_element_raises(self):
        with pytest.raises(TypeError, match="keywords"):
            self._valid_episode(keywords=["valid", 42])

    def test_tags_empty_allowed(self):
        ep = self._valid_episode(tags=[])
        assert ep.tags == []

    def test_tags_non_string_element_raises(self):
        with pytest.raises(TypeError, match="tags"):
            self._valid_episode(tags=["valid", None])

    def test_empty_trigger_raises(self):
        with pytest.raises(ValueError, match="trigger"):
            self._valid_episode(trigger="")

    def test_whitespace_only_trigger_raises(self):
        with pytest.raises(ValueError, match="trigger"):
            self._valid_episode(trigger="   ")

    def test_empty_context_raises(self):
        with pytest.raises(ValueError, match="context"):
            self._valid_episode(context="")

    def test_empty_lesson_extracted_raises(self):
        with pytest.raises(ValueError, match="lesson_extracted"):
            self._valid_episode(lesson_extracted="")

    def test_invalid_emotional_valence_raises(self):
        with pytest.raises(ValueError, match="emotional_valence"):
            self._valid_episode(emotional_valence="angry")

    def test_timestamp_not_datetime_raises(self):
        with pytest.raises(TypeError, match="timestamp"):
            self._valid_episode(timestamp="2026-03-28")

    def test_to_memorygraph_params(self):
        ep = self._valid_episode()
        params = ep.to_memorygraph_params()
        assert "name" in params
        assert params["name"].startswith("episode-")
        assert params["memory_type"] == "Episode"
        assert "archon-consciousness" in params["tags"]
        # Content should be JSON string
        content = json.loads(params["content"])
        assert content["trigger"] == ep.trigger


# ─── PatternScore ──────────────────────────────────────────────────


class TestPatternScore:
    """Test PatternScore dataclass."""

    def _valid_score(self, **overrides):
        defaults = {
            "rule_id": "ask-before-implementing",
            "score": 0.5,
            "last_tested_session": None,
            "tested_session_count": 0,
            "last_delta": None,
            "trend": "insufficient_data",
            "status": "active",
        }
        defaults.update(overrides)
        return PatternScore(**defaults)

    def test_valid_construction(self):
        ps = self._valid_score()
        assert ps.rule_id == "ask-before-implementing"
        assert ps.score == 0.5

    def test_to_dict_round_trip(self):
        ps = self._valid_score(score=0.73, tested_session_count=5)
        d = ps.to_dict()
        ps2 = PatternScore.from_dict(d)
        assert ps2.score == ps.score
        assert ps2.tested_session_count == ps.tested_session_count

    def test_score_min_boundary(self):
        ps = self._valid_score(score=0.0)
        assert ps.score == 0.0

    def test_score_max_boundary(self):
        ps = self._valid_score(score=1.0)
        assert ps.score == 1.0

    def test_score_below_min_raises(self):
        with pytest.raises(ValueError, match="score"):
            self._valid_score(score=-0.01)

    def test_score_above_max_raises(self):
        with pytest.raises(ValueError, match="score"):
            self._valid_score(score=1.01)

    def test_score_nan_raises(self):
        with pytest.raises(ValueError, match="score"):
            self._valid_score(score=float("nan"))

    def test_score_bool_raises(self):
        with pytest.raises(TypeError, match="score"):
            self._valid_score(score=True)

    def test_invalid_rule_id_uppercase_raises(self):
        with pytest.raises(ValueError, match="rule_id"):
            self._valid_score(rule_id="AskBefore")

    def test_invalid_rule_id_spaces_raises(self):
        with pytest.raises(ValueError, match="rule_id"):
            self._valid_score(rule_id="ask before")

    def test_invalid_rule_id_empty_raises(self):
        with pytest.raises(ValueError, match="rule_id"):
            self._valid_score(rule_id="")

    def test_invalid_rule_id_too_long_raises(self):
        with pytest.raises(ValueError, match="rule_id"):
            self._valid_score(rule_id="a" * 51)

    def test_invalid_status_raises(self):
        with pytest.raises(ValueError, match="status"):
            self._valid_score(status="deleted")

    def test_invalid_trend_raises(self):
        with pytest.raises(ValueError, match="trend"):
            self._valid_score(trend="unknown")

    def test_last_delta_nan_raises(self):
        with pytest.raises(ValueError, match="last_delta"):
            self._valid_score(last_delta=float("nan"))

    def test_last_delta_inf_raises(self):
        with pytest.raises(ValueError, match="last_delta"):
            self._valid_score(last_delta=float("inf"))

    def test_last_delta_out_of_range_raises(self):
        with pytest.raises(ValueError, match="last_delta"):
            self._valid_score(last_delta=1.5)

    def test_last_delta_valid(self):
        ps = self._valid_score(last_delta=-0.1)
        assert ps.last_delta == -0.1

    def test_tested_session_count_negative_raises(self):
        with pytest.raises(ValueError, match="tested_session_count"):
            self._valid_score(tested_session_count=-1)

    def test_to_memorygraph_params(self):
        ps = self._valid_score()
        params = ps.to_memorygraph_params()
        assert params["name"] == "patternscore-ask-before-implementing"
        assert params["memory_type"] == "PatternScore"


# ─── ValuesNode ────────────────────────────────────────────────────


class TestValuesNode:
    """Test ValuesNode dataclass."""

    def _valid_node(self, **overrides):
        defaults = {
            "rule_id": "no-echo-user-input",
            "rule_text": "Never echo user input in error messages",
            "tier": "safety",
            "status": "active",
            "created_at": datetime(2026, 3, 28, tzinfo=timezone.utc),
        }
        defaults.update(overrides)
        return ValuesNode(**defaults)

    def test_valid_construction(self):
        vn = self._valid_node()
        assert vn.tier == "safety"
        assert vn.status == "active"

    def test_to_dict_round_trip(self):
        vn = self._valid_node()
        d = vn.to_dict()
        vn2 = ValuesNode.from_dict(d)
        assert vn2.rule_id == vn.rule_id
        assert vn2.tier == vn.tier

    def test_invalid_tier_raises(self):
        with pytest.raises(ValueError, match="tier"):
            self._valid_node(tier="critical")

    def test_invalid_status_raises(self):
        with pytest.raises(ValueError, match="status"):
            self._valid_node(status="deleted")

    def test_empty_rule_text_raises(self):
        with pytest.raises(ValueError, match="rule_text"):
            self._valid_node(rule_text="")

    def test_invalid_rule_id_raises(self):
        with pytest.raises(ValueError, match="rule_id"):
            self._valid_node(rule_id="Has Spaces")

    def test_all_tiers_accepted(self):
        for tier in ("safety", "ethics", "guidelines", "helpfulness"):
            vn = self._valid_node(tier=tier)
            assert vn.tier == tier

    def test_all_statuses_accepted(self):
        for status in ("active", "archived", "deprecated"):
            vn = self._valid_node(status=status)
            assert vn.status == status

    def test_to_memorygraph_params(self):
        vn = self._valid_node()
        params = vn.to_memorygraph_params()
        assert params["name"] == "valuesnode-no-echo-user-input"
        assert params["memory_type"] == "ValuesNode"


# ─── EmotionalState ────────────────────────────────────────────────


class TestEmotionalState:
    """Test EmotionalState dataclass."""

    def _valid_state(self, **overrides):
        defaults = {
            "timestamp": datetime(2026, 3, 28, 12, 0, 0, tzinfo=timezone.utc),
            "previous_state": "neutral",
            "new_state": "frustrated",
            "confidence": 0.8,
            "evidence": "3 exclamation marks, 'wtf' keyword detected",
        }
        defaults.update(overrides)
        return EmotionalState(**defaults)

    def test_valid_construction(self):
        es = self._valid_state()
        assert es.new_state == "frustrated"

    def test_to_dict_round_trip(self):
        es = self._valid_state()
        d = es.to_dict()
        es2 = EmotionalState.from_dict(d)
        assert es2.new_state == es.new_state
        assert es2.confidence == es.confidence

    def test_invalid_previous_state_raises(self):
        with pytest.raises(ValueError, match="previous_state"):
            self._valid_state(previous_state="angry")

    def test_invalid_new_state_raises(self):
        with pytest.raises(ValueError, match="new_state"):
            self._valid_state(new_state="happy")

    def test_confidence_boundary_min(self):
        es = self._valid_state(confidence=0.0)
        assert es.confidence == 0.0

    def test_confidence_boundary_max(self):
        es = self._valid_state(confidence=1.0)
        assert es.confidence == 1.0

    def test_confidence_nan_raises(self):
        with pytest.raises(ValueError, match="confidence"):
            self._valid_state(confidence=float("nan"))

    def test_confidence_bool_raises(self):
        with pytest.raises(TypeError, match="confidence"):
            self._valid_state(confidence=False)

    def test_empty_evidence_raises(self):
        with pytest.raises(ValueError, match="evidence"):
            self._valid_state(evidence="")


# ─── Reflection ────────────────────────────────────────────────────


class TestReflection:
    """Test Reflection dataclass."""

    def _valid_reflection(self, **overrides):
        defaults = {
            "session_id": "session-abc-123",
            "duration": 1800.0,
            "partial": False,
            "items": [
                {"rule_id": "ask-before-implementing", "result": "followed",
                 "taxonomy": "correction"},
            ],
        }
        defaults.update(overrides)
        return Reflection(**defaults)

    def test_valid_construction(self):
        r = self._valid_reflection()
        assert r.session_id == "session-abc-123"
        assert r.partial is False

    def test_to_dict_round_trip(self):
        r = self._valid_reflection()
        d = r.to_dict()
        r2 = Reflection.from_dict(d)
        assert r2.session_id == r.session_id
        assert r2.items == r.items

    def test_empty_session_id_raises(self):
        with pytest.raises(ValueError, match="session_id"):
            self._valid_reflection(session_id="")

    def test_negative_duration_raises(self):
        with pytest.raises(ValueError, match="duration"):
            self._valid_reflection(duration=-1.0)

    def test_duration_nan_raises(self):
        with pytest.raises(ValueError, match="duration"):
            self._valid_reflection(duration=float("nan"))

    def test_partial_non_bool_raises(self):
        with pytest.raises(TypeError, match="partial"):
            self._valid_reflection(partial=1)

    def test_items_must_be_list(self):
        with pytest.raises(TypeError, match="items"):
            self._valid_reflection(items="not a list")

    def test_items_elements_must_be_dicts(self):
        with pytest.raises(TypeError, match="items"):
            self._valid_reflection(items=[42, "string"])

    def test_duration_zero_allowed(self):
        r = self._valid_reflection(duration=0.0)
        assert r.duration == 0.0


# ─── Intent ────────────────────────────────────────────────────────


class TestIntent:
    """Test Intent dataclass."""

    def _valid_intent(self, **overrides):
        defaults = {
            "goal_id": "high-test-coverage",
            "description": "Steven wants high test coverage because production bugs burned him",
            "tier": "persistent",
            "confidence": 0.7,
            "status": "active",
            "created_at": datetime(2026, 3, 28, tzinfo=timezone.utc),
        }
        defaults.update(overrides)
        return Intent(**defaults)

    def test_valid_construction(self):
        i = self._valid_intent()
        assert i.goal_id == "high-test-coverage"

    def test_to_dict_round_trip(self):
        i = self._valid_intent()
        d = i.to_dict()
        i2 = Intent.from_dict(d)
        assert i2.goal_id == i.goal_id
        assert i2.confidence == i.confidence

    def test_invalid_tier_raises(self):
        with pytest.raises(ValueError, match="tier"):
            self._valid_intent(tier="temporary")

    def test_session_tier_accepted(self):
        i = self._valid_intent(tier="session")
        assert i.tier == "session"

    def test_confidence_nan_raises(self):
        with pytest.raises(ValueError, match="confidence"):
            self._valid_intent(confidence=float("nan"))

    def test_confidence_bool_raises(self):
        with pytest.raises(TypeError, match="confidence"):
            self._valid_intent(confidence=True)

    def test_empty_description_raises(self):
        with pytest.raises(ValueError, match="description"):
            self._valid_intent(description="")


# ─── SessionEvent ──────────────────────────────────────────────────


class TestSessionEvent:
    """Test SessionEvent dataclass."""

    def _valid_event(self, **overrides):
        defaults = {
            "session_id": "session-abc-123",
            "sequence_number": 0,
            "event_type": "correction",
            "content": "User said: no, don't implement without asking",
            "timestamp": datetime(2026, 3, 28, 12, 5, 0, tzinfo=timezone.utc),
        }
        defaults.update(overrides)
        return SessionEvent(**defaults)

    def test_valid_construction(self):
        ev = self._valid_event()
        assert ev.event_type == "correction"
        assert ev.sequence_number == 0

    def test_to_dict_round_trip(self):
        ev = self._valid_event()
        d = ev.to_dict()
        ev2 = SessionEvent.from_dict(d)
        assert ev2.session_id == ev.session_id
        assert ev2.sequence_number == ev.sequence_number

    def test_all_event_types_accepted(self):
        for et in ("correction", "decision", "state_change",
                    "rule_applied", "novel_situation_encountered"):
            ev = self._valid_event(event_type=et)
            assert ev.event_type == et

    def test_invalid_event_type_raises(self):
        with pytest.raises(ValueError, match="event_type"):
            self._valid_event(event_type="unknown")

    def test_negative_sequence_number_raises(self):
        with pytest.raises(ValueError, match="sequence_number"):
            self._valid_event(sequence_number=-1)

    def test_sequence_number_bool_raises(self):
        with pytest.raises(TypeError, match="sequence_number"):
            self._valid_event(sequence_number=True)

    def test_empty_content_raises(self):
        with pytest.raises(ValueError, match="content"):
            self._valid_event(content="")

    def test_empty_session_id_raises(self):
        with pytest.raises(ValueError, match="session_id"):
            self._valid_event(session_id="")
