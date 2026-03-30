"""Tests for EmotionalStateLogger — state transition writing to MemoryGraph.

Written BEFORE implementation (TDD). All tests must fail until
emotional_state_logger.py exists.

Covers FR-CON-008: emotional state transition logging.
"""

import json
from datetime import datetime, timezone

import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.emotional_state_logger import EmotionalStateLogger
from src.archon_consciousness.schemas import EmotionalState


class TestLogTransition:
    """Test EmotionalStateLogger.log_transition."""

    def test_valid_transition_writes_to_memorygraph(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        logger.log_transition("neutral", "frustrated", 0.8, "3 exclamation marks detected")
        states = mock_graph.list_by_type("EmotionalState")
        assert len(states) == 1

    def test_writes_immediately_not_batched(self, mock_graph):
        """State transitions are important enough to not batch."""
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        logger.log_transition("neutral", "frustrated", 0.8, "Signal detected")
        store_calls = [c for c in mock_graph.call_log if c[0] == "store_memory"]
        assert len(store_calls) == 1  # Immediate write, not batched

    def test_returns_emotional_state_object(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        result = logger.log_transition("neutral", "frustrated", 0.8, "Evidence text")
        assert isinstance(result, EmotionalState)
        assert result.previous_state == "neutral"
        assert result.new_state == "frustrated"
        assert result.confidence == 0.8

    def test_reset_transition(self, mock_graph):
        """frustrated → neutral (user correction or state reset)."""
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        result = logger.log_transition("frustrated", "neutral", 0.9, "User said: I'm not frustrated")
        assert result.new_state == "neutral"

    def test_all_states_as_previous(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        for state in ("frustrated", "exploring", "in_flow", "confused", "urgent", "neutral"):
            result = logger.log_transition(state, "neutral", 0.7, f"Transition from {state}")
            assert result.previous_state == state

    def test_all_states_as_new(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        for state in ("frustrated", "exploring", "in_flow", "confused", "urgent", "neutral"):
            result = logger.log_transition("neutral", state, 0.7, f"Transition to {state}")
            assert result.new_state == state

    def test_invalid_previous_state_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        with pytest.raises(ValueError, match="previous_state"):
            logger.log_transition("angry", "neutral", 0.8, "Evidence")

    def test_invalid_new_state_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        with pytest.raises(ValueError, match="new_state"):
            logger.log_transition("neutral", "happy", 0.8, "Evidence")

    def test_confidence_min_boundary(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        result = logger.log_transition("neutral", "frustrated", 0.0, "Low confidence")
        assert result.confidence == 0.0

    def test_confidence_max_boundary(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        result = logger.log_transition("neutral", "frustrated", 1.0, "High confidence")
        assert result.confidence == 1.0

    def test_confidence_nan_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        with pytest.raises(ValueError, match="confidence"):
            logger.log_transition("neutral", "frustrated", float("nan"), "Evidence")

    def test_confidence_bool_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        with pytest.raises(TypeError, match="confidence"):
            logger.log_transition("neutral", "frustrated", True, "Evidence")

    def test_confidence_below_min_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        with pytest.raises(ValueError, match="confidence"):
            logger.log_transition("neutral", "frustrated", -0.1, "Evidence")

    def test_confidence_above_max_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        with pytest.raises(ValueError, match="confidence"):
            logger.log_transition("neutral", "frustrated", 1.5, "Evidence")

    def test_confidence_inf_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        with pytest.raises(ValueError, match="confidence"):
            logger.log_transition("neutral", "frustrated", float("inf"), "Evidence")

    def test_empty_evidence_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        with pytest.raises(ValueError, match="evidence"):
            logger.log_transition("neutral", "frustrated", 0.8, "")

    def test_stored_content_matches_fields(self, mock_graph):
        """Verify the stored MemoryGraph content has all expected fields."""
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        logger.log_transition("neutral", "in_flow", 0.75, "Short messages, no questions")
        states = mock_graph.list_by_type("EmotionalState")
        content = json.loads(states[0]["content"])
        assert content["previous_state"] == "neutral"
        assert content["new_state"] == "in_flow"
        assert content["confidence"] == 0.75
        assert content["evidence"] == "Short messages, no questions"
        assert "timestamp" in content

    def test_tags_include_consciousness(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        logger = EmotionalStateLogger(client)
        logger.log_transition("neutral", "frustrated", 0.8, "Evidence")
        states = mock_graph.list_by_type("EmotionalState")
        assert "archon-consciousness" in states[0]["tags"]
        assert "emotional-state" in states[0]["tags"]
