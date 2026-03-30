"""Tests for trust trend accumulation — velocity, volatility, frustration.

TASK-GAP-001 | Fixes FR-PER-022, FR-PER-023 placeholder components.
"""

import json
import math
from datetime import datetime, timezone

import pytest


def _make_health_with_history(mock_graph, trust_values=None, corrections_per_session=None):
    """Create TrustHealth with pre-populated trend history."""
    from src.archon_consciousness.personality.trust_state_tracker import TrustTracker
    from src.archon_consciousness.personality.trust_health import TrustHealth

    tracker = TrustTracker(client=mock_graph, session_id="s1")
    health = TrustHealth(tracker=tracker, client=mock_graph)

    if trust_values:
        for v in trust_values:
            health.record_session_trust(v)
    if corrections_per_session:
        for c in corrections_per_session:
            health.record_session_corrections(c)
    return health


class TestTrustVelocity:

    def test_no_history_zero(self, mock_graph):
        h = _make_health_with_history(mock_graph)
        assert h._compute_velocity() == 0.0

    def test_improving_positive(self, mock_graph):
        h = _make_health_with_history(mock_graph, trust_values=[0.5, 0.6, 0.7])
        assert h._compute_velocity() > 0

    def test_declining_negative(self, mock_graph):
        h = _make_health_with_history(mock_graph, trust_values=[0.7, 0.6, 0.5])
        assert h._compute_velocity() < 0

    def test_stable_near_zero(self, mock_graph):
        h = _make_health_with_history(mock_graph, trust_values=[0.6, 0.6, 0.6])
        assert abs(h._compute_velocity()) < 0.01


class TestTrustVolatility:

    def test_no_history_zero(self, mock_graph):
        h = _make_health_with_history(mock_graph)
        assert h._compute_volatility() == 0.0

    def test_stable_low(self, mock_graph):
        h = _make_health_with_history(mock_graph, trust_values=[0.6] * 10)
        assert h._compute_volatility() < 0.01

    def test_volatile_high(self, mock_graph):
        h = _make_health_with_history(mock_graph, trust_values=[0.3, 0.8, 0.3, 0.8, 0.3, 0.8])
        assert h._compute_volatility() > 0.2


class TestFrustrationTrend:

    def test_no_corrections_zero(self, mock_graph):
        h = _make_health_with_history(mock_graph)
        assert h._compute_frustration_trend() == 0.0

    def test_increasing_corrections_positive(self, mock_graph):
        h = _make_health_with_history(mock_graph, corrections_per_session=[0, 1, 2, 3, 4])
        assert h._compute_frustration_trend() > 0

    def test_decreasing_corrections_negative(self, mock_graph):
        h = _make_health_with_history(mock_graph, corrections_per_session=[4, 3, 2, 1, 0])
        assert h._compute_frustration_trend() < 0


class TestHealthGradeNoPlaceholders:

    def test_grade_uses_real_velocity(self, mock_graph):
        h = _make_health_with_history(mock_graph, trust_values=[0.5, 0.6, 0.7])
        _, _, components = h.compute_grade()
        # Velocity should NOT be 0.5 (the neutral default from placeholder)
        assert components["trust_velocity"] != 0.5 or h._compute_velocity() == 0.0

    def test_grade_uses_real_volatility(self, mock_graph):
        h = _make_health_with_history(mock_graph, trust_values=[0.3, 0.8] * 5)
        _, _, components = h.compute_grade()
        # Volatility component should be low (high volatility = low component)
        assert components["trust_volatility"] < 0.8

    def test_trend_history_capped_at_50(self, mock_graph):
        h = _make_health_with_history(mock_graph, trust_values=[0.5 + i * 0.005 for i in range(60)])
        assert len(h._trust_history) <= 50


class TestTrendPersistence:

    def test_trends_stored_to_memorygraph(self, mock_graph):
        from src.archon_consciousness.personality.trust_health import TrustHealth
        from src.archon_consciousness.personality.trust_state_tracker import TrustTracker

        tracker = TrustTracker(client=mock_graph, session_id="s1")
        health = TrustHealth(tracker=tracker, client=mock_graph)
        for v in [0.5, 0.6, 0.7]:
            health.record_session_trust(v)
        health.persist_trends()

        stored = mock_graph.get_memory("trust-trends-current")
        assert stored is not None
        data = json.loads(stored["content"])
        assert "trust_history" in data
        assert len(data["trust_history"]) == 3

    def test_trends_loaded_from_memorygraph(self, mock_graph):
        from src.archon_consciousness.personality.trust_health import TrustHealth
        from src.archon_consciousness.personality.trust_state_tracker import TrustTracker

        # Store trend data
        mock_graph.store_memory(
            name="trust-trends-current",
            memory_type="TrustTrends",
            content=json.dumps({
                "trust_history": [0.5, 0.6, 0.7],
                "corrections_history": [2, 1, 0],
            }),
            tags=["archon-consciousness", "archon-personality", "trust-trends"],
        )
        tracker = TrustTracker(client=mock_graph, session_id="s2")
        health = TrustHealth(tracker=tracker, client=mock_graph)
        assert len(health._trust_history) == 3
        assert health._compute_velocity() > 0
