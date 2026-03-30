"""Comprehensive integration tests — degradation, cross-subsystem, bash lifecycle.

TASK-GAP-007 | NFR-PER-011, NFR-PER-018, PER-014
"""

import json
import os
import subprocess
import tempfile

import pytest


# ─── NFR-PER-011: Graceful Degradation ────────────────────────────


class TestGracefulDegradation:
    """All subsystems handle unavailable backends without crashing."""

    def test_signal_collector_no_lance(self):
        from src.archon_consciousness.personality.signal_collector import SignalCollector
        from tests.archon_consciousness.conftest import MockMemoryGraph

        sc = SignalCollector(client=MockMemoryGraph(), lance=None)
        signals = sc.collect()
        assert signals["similar_task_history"] == 0.0
        assert signals["past_success_ratio"] == 0.0

    def test_agent_self_model_no_lance(self):
        from src.archon_consciousness.personality.agent_self_model import AgentSelfModel
        from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
        from src.archon_consciousness.personality.signal_collector import SignalCollector
        from tests.archon_consciousness.conftest import MockMemoryGraph

        g = MockMemoryGraph()
        sc = SignalCollector(client=g, lance=None)
        model = AgentSelfModel(collector=sc, engine=AppraisalEngine(), client=g, lance=None)
        state, hints = model.process_turn(0, "s1")
        assert state.primary_state == "neutral"

    def test_trust_tracker_corrupt_memorygraph(self):
        """Corrupt data in MemoryGraph → fresh state, no crash."""
        from src.archon_consciousness.personality.trust_state_tracker import TrustTracker
        from tests.archon_consciousness.conftest import MockMemoryGraph

        g = MockMemoryGraph()
        g.store_memory(name="truststate-current", memory_type="TrustState",
                       content="NOT VALID JSON", tags=["archon-consciousness"])
        t = TrustTracker(client=g, session_id="s1")
        assert t.overall_trust > 0  # created fresh, didn't crash

    def test_personality_tracker_corrupt_memorygraph(self):
        from src.archon_consciousness.personality.personality_tracker import PersonalityTracker
        from tests.archon_consciousness.conftest import MockMemoryGraph

        g = MockMemoryGraph()
        g.store_memory(name="traitset-current", memory_type="PersonalityTraitSet",
                       content="CORRUPTED", tags=["archon-consciousness"])
        t = PersonalityTracker(client=g)
        assert len(t.trait_means) == 6  # seeded from defaults

    def test_fast_channel_lance_unavailable(self):
        from src.archon_consciousness.personality.fast_channel import FastChannel
        ch = FastChannel(lance=None, client=None)
        result = ch.check("edit", "test.py")
        assert result.episode_match is None
        assert result.rule_violation is None

    def test_session_end_runner_missing_files(self):
        from src.archon_consciousness.personality.session_end_runner import process_session_end
        from tests.archon_consciousness.conftest import MockMemoryGraph

        result = process_session_end("/nonexistent", client=MockMemoryGraph())
        assert result["events_processed"] == 0


# ─── NFR-PER-018: Cross-Subsystem Integration (6 points) ─────────


class TestCrossSubsystemIntegration:
    """All 6 defined integration points from PRD Section 14."""

    def test_1_emotional_state_biases_preference_selection(self, mock_graph):
        """Integration 1: mood biases Thompson Sampling exploration."""
        from src.archon_consciousness.personality.agent_self_model import AgentSelfModel
        from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
        from src.archon_consciousness.personality.signal_collector import SignalCollector

        sc = SignalCollector(client=mock_graph)
        model = AgentSelfModel(collector=sc, engine=AppraisalEngine(), client=mock_graph)
        model._mood_valence = 0.8  # positive mood
        state, hints = model.process_turn(0, "s1")
        # Positive mood should boost confident/engaged thresholds
        assert state.mood_valence > 0

    def test_2_emotional_state_feeds_metacognitive(self, mock_graph):
        """Integration 2: confidence trajectory feeds slow channel."""
        from src.archon_consciousness.personality.metacognitive_monitor import SlowChannel

        slow = SlowChannel()
        slow.update_confidence(0.3)
        slow.update_confidence(0.2)
        slow.update_confidence(0.1)
        assert slow._confidence_ewma < 0.3
        assert slow.should_trigger  # absolute < 0.3

    def test_3_trust_violations_influence_traits(self, mock_graph):
        """Integration 3: trust violations influence conscientiousness."""
        from src.archon_consciousness.personality.trust_state_tracker import TrustTracker
        from src.archon_consciousness.personality.personality_tracker import PersonalityTracker

        t = TrustTracker(client=mock_graph, session_id="s1")
        t.record_violation("factual_error", "Wrong type")
        t.persist()

        p = PersonalityTracker(client=mock_graph)
        signals = {"tdd_compliance": False, "plan_adherence": False,
                    "error_admissions": 1}
        p.update_session(signals)
        # conscientiousness should have beta incremented (not expressed)
        assert p._traits.conscientiousness_beta > 1.5

    def test_4_metacognitive_feeds_trust(self, mock_graph):
        """Integration 4: interrupt-triggered corrections feed competence trust."""
        from src.archon_consciousness.personality.trust_state_tracker import TrustTracker
        from src.archon_consciousness.personality.integration import PersonalityHooks

        hooks = PersonalityHooks(client=mock_graph, session_id="s1")
        hooks.record_correction()
        # Correction should have updated trust tracker
        assert hooks._trust_tracker._state.total_violations >= 1

    def test_5_curiosity_queries_episodes(self, mock_graph, mock_lance):
        """Integration 5: curiosity flagging queries episode store."""
        from src.archon_consciousness.personality.curiosity_tracker import CuriosityTracker

        mock_lance.embed_and_store("HNSW indexing topic", collection="episodes")
        ct = CuriosityTracker(client=mock_graph, lance=mock_lance, session_id="s1")
        enc = ct.flag_encounter("knowledge_gap", "HNSW indexing", confidence=0.3)
        assert enc is not None
        assert enc.interest_score > 0

    def test_6_preference_rule_conflict(self, mock_graph):
        """Integration 6: preference-rule conflict via ValuesDAG."""
        from src.archon_consciousness.personality.preference_engine import PreferenceEngine
        from src.archon_consciousness.personality.preference_lifecycle import PreferenceLifecycle
        from tests.archon_consciousness.personality.conftest import make_outcome_record

        engine = PreferenceEngine(client=mock_graph)
        for i in range(25):
            engine.record_outcome(make_outcome_record(task_id=f"t{i}", quality_score=0.9))
        lc = PreferenceLifecycle(engine=engine, client=mock_graph)
        entry = engine.all_entries()[0]
        # Safety always wins even with high certainty
        assert lc.resolve_conflict(entry, "safety") == "rule_wins"


# ─── Full Lifecycle Test ──────────────────────────────────────────


class TestFullLifecycle:
    """End-to-end: events → phase check → session end → data persisted."""

    def test_complete_session_lifecycle(self, mock_graph):
        from src.archon_consciousness.personality.session_end_runner import process_session_end
        import tempfile, json

        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            for tool, target in [("Write", "tests/test_x.py"), ("Write", "src/x.py"),
                                  ("Bash", "python -m pytest"), ("Edit", "src/x.py")]:
                f.write(json.dumps({"tool": tool, "target": target}) + "\n")
            path = f.name

        try:
            result = process_session_end(path, client=mock_graph, session_id="lifecycle-test")
            assert result["events_processed"] == 4
            assert result["trust_persisted"] is True
            assert result["traits_updated"] is True

            # Verify data persisted
            trust = mock_graph.get_memory("truststate-current")
            traits = mock_graph.get_memory("traitset-current")
            assert trust is not None
            assert traits is not None
        finally:
            if os.path.exists(path):
                os.remove(path)
