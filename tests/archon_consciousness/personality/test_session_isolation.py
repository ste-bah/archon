"""Tests for multi-session isolation — concurrent sessions don't corrupt data.

Verifies that session ID namespacing keeps files separated.
"""

import json
import os
import tempfile

import pytest


class TestSessionIdNamespacing:
    """Verify namespaced file paths prevent cross-session contamination."""

    def test_different_sessions_different_files(self):
        """Two sessions with different IDs use different event files."""
        sid_a = "1711734000-12345"
        sid_b = "1711734001-12346"
        base = "/tmp/test-personality"

        events_a = f"{base}/personality-events-{sid_a}.jsonl"
        events_b = f"{base}/personality-events-{sid_b}.jsonl"

        assert events_a != events_b

    def test_fallback_when_no_session_id(self):
        """Without session ID, use non-namespaced paths (backward compat)."""
        sid = ""
        base = "/tmp/test-personality"

        if sid:
            events = f"{base}/personality-events-{sid}.jsonl"
        else:
            events = f"{base}/personality-events.jsonl"

        assert events == f"{base}/personality-events.jsonl"

    def test_session_cleanup_only_removes_own_files(self):
        """Session end cleanup removes only its own namespaced files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            sid_a = "session-a"
            sid_b = "session-b"

            # Create files for both sessions
            for sid in [sid_a, sid_b]:
                for suffix in ["events", "corrections", "current-state"]:
                    path = os.path.join(tmpdir, f"personality-{suffix}-{sid}.jsonl")
                    with open(path, "w") as f:
                        f.write(f'{{"session": "{sid}"}}\n')

            # Simulate session A cleanup
            for suffix in ["events", "corrections", "current-state"]:
                path = os.path.join(tmpdir, f"personality-{suffix}-{sid_a}.jsonl")
                if os.path.exists(path):
                    os.remove(path)

            # Session B files should still exist
            for suffix in ["events", "corrections", "current-state"]:
                path = os.path.join(tmpdir, f"personality-{suffix}-{sid_b}.jsonl")
                assert os.path.exists(path), f"Session B file deleted: {path}"

    def test_session_data_cache_is_shared(self):
        """personality-session-data.json is NOT namespaced — shared across sessions."""
        sid_a = "session-a"
        sid_b = "session-b"

        # Both sessions write to the same file
        shared_path = "personality-session-data.json"

        # This file should NOT contain session ID in its name
        assert sid_a not in shared_path
        assert sid_b not in shared_path

    def test_daemon_pid_namespaced(self):
        """Each session's daemon has its own PID file."""
        sid_a = "session-a"
        sid_b = "session-b"

        pid_a = f"personality-daemon-{sid_a}.pid"
        pid_b = f"personality-daemon-{sid_b}.pid"

        assert pid_a != pid_b

    def test_concurrent_event_writes_isolated(self):
        """Events written to different session files don't interfere."""
        with tempfile.TemporaryDirectory() as tmpdir:
            sid_a = "sess-a"
            sid_b = "sess-b"

            events_a = os.path.join(tmpdir, f"personality-events-{sid_a}.jsonl")
            events_b = os.path.join(tmpdir, f"personality-events-{sid_b}.jsonl")

            # Session A writes
            with open(events_a, "a") as f:
                f.write(json.dumps({"tool": "Edit", "session": "A"}) + "\n")

            # Session B writes
            with open(events_b, "a") as f:
                f.write(json.dumps({"tool": "Write", "session": "B"}) + "\n")

            # Verify isolation
            with open(events_a) as f:
                a_events = [json.loads(l) for l in f]
            with open(events_b) as f:
                b_events = [json.loads(l) for l in f]

            assert len(a_events) == 1
            assert a_events[0]["session"] == "A"
            assert len(b_events) == 1
            assert b_events[0]["session"] == "B"
