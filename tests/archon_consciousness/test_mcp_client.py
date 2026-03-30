"""Tests for MemoryGraphClient — store, get, update, delete, relationships.

Covers FAIL-1 (update path untested), FAIL-2 (edge types with properties),
and FAIL-3 (GUARD-CON-004 regression).
"""

import json
from datetime import datetime, timezone

import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.schemas import Episode, PatternScore, ValuesNode


class TestStoreAndRetrieve:
    """Test basic CRUD via MemoryGraphClient."""

    def test_store_and_get(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        client.store("test-node", "TestType", '{"key": "value"}', importance=0.5)
        result = client.get("test-node")
        assert result is not None
        assert result["name"] == "test-node"
        assert json.loads(result["content"]) == {"key": "value"}

    def test_get_nonexistent_returns_none(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        assert client.get("does-not-exist") is None

    def test_update_modifies_fields(self, mock_graph):
        """FAIL-1: Verify update path works."""
        client = MemoryGraphClient(mock_graph)
        client.store("test-node", "TestType", '{"score": 0.5}')
        client.update("test-node", content='{"score": 0.8}')
        result = client.get("test-node")
        assert json.loads(result["content"]) == {"score": 0.8}

    def test_update_nonexistent_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        with pytest.raises(KeyError):
            client.update("ghost", content="new")

    def test_delete(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        client.store("to-delete", "TestType", "{}")
        client.delete("to-delete")
        assert client.get("to-delete") is None

    def test_delete_nonexistent_raises(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        with pytest.raises(KeyError):
            client.delete("ghost")


class TestStoreFromSchema:
    """Test typed schema storage and retrieval."""

    def test_store_and_deserialize_episode(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        ep = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="test trigger",
            context="test context",
            action_taken="test action",
            outcome="test outcome",
            emotional_valence="neutral",
            lesson_extracted="test lesson",
        )
        client.store_from_schema(ep)
        retrieved = client.get_and_deserialize(ep.to_memorygraph_params()["name"], Episode)
        assert retrieved is not None
        assert retrieved.trigger == "test trigger"

    def test_store_and_deserialize_pattern_score(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        ps = PatternScore(rule_id="test-rule", score=0.75)
        client.store_from_schema(ps)
        retrieved = client.get_and_deserialize("patternscore-test-rule", PatternScore)
        assert retrieved is not None
        assert retrieved.score == 0.75


class TestRelationships:
    """Test edge creation and traversal with typed properties."""

    def test_create_relationship(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        client.store("node-a", "ValuesNode", "{}")
        client.store("node-b", "ValuesNode", "{}")
        client.create_relationship("node-a", "node-b", "SUPERSEDED_BY", {"timestamp": "2026-03-28"})
        related = client.get_related("node-a", "SUPERSEDED_BY", direction="outgoing")
        assert len(related) == 1
        assert related[0]["name"] == "node-b"

    def test_strict_priority_edge_with_weight(self, mock_graph):
        """FAIL-2: Test STRICT_PRIORITY edge with weight property."""
        client = MemoryGraphClient(mock_graph)
        client.store("rule-a", "ValuesNode", '{"rule_id": "a"}')
        client.store("rule-b", "ValuesNode", '{"rule_id": "b"}')
        client.create_relationship(
            "rule-a", "rule-b", "STRICT_PRIORITY",
            properties={"weight": 1.0},
        )
        related = client.get_related("rule-a", "STRICT_PRIORITY", direction="outgoing")
        assert len(related) == 1
        assert related[0]["_relationship"]["properties"]["weight"] == 1.0

    def test_defeasible_priority_edge_with_context(self, mock_graph):
        """FAIL-2: Test DEFEASIBLE_PRIORITY edge with weight + context."""
        client = MemoryGraphClient(mock_graph)
        client.store("rule-a", "ValuesNode", '{"rule_id": "a"}')
        client.store("rule-b", "ValuesNode", '{"rule_id": "b"}')
        context = {"mode": "pipeline", "user_state": "any", "task_type": "coding"}
        client.create_relationship(
            "rule-a", "rule-b", "DEFEASIBLE_PRIORITY",
            properties={"weight": 0.8, "context": context},
        )
        related = client.get_related("rule-a", "DEFEASIBLE_PRIORITY", direction="outgoing")
        assert len(related) == 1
        props = related[0]["_relationship"]["properties"]
        assert props["weight"] == 0.8
        assert props["context"]["mode"] == "pipeline"

    def test_defeats_edge_with_context(self, mock_graph):
        """FAIL-2: Test DEFEATS edge with context property."""
        client = MemoryGraphClient(mock_graph)
        client.store("rule-a", "ValuesNode", '{"rule_id": "a"}')
        client.store("rule-b", "ValuesNode", '{"rule_id": "b"}')
        context = {"mode": "any", "user_state": "frustrated", "task_type": "any"}
        client.create_relationship(
            "rule-a", "rule-b", "DEFEATS",
            properties={"context": context},
        )
        related = client.get_related("rule-a", "DEFEATS", direction="outgoing")
        assert len(related) == 1
        assert related[0]["_relationship"]["properties"]["context"]["user_state"] == "frustrated"

    def test_evidenced_by_edge(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        client.store("intent-goal", "Intent", '{"goal_id": "test"}')
        client.store("correction-mem", "Episode", '{"trigger": "correction"}')
        client.create_relationship(
            "intent-goal", "correction-mem", "EVIDENCED_BY",
            properties={"timestamp": "2026-03-28T12:00:00"},
        )
        related = client.get_related("intent-goal", "EVIDENCED_BY", direction="outgoing")
        assert len(related) == 1

    def test_pinned_by_edge(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        client.store("episode-1", "Episode", '{"trigger": "important"}')
        client.store("user-pin", "Episode", '{}')
        client.create_relationship(
            "user-pin", "episode-1", "PINNED_BY",
            properties={"reason": "Critical learning moment"},
        )
        related = client.get_related("user-pin", "PINNED_BY", direction="outgoing")
        assert len(related) == 1
        assert related[0]["_relationship"]["properties"]["reason"] == "Critical learning moment"


class TestGuardCON004Regression:
    """FAIL-3: Verify GUARD-CON-004 — existing MemoryGraph memories untouched.

    Pre-populate non-consciousness memories, run consciousness operations,
    verify the original memories survive unchanged.
    """

    def test_consciousness_ops_dont_touch_existing_memories(self, mock_graph):
        """Create non-consciousness memories, then run consciousness CRUD.
        Verify the original memories are identical after."""
        client = MemoryGraphClient(mock_graph)

        # Pre-existing memories (NOT consciousness nodes)
        client.store("user-preference-1", "UserMemory", '{"pref": "dark mode"}', tags=["user"])
        client.store("project-note-1", "ProjectMemory", '{"note": "deadline friday"}', tags=["project"])
        original_pref = client.get("user-preference-1")
        original_note = client.get("project-note-1")

        # Consciousness operations
        from src.archon_consciousness.rule_registry import RuleRegistry
        registry = RuleRegistry(client)
        rule_id = registry.create_rule("Test rule for regression check")
        registry.archive_rule(rule_id)

        # Verify originals unchanged
        after_pref = client.get("user-preference-1")
        after_note = client.get("project-note-1")
        assert after_pref["content"] == original_pref["content"]
        assert after_note["content"] == original_note["content"]
        assert after_pref["tags"] == original_pref["tags"]
        assert after_note["tags"] == original_note["tags"]

    def test_consciousness_nodes_use_dedicated_labels(self, mock_graph):
        """All consciousness nodes use dedicated type labels, not generic ones."""
        client = MemoryGraphClient(mock_graph)
        from src.archon_consciousness.rule_registry import RuleRegistry
        registry = RuleRegistry(client)
        registry.create_rule("Dedicated label test rule")

        # Check all stored consciousness nodes have correct types
        consciousness_types = {"ValuesNode", "PatternScore"}
        for mem in mock_graph.memories.values():
            if "archon-consciousness" in mem.get("tags", []):
                assert mem["type"] in consciousness_types, (
                    f"Consciousness node '{mem['name']}' has unexpected type '{mem['type']}'"
                )
