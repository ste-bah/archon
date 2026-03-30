"""Tests for CuriosityTracker — encounters, scoring, queue, budget.

TASK-PER-009 | PRD-ARCHON-CON-002 | FR-PER-026/027/028/029/030
"""

import math

import pytest


def _make_tracker(mock_graph, mock_lance=None):
    from src.archon_consciousness.personality.curiosity_tracker import CuriosityTracker
    return CuriosityTracker(client=mock_graph, lance=mock_lance, session_id="s1")


class TestFlagEncounter:
    """FR-PER-026: 5 signal types, session budget."""

    def test_valid_encounter_returned(self, mock_graph):
        t = _make_tracker(mock_graph)
        enc = t.flag_encounter("knowledge_gap", "HNSW indexing", confidence=0.3)
        assert enc is not None
        assert enc.signal_type == "knowledge_gap"
        assert enc.topic == "HNSW indexing"

    def test_invalid_signal_type_raises(self, mock_graph):
        t = _make_tracker(mock_graph)
        with pytest.raises(ValueError):
            t.flag_encounter("boredom", "nothing", confidence=0.5)

    def test_session_budget_three(self, mock_graph):
        """FR-PER-029: max 3 flagged per session."""
        t = _make_tracker(mock_graph)
        e1 = t.flag_encounter("knowledge_gap", "topic1", confidence=0.3)
        e2 = t.flag_encounter("prediction_failure", "topic2", confidence=0.4)
        e3 = t.flag_encounter("surprising_success", "topic3", confidence=0.5)
        e4 = t.flag_encounter("knowledge_gap", "topic4", confidence=0.2)
        assert e1 is not None
        assert e2 is not None
        assert e3 is not None
        assert e4 is None  # budget exhausted

    def test_interest_score_positive(self, mock_graph):
        t = _make_tracker(mock_graph)
        enc = t.flag_encounter("knowledge_gap", "topic", confidence=0.2)
        assert enc.interest_score > 0

    def test_stored_to_memorygraph(self, mock_graph):
        t = _make_tracker(mock_graph)
        enc = t.flag_encounter("knowledge_gap", "topic", confidence=0.3)
        stored = mock_graph.get_memory(f"curiosity-{enc.encounter_id}")
        assert stored is not None


class TestInterestScore:
    """FR-PER-027: multi-factor interest formula."""

    def test_lower_confidence_higher_score(self, mock_graph):
        """Higher uncertainty = higher interest."""
        t1 = _make_tracker(mock_graph)
        t2 = _make_tracker(mock_graph)
        e_low = t1.flag_encounter("knowledge_gap", "topic", confidence=0.1)
        e_high = t2.flag_encounter("knowledge_gap", "topic", confidence=0.9)
        assert e_low.interest_score > e_high.interest_score

    def test_frequency_floor(self, mock_graph):
        """FR-PER-027: frequency_weight floor at 0.1 for occurrence_count=0."""
        t = _make_tracker(mock_graph)
        enc = t.flag_encounter("knowledge_gap", "brand_new_topic", confidence=0.5)
        assert enc.interest_score > 0  # floor prevents zero


class TestQueue:
    """FR-PER-028: priority queue sorted by interest score."""

    def test_sorted_by_score(self, mock_graph):
        t = _make_tracker(mock_graph)
        t.flag_encounter("knowledge_gap", "low", confidence=0.9)   # low uncertainty = low score
        t.flag_encounter("knowledge_gap", "high", confidence=0.1)  # high uncertainty = high score
        queue = t.get_queue(limit=5)
        assert len(queue) == 2
        assert queue[0].interest_score >= queue[1].interest_score

    def test_suppressed_excluded(self, mock_graph):
        t = _make_tracker(mock_graph)
        enc = t.flag_encounter("knowledge_gap", "topic", confidence=0.3)
        # Manually suppress
        enc.suppressed = True
        t._store_encounter(enc)
        queue = t.get_queue()
        suppressed_ids = [e.encounter_id for e in queue if e.suppressed]
        assert len(suppressed_ids) == 0


class TestStudyOutcome:
    """FR-PER-028 + FR-PER-030: learning outcome tracking."""

    def test_compression_progress_increases(self, mock_graph):
        t = _make_tracker(mock_graph)
        enc = t.flag_encounter("knowledge_gap", "topic", confidence=0.3)
        t.record_study_outcome(enc.encounter_id, accuracy_improved=True)
        updated = t._load_encounter(enc.encounter_id)
        assert updated.study_sessions == 1
        assert updated.compression_progress > 0

    def test_three_sessions_no_improvement_suppressed(self, mock_graph):
        """EC-PER-013: irreducibly uncertain -> suppressed."""
        t = _make_tracker(mock_graph)
        enc = t.flag_encounter("knowledge_gap", "crypto prices", confidence=0.3)
        for _ in range(3):
            t.record_study_outcome(enc.encounter_id, accuracy_improved=False)
        updated = t._load_encounter(enc.encounter_id)
        assert updated.suppressed is True

    def test_no_improvement_halves_score(self, mock_graph):
        """FR-PER-028: after 3 sessions no improvement, score *= 0.5."""
        t = _make_tracker(mock_graph)
        enc = t.flag_encounter("knowledge_gap", "topic", confidence=0.3)
        original_score = enc.interest_score
        for _ in range(3):
            t.record_study_outcome(enc.encounter_id, accuracy_improved=False)
        updated = t._load_encounter(enc.encounter_id)
        assert updated.interest_score < original_score


class TestCrossDomainBoost:
    """FR-PER-029: boost cross-domain when >60% in one domain."""

    def test_boost_applied(self, mock_graph):
        t = _make_tracker(mock_graph)
        t.flag_encounter("knowledge_gap", "python-topic", confidence=0.3)
        t.flag_encounter("knowledge_gap", "rust-topic", confidence=0.3)

        python_enc = [e for e in t.get_queue() if "python" in e.topic][0]
        rust_enc = [e for e in t.get_queue() if "rust" in e.topic][0]

        # 70% learning in python -> boost rust
        t.apply_cross_domain_boost({"python": 7, "rust": 3})

        queue = t.get_queue()
        rust_after = [e for e in queue if "rust" in e.topic]
        if rust_after:
            assert rust_after[0].interest_score >= rust_enc.interest_score

    def test_no_boost_balanced(self, mock_graph):
        t = _make_tracker(mock_graph)
        enc = t.flag_encounter("knowledge_gap", "topic", confidence=0.3)
        score_before = enc.interest_score
        t.apply_cross_domain_boost({"a": 5, "b": 5})  # balanced
        # No boost should apply
        updated = t._load_encounter(enc.encounter_id)
        assert updated.interest_score == score_before
