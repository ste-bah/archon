"""Tests for archon monitor daemon."""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from archon_monitor.daemon import MonitorDaemon, send_to_daemon
from archon_monitor.models import TrackType, ItemState


@pytest.fixture
def daemon_paths():
    """Use short paths — Unix sockets have 104-byte limit on macOS."""
    base = Path(f"/tmp/archon-test-{os.getpid()}")
    base.mkdir(parents=True, exist_ok=True)
    yield {
        "socket": base / "mon.sock",
        "pid_file": base / "d.pid",
        "state_file": base / "state.json",
    }
    # Cleanup
    import shutil
    shutil.rmtree(str(base), ignore_errors=True)


@pytest.fixture
def daemon(daemon_paths):
    return MonitorDaemon(
        socket_path=daemon_paths["socket"],
        pid_file=daemon_paths["pid_file"],
        state_file=daemon_paths["state_file"],
        pid_poll_interval=0.1,
    )


def run_async(coro):
    """Helper to run async code in sync tests."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class TestDaemonLifecycle:
    def test_start_creates_pid_file(self, daemon, daemon_paths):
        async def _test():
            await daemon.start()
            assert daemon_paths["pid_file"].exists()
            pid = int(daemon_paths["pid_file"].read_text())
            assert pid == os.getpid()
            await daemon.stop()

        run_async(_test())

    def test_start_creates_socket(self, daemon, daemon_paths):
        async def _test():
            await daemon.start()
            assert daemon_paths["socket"].exists()
            await daemon.stop()

        run_async(_test())

    def test_stop_removes_pid_and_socket(self, daemon, daemon_paths):
        async def _test():
            await daemon.start()
            await daemon.stop()
            assert not daemon_paths["pid_file"].exists()
            assert not daemon_paths["socket"].exists()

        run_async(_test())

    def test_socket_permissions(self, daemon, daemon_paths):
        async def _test():
            await daemon.start()
            mode = oct(daemon_paths["socket"].stat().st_mode)[-3:]
            assert mode == "600", f"Socket permissions should be 600, got {mode}"
            await daemon.stop()

        run_async(_test())


class TestTracking:
    def test_track_current_pid(self, daemon):
        run_async(daemon.start())
        try:
            item = daemon.track(TrackType.PID, "self", str(os.getpid()))
            assert item.state == ItemState.RUNNING
            assert item.track_type == TrackType.PID
            assert len(item.item_id) == 8
        finally:
            run_async(daemon.stop())

    def test_track_rejects_pid_0(self, daemon):
        run_async(daemon.start())
        try:
            with pytest.raises(ValueError, match="reserved"):
                daemon.track(TrackType.PID, "init", "0")
        finally:
            run_async(daemon.stop())

    def test_track_rejects_pid_1(self, daemon):
        run_async(daemon.start())
        try:
            with pytest.raises(ValueError, match="reserved"):
                daemon.track(TrackType.PID, "init", "1")
        finally:
            run_async(daemon.stop())

    def test_track_rejects_nonexistent_pid(self, daemon):
        run_async(daemon.start())
        try:
            with pytest.raises(ValueError, match="does not exist"):
                daemon.track(TrackType.PID, "gone", "999999999")
        finally:
            run_async(daemon.stop())

    def test_track_log_rejects_relative_path(self, daemon):
        run_async(daemon.start())
        try:
            with pytest.raises(ValueError, match="absolute"):
                daemon.track(TrackType.LOG, "log", "relative/path.log")
        finally:
            run_async(daemon.stop())

    def test_untrack(self, daemon):
        run_async(daemon.start())
        try:
            item = daemon.track(TrackType.PID, "self", str(os.getpid()))
            assert daemon.tracked_count == 1
            assert daemon.untrack(item.item_id) is True
            assert daemon.tracked_count == 0
        finally:
            run_async(daemon.stop())

    def test_untrack_nonexistent_returns_false(self, daemon):
        run_async(daemon.start())
        try:
            assert daemon.untrack("nonexistent") is False
        finally:
            run_async(daemon.stop())

    def test_get_status(self, daemon):
        run_async(daemon.start())
        try:
            daemon.track(TrackType.PID, "self", str(os.getpid()))
            status = daemon.get_status()
            assert status["status"] == "ok"
            assert status["tracked_count"] == 1
            assert status["pid"] == os.getpid()
            assert len(status["items"]) == 1
        finally:
            run_async(daemon.stop())


class TestStatePersistence:
    def test_save_and_load(self, daemon, daemon_paths):
        run_async(daemon.start())
        daemon.track(TrackType.PID, "self", str(os.getpid()))
        run_async(daemon.stop())

        # Create new daemon and verify state restored
        daemon2 = MonitorDaemon(
            socket_path=daemon_paths["socket"],
            pid_file=daemon_paths["pid_file"],
            state_file=daemon_paths["state_file"],
        )
        run_async(daemon2.start())
        try:
            assert daemon2.tracked_count == 1
        finally:
            run_async(daemon2.stop())

    def test_state_file_is_json(self, daemon, daemon_paths):
        run_async(daemon.start())
        daemon.track(TrackType.PID, "test", str(os.getpid()))
        run_async(daemon.stop())

        data = json.loads(daemon_paths["state_file"].read_text())
        assert "items" in data
        assert len(data["items"]) == 1


class TestPidPolling:
    def test_detects_process_exit(self, daemon):
        """Start a subprocess, track it, let it exit, verify detection."""
        import subprocess

        async def _test():
            await daemon.start()
            # Start a process that sleeps briefly — track it BEFORE it exits
            proc = subprocess.Popen(["sleep", "10"])
            item = daemon.track(TrackType.PID, "short-lived", str(proc.pid))
            assert daemon._items[item.item_id].state == ItemState.RUNNING

            # Kill it
            proc.terminate()
            proc.wait()

            # Poll — should detect exit
            await daemon._poll_pids()
            assert daemon._items[item.item_id].state == ItemState.COMPLETED
            await daemon.stop()

        run_async(_test())


class TestSocketIPC:
    def test_health_check(self, daemon, daemon_paths):
        async def _test():
            await daemon.start()
            response = await send_to_daemon("health", socket_path=daemon_paths["socket"])
            assert response["status"] == "ok"
            assert "uptime_seconds" in response
            await daemon.stop()

        run_async(_test())

    def test_track_via_socket(self, daemon, daemon_paths):
        async def _test():
            await daemon.start()
            response = await send_to_daemon("track", {
                "type": "pid",
                "label": "self",
                "target": os.getpid(),
            }, socket_path=daemon_paths["socket"])
            assert response["status"] == "ok"
            assert "item" in response
            await daemon.stop()

        run_async(_test())

    def test_status_via_socket(self, daemon, daemon_paths):
        async def _test():
            await daemon.start()
            daemon.track(TrackType.PID, "self", str(os.getpid()))
            response = await send_to_daemon("status", socket_path=daemon_paths["socket"])
            assert response["tracked_count"] == 1
            await daemon.stop()

        run_async(_test())

    def test_unknown_method_returns_error(self, daemon, daemon_paths):
        async def _test():
            await daemon.start()
            response = await send_to_daemon("nonexistent", socket_path=daemon_paths["socket"])
            assert response["status"] == "error"
            await daemon.stop()

        run_async(_test())


class TestEventEmission:
    def test_exit_event_emitted(self, daemon):
        events = []
        daemon.set_event_callback(lambda e: events.append(e))

        import subprocess

        async def _test():
            await daemon.start()
            proc = subprocess.Popen(["sleep", "10"])
            daemon.track(TrackType.PID, "exiter", str(proc.pid))
            proc.terminate()
            proc.wait()
            await daemon._poll_pids()
            await daemon.stop()

        run_async(_test())
        assert len(events) == 1
        assert events[0].event_type == "exit"
        assert events[0].severity == "info"
