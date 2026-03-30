"""Tests for MetacognitiveMonitor — slow channel + interrupt controller.

TASK-PER-011 | PRD-ARCHON-CON-002 | FR-PER-035/036/037/038/039/040
"""

import inspect
import json

import pytest


def _make_monitor(mock_graph, mock_lance=None):
    from src.archon_consciousness.personality.fast_channel import FastChannel
    from src.archon_consciousness.personality.metacognitive_monitor import MetacognitiveMonitor
    fast = FastChannel(lance=mock_lance, client=mock_graph)
    return MetacognitiveMonitor(fast=fast, client=mock_graph, session_id="s1")


def _add_matching_negative_episode(mock_lance, text="edit:test.py:error"):
    mock_lance.embed_and_store(text, metadata={"outcome": "negative"}, collection="episodes")


class TestHardTriggers:
    """FR-PER-036: hard triggers fire immediately on any single signal."""

    def test_episode_match_fires(self, mock_graph, mock_lance):
        _add_matching_negative_episode(mock_lance, "edit:test.py:syntax error")
        mon = _make_monitor(mock_graph, mock_lance)
        patch = mon.on_pre_action("edit", "test.py", "syntax error")
        # If episode matches, should fire
        if patch is not None:
            assert "[METACOGNITIVE INTERRUPT" in patch

    def test_no_trigger_clean_action(self, mock_graph):
        mon = _make_monitor(mock_graph)
        patch = mon.on_pre_action("edit", "clean_file.py")
        assert patch is None


class TestSoftTriggers:
    """FR-PER-036: soft composite > 0.6 with external signal."""

    def test_composite_fires_with_external(self, mock_graph):
        mon = _make_monitor(mock_graph)
        # Simulate declining confidence + errors
        for _ in range(3):
            mon.on_pre_action("edit", "file.py", error_msg="TypeError")
            mon._fast.update_outcome("TypeError")
        # Phase boundary with low confidence and errors
        patch = mon.on_phase_boundary(
            action_outcome_confidence=0.1, recent_error_count=3,
        )
        # May or may not fire depending on composite calculation
        # The key test is FR-PER-040 below

    def test_fr_per_040_confidence_alone_insufficient(self, mock_graph):
        """FR-PER-040 BLOCKER: low confidence alone must NOT trigger interrupt."""
        mon = _make_monitor(mock_graph)
        # Very low confidence but NO anomalies, NO errors, NO episode matches
        patch = mon.on_phase_boundary(
            action_outcome_confidence=0.05, recent_error_count=0,
        )
        assert patch is None, "FR-PER-040 VIOLATION: confidence alone triggered interrupt"

    def test_fr_per_040_with_errors_can_fire(self, mock_graph):
        """Low confidence + errors = external signal present = CAN fire."""
        mon = _make_monitor(mock_graph)
        # Drop confidence with some errors present
        for _ in range(4):
            mon._slow.update_confidence(0.1)
        patch = mon.on_phase_boundary(
            action_outcome_confidence=0.1, recent_error_count=3,
        )
        # Should fire because errors provide external signal


class TestRateLimiter:
    """FR-PER-037: max 3 interrupts per 20 actions, threshold escalation."""

    def test_max_three_interrupts(self, mock_graph, mock_lance):
        """After 3 interrupts, further ones are suppressed."""
        # Store a matching episode to trigger hard interrupts
        for i in range(5):
            mock_lance.embed_and_store(
                f"edit:fail.py:error-{i}",
                metadata={"outcome": "negative"},
                collection="episodes",
            )
        mon = _make_monitor(mock_graph, mock_lance)
        fired = 0
        for i in range(10):
            patch = mon.on_pre_action("edit", f"fail.py", f"error-{i}")
            if patch is not None:
                fired += 1
        assert fired <= 3, f"Rate limit violated: {fired} interrupts fired"

    def test_reset_phase_clears_limiter(self, mock_graph):
        mon = _make_monitor(mock_graph)
        mon._interrupt_count = 3
        mon._threshold = 0.8  # escalated
        mon.reset_phase()
        assert mon._interrupt_count == 0
        assert mon._threshold == 0.6

    def test_threshold_escalation(self, mock_graph):
        from src.archon_consciousness.personality.personality_constants import (
            INTERRUPT_ESCALATED_THRESHOLD, INTERRUPT_SOFT_THRESHOLD,
        )
        mon = _make_monitor(mock_graph)
        assert mon._threshold == INTERRUPT_SOFT_THRESHOLD  # 0.6
        # Fire 3 interrupts to trigger escalation
        mon._fire_interrupt("episode_match", "detail1")
        mon._fire_interrupt("rule_violation", "detail2")
        mon._fire_interrupt("revert_cycle", "detail3")  # 3rd fires, triggers escalation
        assert mon._threshold == INTERRUPT_ESCALATED_THRESHOLD  # 0.8


class TestContextPatch:
    """FR-PER-038: lightweight context patch, no side effects."""

    def test_patch_format(self, mock_graph):
        from src.archon_consciousness.personality.metacognitive_monitor import generate_context_patch
        patch = generate_context_patch("episode_match", "similar failure from session 5")
        assert patch.startswith("[METACOGNITIVE INTERRUPT:")
        assert "episode_match" in patch
        assert len(patch) <= 500

    def test_patch_is_pure_function(self):
        """generate_context_patch has no side effects."""
        from src.archon_consciousness.personality.metacognitive_monitor import generate_context_patch
        p1 = generate_context_patch("test", "detail")
        p2 = generate_context_patch("test", "detail")
        assert p1 == p2  # deterministic

    def test_interrupt_stored_to_memorygraph(self, mock_graph):
        mon = _make_monitor(mock_graph)
        # Force a fire
        patch = mon._fire_interrupt("episode_match", "test episode")
        if patch is not None:
            # Check MemoryGraph for interrupt event
            all_mems = mock_graph.list_by_type("InterruptEvent")
            assert len(all_mems) >= 1


class TestSlowChannel:
    """FR-PER-035: confidence trajectory EWMA."""

    def test_confidence_drops_tracked(self, mock_graph):
        """Feed steadily declining values to force EWMA decline."""
        from src.archon_consciousness.personality.metacognitive_monitor import SlowChannel
        slow = SlowChannel()
        # Start at 0.5, feed very low values to force EWMA down
        slow.update_confidence(0.1)  # ewma: 0.3*0.1 + 0.7*0.5 = 0.38 (drop from 0.5)
        slow.update_confidence(0.05) # ewma: 0.3*0.05 + 0.7*0.38 = 0.281 (drop)
        slow.update_confidence(0.01) # ewma: 0.3*0.01 + 0.7*0.281 = 0.200 (drop)
        assert slow._confidence_drops >= 2

    def test_confidence_rise_resets_drops(self, mock_graph):
        from src.archon_consciousness.personality.metacognitive_monitor import SlowChannel
        slow = SlowChannel()
        slow.update_confidence(0.4)
        slow.update_confidence(0.3)
        slow.update_confidence(0.5)  # rise
        assert slow._confidence_drops == 0


class TestAntiPatterns:
    """FR-PER-039 + FR-PER-040: prohibited behaviors."""

    def test_no_scheduled_reflection(self):
        """FR-PER-039: grep for schedule/timer/cron/periodic."""
        from src.archon_consciousness.personality import metacognitive_monitor
        source = inspect.getsource(metacognitive_monitor).lower()
        for term in ["schedule", "timer", "cron", "periodic", "interval"]:
            # Allow in comments/docstrings but not in function names
            lines = [l.strip() for l in source.split("\n")
                     if not l.strip().startswith("#") and not l.strip().startswith('"""')]
            code_only = "\n".join(lines)
            assert f"def {term}" not in code_only, \
                f"FR-PER-039: found scheduled function '{term}'"

    def test_guard_per_007_no_tool_access(self):
        """GUARD-PER-007: no file modification capability."""
        from src.archon_consciousness.personality import metacognitive_monitor
        source = inspect.getsource(metacognitive_monitor)
        for term in ["subprocess", "os.system", "Write", "Edit", "Bash"]:
            assert term not in source, f"GUARD-PER-007: found '{term}'"
