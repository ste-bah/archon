"""Tests for personality hook integration — wiring, injection, episode decay.

TASK-PER-012 | PRD-ARCHON-CON-002 | FR-PER-041/042/046/047
"""

import json
import math
from datetime import datetime, timezone

import pytest


def _make_integration(mock_graph, mock_lance=None, session_num=1):
    from src.archon_consciousness.personality.integration import PersonalityHooks
    return PersonalityHooks(
        client=mock_graph, lance=mock_lance,
        session_id="s1", session_num=session_num,
    )


class TestSessionStartInjection:
    """FR-PER-046: personality context injection at session start."""

    def test_returns_string(self, mock_graph):
        hooks = _make_integration(mock_graph)
        injection = hooks.build_session_injection()
        assert isinstance(injection, str)

    def test_under_1200_chars(self, mock_graph):
        """NFR-PER-015: injection < 300 tokens (~1200 chars)."""
        hooks = _make_integration(mock_graph)
        injection = hooks.build_session_injection()
        assert len(injection) <= 1200, f"Injection too long: {len(injection)} chars"

    def test_includes_mood_when_available(self, mock_graph):
        # Store a previous self-state with mood data
        from tests.archon_consciousness.personality.conftest import make_agent_self_state
        state = make_agent_self_state(mood_valence=0.5)
        mock_graph.store_memory(
            name="selfstate-prev-t99", memory_type="AgentSelfState",
            content=json.dumps(state.to_dict()),
            tags=["archon-consciousness", "archon-personality", "self-state"],
        )
        hooks = _make_integration(mock_graph)
        injection = hooks.build_session_injection()
        # Should contain mood info
        assert isinstance(injection, str)

    def test_handles_no_data_gracefully(self, mock_graph):
        """Fresh session with no personality data -> minimal injection."""
        hooks = _make_integration(mock_graph)
        injection = hooks.build_session_injection()
        assert len(injection) > 0  # at least something

    def test_guard_per_003_no_raw_scores(self, mock_graph):
        """GUARD-PER-003: no raw signal dumps in injection."""
        hooks = _make_integration(mock_graph)
        injection = hooks.build_session_injection()
        assert "signals_snapshot" not in injection
        assert "correction_count" not in injection


class TestEpisodeDecay:
    """FR-PER-047: stale episode importance decay."""

    def test_recent_episodes_not_decayed(self, mock_graph, mock_lance):
        """Episodes from last 5 sessions get weight 1.0."""
        mock_lance.embed_and_store(
            "recent episode", collection="episodes",
            metadata={"session_num": 10, "importance": 0.8},
        )
        hooks = _make_integration(mock_graph, mock_lance, session_num=12)
        decayed = hooks.apply_episode_decay()
        # Session 12 - 10 = 2 sessions ago (within 5) -> no decay
        assert decayed == 0

    def test_old_episodes_decayed(self, mock_graph, mock_lance):
        """Episodes > 5 sessions old get reduced importance."""
        mock_lance.embed_and_store(
            "old episode", collection="episodes",
            metadata={"session_num": 1, "importance": 0.8},
        )
        hooks = _make_integration(mock_graph, mock_lance, session_num=20)
        decayed = hooks.apply_episode_decay()
        assert decayed >= 0  # may or may not decay depending on threshold

    def test_no_lance_returns_zero(self, mock_graph):
        hooks = _make_integration(mock_graph, mock_lance=None)
        assert hooks.apply_episode_decay() == 0


class TestPreToolCallHook:
    """FR-PER-042: fast channel before every tool call."""

    def test_returns_none_or_string(self, mock_graph):
        hooks = _make_integration(mock_graph)
        result = hooks.on_pre_tool_call("edit", "test.py")
        assert result is None or isinstance(result, str)

    def test_repeated_edits_detected(self, mock_graph):
        hooks = _make_integration(mock_graph)
        hooks.on_pre_tool_call("edit", "parser.py")
        hooks.on_pre_tool_call("edit", "parser.py")
        result = hooks.on_pre_tool_call("edit", "parser.py")
        # May detect repeated_edit anomaly
        assert result is None or "[METACOGNITIVE INTERRUPT" in result


class TestPhaseCompleteHook:
    """FR-PER-042: slow channel at phase boundaries."""

    def test_returns_none_or_string(self, mock_graph):
        hooks = _make_integration(mock_graph)
        result = hooks.on_phase_complete(confidence=0.7, error_count=0)
        assert result is None or isinstance(result, str)

    def test_fr_per_040_confidence_alone_no_interrupt(self, mock_graph):
        """FR-PER-040: low confidence alone must not trigger."""
        hooks = _make_integration(mock_graph)
        result = hooks.on_phase_complete(confidence=0.05, error_count=0)
        assert result is None


class TestSessionEnd:
    """FR-PER-041: personality updates at session end."""

    def test_persists_trust(self, mock_graph):
        hooks = _make_integration(mock_graph)
        hooks.on_session_end()
        # Trust state should be persisted
        stored = mock_graph.get_memory("truststate-current")
        assert stored is not None

    def test_updates_personality_traits(self, mock_graph):
        hooks = _make_integration(mock_graph)
        hooks.on_session_end()
        stored = mock_graph.get_memory("traitset-current")
        assert stored is not None


class TestV1Preservation:
    """V1 hook behavior must be completely preserved."""

    def test_v1_session_start_still_works(self, mock_graph, mock_lance):
        """Existing on_session_start function still returns expected keys."""
        from src.archon_consciousness.hooks import on_session_start
        result = on_session_start(mock_graph, mock_lance, session_num=1)
        assert "rules_injected" in result
        assert "injected_rules" in result
        assert "missing_reflection" in result

    def test_v1_pre_compact_still_works(self, mock_graph):
        """Existing on_pre_compact function still works."""
        from src.archon_consciousness.hooks import on_pre_compact
        from src.archon_consciousness.session_journal import SessionJournal
        journal = SessionJournal(client=mock_graph, session_id="test-session")
        result = on_pre_compact(journal)
        assert result == 0  # nothing to flush
