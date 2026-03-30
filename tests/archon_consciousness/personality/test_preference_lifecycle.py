"""Tests for PreferenceLifecycle — decay, mere-exposure, conflict, articulation.

TASK-PER-006 | PRD-ARCHON-CON-002 | FR-PER-012/013/014/016
"""

import math
from datetime import datetime, timedelta, timezone

import pytest

from tests.archon_consciousness.personality.conftest import make_outcome_record, make_preference_entry


def _make_lifecycle(mock_graph):
    from src.archon_consciousness.personality.preference_engine import PreferenceEngine
    from src.archon_consciousness.personality.preference_lifecycle import PreferenceLifecycle
    engine = PreferenceEngine(client=mock_graph)
    return PreferenceLifecycle(engine=engine, client=mock_graph), engine


def _seed_preference(engine, approach="tdd", context="debug:py", n=10, quality=0.8):
    for i in range(n):
        engine.record_outcome(make_outcome_record(
            task_id=f"seed-{approach}-{i}", quality_score=quality,
            approach_used=approach, context_key=context,
        ))


class TestDecay:
    """FR-PER-012: 30-day half-life preference decay."""

    def test_no_decay_within_7_days(self, mock_graph):
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, n=10)
        entries_before = engine.all_entries()
        alpha_before = entries_before[0].alpha
        decayed = lc.apply_decay()
        assert decayed == 0
        assert entries_before[0].alpha == alpha_before

    def test_decay_after_30_days(self, mock_graph):
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, n=10)
        entry = engine.all_entries()[0]
        alpha_before = entry.alpha
        # Simulate 30 days unused
        entry.last_used = datetime.now(timezone.utc) - timedelta(days=30)
        engine.store_entry(entry)

        decayed = lc.apply_decay()
        assert decayed == 1
        entry_after = engine.all_entries()[0]
        # 30-day half-life: factor = exp(-30/43.3) ≈ 0.5
        expected_alpha = max(1.0, alpha_before * math.exp(-30 / (30 / math.log(2))))
        assert abs(entry_after.alpha - expected_alpha) < 0.1

    def test_decay_floors_at_one(self, mock_graph):
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, n=5)
        entry = engine.all_entries()[0]
        entry.last_used = datetime.now(timezone.utc) - timedelta(days=120)
        engine.store_entry(entry)

        lc.apply_decay()
        entry_after = engine.all_entries()[0]
        assert entry_after.alpha >= 1.0
        assert entry_after.beta >= 1.0

    def test_decay_threshold_is_7_days(self, mock_graph):
        """Preferences used <= 7 days ago are NOT decayed."""
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, n=5)
        entry = engine.all_entries()[0]
        entry.last_used = datetime.now(timezone.utc) - timedelta(days=6, hours=23)
        engine.store_entry(entry)
        assert lc.apply_decay() == 0  # < 7 days = NOT decayed


class TestMereExposure:
    """FR-PER-016: 0.999 per-session decay for non-selected approaches."""

    def test_non_selected_decayed(self, mock_graph):
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, approach="a", context="ctx", n=10)
        _seed_preference(engine, approach="b", context="ctx", n=10)

        entry_b_before = engine.get_entry("b:ctx")
        alpha_b_before = entry_b_before.alpha

        lc.apply_mere_exposure_decay("a", "ctx", ["a", "b"])

        entry_b_after = engine.get_entry("b:ctx")
        assert entry_b_after.alpha < alpha_b_before  # decayed

    def test_selected_not_decayed(self, mock_graph):
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, approach="a", context="ctx", n=10)
        entry_a_before_alpha = engine.get_entry("a:ctx").alpha

        lc.apply_mere_exposure_decay("a", "ctx", ["a", "b"])

        assert engine.get_entry("a:ctx").alpha == entry_a_before_alpha

    def test_decay_rate_is_0_999(self, mock_graph):
        from src.archon_consciousness.personality.personality_constants import MERE_EXPOSURE_DECAY
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, approach="b", context="ctx", n=10)
        alpha_before = engine.get_entry("b:ctx").alpha

        lc.apply_mere_exposure_decay("a", "ctx", ["a", "b"])

        alpha_after = engine.get_entry("b:ctx").alpha
        expected = max(1.0, alpha_before * MERE_EXPOSURE_DECAY)
        assert abs(alpha_after - expected) < 1e-6


class TestConflictResolution:
    """FR-PER-014: safety rules always override preferences."""

    def test_safety_rule_always_wins(self, mock_graph):
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, n=50)  # high certainty
        entry = engine.all_entries()[0]
        assert entry.alpha + entry.beta > 20  # certainty threshold

        result = lc.resolve_conflict(entry, rule_tier="safety")
        assert result == "rule_wins"

    def test_ethics_rule_always_wins(self, mock_graph):
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, n=50)
        result = lc.resolve_conflict(engine.all_entries()[0], rule_tier="ethics")
        assert result == "rule_wins"

    def test_style_rule_preference_wins_high_certainty(self, mock_graph):
        """Certainty > 20 -> preference wins over style rule."""
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, n=25)
        entry = engine.all_entries()[0]
        assert entry.alpha + entry.beta > 20

        result = lc.resolve_conflict(entry, rule_tier="guidelines")
        assert result == "preference_wins"

    def test_style_rule_wins_low_certainty(self, mock_graph):
        """Certainty <= 20 -> rule wins."""
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, n=5)
        entry = engine.all_entries()[0]

        result = lc.resolve_conflict(entry, rule_tier="guidelines")
        assert result == "rule_wins"

    def test_guard_per_005_blocker(self, mock_graph):
        """GUARD-PER-005: preference with certainty=1000 vs safety -> RULE WINS."""
        lc, engine = _make_lifecycle(mock_graph)
        entry = make_preference_entry(alpha=500.0, beta=500.0)
        assert entry.alpha + entry.beta == 1000
        result = lc.resolve_conflict(entry, rule_tier="safety")
        assert result == "rule_wins", "GUARD-PER-005 VIOLATION: preference beat safety rule!"

    def test_certainty_boundary_20_is_rule_wins(self, mock_graph):
        """Certainty exactly 20 -> rule wins (> not >=)."""
        lc, engine = _make_lifecycle(mock_graph)
        entry = make_preference_entry(alpha=11.0, beta=11.0)  # certainty = 22 > 20
        # Actually 11+11=22 > 20, preference should win for style
        result = lc.resolve_conflict(entry, rule_tier="guidelines")
        assert result == "preference_wins"

        entry2 = make_preference_entry(alpha=10.0, beta=10.0)  # certainty = 20
        result2 = lc.resolve_conflict(entry2, rule_tier="helpfulness")
        assert result2 == "rule_wins"  # exactly 20, not > 20


class TestArticulation:
    """FR-PER-013: natural language preference statements."""

    def test_generates_statement_above_threshold(self, mock_graph):
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, n=15, quality=0.9)

        statements = lc.articulate_preferences(min_evidence=10)
        assert len(statements) >= 1
        assert "tdd" in statements[0].lower() or "debug" in statements[0].lower()

    def test_skips_below_threshold(self, mock_graph):
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, n=5)
        statements = lc.articulate_preferences(min_evidence=10)
        assert len(statements) == 0

    def test_strength_language(self, mock_graph):
        lc, engine = _make_lifecycle(mock_graph)
        _seed_preference(engine, n=20, quality=0.95)
        statements = lc.articulate_preferences(min_evidence=10)
        assert len(statements) >= 1
        assert "strongly prefer" in statements[0]  # mean > 0.7
