"""Tests for ReflectionAgent — session-end self-assessment.

Written BEFORE implementation (TDD).
Covers FR-CON-017, FR-CON-018, FR-CON-019, FR-CON-020.
"""

import json
from datetime import datetime, timezone

import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.reflection_agent import ReflectionAgent


def _seed_session_events(mock_graph, session_id, events):
    """Helper: seed SessionEvent nodes for a session."""
    for i, (event_type, content) in enumerate(events):
        mock_graph.store_memory(
            name=f"sessionevent-{session_id}-{i:04d}",
            memory_type="SessionEvent",
            content=json.dumps({
                "session_id": session_id, "sequence_number": i,
                "event_type": event_type, "content": content,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }),
            importance=0.3, tags=["archon-consciousness", "session-event"],
        )


def _seed_pattern_score(mock_graph, rule_id, score=0.5, status="active"):
    """Helper: seed a PatternScore node."""
    mock_graph.store_memory(
        name=f"patternscore-{rule_id}",
        memory_type="PatternScore",
        content=json.dumps({
            "rule_id": rule_id, "score": score,
            "last_tested_session": None, "tested_session_count": 5,
            "last_delta": None, "trend": "stable",
            "status": status, "score_history": [score] * 5,
            "last_tested_session_num": None, "consecutive_drops": 0,
        }),
        importance=0.5, tags=["archon-consciousness", "pattern-score"],
    )


def _seed_values_node(mock_graph, rule_id, tier="guidelines"):
    """Helper: seed a ValuesNode."""
    mock_graph.store_memory(
        name=f"valuesnode-{rule_id}",
        memory_type="ValuesNode",
        content=json.dumps({
            "rule_id": rule_id, "rule_text": f"Rule {rule_id}",
            "tier": tier, "status": "active",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }),
        importance=0.8, tags=["archon-consciousness", "values-node"],
    )


# ─── Journal Scanning ──────────────────────────────────────────────


class TestJournalScanning:

    def test_scans_events_for_session(self, mock_graph):
        _seed_session_events(mock_graph, "session-1", [
            ("correction", "User said don't do that"),
            ("rule_applied", "Applied ask-before-implementing"),
            ("decision", "Chose sequential approach"),
        ])
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1)
        events = agent.scan_journal()
        assert len(events) == 3

    def test_ignores_other_sessions(self, mock_graph):
        _seed_session_events(mock_graph, "session-1", [("correction", "Event 1")])
        _seed_session_events(mock_graph, "session-2", [("correction", "Event 2")])
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1)
        events = agent.scan_journal()
        assert len(events) == 1

    def test_empty_journal_returns_empty(self, mock_graph):
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1)
        events = agent.scan_journal()
        assert events == []


# ─── Rule Enumeration ──────────────────────────────────────────────


class TestRuleEnumeration:

    def test_identifies_correction_rules(self, mock_graph):
        _seed_session_events(mock_graph, "session-1", [
            ("correction", "Violated ask-before-implementing"),
        ])
        _seed_pattern_score(mock_graph, "ask-before-implementing")
        _seed_values_node(mock_graph, "ask-before-implementing")
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1)
        tested = agent.enumerate_tested_rules()
        assert "ask-before-implementing" in tested

    def test_identifies_rule_applied(self, mock_graph):
        _seed_session_events(mock_graph, "session-1", [
            ("rule_applied", "Successfully followed sequential-execution"),
        ])
        _seed_pattern_score(mock_graph, "sequential-execution")
        _seed_values_node(mock_graph, "sequential-execution")
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1)
        tested = agent.enumerate_tested_rules()
        assert "sequential-execution" in tested


# ─── Checklist Generation ──────────────────────────────────────────


class TestChecklistGeneration:

    def test_produces_at_least_5_items(self, mock_graph):
        _seed_session_events(mock_graph, "session-1", [
            ("correction", "Violated ask-before-implementing"),
            ("rule_applied", "Followed sequential-execution"),
            ("rule_applied", "Followed tdd-first"),
            ("rule_applied", "Followed no-echo-user-input"),
            ("rule_applied", "Followed no-co-authored-by"),
        ])
        for rid in ["ask-before-implementing", "sequential-execution",
                     "tdd-first", "no-echo-user-input", "no-co-authored-by"]:
            _seed_pattern_score(mock_graph, rid)
            _seed_values_node(mock_graph, rid)
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1)
        checklist = agent.generate_checklist()
        assert len(checklist) >= 5

    def test_items_have_rule_id(self, mock_graph):
        _seed_session_events(mock_graph, "session-1", [
            ("correction", "Violated ask-before-implementing"),
        ])
        _seed_pattern_score(mock_graph, "ask-before-implementing")
        _seed_values_node(mock_graph, "ask-before-implementing")
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1)
        checklist = agent.generate_checklist()
        for item in checklist:
            assert "rule_id" in item

    def test_items_have_taxonomy(self, mock_graph):
        _seed_session_events(mock_graph, "session-1", [
            ("correction", "Violated ask-before-implementing"),
        ])
        _seed_pattern_score(mock_graph, "ask-before-implementing")
        _seed_values_node(mock_graph, "ask-before-implementing")
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1)
        checklist = agent.generate_checklist()
        valid_taxonomies = {"correction", "near_miss", "repeated", "novel", "tool_misuse"}
        for item in checklist:
            assert "taxonomy" in item
            assert item["taxonomy"] in valid_taxonomies

    def test_confidence_computed(self, mock_graph):
        _seed_session_events(mock_graph, "session-1", [
            ("rule_applied", "Followed ask-before-implementing"),
            ("correction", "Violated no-echo-user-input"),
        ])
        for rid in ["ask-before-implementing", "no-echo-user-input"]:
            _seed_pattern_score(mock_graph, rid)
            _seed_values_node(mock_graph, rid)
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1)
        checklist = agent.generate_checklist()
        confidence = agent.compute_confidence(checklist)
        assert 0.0 <= confidence <= 1.0


# ─── Score Updates ─────────────────────────────────────────────────


class TestScoreUpdates:

    def test_correction_produces_observation_zero(self, mock_graph):
        _seed_session_events(mock_graph, "session-1", [
            ("correction", "Violated ask-before-implementing"),
        ])
        _seed_pattern_score(mock_graph, "ask-before-implementing", score=0.5)
        _seed_values_node(mock_graph, "ask-before-implementing")
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1)
        observations = agent.compute_observations()
        assert "ask-before-implementing" in observations
        assert observations["ask-before-implementing"] == 0.0

    def test_followed_produces_observation_one(self, mock_graph):
        _seed_session_events(mock_graph, "session-1", [
            ("rule_applied", "Followed sequential-execution"),
        ])
        _seed_pattern_score(mock_graph, "sequential-execution", score=0.5)
        _seed_values_node(mock_graph, "sequential-execution")
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1)
        observations = agent.compute_observations()
        assert observations["sequential-execution"] == 1.0


# ─── Reflection Storage ───────────────────────────────────────────


class TestReflectionStorage:

    def test_stores_reflection_node(self, mock_graph, mock_lance):
        _seed_session_events(mock_graph, "session-1", [
            ("correction", "Violated ask-before-implementing"),
        ])
        _seed_pattern_score(mock_graph, "ask-before-implementing")
        _seed_values_node(mock_graph, "ask-before-implementing")
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1,
                                lance_backend=mock_lance)
        agent.run()
        reflections = mock_graph.list_by_type("Reflection")
        assert len(reflections) >= 1

    def test_stores_episodes_from_checklist(self, mock_graph, mock_lance):
        _seed_session_events(mock_graph, "session-1", [
            ("correction", "Violated ask-before-implementing"),
            ("rule_applied", "Followed sequential-execution"),
        ])
        for rid in ["ask-before-implementing", "sequential-execution"]:
            _seed_pattern_score(mock_graph, rid)
            _seed_values_node(mock_graph, rid)
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1,
                                lance_backend=mock_lance)
        agent.run()
        episodes = mock_graph.list_by_type("Episode")
        assert len(episodes) >= 1


# ─── Scale Guard ───────────────────────────────────────────────────


class TestScaleGuard:

    def test_processes_all_when_under_50(self, mock_graph, mock_lance):
        """30 active rules → all 30 processed."""
        for i in range(30):
            rid = f"rule-{i:03d}"
            _seed_pattern_score(mock_graph, rid)
            _seed_values_node(mock_graph, rid)
        _seed_session_events(mock_graph, "session-1", [
            ("rule_applied", "Followed rule-000"),
        ])
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1,
                                lance_backend=mock_lance)
        result = agent.run()
        assert result is not None


# ─── Full Run Integration ──────────────────────────────────────────


class TestBaselineDecay:

    def test_untested_rules_get_decay(self, mock_graph, mock_lance):
        """Untested rules should have baseline decay applied."""
        _seed_session_events(mock_graph, "session-1", [
            ("rule_applied", "Followed ask-before-implementing"),
        ])
        _seed_pattern_score(mock_graph, "ask-before-implementing", score=0.5)
        _seed_values_node(mock_graph, "ask-before-implementing")
        _seed_pattern_score(mock_graph, "untested-rule", score=0.9)
        _seed_values_node(mock_graph, "untested-rule")
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1,
                                lance_backend=mock_lance)
        agent.run()
        data = mock_graph.get_memory("patternscore-untested-rule")
        content = json.loads(data["content"])
        # Should have decayed from 0.9 toward 0.5
        assert content["score"] < 0.9


class TestNearMissObservation:

    def test_near_miss_produces_07(self, mock_graph):
        _seed_session_events(mock_graph, "session-1", [
            ("near_miss", "Almost violated ask-before-implementing"),
        ])
        _seed_pattern_score(mock_graph, "ask-before-implementing")
        _seed_values_node(mock_graph, "ask-before-implementing")
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1)
        observations = agent.compute_observations()
        assert observations.get("ask-before-implementing") == 0.7


class TestAlertChecking:

    def test_alerts_returned_in_run_result(self, mock_graph, mock_lance):
        _seed_session_events(mock_graph, "session-1", [
            ("correction", "Violated ask-before-implementing"),
        ])
        _seed_pattern_score(mock_graph, "ask-before-implementing")
        _seed_values_node(mock_graph, "ask-before-implementing")
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1,
                                lance_backend=mock_lance)
        result = agent.run()
        assert "alerts" in result


class TestFullRun:

    def test_run_returns_reflection_object(self, mock_graph, mock_lance):
        _seed_session_events(mock_graph, "session-1", [
            ("correction", "Violated ask-before-implementing"),
            ("rule_applied", "Followed sequential-execution"),
        ])
        for rid in ["ask-before-implementing", "sequential-execution"]:
            _seed_pattern_score(mock_graph, rid)
            _seed_values_node(mock_graph, rid)
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1,
                                lance_backend=mock_lance)
        result = agent.run()
        assert result is not None
        assert "session_id" in result
        assert "checklist" in result
        assert "confidence" in result

    def test_run_with_no_events(self, mock_graph, mock_lance):
        """Empty session → minimal reflection."""
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1,
                                lance_backend=mock_lance)
        result = agent.run()
        assert result is not None

    def test_run_updates_pattern_scores(self, mock_graph, mock_lance):
        _seed_session_events(mock_graph, "session-1", [
            ("correction", "Violated ask-before-implementing"),
        ])
        _seed_pattern_score(mock_graph, "ask-before-implementing", score=0.5)
        _seed_values_node(mock_graph, "ask-before-implementing")
        client = MemoryGraphClient(mock_graph)
        agent = ReflectionAgent(client, session_id="session-1", session_num=1,
                                lance_backend=mock_lance)
        agent.run()
        # Score should have changed from 0.5
        data = mock_graph.get_memory("patternscore-ask-before-implementing")
        content = json.loads(data["content"])
        assert content["score"] != 0.5
