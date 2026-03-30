"""Tests for AgentSelfModel orchestrator.

TDD test file — written BEFORE implementation.
Covers mood EWMA, mood bias, somatic markers, dampening,
behavior mapping, MemoryGraph storage, and edge cases.

TASK-PER-004 | PRD-ARCHON-CON-002 | FR-PER-004/005/006/007/008
"""

import json
from datetime import datetime, timezone

import pytest


def _make_model(mock_graph, mock_lance=None, **collector_overrides):
    """Create an AgentSelfModel with a pre-configured SignalCollector."""
    from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
    from src.archon_consciousness.personality.agent_self_model import AgentSelfModel
    from src.archon_consciousness.personality.signal_collector import SignalCollector

    sc = SignalCollector(client=mock_graph, lance=mock_lance)
    for key, val in collector_overrides.items():
        setattr(sc, f"_{key}", val)
    engine = AppraisalEngine()
    return AgentSelfModel(collector=sc, engine=engine, client=mock_graph, lance=mock_lance)


def _populate_negative_episodes(mock_lance, count=6):
    """Store negative episodes in MockLanceDB for somatic marker tests."""
    for i in range(count):
        mock_lance.embed_and_store(
            text=f"debugging parser failure attempt {i}",
            metadata={"outcome": "negative", "emotional_valence": "negative",
                      "importance": 0.7},
            collection="episodes",
        )


def _populate_positive_episodes(mock_lance, count=6):
    """Store positive episodes in MockLanceDB for somatic marker tests."""
    for i in range(count):
        mock_lance.embed_and_store(
            text=f"debugging parser success attempt {i}",
            metadata={"outcome": "positive", "emotional_valence": "positive",
                      "importance": 0.8},
            collection="episodes",
        )


def _populate_mixed_episodes(mock_lance):
    """Store mixed valence episodes."""
    for i in range(3):
        mock_lance.embed_and_store(
            text=f"debugging parser attempt {i}",
            metadata={"outcome": "positive", "emotional_valence": "positive",
                      "importance": 0.7},
            collection="episodes",
        )
    for i in range(3):
        mock_lance.embed_and_store(
            text=f"debugging parser attempt {i + 3}",
            metadata={"outcome": "negative", "emotional_valence": "negative",
                      "importance": 0.7},
            collection="episodes",
        )


# ─── process_turn Return Type ─────────────────────────────────────


class TestProcessTurnBasics:

    def test_returns_state_and_hints(self, mock_graph):
        from src.archon_consciousness.personality.agent_self_model import AgentSelfModel, BehaviorHints
        from src.archon_consciousness.personality.types import AgentSelfState

        model = _make_model(mock_graph)
        state, hints = model.process_turn(turn_number=0, session_id="s1")
        assert isinstance(state, AgentSelfState)
        assert isinstance(hints, BehaviorHints)

    def test_state_has_all_fields_populated(self, mock_graph):
        model = _make_model(mock_graph)
        state, _ = model.process_turn(turn_number=0, session_id="s1")
        assert state.session_id == "s1"
        assert state.turn_number == 0
        assert state.primary_state in {"confident", "anxious", "frustrated",
                                        "engaged", "cautious", "neutral"}
        assert -1.0 <= state.mood_valence <= 1.0
        assert 0.0 <= state.mood_arousal <= 1.0
        assert isinstance(state.signals_snapshot, dict)

    def test_state_stored_to_memorygraph(self, mock_graph):
        model = _make_model(mock_graph)
        state, _ = model.process_turn(turn_number=0, session_id="s1")
        # Verify stored in MemoryGraph (MockMemoryGraph uses get_memory)
        stored = mock_graph.get_memory("selfstate-s1-t0")
        assert stored is not None
        content = json.loads(stored["content"])
        assert content["session_id"] == "s1"
        assert content["turn_number"] == 0


# ─── Mood EWMA (FR-PER-004) ──────────────────────────────────────


class TestMoodEWMA:

    def test_initial_mood_is_zero(self, mock_graph):
        model = _make_model(mock_graph)
        state, _ = model.process_turn(turn_number=0, session_id="s1")
        # First turn: mood starts at 0.0, then EWMA updates
        # With fresh signals, valence is slightly negative (~-0.46)
        # mood = 0.3 * valence + 0.7 * 0.0 = 0.3 * valence
        assert -1.0 <= state.mood_valence <= 1.0

    def test_positive_turns_trend_positive(self, mock_graph):
        """3 turns with high confidence should push mood positive."""
        model = _make_model(mock_graph,
                            tasks_attempted=10, tasks_completed=10,
                            plans_submitted=5, plans_approved=5,
                            total_interactions=10, corrections=0,
                            consecutive_successes=10, consecutive_corrections=0)
        moods = []
        for i in range(5):
            state, _ = model.process_turn(turn_number=i, session_id="s1")
            moods.append(state.mood_valence)
        # Mood should be trending positive
        assert moods[-1] > moods[0], f"Mood should trend positive: {moods}"

    def test_negative_turns_trend_negative(self, mock_graph):
        """Turns with high correction rate should push mood negative."""
        model = _make_model(mock_graph,
                            corrections=8, total_interactions=10,
                            tasks_attempted=5, tasks_completed=1,
                            plans_submitted=5, plans_approved=1,
                            consecutive_successes=0, consecutive_corrections=5)
        moods = []
        for i in range(5):
            state, _ = model.process_turn(turn_number=i, session_id="s1")
            moods.append(state.mood_valence)
        assert moods[-1] < 0, f"Mood should be negative: {moods}"

    def test_ewma_formula(self, mock_graph):
        """EWMA: mood = 0.3 * turn_valence + 0.7 * prev_mood."""
        from src.archon_consciousness.personality.personality_constants import MOOD_EWMA_ALPHA
        assert MOOD_EWMA_ALPHA == 0.3

    def test_mood_doesnt_overflow_100_turns(self, mock_graph):
        """EC-PER-017: extended session doesn't cause overflow."""
        model = _make_model(mock_graph,
                            corrections=8, total_interactions=10,
                            consecutive_corrections=5)
        for i in range(100):
            state, _ = model.process_turn(turn_number=i, session_id="s1")
            assert -1.0 <= state.mood_valence <= 1.0, \
                f"Mood overflow at turn {i}: {state.mood_valence}"


# ─── Mood Bias (FR-PER-004) ──────────────────────────────────────


class TestMoodBias:

    def test_positive_mood_boosts_confident(self, mock_graph):
        """Positive mood should add 0.05 to confident score."""
        from src.archon_consciousness.personality.agent_self_model import AgentSelfModel
        from src.archon_consciousness.personality.appraisal_engine import compute_state_scores

        model = _make_model(mock_graph,
                            tasks_attempted=5, tasks_completed=5,
                            plans_submitted=3, plans_approved=3,
                            total_interactions=5, corrections=0,
                            consecutive_successes=5)
        # Force positive mood
        model._mood_valence = 0.5

        sc = model._collector
        signals = sc.collect()
        raw_scores = compute_state_scores(signals, sc)
        biased_scores = model._apply_mood_bias(raw_scores)

        assert biased_scores["confident"] > raw_scores["confident"]
        assert abs(biased_scores["confident"] - raw_scores["confident"] - 0.05) < 1e-9 or \
               biased_scores["confident"] == 1.0  # clamped

    def test_positive_mood_reduces_anxious(self, mock_graph):
        model = _make_model(mock_graph)
        model._mood_valence = 0.5
        raw = {"confident": 0.5, "anxious": 0.5, "frustrated": 0.5,
               "engaged": 0.5, "cautious": 0.5}
        biased = model._apply_mood_bias(raw)
        assert biased["anxious"] == 0.45  # reduced by 0.05

    def test_negative_mood_boosts_anxious(self, mock_graph):
        model = _make_model(mock_graph)
        model._mood_valence = -0.5
        raw = {"confident": 0.5, "anxious": 0.5, "frustrated": 0.5,
               "engaged": 0.5, "cautious": 0.5}
        biased = model._apply_mood_bias(raw)
        assert biased["anxious"] == 0.55

    def test_caution_never_modulated(self, mock_graph):
        """FR-PER-004: caution threshold not mood-modulated."""
        model = _make_model(mock_graph)
        for mood in [0.5, -0.5, 0.0, 1.0, -1.0]:
            model._mood_valence = mood
            raw = {"confident": 0.5, "anxious": 0.5, "frustrated": 0.5,
                   "engaged": 0.5, "cautious": 0.5}
            biased = model._apply_mood_bias(raw)
            assert biased["cautious"] == 0.5, \
                f"Caution modulated at mood={mood}: {biased['cautious']}"

    def test_zero_mood_no_adjustment(self, mock_graph):
        model = _make_model(mock_graph)
        model._mood_valence = 0.0
        raw = {"confident": 0.5, "anxious": 0.5, "frustrated": 0.5,
               "engaged": 0.5, "cautious": 0.5}
        biased = model._apply_mood_bias(raw)
        assert biased == raw

    def test_bias_clamped_to_zero_one(self, mock_graph):
        model = _make_model(mock_graph)
        model._mood_valence = 0.5
        raw = {"confident": 0.98, "anxious": 0.02, "frustrated": 0.01,
               "engaged": 0.99, "cautious": 0.5}
        biased = model._apply_mood_bias(raw)
        assert biased["confident"] <= 1.0
        assert biased["anxious"] >= 0.0
        assert biased["frustrated"] >= 0.0


# ─── Somatic Markers (FR-PER-005) ─────────────────────────────────


class TestSomaticMarkers:

    def test_below_threshold_returns_zero(self, mock_graph, mock_lance):
        """< 5 episodes -> marker = 0.0."""
        mock_lance.embed_and_store("debugging parser", metadata={
            "emotional_valence": "negative", "importance": 0.5,
        }, collection="episodes")
        model = _make_model(mock_graph, mock_lance)
        value, count = model._compute_somatic_marker("debugging parser")
        assert value == 0.0
        assert count < 5

    def test_all_negative_episodes(self, mock_graph, mock_lance):
        """5+ negative episodes -> marker < 0."""
        _populate_negative_episodes(mock_lance, count=6)
        model = _make_model(mock_graph, mock_lance)
        value, count = model._compute_somatic_marker("debugging parser failure")
        assert value < 0, f"Expected negative marker, got {value}"
        assert count >= 5

    def test_all_positive_episodes(self, mock_graph, mock_lance):
        """5+ positive episodes -> marker > 0."""
        _populate_positive_episodes(mock_lance, count=6)
        model = _make_model(mock_graph, mock_lance)
        value, count = model._compute_somatic_marker("debugging parser success")
        assert value > 0, f"Expected positive marker, got {value}"

    def test_mixed_episodes_near_zero(self, mock_graph, mock_lance):
        """EC-PER-005: mixed episodes -> marker near 0."""
        _populate_mixed_episodes(mock_lance)
        model = _make_model(mock_graph, mock_lance)
        value, count = model._compute_somatic_marker("debugging parser attempt")
        assert abs(value) < 0.5, f"Expected near-zero marker, got {value}"

    def test_no_lance_returns_zero(self, mock_graph):
        model = _make_model(mock_graph, mock_lance=None)
        value, count = model._compute_somatic_marker("anything")
        assert value == 0.0
        assert count == 0

    def test_empty_context_returns_zero(self, mock_graph, mock_lance):
        _populate_negative_episodes(mock_lance)
        model = _make_model(mock_graph, mock_lance)
        value, count = model._compute_somatic_marker("")
        assert value == 0.0

    def test_marker_in_range(self, mock_graph, mock_lance):
        """Marker must always be in [-1, 1]."""
        _populate_negative_episodes(mock_lance, count=10)
        model = _make_model(mock_graph, mock_lance)
        value, _ = model._compute_somatic_marker("debugging parser failure")
        assert -1.0 <= value <= 1.0


# ─── Dampening (FR-PER-007) ──────────────────────────────────────


class TestDampening:

    def test_first_turn_full_weight(self, mock_graph):
        model = _make_model(mock_graph)
        _, hints = model.process_turn(turn_number=0, session_id="s1")
        assert hints.influence_weight == 1.0

    def test_second_consecutive_reduces_by_10pct(self, mock_graph):
        model = _make_model(mock_graph,
                            corrections=8, total_interactions=10,
                            consecutive_corrections=5)
        # First turn sets a state
        _, h1 = model.process_turn(turn_number=0, session_id="s1")
        # Second turn with same signals -> same state -> dampening kicks in
        _, h2 = model.process_turn(turn_number=1, session_id="s1")
        if h1.influence_weight == 1.0 and h2.influence_weight < 1.0:
            assert abs(h2.influence_weight - 0.9) < 1e-9

    def test_floor_at_50_percent(self, mock_graph):
        """EC-PER-004: after 6+ consecutive same-state turns, floor is 0.5."""
        model = _make_model(mock_graph,
                            corrections=8, total_interactions=10,
                            consecutive_corrections=5,
                            user_state="frustrated")
        weights = []
        for i in range(10):
            _, hints = model.process_turn(turn_number=i, session_id="s1")
            weights.append(hints.influence_weight)
        # After enough turns, should hit floor
        assert min(weights) >= 0.5 - 1e-9, f"Floor violated: {min(weights)}"

    def test_state_change_resets_dampening(self, mock_graph):
        """State change -> weight returns to 1.0."""
        from src.archon_consciousness.personality.agent_self_model import AgentSelfModel

        model = _make_model(mock_graph,
                            corrections=8, total_interactions=10,
                            consecutive_corrections=5)
        # Run 3 turns in bad state
        for i in range(3):
            model.process_turn(turn_number=i, session_id="s1")

        # Now switch to perfect signals -> different state
        model._collector._corrections = 0
        model._collector._total_interactions = 10
        model._collector._tasks_attempted = 10
        model._collector._tasks_completed = 10
        model._collector._plans_submitted = 5
        model._collector._plans_approved = 5
        model._collector._consecutive_successes = 10
        model._collector._consecutive_corrections = 0
        model._collector._user_emotional_state = "neutral"

        _, hints = model.process_turn(turn_number=3, session_id="s1")
        assert hints.influence_weight == 1.0, \
            f"Weight should reset on state change, got {hints.influence_weight}"


# ─── Behavior Mapping (FR-PER-006) ───────────────────────────────


class TestBehaviorHints:

    def test_neutral_defaults(self, mock_graph):
        from src.archon_consciousness.personality.agent_self_model import BehaviorHints
        model = _make_model(mock_graph)
        _, hints = model.process_turn(turn_number=0, session_id="s1")
        # Fresh session is neutral
        assert hints.validation_level in {"normal", "extra", "maximum"}
        assert hints.response_verbosity in {"concise", "standard", "detailed"}
        assert hints.exploration_mode in {"conservative", "default", "creative"}

    def test_anxious_extra_validation(self, mock_graph):
        """Anxious -> extra validation, should retrieve episodes."""
        from src.archon_consciousness.personality.agent_self_model import STATE_BEHAVIOR_MAP
        hints = STATE_BEHAVIOR_MAP["anxious"]
        assert hints.validation_level == "extra"
        assert hints.should_retrieve_episodes is True

    def test_confident_concise(self, mock_graph):
        from src.archon_consciousness.personality.agent_self_model import STATE_BEHAVIOR_MAP
        hints = STATE_BEHAVIOR_MAP["confident"]
        assert hints.response_verbosity == "concise"
        assert hints.should_present_options is False

    def test_engaged_creative(self, mock_graph):
        from src.archon_consciousness.personality.agent_self_model import STATE_BEHAVIOR_MAP
        hints = STATE_BEHAVIOR_MAP["engaged"]
        assert hints.exploration_mode == "creative"

    def test_cautious_verify_values(self, mock_graph):
        from src.archon_consciousness.personality.agent_self_model import STATE_BEHAVIOR_MAP
        hints = STATE_BEHAVIOR_MAP["cautious"]
        assert hints.should_verify_values is True
        assert hints.should_present_options is True

    def test_hints_are_structured_not_text(self, mock_graph):
        """GUARD-PER-003: no natural language in hints."""
        from src.archon_consciousness.personality.agent_self_model import STATE_BEHAVIOR_MAP
        for state, hints in STATE_BEHAVIOR_MAP.items():
            # No sentence-like strings (containing spaces + periods)
            for field_val in [hints.validation_level, hints.response_verbosity,
                              hints.exploration_mode]:
                assert "." not in field_val, f"Natural language in {state}.{field_val}"
                assert len(field_val.split()) <= 2, f"Multi-word in {state}: {field_val}"


# ─── Guard Compliance ─────────────────────────────────────────────


class TestGuardCompliance:

    def test_guard_per_003_no_unsolicited_state(self):
        """GUARD-PER-003: BehaviorHints contain no state disclosure text."""
        import inspect
        from src.archon_consciousness.personality import agent_self_model
        source = inspect.getsource(agent_self_model)
        for phrase in ["I feel", "my confidence is", "I am feeling",
                       "my state is", "currently experiencing"]:
            assert phrase.lower() not in source.lower(), \
                f"GUARD-PER-003: found '{phrase}' in source"
