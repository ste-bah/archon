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
