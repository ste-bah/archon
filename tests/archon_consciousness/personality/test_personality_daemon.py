"""Tests for singleton multi-session personality daemon.

One daemon scans all sessions/*/events.jsonl, maintains per-session state,
self-terminates when no active sessions remain.
"""

import json
import os
import tempfile
import time

import pytest


def _write_event(session_dir, tool="Edit", target="src/x.py"):
    """Write a single event to a session's events file."""
    events_file = os.path.join(session_dir, "events.jsonl")
    os.makedirs(session_dir, exist_ok=True)
    with open(events_file, "a") as f:
        f.write(json.dumps({"tool": tool, "target": target, "ts": "2026-01-01T00:00:00Z"}) + "\n")


class TestMultiSessionDaemon:

    def test_processes_single_session(self):
        from src.archon_consciousness.personality.personality_daemon import (
            MultiSessionDaemon,
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            sess_dir = os.path.join(tmpdir, "12345")
            for i in range(6):
                _write_event(sess_dir, target=f"src/f{i}.py")

            daemon = MultiSessionDaemon(tmpdir)
            daemon.poll_once()

            assert "12345" in daemon.session_states
            assert daemon.session_states["12345"].action_count == 6

    def test_processes_multiple_sessions(self):
        from src.archon_consciousness.personality.personality_daemon import (
            MultiSessionDaemon,
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            for sid in ["aaa", "bbb"]:
                sess_dir = os.path.join(tmpdir, sid)
                for i in range(3):
                    _write_event(sess_dir, target=f"src/{sid}_{i}.py")

            daemon = MultiSessionDaemon(tmpdir)
            daemon.poll_once()

            assert "aaa" in daemon.session_states
            assert "bbb" in daemon.session_states
            assert daemon.session_states["aaa"].action_count == 3
            assert daemon.session_states["bbb"].action_count == 3

    def test_writes_per_session_cache(self):
        from src.archon_consciousness.personality.personality_daemon import (
            MultiSessionDaemon,
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            sess_dir = os.path.join(tmpdir, "sess1")
            for i in range(10):  # 10 events → triggers state update at action_count=5 and 10
                _write_event(sess_dir)

            daemon = MultiSessionDaemon(tmpdir)
            daemon.poll_once()

            cache_file = os.path.join(sess_dir, "state.json")
            assert os.path.exists(cache_file)
            with open(cache_file) as f:
                cache = json.load(f)
            assert "state" in cache
            assert "mood_valence" in cache

    def test_sessions_isolated(self):
        """Events from session A don't affect session B's state."""
        from src.archon_consciousness.personality.personality_daemon import (
            MultiSessionDaemon,
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            # Session A: many corrections
            sess_a = os.path.join(tmpdir, "sess-a")
            for i in range(10):
                _write_event(sess_a)
            corr_a = os.path.join(sess_a, "corrections.jsonl")
            with open(corr_a, "w") as f:
                for i in range(5):
                    f.write(json.dumps({"type": "factual_error"}) + "\n")

            # Session B: clean
            sess_b = os.path.join(tmpdir, "sess-b")
            for i in range(3):
                _write_event(sess_b)

            daemon = MultiSessionDaemon(tmpdir)
            daemon.poll_once()

            # Session A should have corrections, B should not
            assert daemon.session_states["sess-a"].correction_count >= 1
            assert daemon.session_states["sess-b"].correction_count == 0

    def test_cleans_up_removed_sessions(self):
        from src.archon_consciousness.personality.personality_daemon import (
            MultiSessionDaemon,
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            sess_dir = os.path.join(tmpdir, "temp-session")
            _write_event(sess_dir)

            daemon = MultiSessionDaemon(tmpdir)
            daemon.poll_once()
            assert "temp-session" in daemon.session_states

            # Remove session directory
            import shutil
            shutil.rmtree(sess_dir)
            daemon.poll_once()
            assert "temp-session" not in daemon.session_states

    def test_tracks_file_positions(self):
        """Doesn't re-read old events on subsequent polls."""
        from src.archon_consciousness.personality.personality_daemon import (
            MultiSessionDaemon,
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            sess_dir = os.path.join(tmpdir, "pos-test")
            _write_event(sess_dir, target="src/a.py")
            _write_event(sess_dir, target="src/b.py")

            daemon = MultiSessionDaemon(tmpdir)
            daemon.poll_once()
            assert daemon.session_states["pos-test"].action_count == 2

            # Write more events
            _write_event(sess_dir, target="src/c.py")
            daemon.poll_once()
            assert daemon.session_states["pos-test"].action_count == 3  # not 5


class TestShouldStayAlive:

    def test_no_sessions_returns_false(self):
        from src.archon_consciousness.personality.personality_daemon import (
            should_stay_alive,
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            assert should_stay_alive(tmpdir) is False

    def test_recent_events_returns_true(self):
        from src.archon_consciousness.personality.personality_daemon import (
            should_stay_alive,
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            sess_dir = os.path.join(tmpdir, "active")
            _write_event(sess_dir)
            assert should_stay_alive(tmpdir) is True

    def test_new_directory_no_events_returns_true(self):
        """Recently created session dir (no events yet) = active."""
        from src.archon_consciousness.personality.personality_daemon import (
            should_stay_alive,
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            sess_dir = os.path.join(tmpdir, "new-session")
            os.makedirs(sess_dir)
            assert should_stay_alive(tmpdir) is True

    def test_nonexistent_dir_returns_false(self):
        from src.archon_consciousness.personality.personality_daemon import (
            should_stay_alive,
        )
        assert should_stay_alive("/nonexistent/path") is False
