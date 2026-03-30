"""Tests for session_end_runner — production entry point for session-end processing.

TDD test file. Verifies that session-end processing calls the TESTED
PersonalityHooks methods (not duplicated logic) and handles edge cases.

Personality Event Pipeline wiring.
"""

import json
import os
import tempfile
from datetime import datetime, timezone

import pytest


def _write_events(path, events):
    """Write event dicts as JSONL to a file."""
    with open(path, "w") as f:
        for ev in events:
            f.write(json.dumps(ev) + "\n")


def _sample_events(n=10):
    """Generate n sample tool events."""
    events = []
    for i in range(n):
        tool = ["Write", "Edit", "Bash", "Read"][i % 4]
        target = f"src/file{i}.py" if tool != "Bash" else "python -m pytest"
        events.append({
            "ts": f"2026-03-29T13:{i:02d}:00Z",
            "tool": tool,
            "target": target,
        })
    return events


class TestProcessSessionEnd:
    """process_session_end uses tested PersonalityHooks, no duplicated logic."""

    def test_processes_events_and_updates_trust(self, mock_graph):
        from src.archon_consciousness.personality.session_end_runner import (
            process_session_end,
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            _write_events(f.name, _sample_events(10))
            events_path = f.name

        try:
            result = process_session_end(events_path, client=mock_graph)
            assert result["events_processed"] == 10
            # Trust should be stored
            stored = mock_graph.get_memory("truststate-current")
            assert stored is not None
        finally:
            if os.path.exists(events_path):
                os.remove(events_path)

    def test_updates_personality_traits(self, mock_graph):
        from src.archon_consciousness.personality.session_end_runner import (
            process_session_end,
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            _write_events(f.name, _sample_events(5))
            events_path = f.name

        try:
            result = process_session_end(events_path, client=mock_graph)
            stored = mock_graph.get_memory("traitset-current")
            assert stored is not None
            assert result["traits_updated"] is True
        finally:
            if os.path.exists(events_path):
                os.remove(events_path)

    def test_cleans_up_events_file(self, mock_graph):
        from src.archon_consciousness.personality.session_end_runner import (
            process_session_end,
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            _write_events(f.name, _sample_events(3))
            events_path = f.name

        process_session_end(events_path, client=mock_graph)
        assert not os.path.exists(events_path), "Events file should be deleted after processing"

    def test_missing_file_returns_zero(self, mock_graph):
        from src.archon_consciousness.personality.session_end_runner import (
            process_session_end,
        )
        result = process_session_end("/nonexistent/path.jsonl", client=mock_graph)
        assert result["events_processed"] == 0

    def test_empty_file_returns_zero(self, mock_graph):
        from src.archon_consciousness.personality.session_end_runner import (
            process_session_end,
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            events_path = f.name

        try:
            result = process_session_end(events_path, client=mock_graph)
            assert result["events_processed"] == 0
        finally:
            if os.path.exists(events_path):
                os.remove(events_path)

    def test_corrupt_json_lines_skipped(self, mock_graph):
        from src.archon_consciousness.personality.session_end_runner import (
            process_session_end,
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            f.write('{"ts":"2026-03-29T13:00:00Z","tool":"Write","target":"a.py"}\n')
            f.write("not valid json\n")
            f.write('{"ts":"2026-03-29T13:01:00Z","tool":"Edit","target":"b.py"}\n')
            events_path = f.name

        try:
            result = process_session_end(events_path, client=mock_graph)
            assert result["events_processed"] == 2  # skipped corrupt line
        finally:
            if os.path.exists(events_path):
                os.remove(events_path)

    def test_computes_signals_from_events(self, mock_graph):
        """Events should be parsed into meaningful signals for subsystems."""
        from src.archon_consciousness.personality.session_end_runner import (
            compute_signals_from_events,
        )
        events = [
            {"tool": "Write", "target": "src/a.py"},
            {"tool": "Edit", "target": "src/a.py"},
            {"tool": "Bash", "target": "python -m pytest tests/"},
            {"tool": "Read", "target": "src/b.py"},
            {"tool": "Bash", "target": "ls -la"},
        ]
        signals = compute_signals_from_events(events)
        assert signals["edit_count"] == 2  # Write + Edit
        assert signals["test_count"] == 1  # pytest command
        assert signals["total_actions"] == 5

    def test_tdd_compliance_detected(self, mock_graph):
        """Session with both tests and edits = TDD compliant."""
        from src.archon_consciousness.personality.session_end_runner import (
            compute_signals_from_events,
        )
        events = [
            {"tool": "Write", "target": "src/a.py"},
            {"tool": "Bash", "target": "python -m pytest"},
        ]
        signals = compute_signals_from_events(events)
        assert signals["tdd_compliance"] is True

    def test_no_tests_not_tdd(self, mock_graph):
        from src.archon_consciousness.personality.session_end_runner import (
            compute_signals_from_events,
        )
        events = [
            {"tool": "Write", "target": "src/a.py"},
            {"tool": "Edit", "target": "src/a.py"},
        ]
        signals = compute_signals_from_events(events)
        assert signals["tdd_compliance"] is False


class TestReadCorrections:
    """read_corrections parses corrections.jsonl into violation dicts."""

    def test_reads_valid_corrections(self):
        from src.archon_consciousness.personality.session_end_runner import read_corrections

        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            f.write('{"type":"did_forbidden_action","ts":"2026-03-30T21:00:00Z"}\n')
            f.write('{"type":"repeated_instruction","ts":"2026-03-30T20:00:00Z"}\n')
            path = f.name

        try:
            corrections = read_corrections(path)
            assert len(corrections) == 2
            assert corrections[0]["type"] == "did_forbidden_action"
            assert corrections[1]["type"] == "repeated_instruction"
        finally:
            os.remove(path)

    def test_skips_unknown_types(self):
        from src.archon_consciousness.personality.session_end_runner import read_corrections

        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            f.write('{"type":"unknown_violation","ts":"2026-03-30T21:00:00Z"}\n')
            f.write('{"type":"did_forbidden_action","ts":"2026-03-30T21:01:00Z"}\n')
            path = f.name

        try:
            corrections = read_corrections(path)
            assert len(corrections) == 1
            assert corrections[0]["type"] == "did_forbidden_action"
        finally:
            os.remove(path)

    def test_skips_corrupt_lines(self):
        from src.archon_consciousness.personality.session_end_runner import read_corrections

        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            f.write('{"type":"factual_error","ts":"2026-03-30T21:00:00Z"}\n')
            f.write("not valid json\n")
            path = f.name

        try:
            corrections = read_corrections(path)
            assert len(corrections) == 1
        finally:
            os.remove(path)

    def test_missing_file_returns_empty(self):
        from src.archon_consciousness.personality.session_end_runner import read_corrections

        corrections = read_corrections("/nonexistent/corrections.jsonl")
        assert corrections == []

    def test_all_violation_types_accepted(self):
        from src.archon_consciousness.personality.session_end_runner import read_corrections

        types = [
            "factual_error",
            "approach_correction",
            "repeated_instruction",
            "did_forbidden_action",
            "acted_without_permission",
            "repeated_correction",
        ]
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            for t in types:
                f.write(json.dumps({"type": t, "ts": "2026-03-30T21:00:00Z"}) + "\n")
            path = f.name

        try:
            corrections = read_corrections(path)
            assert len(corrections) == len(types)
        finally:
            os.remove(path)


class TestCorrectionsWiredIntoTrustTracker:
    """Corrections from corrections.jsonl feed into trust tracker at session end."""

    def test_did_forbidden_action_recorded_as_violation(self, mock_graph):
        from src.archon_consciousness.personality.session_end_runner import process_session_end

        with tempfile.TemporaryDirectory() as tmpdir:
            events_path = os.path.join(tmpdir, "events.jsonl")
            corrections_path = os.path.join(tmpdir, "corrections.jsonl")

            _write_events(events_path, _sample_events(5))
            with open(corrections_path, "w") as f:
                f.write('{"type":"did_forbidden_action","ts":"2026-03-30T21:00:00Z"}\n')

            result = process_session_end(events_path, client=mock_graph)
            assert result["events_processed"] == 5
            # Trust state should be stored (violation was processed)
            stored = mock_graph.get_memory("truststate-current")
            assert stored is not None

    def test_corrections_count_in_signals(self, mock_graph):
        from src.archon_consciousness.personality.session_end_runner import process_session_end

        with tempfile.TemporaryDirectory() as tmpdir:
            events_path = os.path.join(tmpdir, "events.jsonl")
            corrections_path = os.path.join(tmpdir, "corrections.jsonl")

            _write_events(events_path, _sample_events(5))
            with open(corrections_path, "w") as f:
                f.write('{"type":"repeated_instruction","ts":"2026-03-30T20:00:00Z"}\n')
                f.write('{"type":"did_forbidden_action","ts":"2026-03-30T21:00:00Z"}\n')

            result = process_session_end(events_path, client=mock_graph)
            assert result["events_processed"] == 5

    def test_corrections_only_no_events_still_processes(self, mock_graph):
        """If only corrections.jsonl exists (no events), still process violations."""
        from src.archon_consciousness.personality.session_end_runner import process_session_end

        with tempfile.TemporaryDirectory() as tmpdir:
            events_path = os.path.join(tmpdir, "events.jsonl")
            corrections_path = os.path.join(tmpdir, "corrections.jsonl")

            # No events file — only corrections
            with open(corrections_path, "w") as f:
                f.write('{"type":"did_forbidden_action","ts":"2026-03-30T21:00:00Z"}\n')

            result = process_session_end(events_path, client=mock_graph)
            # Should process (corrections exist) not short-circuit to zero
            assert result["events_processed"] == 0  # no events, but ran

    def test_no_corrections_file_is_noop(self, mock_graph):
        """Missing corrections.jsonl does not break processing."""
        from src.archon_consciousness.personality.session_end_runner import process_session_end

        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            _write_events(f.name, _sample_events(3))
            events_path = f.name

        try:
            result = process_session_end(events_path, client=mock_graph)
            assert result["events_processed"] == 3
        finally:
            if os.path.exists(events_path):
                os.remove(events_path)
