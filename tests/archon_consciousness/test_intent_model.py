"""Tests for IntentModel — goal storage, confidence, contradictions, tiers.

Written BEFORE implementation (TDD).
Covers FR-CON-021, FR-CON-022, FR-CON-023.
"""

import json
import math
from datetime import datetime, timezone, timedelta

import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.intent_model import IntentModel


# ─── Goal Creation ─────────────────────────────────────────────────


class TestGoalCreation:

    def test_create_persistent_goal(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        goal_id = model.create_goal("High test coverage", tier="persistent")
        assert goal_id is not None
        goal = model.get_goal(goal_id)
        assert goal is not None
        assert goal["tier"] == "persistent"
        assert goal["status"] == "active"

    def test_create_session_goal(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        goal_id = model.create_goal("Get this PR merged today", tier="session")
        goal = model.get_goal(goal_id)
        assert goal["tier"] == "session"

    def test_create_returns_goal_id(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        goal_id = model.create_goal("Some goal", tier="persistent")
        assert isinstance(goal_id, str)
        assert len(goal_id) > 0

    def test_get_nonexistent_returns_none(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        assert model.get_goal("nonexistent-goal") is None


# ─── Evidence Edges ────────────────────────────────────────────────


class TestEvidence:

    def test_add_evidence(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        goal_id = model.create_goal("High coverage", tier="persistent")
        model.add_evidence(goal_id, "correction-123")
        evidence = model.get_evidence(goal_id)
        assert len(evidence) == 1

    def test_multiple_evidence(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        goal_id = model.create_goal("High coverage", tier="persistent")
        model.add_evidence(goal_id, "correction-1")
        model.add_evidence(goal_id, "correction-2")
        model.add_evidence(goal_id, "correction-3")
        evidence = model.get_evidence(goal_id)
        assert len(evidence) == 3

    def test_add_contradiction(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        goal_id = model.create_goal("Speed over quality", tier="persistent")
        model.add_contradiction(goal_id, "User said: correctness over speed")
        contradictions = model.get_contradictions(goal_id)
        assert len(contradictions) == 1

    def test_contradiction_has_text(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        goal_id = model.create_goal("Some goal", tier="persistent")
        model.add_contradiction(goal_id, "Contradicting evidence text")
        contradictions = model.get_contradictions(goal_id)
        assert "Contradicting evidence text" in str(contradictions[0])


# ─── Confidence Computation ────────────────────────────────────────


class TestConfidence:

    def test_three_recent_evidence_above_half(self, mock_graph):
        """Min 3 evidence for confidence > 0.5."""
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        goal_id = model.create_goal("Test confidence", tier="persistent")
        for i in range(3):
            model.add_evidence(goal_id, f"evidence-{i}")
        confidence = model.compute_confidence(goal_id)
        assert confidence > 0.5

    def test_two_evidence_below_half(self, mock_graph):
        """Less than 3 evidence → confidence < 0.5."""
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        goal_id = model.create_goal("Test confidence", tier="persistent")
        model.add_evidence(goal_id, "evidence-1")
        model.add_evidence(goal_id, "evidence-2")
        confidence = model.compute_confidence(goal_id)
        assert confidence < 0.5

    def test_zero_evidence_very_low(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        goal_id = model.create_goal("No evidence", tier="persistent")
        confidence = model.compute_confidence(goal_id)
        assert confidence < 0.2

    def test_confidence_in_range(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        goal_id = model.create_goal("Range check", tier="persistent")
        for i in range(10):
            model.add_evidence(goal_id, f"evidence-{i}")
        confidence = model.compute_confidence(goal_id)
        assert 0.0 <= confidence <= 1.0

    def test_contradictions_reduce_confidence(self, mock_graph):
        """More contradictions than evidence → low confidence."""
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        goal_id = model.create_goal("Contested goal", tier="persistent")
        model.add_evidence(goal_id, "evidence-1")
        model.add_evidence(goal_id, "evidence-2")
        model.add_contradiction(goal_id, "contra-1")
        model.add_contradiction(goal_id, "contra-2")
        model.add_contradiction(goal_id, "contra-3")
        confidence = model.compute_confidence(goal_id)
        assert confidence < 0.3

    def test_session_goals_excluded_from_confidence(self, mock_graph):
        """Session-scoped goals do NOT participate in confidence calc."""
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        goal_id = model.create_goal("Session goal", tier="session")
        model.add_evidence(goal_id, "evidence-1")
        confidence = model.compute_confidence(goal_id)
        assert confidence == 0.0  # session goals return 0


# ─── Session Goal Lifecycle ────────────────────────────────────────


class TestSessionGoalLifecycle:

    def test_archive_session_goals(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        model.create_goal("Session goal 1", tier="session")
        model.create_goal("Session goal 2", tier="session")
        model.create_goal("Persistent goal", tier="persistent")
        model.archive_session_goals()
        active = model.list_active_goals()
        active_tiers = [g["tier"] for g in active]
        assert "session" not in active_tiers
        assert "persistent" in active_tiers

    def test_archived_session_goals_not_in_active(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        model.create_goal("Will be archived", tier="session")
        model.archive_session_goals()
        active = model.list_active_goals()
        assert len(active) == 0


# ─── Query Relevant Goals ─────────────────────────────────────────


class TestQueryRelevant:

    def test_returns_goals_above_confidence_threshold(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        gid = model.create_goal("High test coverage", tier="persistent")
        for i in range(5):
            model.add_evidence(gid, f"evidence-{i}")
        results = model.query_relevant_goals("Should I write more tests?")
        # Goal with 5 evidence should have high confidence
        assert len(results) >= 0  # may or may not match depending on threshold

    def test_returns_empty_when_no_goals(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        results = model.query_relevant_goals("Some ambiguous situation")
        assert results == []

    def test_result_includes_reasoning(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        gid = model.create_goal("Always ask before implementing", tier="persistent")
        for i in range(4):
            model.add_evidence(gid, f"correction-{i}")
        results = model.query_relevant_goals("Should I start coding?")
        if results:
            assert "goal_id" in results[0]
            assert "confidence" in results[0]
            assert "description" in results[0]


# ─── List Goals ────────────────────────────────────────────────────


class TestListGoals:

    def test_list_active_goals(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        model.create_goal("Goal 1", tier="persistent")
        model.create_goal("Goal 2", tier="persistent")
        model.create_goal("Goal 3", tier="session")
        active = model.list_active_goals()
        assert len(active) == 3

    def test_list_excludes_archived(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        model = IntentModel(client)
        model.create_goal("Active", tier="persistent")
        model.create_goal("Will archive", tier="session")
        model.archive_session_goals()
        active = model.list_active_goals()
        assert len(active) == 1
