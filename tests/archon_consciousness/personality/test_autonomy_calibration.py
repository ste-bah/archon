"""Tests for autonomy signals + proactive calibration.

TASK-GAP-002 | FR-PER-024, FR-PER-025
"""

import pytest


class TestAutonomyIndex:

    def test_all_direct_edits_low_autonomy(self, mock_graph):
        from src.archon_consciousness.personality.trust_health import TrustHealth
        from src.archon_consciousness.personality.trust_state_tracker import TrustTracker
        tracker = TrustTracker(client=mock_graph, session_id="s1")
        health = TrustHealth(tracker=tracker, client=mock_graph)
        # All direct Write/Edit, no Task delegation
        health.record_session_autonomy(task_calls=0, direct_edits=20)
        assert health._compute_autonomy_index() < 1.0

    def test_all_delegated_high_autonomy(self, mock_graph):
        from src.archon_consciousness.personality.trust_health import TrustHealth
        from src.archon_consciousness.personality.trust_state_tracker import TrustTracker
        tracker = TrustTracker(client=mock_graph, session_id="s1")
        health = TrustHealth(tracker=tracker, client=mock_graph)
        # All Task tool, no direct edits
        health.record_session_autonomy(task_calls=15, direct_edits=2)
        assert health._compute_autonomy_index() > 2.0

    def test_no_data_returns_zero(self, mock_graph):
        from src.archon_consciousness.personality.trust_health import TrustHealth
        from src.archon_consciousness.personality.trust_state_tracker import TrustTracker
        tracker = TrustTracker(client=mock_graph, session_id="s1")
        health = TrustHealth(tracker=tracker, client=mock_graph)
        assert health._compute_autonomy_index() == 0.0


class TestCalibrationHints:

    def test_new_user_gets_boundaries(self, mock_graph):
        from src.archon_consciousness.personality.trust_health import TrustHealth
        from src.archon_consciousness.personality.trust_state_tracker import TrustTracker
        tracker = TrustTracker(client=mock_graph, session_id="s1")
        health = TrustHealth(tracker=tracker, client=mock_graph)
        hints = health.get_calibration_hints(session_count=2)
        assert any("capabilit" in h.lower() for h in hints)

    def test_experienced_user_no_boundaries(self, mock_graph):
        from src.archon_consciousness.personality.trust_health import TrustHealth
        from src.archon_consciousness.personality.trust_state_tracker import TrustTracker
        tracker = TrustTracker(client=mock_graph, session_id="s1")
        health = TrustHealth(tracker=tracker, client=mock_graph)
        hints = health.get_calibration_hints(session_count=50)
        assert not any("capabilit" in h.lower() for h in hints)
