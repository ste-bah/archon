"""Tests for ContextDescriptor schema and matching logic.

Tests field validation, wildcard matching, null context, and
multi-field matching. Written BEFORE implementation (TDD).
"""

import pytest

from src.archon_consciousness.context_descriptor import (
    ContextDescriptor,
    context_matches,
)


class TestContextDescriptor:
    """Test ContextDescriptor construction and validation."""

    def test_valid_construction(self):
        cd = ContextDescriptor(mode="pipeline", user_state="neutral", task_type="coding")
        assert cd.mode == "pipeline"

    def test_any_mode_accepted(self):
        cd = ContextDescriptor(mode="any", user_state="any", task_type="any")
        assert cd.mode == "any"

    def test_all_modes_accepted(self):
        for mode in ("pipeline", "manual", "any"):
            cd = ContextDescriptor(mode=mode, user_state="any", task_type="any")
            assert cd.mode == mode

    def test_all_user_states_accepted(self):
        for state in ("frustrated", "exploring", "in_flow", "confused", "urgent", "neutral", "any"):
            cd = ContextDescriptor(mode="any", user_state=state, task_type="any")
            assert cd.user_state == state

    def test_all_task_types_accepted(self):
        for tt in ("coding", "research", "review", "any"):
            cd = ContextDescriptor(mode="any", user_state="any", task_type=tt)
            assert cd.task_type == tt

    def test_invalid_mode_raises(self):
        with pytest.raises(ValueError, match="mode"):
            ContextDescriptor(mode="batch", user_state="any", task_type="any")

    def test_invalid_user_state_raises(self):
        with pytest.raises(ValueError, match="user_state"):
            ContextDescriptor(mode="any", user_state="angry", task_type="any")

    def test_invalid_task_type_raises(self):
        with pytest.raises(ValueError, match="task_type"):
            ContextDescriptor(mode="any", user_state="any", task_type="debugging")

    def test_to_dict_round_trip(self):
        cd = ContextDescriptor(mode="pipeline", user_state="frustrated", task_type="coding")
        d = cd.to_dict()
        cd2 = ContextDescriptor.from_dict(d)
        assert cd2.mode == cd.mode
        assert cd2.user_state == cd.user_state
        assert cd2.task_type == cd.task_type


class TestContextMatching:
    """Test context_matches function."""

    def test_null_edge_context_matches_everything(self):
        current = ContextDescriptor(mode="pipeline", user_state="frustrated", task_type="coding")
        assert context_matches(current, None) is True

    def test_exact_match_all_fields(self):
        current = ContextDescriptor(mode="pipeline", user_state="frustrated", task_type="coding")
        edge = ContextDescriptor(mode="pipeline", user_state="frustrated", task_type="coding")
        assert context_matches(current, edge) is True

    def test_wildcard_mode_matches(self):
        current = ContextDescriptor(mode="pipeline", user_state="neutral", task_type="coding")
        edge = ContextDescriptor(mode="any", user_state="neutral", task_type="coding")
        assert context_matches(current, edge) is True

    def test_wildcard_user_state_matches(self):
        current = ContextDescriptor(mode="manual", user_state="frustrated", task_type="coding")
        edge = ContextDescriptor(mode="manual", user_state="any", task_type="coding")
        assert context_matches(current, edge) is True

    def test_wildcard_task_type_matches(self):
        current = ContextDescriptor(mode="manual", user_state="neutral", task_type="research")
        edge = ContextDescriptor(mode="manual", user_state="neutral", task_type="any")
        assert context_matches(current, edge) is True

    def test_all_wildcards_matches_everything(self):
        current = ContextDescriptor(mode="pipeline", user_state="frustrated", task_type="review")
        edge = ContextDescriptor(mode="any", user_state="any", task_type="any")
        assert context_matches(current, edge) is True

    def test_mode_mismatch_fails(self):
        current = ContextDescriptor(mode="manual", user_state="neutral", task_type="coding")
        edge = ContextDescriptor(mode="pipeline", user_state="neutral", task_type="coding")
        assert context_matches(current, edge) is False

    def test_user_state_mismatch_fails(self):
        current = ContextDescriptor(mode="manual", user_state="neutral", task_type="coding")
        edge = ContextDescriptor(mode="manual", user_state="frustrated", task_type="coding")
        assert context_matches(current, edge) is False

    def test_task_type_mismatch_fails(self):
        current = ContextDescriptor(mode="manual", user_state="neutral", task_type="coding")
        edge = ContextDescriptor(mode="manual", user_state="neutral", task_type="research")
        assert context_matches(current, edge) is False

    def test_single_field_mismatch_in_multi_field(self):
        """Even if 2 of 3 fields match, one mismatch means no match."""
        current = ContextDescriptor(mode="pipeline", user_state="frustrated", task_type="coding")
        edge = ContextDescriptor(mode="pipeline", user_state="frustrated", task_type="research")
        assert context_matches(current, edge) is False

    def test_current_any_does_not_match_specific_edge(self):
        """'any' in current does NOT wildcard-match a specific edge value.
        Only 'any' on the EDGE side is a wildcard."""
        current = ContextDescriptor(mode="any", user_state="any", task_type="any")
        edge = ContextDescriptor(mode="pipeline", user_state="frustrated", task_type="coding")
        assert context_matches(current, edge) is False

    def test_current_any_mode_does_not_match_specific_edge_mode(self):
        current = ContextDescriptor(mode="any", user_state="neutral", task_type="coding")
        edge = ContextDescriptor(mode="pipeline", user_state="neutral", task_type="coding")
        assert context_matches(current, edge) is False

    def test_current_any_user_state_does_not_match_specific_edge_state(self):
        current = ContextDescriptor(mode="manual", user_state="any", task_type="coding")
        edge = ContextDescriptor(mode="manual", user_state="frustrated", task_type="coding")
        assert context_matches(current, edge) is False

    def test_current_any_task_type_does_not_match_specific_edge_task(self):
        current = ContextDescriptor(mode="manual", user_state="neutral", task_type="any")
        edge = ContextDescriptor(mode="manual", user_state="neutral", task_type="research")
        assert context_matches(current, edge) is False
