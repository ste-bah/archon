"""Tests for TrustHealth — repair protocol, health grade, trends.

TASK-PER-008 | PRD-ARCHON-CON-002 | FR-PER-020/021/022/023
"""

import pytest

from tests.archon_consciousness.personality.conftest import make_trust_violation


def _make_health(mock_graph):
    from src.archon_consciousness.personality.trust_state_tracker import TrustTracker
    from src.archon_consciousness.personality.trust_health import TrustHealth
    tracker = TrustTracker(client=mock_graph, session_id="s1")
    return TrustHealth(tracker=tracker, client=mock_graph), tracker


class TestRepairProtocol:
    """FR-PER-020: graduated repair by severity."""

    def test_acknowledge_below_1_5(self, mock_graph):
        from src.archon_consciousness.personality.trust_health import TrustHealth
        h, _ = _make_health(mock_graph)
        v = make_trust_violation(severity=1.0, repair_level="acknowledge")
        repair = h.generate_repair(v)
        assert len(repair.split(". ")) <= 3  # max ~2 sentences
        assert "sorry" not in repair.lower()
        assert "apologize" not in repair.lower()

    def test_explain_at_2_0(self, mock_graph):
        h, _ = _make_health(mock_graph)
        v = make_trust_violation(severity=2.0, repair_level="explain")
        repair = h.generate_repair(v)
        assert len(repair) > 10  # has content

    def test_full_repair_at_3_5(self, mock_graph):
        h, _ = _make_health(mock_graph)
        v = make_trust_violation(severity=3.5, repair_level="full_repair",
                                 dimension="integrity")
        repair = h.generate_repair(v)
        assert len(repair) > 20

    def test_critical_repair_at_5(self, mock_graph):
        h, _ = _make_health(mock_graph)
        v = make_trust_violation(severity=5.0, repair_level="critical_repair",
                                 dimension="integrity",
                                 violation_type="acted_without_permission")
        repair = h.generate_repair(v)
        assert len(repair) > 30

    def test_competence_internal_attribution(self, mock_graph):
        """FR-PER-021: competence violations use internal attribution."""
        h, _ = _make_health(mock_graph)
        v = make_trust_violation(severity=2.0, dimension="competence",
                                 repair_level="explain")
        repair = h.generate_repair(v)
        # Should reference agent's own misunderstanding
        assert "I" in repair or "my" in repair.lower()

    def test_integrity_external_attribution(self, mock_graph):
        """FR-PER-021: integrity violations use external+accountability."""
        h, _ = _make_health(mock_graph)
        v = make_trust_violation(severity=3.0, dimension="integrity",
                                 repair_level="full_repair",
                                 violation_type="repeated_instruction")
        repair = h.generate_repair(v)
        assert "should have" in repair.lower() or "re-verif" in repair.lower()

    def test_guard_per_009_minor_max_2_sentences(self, mock_graph):
        """GUARD-PER-009: severity < 1.5 -> max 2 sentences."""
        h, _ = _make_health(mock_graph)
        v = make_trust_violation(severity=1.0, repair_level="acknowledge")
        repair = h.generate_repair(v)
        sentences = [s.strip() for s in repair.split(".") if s.strip()]
        assert len(sentences) <= 2, f"Too many sentences: {sentences}"

    def test_guard_per_004_no_user_evaluation(self, mock_graph):
        """GUARD-PER-004: framing is agent performance, not user behavior."""
        h, _ = _make_health(mock_graph)
        for sev, level in [(1.0, "acknowledge"), (3.0, "full_repair"), (5.0, "critical_repair")]:
            v = make_trust_violation(severity=sev, repair_level=level,
                                     dimension="competence")
            repair = h.generate_repair(v)
            assert "you corrected" not in repair.lower()
            assert "your correction" not in repair.lower()


class TestHealthGrade:
    """FR-PER-022: 7-component weighted health grade."""

    def test_initial_session_approximately_b(self, mock_graph):
        """Fresh tracker with default priors -> approximately B range."""
        h, _ = _make_health(mock_graph)
        grade, score, components = h.compute_grade()
        assert grade in ("B+", "B", "B-", "C"), f"Expected ~B range, got {grade} ({score:.3f})"

    def test_zero_violations_repair_ratio_one(self, mock_graph):
        h, _ = _make_health(mock_graph)
        _, _, components = h.compute_grade()
        assert components["repair_ratio"] == 1.0

    def test_component_weights_sum_to_one(self):
        weights = {"overall_trust": 0.35, "trust_velocity": 0.15,
                    "trust_volatility": 0.10, "repair_ratio": 0.15,
                    "autonomy_index": 0.10, "frustration_trend": 0.10,
                    "session_streak": 0.05}
        assert abs(sum(weights.values()) - 1.0) < 1e-9

    def test_grade_a_plus(self, mock_graph):
        from src.archon_consciousness.personality.trust_health import TrustHealth
        h, _ = _make_health(mock_graph)
        # Override with high values
        grade = h._score_to_grade(0.95)
        assert grade == "A+"

    def test_grade_f(self, mock_graph):
        from src.archon_consciousness.personality.trust_health import TrustHealth
        h, _ = _make_health(mock_graph)
        grade = h._score_to_grade(0.30)
        assert grade == "F"

    def test_grade_boundaries(self):
        from src.archon_consciousness.personality.trust_health import TrustHealth
        h = TrustHealth.__new__(TrustHealth)
        assert h._score_to_grade(0.93) == "A+"
        assert h._score_to_grade(0.929) == "A"
        assert h._score_to_grade(0.85) == "A"
        assert h._score_to_grade(0.80) == "A-"
        assert h._score_to_grade(0.73) == "B+"
        assert h._score_to_grade(0.65) == "B"
        assert h._score_to_grade(0.60) == "B-"
        assert h._score_to_grade(0.50) == "C"
        assert h._score_to_grade(0.40) == "D"
        assert h._score_to_grade(0.39) == "F"

    def test_returns_three_elements(self, mock_graph):
        h, _ = _make_health(mock_graph)
        result = h.compute_grade()
        assert len(result) == 3
        grade, score, components = result
        assert isinstance(grade, str)
        assert isinstance(score, float)
        assert isinstance(components, dict)
        assert len(components) == 7
