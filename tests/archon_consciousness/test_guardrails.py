"""Guardrail verification tests — GUARD-CON-001 through GUARD-CON-009.

Each guardrail gets at least one dedicated test proving enforcement.
"""

import json
from datetime import datetime, timezone

import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient


class TestGuardCON001NoHTTP:
    """GUARD-CON-001: No HTTP calls in emotional state module."""

    def test_no_http_imports_emotional(self):
        import src.archon_consciousness.emotional_state_detector as mod
        with open(mod.__file__) as f:
            source = f.read()
        for banned in ["import requests", "import urllib", "import httpx", "import aiohttp"]:
            assert banned not in source

    def test_no_http_imports_any_module(self):
        """Broader check: no consciousness module imports HTTP clients."""
        import src.archon_consciousness as pkg
        import os
        pkg_dir = os.path.dirname(pkg.__file__)
        for fname in os.listdir(pkg_dir):
            if fname.endswith(".py"):
                with open(os.path.join(pkg_dir, fname)) as f:
                    source = f.read()
                for banned in ["import requests", "import httpx", "import aiohttp"]:
                    assert banned not in source, f"{fname} contains {banned}"


class TestGuardCON002NoSelfModification:
    """GUARD-CON-002: Personality not self-modified without /values command."""

    def test_no_direct_personality_file_writes(self):
        """Consciousness modules never write to personality files directly."""
        import os, src.archon_consciousness as pkg
        pkg_dir = os.path.dirname(pkg.__file__)
        for fname in os.listdir(pkg_dir):
            if fname.endswith(".py"):
                with open(os.path.join(pkg_dir, fname)) as f:
                    source = f.read()
                assert "personality.md" not in source, f"{fname} references personality.md"
                assert "understanding.md" not in source, f"{fname} references understanding.md"


class TestGuardCON003ConflictResolutionLogged:
    """GUARD-CON-003: Every conflict resolution is logged."""

    def test_resolution_has_all_required_fields(self, mock_graph):
        from src.archon_consciousness.values_dag import ValuesDAG
        from src.archon_consciousness.context_descriptor import ContextDescriptor
        mock_graph.store_memory(
            name="valuesnode-rule-a", memory_type="ValuesNode",
            content=json.dumps({"rule_id": "rule-a", "rule_text": "Rule A",
                                "tier": "safety", "status": "active",
                                "created_at": "2026-03-28T00:00:00+00:00"}),
            importance=0.8, tags=["archon-consciousness"],
        )
        mock_graph.store_memory(
            name="valuesnode-rule-b", memory_type="ValuesNode",
            content=json.dumps({"rule_id": "rule-b", "rule_text": "Rule B",
                                "tier": "guidelines", "status": "active",
                                "created_at": "2026-03-28T00:00:00+00:00"}),
            importance=0.8, tags=["archon-consciousness"],
        )
        client = MemoryGraphClient(mock_graph)
        dag = ValuesDAG(client)
        ctx = ContextDescriptor(mode="any", user_state="any", task_type="any")
        result = dag.resolve_conflict("rule-a", "rule-b", ctx)
        # Must have all logging fields per PRD
        assert "winner" in result
        assert "loser" in result
        assert "step" in result
        assert "reason" in result
        assert "rule_a" in result
        assert "rule_b" in result
        assert "path" in result
        assert "context_evaluated" in result


class TestGuardCON004DedicatedLabels:
    """GUARD-CON-004: Consciousness uses dedicated node labels only."""

    def test_consciousness_nodes_use_dedicated_types(self, mock_graph):
        from src.archon_consciousness.rule_registry import RuleRegistry
        client = MemoryGraphClient(mock_graph)

        # Pre-existing non-consciousness memory
        mock_graph.store_memory("user-pref", "UserMemory", '{"pref": "dark"}', tags=["user"])

        registry = RuleRegistry(client)
        registry.create_rule("Test rule for label check")

        # Verify consciousness nodes have dedicated types
        allowed_types = {"ValuesNode", "PatternScore", "Episode", "Reflection",
                         "Intent", "SessionEvent", "EmotionalState", "PinMarker",
                         "EvidenceMarker", "ContradictionMarker"}
        for mem in mock_graph.memories.values():
            if "archon-consciousness" in mem.get("tags", []):
                assert mem["type"] in allowed_types, (
                    f"Node '{mem['name']}' has unexpected type '{mem['type']}'"
                )

        # Pre-existing memory untouched
        pref = mock_graph.get_memory("user-pref")
        assert pref["content"] == '{"pref": "dark"}'


class TestGuardCON005SessionStartLatency:
    """GUARD-CON-005: Session start < 2 seconds."""

    def test_session_start_fast(self, mock_graph, mock_lance):
        import time
        from src.archon_consciousness.hooks import on_session_start
        client = MemoryGraphClient(mock_graph)
        start = time.monotonic()
        on_session_start(client, mock_lance, session_num=1)
        elapsed = time.monotonic() - start
        assert elapsed < 2.0


class TestGuardCON006NeutralDefault:
    """GUARD-CON-006: Default to neutral when confidence < 0.6."""

    def test_ambiguous_defaults_to_neutral(self):
        from src.archon_consciousness.emotional_state_detector import (
            extract_signals, classify_state,
        )
        # Very ambiguous message — low confidence
        signals = extract_signals("maybe", ["word " * 15] * 5)
        state, confidence = classify_state(signals)
        assert state == "neutral"


class TestGuardCON007FeatureFlags:
    """GUARD-CON-007: Each subsystem individually disableable."""

    def test_emotional_detector_works_independently(self):
        from src.archon_consciousness.emotional_state_detector import EmotionalStateDetector
        detector = EmotionalStateDetector(logger=None)
        state, _, _ = detector.detect("Hello there")
        assert state == "neutral"  # first message

    def test_pattern_tracker_works_independently(self, mock_graph):
        from src.archon_consciousness.pattern_tracker import PatternTracker
        mock_graph.store_memory(
            name="patternscore-test-rule",
            memory_type="PatternScore",
            content=json.dumps({
                "rule_id": "test-rule", "score": 0.5,
                "last_tested_session": None, "tested_session_count": 0,
                "last_delta": None, "trend": "insufficient_data",
                "status": "active", "score_history": [],
                "last_tested_session_num": None, "consecutive_drops": 0,
            }),
            importance=0.5, tags=["archon-consciousness"],
        )
        client = MemoryGraphClient(mock_graph)
        tracker = PatternTracker(client, current_session_num=1)
        score = tracker.update_rule_score("test-rule", 1.0)
        assert score > 0.5

    def test_episodic_memory_works_independently(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        from src.archon_consciousness.schemas import Episode
        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)
        ep = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="Test", context="C", action_taken="A",
            outcome="O", emotional_valence="neutral",
            lesson_extracted="L",
        )
        name = em.store_fast(ep)
        assert client.get(name) is not None


class TestGuardCON008StorageCaps:
    """GUARD-CON-008: Episode cap 1000, DAG cap 200."""

    def test_rule_creation_at_capacity_raises(self, mock_graph):
        from src.archon_consciousness.rule_registry import RuleRegistry
        client = MemoryGraphClient(mock_graph)
        registry = RuleRegistry(client)
        # Create 200 rules to hit cap
        for i in range(200):
            registry.create_rule(f"Capacity test rule number {i}")
        with pytest.raises(ValueError, match="maximum"):
            registry.create_rule("One too many")


class TestGuardCON009NeverSurfaceDetection:
    """GUARD-CON-009: Never surface emotional state to user."""

    def test_no_surfacing_phrases_in_code(self):
        import src.archon_consciousness.emotional_state_detector as mod
        with open(mod.__file__) as f:
            source = f.read().lower()
        banned_phrases = [
            "you seem", "i notice you're", "you appear to be",
            "i detect that you", "you look",
        ]
        for phrase in banned_phrases:
            assert phrase not in source, f"Found banned phrase: '{phrase}'"
