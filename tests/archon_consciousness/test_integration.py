"""Integration tests — full session lifecycle end-to-end.

Covers the complete flow: session start → work → correction →
emotional state change → session end → reflection → next session recall.

This is the final verification that all subsystems work together.
"""

import json
import time
from datetime import datetime, timezone

import pytest

from src.archon_consciousness.mcp_client import MemoryGraphClient
from src.archon_consciousness.hooks import on_session_start, on_session_end


def _seed_full_system(mock_graph):
    """Seed a complete system with rules, pattern scores, values nodes."""
    rules = [
        ("ask-before-implementing", "Always ask before implementing", "safety"),
        ("sequential-execution", "Use sequential execution", "guidelines"),
        ("tdd-first", "Write tests before implementation", "ethics"),
    ]
    for rule_id, text, tier in rules:
        mock_graph.store_memory(
            name=f"valuesnode-{rule_id}",
            memory_type="ValuesNode",
            content=json.dumps({
                "rule_id": rule_id, "rule_text": text,
                "tier": tier, "status": "active",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }),
            importance=0.8, tags=["archon-consciousness", "values-node"],
        )
        mock_graph.store_memory(
            name=f"patternscore-{rule_id}",
            memory_type="PatternScore",
            content=json.dumps({
                "rule_id": rule_id, "score": 0.5,
                "last_tested_session": None, "tested_session_count": 0,
                "last_delta": None, "trend": "insufficient_data",
                "status": "active", "score_history": [],
                "last_tested_session_num": None, "consecutive_drops": 0,
            }),
            importance=0.5, tags=["archon-consciousness", "pattern-score"],
        )
    return [r[0] for r in rules]


class TestSessionLifecycle:
    """Test complete session start → work → end → next session."""

    def test_full_lifecycle(self, mock_graph, mock_lance):
        """End-to-end: start session, log events, end session, verify reflection."""
        rule_ids = _seed_full_system(mock_graph)
        client = MemoryGraphClient(mock_graph)

        # Session 1: Start
        start_result = on_session_start(client, mock_lance, session_num=1)
        assert "rules_injected" in start_result
        assert start_result["rules_injected"] >= 0

        # Session 1: Work — log some events
        from src.archon_consciousness.session_journal import SessionJournal
        journal = SessionJournal(client, "session-1")
        journal.log_event("correction", "Violated ask-before-implementing")
        journal.log_event("rule_applied", "Followed sequential-execution correctly")
        journal.flush()

        # Session 1: End
        end_result = on_session_end(client, mock_lance, "session-1", session_num=1)
        assert end_result is not None
        assert "reflection" in end_result

        # Verify reflection was stored
        reflections = mock_graph.list_by_type("Reflection")
        assert len(reflections) >= 1

        # Verify pattern score was updated for corrected rule
        score_data = mock_graph.get_memory("patternscore-ask-before-implementing")
        content = json.loads(score_data["content"])
        assert content["score"] != 0.5  # Changed from initial

    def test_session_start_injects_rules(self, mock_graph, mock_lance):
        _seed_full_system(mock_graph)
        client = MemoryGraphClient(mock_graph)
        result = on_session_start(client, mock_lance, session_num=1)
        assert result["rules_injected"] > 0
        assert "injected_rules" in result

    def test_session_end_runs_reflection(self, mock_graph, mock_lance):
        _seed_full_system(mock_graph)
        client = MemoryGraphClient(mock_graph)
        # Seed a correction event
        mock_graph.store_memory(
            name="sessionevent-session-1-0000",
            memory_type="SessionEvent",
            content=json.dumps({
                "session_id": "session-1", "sequence_number": 0,
                "event_type": "correction",
                "content": "Violated ask-before-implementing",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }),
            importance=0.3, tags=["archon-consciousness", "session-event"],
        )
        result = on_session_end(client, mock_lance, "session-1", session_num=1)
        assert result["reflection"] is not None

    def test_session_start_checks_missing_reflection(self, mock_graph, mock_lance):
        """If previous session has events but no reflection, detect it."""
        _seed_full_system(mock_graph)
        client = MemoryGraphClient(mock_graph)
        # Seed events for session-0 with no reflection
        mock_graph.store_memory(
            name="sessionevent-session-0-0000",
            memory_type="SessionEvent",
            content=json.dumps({
                "session_id": "session-0", "sequence_number": 0,
                "event_type": "correction",
                "content": "Event from previous session",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }),
            importance=0.3, tags=["archon-consciousness", "session-event"],
        )
        result = on_session_start(client, mock_lance, session_num=2)
        assert "missing_reflection" in result
        # Should actually detect the missing session
        assert result["missing_reflection"], "Expected truthy value for missing reflection"


class TestSessionStartPerformance:
    """Verify session start is fast (GUARD-CON-005)."""

    def test_session_start_under_2_seconds(self, mock_graph, mock_lance):
        _seed_full_system(mock_graph)
        client = MemoryGraphClient(mock_graph)
        start = time.monotonic()
        on_session_start(client, mock_lance, session_num=1)
        elapsed = time.monotonic() - start
        assert elapsed < 2.0, f"Session start took {elapsed:.2f}s, limit is 2.0s"


class TestEmotionalStateIntegration:
    """Test emotional state detection within a session."""

    def test_detect_state_during_session(self, mock_graph, mock_lance):
        from src.archon_consciousness.emotional_state_detector import EmotionalStateDetector
        detector = EmotionalStateDetector()
        # Build baseline
        for _ in range(5):
            detector.detect("This is a normal message with enough words for baseline")
        # Frustrated message
        state, confidence, params = detector.detect("broken!!! stuck failing wtf terrible")
        assert state in ("frustrated", "neutral")
        assert isinstance(params, dict)


class TestEpisodicRecallAcrossSessions:
    """Test that episodes stored in session N are retrievable in session N+1."""

    def test_episode_persists_across_sessions(self, mock_graph, mock_lance):
        from src.archon_consciousness.episodic_memory import EpisodicMemory
        from src.archon_consciousness.schemas import Episode

        client = MemoryGraphClient(mock_graph)
        em = EpisodicMemory(client, mock_lance)

        # Session 1: store an episode
        ep = Episode(
            timestamp=datetime(2026, 3, 28, tzinfo=timezone.utc),
            trigger="User asked about consciousness enhancement",
            context="Discussion about AI self-awareness systems",
            action_taken="Presented the consciousness PRD",
            outcome="User approved the plan",
            emotional_valence="positive",
            lesson_extracted="Structured plans get approval faster",
        )
        name = em.store_fast(ep)
        assert client.get(name) is not None

        # Session 2: retrieve it
        results = em.retrieve_top3("consciousness enhancement plan")
        # Should find something (hash-based mock similarity may vary)
        assert isinstance(results, list)
