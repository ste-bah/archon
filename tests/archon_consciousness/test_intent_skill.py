"""Tests for /intent skill command router.

Written BEFORE implementation (TDD).
Covers FR-CON-024.
"""

import json
import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.intent_skill import IntentSkill


def _seed_intent(mock_graph, goal_id, description, tier="persistent", status="active"):
    mock_graph.store_memory(
        name=f"intent-{goal_id}",
        memory_type="Intent",
        content=json.dumps({
            "goal_id": goal_id, "description": description,
            "tier": tier, "confidence": 0.5, "status": status,
            "created_at": "2026-03-28T00:00:00+00:00",
        }),
        importance=0.6, tags=["archon-consciousness", "intent"],
    )


class TestList:
    def test_list_shows_active_goals(self, mock_graph):
        _seed_intent(mock_graph, "high-coverage", "High test coverage")
        _seed_intent(mock_graph, "security-first", "Security over convenience")
        client = MemoryGraphClient(mock_graph)
        skill = IntentSkill(client)
        output = skill.execute("list")
        assert "high-coverage" in output
        assert "security-first" in output

    def test_list_empty(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = IntentSkill(client)
        output = skill.execute("list")
        assert "No active" in output or "0 goals" in output.lower()


class TestShowEvidence:
    def test_show_evidence_for_goal(self, mock_graph):
        _seed_intent(mock_graph, "high-coverage", "High test coverage")
        # Add an evidence marker
        mock_graph.store_memory(
            name="evidence-marker-1", memory_type="EvidenceMarker",
            content=json.dumps({"evidence_ref": "correction-1"}),
            importance=0.3, tags=["archon-consciousness"],
        )
        mock_graph.create_relationship(
            "evidence-marker-1", "intent-high-coverage", "EVIDENCED_BY", {}
        )
        client = MemoryGraphClient(mock_graph)
        skill = IntentSkill(client)
        output = skill.execute("show-evidence", "high-coverage")
        assert "evidence" in output.lower() or "correction" in output.lower()

    def test_show_evidence_nonexistent(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = IntentSkill(client)
        output = skill.execute("show-evidence", "ghost-goal")
        assert "not found" in output.lower() or "no goal" in output.lower()


class TestConfirm:
    def test_confirm_adds_evidence(self, mock_graph):
        _seed_intent(mock_graph, "high-coverage", "High test coverage")
        client = MemoryGraphClient(mock_graph)
        skill = IntentSkill(client)
        output = skill.execute("confirm", "high-coverage")
        assert "Confirmed" in output or "confirmed" in output

    def test_confirm_nonexistent(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = IntentSkill(client)
        output = skill.execute("confirm", "ghost")
        assert "not found" in output.lower()


class TestCorrect:
    def test_correct_updates_description(self, mock_graph):
        _seed_intent(mock_graph, "high-coverage", "High test coverage")
        client = MemoryGraphClient(mock_graph)
        skill = IntentSkill(client)
        output = skill.execute("correct", "high-coverage Very high test coverage")
        assert "Updated" in output or "updated" in output


class TestPromote:
    def test_promote_session_goal(self, mock_graph):
        _seed_intent(mock_graph, "session-goal", "Get PR merged", tier="session")
        client = MemoryGraphClient(mock_graph)
        skill = IntentSkill(client)
        output = skill.execute("promote", "session-goal")
        assert "Promoted" in output or "promoted" in output or "persistent" in output.lower()

    def test_promote_nonexistent(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = IntentSkill(client)
        output = skill.execute("promote", "ghost")
        assert "not found" in output.lower()


class TestInvalidOperation:
    def test_invalid_shows_help(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = IntentSkill(client)
        output = skill.execute("nonexistent")
        assert "Available" in output or "Unknown" in output

    def test_empty_shows_help(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        skill = IntentSkill(client)
        output = skill.execute("")
        assert "Available" in output or "operations" in output.lower()
