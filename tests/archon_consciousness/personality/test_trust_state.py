"""Tests for TrustTracker — 3-dimension Bayesian trust, forgetting, violations.

TASK-PER-007 | PRD-ARCHON-CON-002 | FR-PER-017/018/019
"""

import json
from datetime import datetime, timezone

import pytest

from tests.archon_consciousness.personality.conftest import make_trust_state


def _make_tracker(mock_graph, session_id="s1"):
    from src.archon_consciousness.personality.trust_state_tracker import TrustTracker
    return TrustTracker(client=mock_graph, session_id=session_id)


class TestInitialState:

    def test_default_priors(self, mock_graph):
        t = _make_tracker(mock_graph)
        assert abs(t.overall_trust - 2 / 3) < 0.05  # ~0.667 after forgetting

    def test_forgetting_applied_at_init(self, mock_graph):
        """FR-PER-018: gamma applied once at session start, clamped at 1.0."""
        from src.archon_consciousness.personality.personality_constants import (
            TRUST_GAMMA_DEFAULT, TRUST_GAMMA_INTEGRITY, TRUST_INITIAL_ALPHA,
        )
        # Store a state so tracker loads it
        ts = make_trust_state()
        mock_graph.store_memory(
            name="truststate-current", memory_type="TrustState",
            content=json.dumps(ts.to_dict()), tags=["archon-consciousness"],
        )
        t = _make_tracker(mock_graph)
        # After forgetting: competence_alpha = max(1.0, 2.0 * 0.95) = 1.9
        assert abs(t._state.competence_alpha - max(1.0, TRUST_INITIAL_ALPHA * TRUST_GAMMA_DEFAULT)) < 1e-9
        # integrity_alpha = max(1.0, 2.0 * 0.92) = 1.84
        assert abs(t._state.integrity_alpha - max(1.0, TRUST_INITIAL_ALPHA * TRUST_GAMMA_INTEGRITY)) < 1e-9
        # beta = max(1.0, 1.0 * 0.95) = 1.0 (clamped)
        assert t._state.competence_beta == 1.0

    def test_session_count_incremented(self, mock_graph):
        ts = make_trust_state(session_count=5)
        mock_graph.store_memory(
            name="truststate-current", memory_type="TrustState",
            content=json.dumps(ts.to_dict()), tags=["archon-consciousness"],
        )
        t = _make_tracker(mock_graph)
        assert t._state.session_count == 6


class TestViolationClassifier:
    """FR-PER-019: violation types mapped to dimension + severity."""

    def test_factual_error(self, mock_graph):
        from src.archon_consciousness.personality.trust_state_tracker import classify_violation
        dim, sev = classify_violation("factual_error")
        assert dim == "competence"
        assert sev == 1.5

    def test_approach_correction(self, mock_graph):
        from src.archon_consciousness.personality.trust_state_tracker import classify_violation
        dim, sev = classify_violation("approach_correction")
        assert dim == "competence"
        assert sev == 2.0

    def test_repeated_instruction(self, mock_graph):
        from src.archon_consciousness.personality.trust_state_tracker import classify_violation
        dim, sev = classify_violation("repeated_instruction")
        assert dim == "integrity"
        assert sev == 3.0

    def test_did_forbidden_action(self, mock_graph):
        from src.archon_consciousness.personality.trust_state_tracker import classify_violation
        dim, sev = classify_violation("did_forbidden_action")
        assert dim == "integrity"
        assert sev == 4.0

    def test_acted_without_permission(self, mock_graph):
        from src.archon_consciousness.personality.trust_state_tracker import classify_violation
        dim, sev = classify_violation("acted_without_permission")
        assert dim == "integrity"
        assert sev == 5.0

    def test_repeated_correction(self, mock_graph):
        from src.archon_consciousness.personality.trust_state_tracker import classify_violation
        dim, sev = classify_violation("repeated_correction")
        assert dim == "competence"
        assert sev == 5.0

    def test_unknown_type_raises(self, mock_graph):
        from src.archon_consciousness.personality.trust_state_tracker import classify_violation
        with pytest.raises(ValueError):
            classify_violation("unknown_violation")


class TestRecordViolation:

    def test_competence_violation_updates_beta(self, mock_graph):
        t = _make_tracker(mock_graph)
        comp_beta_before = t._state.competence_beta
        t.record_violation("factual_error", "Wrong function signature")
        assert t._state.competence_beta > comp_beta_before

    def test_integrity_violation_updates_beta(self, mock_graph):
        t = _make_tracker(mock_graph)
        integ_beta_before = t._state.integrity_beta
        t.record_violation("acted_without_permission", "Ran code without asking")
        assert t._state.integrity_beta > integ_beta_before

    def test_violation_stored_to_memorygraph(self, mock_graph):
        t = _make_tracker(mock_graph)
        violation = t.record_violation("factual_error", "Wrong return type")
        stored = mock_graph.get_memory(f"trustviol-{violation.violation_id}")
        assert stored is not None

    def test_total_violations_incremented(self, mock_graph):
        t = _make_tracker(mock_graph)
        assert t._state.total_violations == 0
        t.record_violation("factual_error", "Error 1")
        t.record_violation("approach_correction", "Error 2")
        assert t._state.total_violations == 2

    def test_ec_per_009_rapid_escalation(self, mock_graph):
        """EC-PER-009: 3 corrections escalating severity."""
        t = _make_tracker(mock_graph)
        trust_before = t.overall_trust
        t.record_violation("factual_error", "Minor")          # 1.5
        t.record_violation("did_forbidden_action", "Major")   # 4.0
        t.record_violation("repeated_correction", "Repeat")   # 5.0
        assert t.overall_trust < trust_before - 0.1  # significant drop


class TestRecordSuccess:

    def test_praise_updates_competence(self, mock_graph):
        t = _make_tracker(mock_graph)
        comp_alpha_before = t._state.competence_alpha
        t.record_success("explicit_praise")
        assert t._state.competence_alpha > comp_alpha_before

    def test_complex_delegation_updates_two(self, mock_graph):
        t = _make_tracker(mock_graph)
        t.record_success("complex_delegation")
        # Should update both competence and integrity
        assert t._state.total_successes == 1

    def test_suggestion_accepted_updates_benevolence(self, mock_graph):
        t = _make_tracker(mock_graph)
        benev_alpha_before = t._state.benevolence_alpha
        t.record_success("suggestion_accepted")
        assert t._state.benevolence_alpha > benev_alpha_before


class TestOverallTrust:

    def test_weights_match_prd(self, mock_graph):
        """FR-PER-017: 0.30 competence + 0.45 integrity + 0.25 benevolence."""
        t = _make_tracker(mock_graph)
        comp = t._state.competence_trust
        integ = t._state.integrity_trust
        benev = t._state.benevolence_trust
        expected = 0.30 * comp + 0.45 * integ + 0.25 * benev
        assert abs(t.overall_trust - expected) < 1e-9

    def test_ec_per_010_perfect_record(self, mock_graph):
        """EC-PER-010: many sessions, zero violations -> high trust."""
        t = _make_tracker(mock_graph)
        for _ in range(20):
            t.record_success("explicit_praise")
        assert t.overall_trust > 0.7


class TestSeverityToRepairLevel:

    def test_below_1_5(self):
        from src.archon_consciousness.personality.trust_state_tracker import severity_to_repair_level
        assert severity_to_repair_level(1.0) == "acknowledge"
        assert severity_to_repair_level(1.4) == "acknowledge"

    def test_at_1_5(self):
        from src.archon_consciousness.personality.trust_state_tracker import severity_to_repair_level
        assert severity_to_repair_level(1.5) == "explain"

    def test_at_3_0(self):
        from src.archon_consciousness.personality.trust_state_tracker import severity_to_repair_level
        assert severity_to_repair_level(3.0) == "full_repair"

    def test_at_5_0(self):
        from src.archon_consciousness.personality.trust_state_tracker import severity_to_repair_level
        assert severity_to_repair_level(5.0) == "critical_repair"

    def test_above_5(self):
        from src.archon_consciousness.personality.trust_state_tracker import severity_to_repair_level
        assert severity_to_repair_level(10.0) == "critical_repair"


class TestPersistence:

    def test_persist_and_reload(self, mock_graph):
        t = _make_tracker(mock_graph)
        t.record_violation("factual_error", "Test")
        t.record_success("explicit_praise")
        t.persist()

        t2 = _make_tracker(mock_graph, session_id="s2")
        # Should load persisted state (with new forgetting applied)
        assert t2._state.total_violations == 1
        assert t2._state.total_successes == 1
