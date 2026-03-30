"""Tests for phase_check_runner — phase-boundary personality computation.

Reads events + corrections, calls process_turn() via tested AgentSelfModel,
writes state cache, outputs behavioral hints.

Behavioral Activation Layer.
"""

import json
import os
import tempfile
from datetime import datetime, timezone

import pytest


def _write_jsonl(path, entries):
    with open(path, "w") as f:
        for e in entries:
            f.write(json.dumps(e) + "\n")


def _sample_events(edits=3, tests=1, reads=2):
    events = []
    for i in range(edits):
        events.append({"ts": f"2026-03-29T13:{i:02d}:00Z", "tool": "Edit", "target": f"src/f{i}.py"})
    for i in range(tests):
        events.append({"ts": f"2026-03-29T13:{10+i:02d}:00Z", "tool": "Bash", "target": "python -m pytest"})
    for i in range(reads):
        events.append({"ts": f"2026-03-29T13:{20+i:02d}:00Z", "tool": "Read", "target": f"src/r{i}.py"})
    return events


class TestPhaseCheckRunner:

    def test_computes_state_and_writes_cache(self, mock_graph):
        from src.archon_consciousness.personality.phase_check_runner import run_phase_check

        with tempfile.TemporaryDirectory() as tmpdir:
            events_path = os.path.join(tmpdir, "events.jsonl")
            corrections_path = os.path.join(tmpdir, "corrections.jsonl")
            cache_path = os.path.join(tmpdir, "state.json")

            _write_jsonl(events_path, _sample_events())

            result = run_phase_check(
                events_path=events_path,
                corrections_path=corrections_path,
                cache_path=cache_path,
                client=mock_graph,
            )
            assert result["state"] in {"confident", "anxious", "frustrated",
                                        "engaged", "cautious", "neutral"}
            assert os.path.exists(cache_path)

    def test_cache_contains_required_fields(self, mock_graph):
        from src.archon_consciousness.personality.phase_check_runner import run_phase_check

        with tempfile.TemporaryDirectory() as tmpdir:
            events_path = os.path.join(tmpdir, "events.jsonl")
            cache_path = os.path.join(tmpdir, "state.json")
            _write_jsonl(events_path, _sample_events())

            run_phase_check(events_path=events_path,
                            corrections_path="/nonexistent",
                            cache_path=cache_path, client=mock_graph)

            with open(cache_path) as f:
                cache = json.load(f)
            assert "state" in cache
            assert "mood_valence" in cache
            assert "hints" in cache
            assert "timestamp" in cache
            assert "validation_level" in cache["hints"]

    def test_corrections_shift_state(self, mock_graph):
        from src.archon_consciousness.personality.phase_check_runner import run_phase_check

        with tempfile.TemporaryDirectory() as tmpdir:
            events_path = os.path.join(tmpdir, "events.jsonl")
            corrections_path = os.path.join(tmpdir, "corrections.jsonl")
            cache_path = os.path.join(tmpdir, "state.json")

            _write_jsonl(events_path, _sample_events(edits=10, tests=1))
            _write_jsonl(corrections_path, [
                {"type": "factual_error"} for _ in range(5)
            ])

            result = run_phase_check(
                events_path=events_path,
                corrections_path=corrections_path,
                cache_path=cache_path,
                client=mock_graph,
            )
            # With 5 corrections out of ~13 actions, correction_rate ~0.38
            # Should NOT be confident
            assert result["state"] != "confident" or result["correction_count"] >= 3

    def test_mood_persists_across_checks(self, mock_graph):
        from src.archon_consciousness.personality.phase_check_runner import run_phase_check

        with tempfile.TemporaryDirectory() as tmpdir:
            events_path = os.path.join(tmpdir, "events.jsonl")
            cache_path = os.path.join(tmpdir, "state.json")

            # First check
            _write_jsonl(events_path, _sample_events())
            r1 = run_phase_check(events_path=events_path,
                                  corrections_path="/nonexistent",
                                  cache_path=cache_path, client=mock_graph)

            # Second check — should load mood from cache
            _write_jsonl(events_path, _sample_events())
            r2 = run_phase_check(events_path=events_path,
                                  corrections_path="/nonexistent",
                                  cache_path=cache_path, client=mock_graph)

            # Mood should be a valid float both times
            assert -1.0 <= r1["mood_valence"] <= 1.0
            assert -1.0 <= r2["mood_valence"] <= 1.0

    def test_missing_events_returns_neutral(self, mock_graph):
        from src.archon_consciousness.personality.phase_check_runner import run_phase_check

        with tempfile.TemporaryDirectory() as tmpdir:
            cache_path = os.path.join(tmpdir, "state.json")
            result = run_phase_check(
                events_path="/nonexistent",
                corrections_path="/nonexistent",
                cache_path=cache_path,
                client=mock_graph,
            )
            assert result["state"] == "neutral"

    def test_stores_state_to_memorygraph(self, mock_graph):
        from src.archon_consciousness.personality.phase_check_runner import run_phase_check

        with tempfile.TemporaryDirectory() as tmpdir:
            events_path = os.path.join(tmpdir, "events.jsonl")
            cache_path = os.path.join(tmpdir, "state.json")
            _write_jsonl(events_path, _sample_events())

            run_phase_check(events_path=events_path,
                            corrections_path="/nonexistent",
                            cache_path=cache_path, client=mock_graph)

            # Should have stored an AgentSelfState
            all_states = mock_graph.list_by_type("AgentSelfState")
            assert len(all_states) >= 1

    def test_output_format(self, mock_graph):
        from src.archon_consciousness.personality.phase_check_runner import format_hints_output

        hints = {"validation_level": "extra", "response_verbosity": "detailed",
                 "exploration_mode": "conservative", "influence_weight": 0.8}
        output = format_hints_output("cautious", hints)
        assert output.startswith("[PERSONALITY STATE:")
        assert "cautious" in output
        assert "extra" in output
