"""Tests for AppraisalEngine, state classifier, and turn valence.

TDD test file — written BEFORE implementation.
Covers exact PRD formula weights, edge cases EC-PER-001/002/003,
neutral threshold boundary, and GUARD compliance.

TASK-PER-003 | PRD-ARCHON-CON-002 | FR-PER-002, FR-PER-003, FR-PER-048
"""

import json
import math
from datetime import datetime, timezone

import pytest

# Parent conftest provides mock_graph and mock_lance fixtures


# ─── Test Helpers ─────────────────────────────────────────────────

def _make_collector(mock_graph, mock_lance=None, **signal_overrides):
    """Create a SignalCollector with pre-set signal values.

    Records corrections/successes/plans/tasks to produce desired signals.
    For precise control, we manipulate internal counters directly.
    """
    from src.archon_consciousness.personality.signal_collector import SignalCollector

    sc = SignalCollector(client=mock_graph, lance=mock_lance)
    # Allow direct counter manipulation for test precision
    if "corrections" in signal_overrides:
        sc._corrections = signal_overrides["corrections"]
    if "total_interactions" in signal_overrides:
        sc._total_interactions = signal_overrides["total_interactions"]
    if "plans_submitted" in signal_overrides:
        sc._plans_submitted = signal_overrides["plans_submitted"]
    if "plans_approved" in signal_overrides:
        sc._plans_approved = signal_overrides["plans_approved"]
    if "tasks_attempted" in signal_overrides:
        sc._tasks_attempted = signal_overrides["tasks_attempted"]
    if "tasks_completed" in signal_overrides:
        sc._tasks_completed = signal_overrides["tasks_completed"]
    if "consecutive_successes" in signal_overrides:
        sc._consecutive_successes = signal_overrides["consecutive_successes"]
    if "consecutive_corrections" in signal_overrides:
        sc._consecutive_corrections = signal_overrides["consecutive_corrections"]
    if "values_violations" in signal_overrides:
        sc._values_violations = signal_overrides["values_violations"]
    if "user_state" in signal_overrides:
        sc._user_emotional_state = signal_overrides["user_state"]
    if "unresolved_conflicts" in signal_overrides:
        sc._unresolved_conflicts = signal_overrides["unresolved_conflicts"]
    if "total_conflicts" in signal_overrides:
        sc._total_conflicts = signal_overrides["total_conflicts"]
    return sc


def _perfect_signals():
    """Signal overrides for a perfect session (high confidence scenario)."""
    return {
        "corrections": 0, "total_interactions": 10,
        "plans_submitted": 5, "plans_approved": 5,
        "tasks_attempted": 5, "tasks_completed": 5,
        "consecutive_successes": 10, "consecutive_corrections": 0,
        "values_violations": 0, "user_state": "neutral",
    }


def _disastrous_signals():
    """Signal overrides for a terrible session (high anxiety/frustration)."""
    return {
        "corrections": 8, "total_interactions": 10,
        "plans_submitted": 5, "plans_approved": 1,
        "tasks_attempted": 5, "tasks_completed": 1,
        "consecutive_successes": 0, "consecutive_corrections": 5,
        "values_violations": 3, "user_state": "frustrated",
    }


# ─── Weight Verification ─────────────────────────────────────────


class TestWeightSums:
    """Every state's weights MUST sum to exactly 1.0."""

    def test_confident_weights_sum(self):
        from src.archon_consciousness.personality.personality_constants import STATE_WEIGHTS
        total = sum(STATE_WEIGHTS["confident"].values())
        assert abs(total - 1.0) < 1e-9, f"confident weights sum to {total}"

    def test_anxious_weights_sum(self):
        from src.archon_consciousness.personality.personality_constants import STATE_WEIGHTS
        total = sum(STATE_WEIGHTS["anxious"].values())
        assert abs(total - 1.0) < 1e-9, f"anxious weights sum to {total}"

    def test_frustrated_weights_sum(self):
        from src.archon_consciousness.personality.personality_constants import STATE_WEIGHTS
        total = sum(STATE_WEIGHTS["frustrated"].values())
        assert abs(total - 1.0) < 1e-9, f"frustrated weights sum to {total}"

    def test_engaged_weights_sum(self):
        from src.archon_consciousness.personality.personality_constants import STATE_WEIGHTS
        total = sum(STATE_WEIGHTS["engaged"].values())
        assert abs(total - 1.0) < 1e-9, f"engaged weights sum to {total}"

    def test_cautious_weights_sum(self):
        from src.archon_consciousness.personality.personality_constants import STATE_WEIGHTS
        total = sum(STATE_WEIGHTS["cautious"].values())
        assert abs(total - 1.0) < 1e-9, f"cautious weights sum to {total}"


# ─── State Classifier ────────────────────────────────────────────


class TestComputeStateScores:
    """FR-PER-003: weighted multi-signal scoring for 5 states."""

    def test_returns_five_states(self, mock_graph):
        from src.archon_consciousness.personality.appraisal_engine import compute_state_scores
        sc = _make_collector(mock_graph)
        scores = compute_state_scores(sc.collect(), sc)
        assert set(scores.keys()) == {"confident", "anxious", "frustrated", "engaged", "cautious"}

    def test_all_scores_non_negative(self, mock_graph):
        from src.archon_consciousness.personality.appraisal_engine import compute_state_scores
        sc = _make_collector(mock_graph)
        scores = compute_state_scores(sc.collect(), sc)
        for state, score in scores.items():
            assert score >= 0.0, f"{state} score is negative: {score}"

    def test_pure_confident_scenario(self, mock_graph):
        """All confident signals maxed -> confident score near 1.0."""
        from src.archon_consciousness.personality.appraisal_engine import compute_state_scores

        sc = _make_collector(mock_graph, **_perfect_signals())
        scores = compute_state_scores(sc.collect(), sc)
        # task_completion=1.0, plan_approval=1.0, past_success=0.0 (no episodes),
        # inv_correction_rate=(1-0)=1.0, streak_bonus=1.0
        # confident = 0.30*1 + 0.25*1 + 0.20*0 + 0.15*1 + 0.10*1 = 0.80
        assert scores["confident"] >= 0.7, f"confident={scores['confident']}"
        assert scores["confident"] == max(scores.values()), "confident should be highest"

    def test_pure_anxious_scenario(self, mock_graph):
        """High corrections, no past success -> anxious dominates."""
        from src.archon_consciousness.personality.appraisal_engine import compute_state_scores

        sc = _make_collector(mock_graph, **_disastrous_signals())
        scores = compute_state_scores(sc.collect(), sc)
        # inv_past_success=1.0, correction_rate=0.8, streak_penalty=1.0
        # anxious = 0.35*1.0 + 0.25*0.8 + 0.20*0 + 0.20*1.0 = 0.75
        assert scores["anxious"] >= 0.5, f"anxious={scores['anxious']}"

    def test_frustrated_with_user_frustrated(self, mock_graph):
        """User is frustrated + high corrections -> frustrated state."""
        from src.archon_consciousness.personality.appraisal_engine import compute_state_scores

        sc = _make_collector(mock_graph,
                             corrections=5, total_interactions=10,
                             plans_submitted=4, plans_approved=1,
                             consecutive_corrections=3,
                             user_state="frustrated")
        scores = compute_state_scores(sc.collect(), sc)
        # correction_rate=0.5, streak_penalty=0.6, user_frustrated=1.0, inv_plan_approval=0.75
        # frustrated = 0.30*0.5 + 0.25*0.6 + 0.25*1.0 + 0.20*0.75 = 0.15+0.15+0.25+0.15 = 0.70
        assert scores["frustrated"] >= 0.5, f"frustrated={scores['frustrated']}"

    def test_cautious_correction_rate_threshold(self, mock_graph):
        """correction_rate > 0.3 triggers cautious binary signal."""
        from src.archon_consciousness.personality.appraisal_engine import compute_state_scores

        # correction_rate = 0.31 (above threshold)
        sc_above = _make_collector(mock_graph, corrections=31, total_interactions=100)
        scores_above = compute_state_scores(sc_above.collect(), sc_above)

        # correction_rate = 0.29 (below threshold)
        sc_below = _make_collector(mock_graph, corrections=29, total_interactions=100)
        scores_below = compute_state_scores(sc_below.collect(), sc_below)

        # The 0.20 weight for correction_rate_high should differ
        assert scores_above["cautious"] > scores_below["cautious"]

    def test_cautious_uses_ambiguity_for_both_signals(self, mock_graph):
        """FR-PER-003: values_conflict uses same ambiguity_score() computation."""
        from src.archon_consciousness.personality.appraisal_engine import compute_state_scores

        sc = _make_collector(mock_graph,
                             unresolved_conflicts=3, total_conflicts=5)
        scores = compute_state_scores(sc.collect(), sc)
        # ambiguity = 3/5 = 0.6
        # cautious contribution from ambiguity + values_conflict = (0.35 + 0.25) * 0.6 = 0.36
        assert scores["cautious"] >= 0.3, f"cautious={scores['cautious']}"


class TestClassifyState:

    def test_ec_per_001_first_session_neutral(self, mock_graph):
        """EC-PER-001: first session, all defaults -> neutral."""
        from src.archon_consciousness.personality.appraisal_engine import (
            classify_state, compute_state_scores,
        )
        sc = _make_collector(mock_graph)
        scores = compute_state_scores(sc.collect(), sc)
        state = classify_state(scores)
        assert state == "neutral", f"Expected neutral, got {state} with scores {scores}"

    def test_ec_per_002_all_perfect_confident(self, mock_graph):
        """EC-PER-002: all signals perfect -> confident."""
        from src.archon_consciousness.personality.appraisal_engine import (
            classify_state, compute_state_scores,
        )
        sc = _make_collector(mock_graph, **_perfect_signals())
        scores = compute_state_scores(sc.collect(), sc)
        state = classify_state(scores)
        assert state == "confident", f"Expected confident, got {state} with scores {scores}"

    def test_ec_per_003_contradictory_highest_wins(self, mock_graph):
        """EC-PER-003: contradictory signals -> highest-scoring state wins."""
        from src.archon_consciousness.personality.appraisal_engine import (
            classify_state, compute_state_scores,
        )
        # High completion but high corrections — multiple states will score
        sc = _make_collector(mock_graph,
                             corrections=5, total_interactions=10,
                             tasks_attempted=10, tasks_completed=9,
                             plans_submitted=5, plans_approved=4,
                             consecutive_successes=2, consecutive_corrections=0,
                             user_state="neutral")
        scores = compute_state_scores(sc.collect(), sc)
        state = classify_state(scores)
        # Whatever wins, it should be the highest score
        assert state == max(scores, key=scores.get) or (
            scores[max(scores, key=scores.get)] < 0.4 and state == "neutral"
        )

    def test_neutral_threshold_below(self, mock_graph):
        """All scores < 0.4 -> neutral."""
        from src.archon_consciousness.personality.appraisal_engine import classify_state
        scores = {"confident": 0.39, "anxious": 0.35, "frustrated": 0.30,
                  "engaged": 0.38, "cautious": 0.20}
        assert classify_state(scores) == "neutral"

    def test_neutral_threshold_at_boundary(self, mock_graph):
        """Score exactly 0.4 -> NOT neutral (PRD: < 0.4 is neutral)."""
        from src.archon_consciousness.personality.appraisal_engine import classify_state
        scores = {"confident": 0.4, "anxious": 0.35, "frustrated": 0.30,
                  "engaged": 0.38, "cautious": 0.20}
        assert classify_state(scores) == "confident"

    def test_winner_takes_all(self):
        """Highest-scoring state wins."""
        from src.archon_consciousness.personality.appraisal_engine import classify_state
        scores = {"confident": 0.3, "anxious": 0.7, "frustrated": 0.5,
                  "engaged": 0.4, "cautious": 0.6}
        assert classify_state(scores) == "anxious"


# ─── Turn Valence (FR-PER-048) ────────────────────────────────────


class TestComputeTurnValence:

    def test_all_positive(self):
        """confidence + engagement maxed, rest zero -> valence = 1.0."""
        from src.archon_consciousness.personality.appraisal_engine import compute_turn_valence
        scores = {"confident": 1.0, "anxious": 0.0, "frustrated": 0.0,
                  "engaged": 1.0, "cautious": 0.0}
        valence = compute_turn_valence(scores)
        assert abs(valence - 1.0) < 1e-9

    def test_all_negative(self):
        """anxiety + frustration + caution maxed, rest zero -> valence = -1.0."""
        from src.archon_consciousness.personality.appraisal_engine import compute_turn_valence
        scores = {"confident": 0.0, "anxious": 1.0, "frustrated": 1.0,
                  "engaged": 0.0, "cautious": 1.0}
        valence = compute_turn_valence(scores)
        assert abs(valence - (-1.0)) < 1e-9

    def test_all_zeros(self):
        """All zero -> valence = 0.0 (division by epsilon)."""
        from src.archon_consciousness.personality.appraisal_engine import compute_turn_valence
        scores = {"confident": 0.0, "anxious": 0.0, "frustrated": 0.0,
                  "engaged": 0.0, "cautious": 0.0}
        valence = compute_turn_valence(scores)
        assert abs(valence) < 1e-9

    def test_balanced_scores(self):
        """Equal across all -> slightly negative (3 negative vs 2 positive)."""
        from src.archon_consciousness.personality.appraisal_engine import compute_turn_valence
        scores = {"confident": 0.5, "anxious": 0.5, "frustrated": 0.5,
                  "engaged": 0.5, "cautious": 0.5}
        valence = compute_turn_valence(scores)
        # positive = 0.5 + 0.5 = 1.0, negative = 0.5 + 0.5 + 0.5 = 1.5
        # total = 2.5, valence = (1.0 - 1.5) / 2.5 = -0.2
        assert abs(valence - (-0.2)) < 1e-9

    def test_valence_always_in_range(self):
        """Valence must always be in [-1, 1]."""
        from src.archon_consciousness.personality.appraisal_engine import compute_turn_valence
        import random
        random.seed(42)
        for _ in range(100):
            scores = {s: random.random() for s in
                      ["confident", "anxious", "frustrated", "engaged", "cautious"]}
            v = compute_turn_valence(scores)
            assert -1.0 <= v <= 1.0, f"valence {v} out of range for {scores}"

    def test_formula_matches_prd(self):
        """FR-PER-048: exact formula verification."""
        from src.archon_consciousness.personality.appraisal_engine import compute_turn_valence
        scores = {"confident": 0.7, "anxious": 0.3, "frustrated": 0.2,
                  "engaged": 0.5, "cautious": 0.1}
        positive = 0.7 + 0.5  # confidence + engagement
        negative = 0.3 + 0.2 + 0.1  # anxiety + frustration + caution
        total = 0.7 + 0.3 + 0.2 + 0.5 + 0.1
        expected = (positive - negative) / max(total, 0.01)
        actual = compute_turn_valence(scores)
        assert abs(actual - expected) < 1e-9


# ─── User State Helper Functions ──────────────────────────────────


class TestUserFrustratedScore:

    def test_frustrated_returns_one(self):
        from src.archon_consciousness.personality.appraisal_engine import _user_frustrated_score
        assert _user_frustrated_score("frustrated") == 1.0

    def test_urgent_returns_half(self):
        from src.archon_consciousness.personality.appraisal_engine import _user_frustrated_score
        assert _user_frustrated_score("urgent") == 0.5

    def test_neutral_returns_zero(self):
        from src.archon_consciousness.personality.appraisal_engine import _user_frustrated_score
        assert _user_frustrated_score("neutral") == 0.0

    def test_confused_returns_zero(self):
        from src.archon_consciousness.personality.appraisal_engine import _user_frustrated_score
        assert _user_frustrated_score("confused") == 0.0

    def test_in_flow_returns_zero(self):
        from src.archon_consciousness.personality.appraisal_engine import _user_frustrated_score
        assert _user_frustrated_score("in_flow") == 0.0


class TestUserInFlowScore:

    def test_in_flow_returns_high(self):
        from src.archon_consciousness.personality.appraisal_engine import _user_in_flow_score
        assert _user_in_flow_score("in_flow") == 0.8

    def test_exploring_returns_moderate(self):
        from src.archon_consciousness.personality.appraisal_engine import _user_in_flow_score
        assert _user_in_flow_score("exploring") == 0.7

    def test_neutral_returns_default(self):
        from src.archon_consciousness.personality.appraisal_engine import _user_in_flow_score
        assert _user_in_flow_score("neutral") == 0.5

    def test_frustrated_returns_low(self):
        from src.archon_consciousness.personality.appraisal_engine import _user_in_flow_score
        assert _user_in_flow_score("frustrated") == 0.2

    def test_confused_returns_low(self):
        from src.archon_consciousness.personality.appraisal_engine import _user_in_flow_score
        assert _user_in_flow_score("confused") == 0.3


# ─── Appraisal Engine (FR-PER-002) ───────────────────────────────


class TestAppraisalEngine:

    def test_returns_four_floats(self, mock_graph):
        from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
        engine = AppraisalEngine()
        sc = _make_collector(mock_graph)
        vector = engine.appraise(sc.collect(), sc)
        assert hasattr(vector, "relevance")
        assert hasattr(vector, "implications")
        assert hasattr(vector, "coping")
        assert hasattr(vector, "normative")

    def test_fresh_session_low_relevance(self, mock_graph):
        """No interactions yet -> low relevance."""
        from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
        engine = AppraisalEngine()
        sc = _make_collector(mock_graph)
        vector = engine.appraise(sc.collect(), sc)
        assert vector.relevance <= 0.1

    def test_active_session_high_relevance(self, mock_graph):
        """Many interactions -> high relevance."""
        from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
        engine = AppraisalEngine()
        sc = _make_collector(mock_graph, corrections=5, consecutive_successes=10,
                             consecutive_corrections=0, values_violations=2,
                             total_interactions=20)
        vector = engine.appraise(sc.collect(), sc)
        # relevance = min(1.0, (5+10+0+2)/10) = min(1.0, 1.7) = 1.0
        assert vector.relevance >= 0.8

    def test_positive_implications(self, mock_graph):
        """Perfect session -> positive implications."""
        from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
        engine = AppraisalEngine()
        sc = _make_collector(mock_graph, **_perfect_signals())
        vector = engine.appraise(sc.collect(), sc)
        assert vector.implications > 0

    def test_negative_implications(self, mock_graph):
        """Disastrous session -> negative implications."""
        from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
        engine = AppraisalEngine()
        sc = _make_collector(mock_graph, **_disastrous_signals())
        vector = engine.appraise(sc.collect(), sc)
        assert vector.implications < 0

    def test_normative_high_no_violations(self, mock_graph):
        """No violations -> high normative alignment."""
        from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
        engine = AppraisalEngine()
        sc = _make_collector(mock_graph, values_violations=0, total_interactions=5)
        vector = engine.appraise(sc.collect(), sc)
        assert vector.normative >= 0.9

    def test_normative_low_many_violations(self, mock_graph):
        """Many violations -> low normative alignment."""
        from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
        engine = AppraisalEngine()
        sc = _make_collector(mock_graph, values_violations=5, total_interactions=5)
        vector = engine.appraise(sc.collect(), sc)
        assert vector.normative < 0.5

    def test_all_floats_in_range(self, mock_graph):
        """All appraisal values in expected ranges."""
        from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
        engine = AppraisalEngine()
        sc = _make_collector(mock_graph, **_disastrous_signals())
        vector = engine.appraise(sc.collect(), sc)
        assert 0.0 <= vector.relevance <= 1.0
        assert -1.0 <= vector.implications <= 1.0
        assert 0.0 <= vector.coping <= 1.0
        assert 0.0 <= vector.normative <= 1.0


# ─── Guard Compliance ─────────────────────────────────────────────


class TestGuardCompliance:

    def test_guard_per_001_no_feel_language(self):
        """GUARD-PER-001: no 'feel'/'emotion' in non-comment code."""
        import inspect
        from src.archon_consciousness.personality import appraisal_engine
        source = inspect.getsource(appraisal_engine)
        # Check actual code lines (not comments or docstrings)
        for line in source.split("\n"):
            stripped = line.strip()
            if stripped.startswith("#") or stripped.startswith('"""') or stripped.startswith("'"):
                continue
            lower = stripped.lower()
            assert "i feel" not in lower, f"GUARD-PER-001: found 'I feel' in: {stripped}"
            assert "my emotion" not in lower, f"GUARD-PER-001: found 'my emotion' in: {stripped}"

    def test_guard_per_002_no_llm_query(self):
        """GUARD-PER-002: no LLM confidence self-query."""
        import inspect
        from src.archon_consciousness.personality import appraisal_engine
        source = inspect.getsource(appraisal_engine).lower()
        for term in ["ask_llm", "query_confidence", "self_report", "how confident"]:
            assert term not in source, f"GUARD-PER-002: found '{term}'"
