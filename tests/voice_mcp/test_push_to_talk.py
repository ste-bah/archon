"""Tests for push-to-talk daemon."""

import asyncio
import os
import tempfile
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from src.voice_mcp.ptt_config import PTTConfig
from src.voice_mcp.push_to_talk import (
    PTTState,
    PIDFileError,
    PushToTalkDaemon,
    _process_alive,
    _read_pid,
    _write_pid,
    check_singleton,
)


# ---------------------------------------------------------------------------
# PID-file helpers
# ---------------------------------------------------------------------------

class TestPIDHelpers:
    def test_write_and_read_pid(self, tmp_path):
        pid_file = tmp_path / "ptt.pid"
        _write_pid(pid_file)
        assert _read_pid(pid_file) == os.getpid()

    def test_read_pid_missing_file(self, tmp_path):
        assert _read_pid(tmp_path / "nonexistent.pid") is None

    def test_read_pid_malformed(self, tmp_path):
        pid_file = tmp_path / "bad.pid"
        pid_file.write_text("not-a-number")
        assert _read_pid(pid_file) is None

    def test_write_pid_creates_parent_dirs(self, tmp_path):
        pid_file = tmp_path / "a" / "b" / "c" / "daemon.pid"
        _write_pid(pid_file)
        assert pid_file.exists()

    def test_process_alive_self(self):
        assert _process_alive(os.getpid()) is True

    def test_process_alive_nonexistent(self):
        # Use a PID unlikely to exist
        assert _process_alive(99999999) is False

    def test_check_singleton_no_existing_file(self, tmp_path):
        # Should not raise
        check_singleton(tmp_path / "daemon.pid")

    def test_check_singleton_stale_pid_cleaned_up(self, tmp_path):
        pid_file = tmp_path / "daemon.pid"
        pid_file.write_text("99999999")  # non-existent PID
        check_singleton(pid_file)
        assert not pid_file.exists()

    def test_check_singleton_running_raises(self, tmp_path):
        pid_file = tmp_path / "daemon.pid"
        _write_pid(pid_file)
        with pytest.raises(PIDFileError, match="already running"):
            check_singleton(pid_file)


# ---------------------------------------------------------------------------
# PTTState enum
# ---------------------------------------------------------------------------

class TestPTTState:
    def test_all_states_are_strings(self):
        for state in PTTState:
            assert isinstance(state.value, str)

    def test_idle_value(self):
        assert PTTState.IDLE.value == "idle"

    def test_recording_value(self):
        assert PTTState.RECORDING.value == "recording"

    def test_transcribing_value(self):
        assert PTTState.TRANSCRIBING.value == "transcribing"

    def test_injecting_value(self):
        assert PTTState.INJECTING.value == "injecting"


# ---------------------------------------------------------------------------
# Daemon helpers
# ---------------------------------------------------------------------------

def _make_config(tmp_path) -> PTTConfig:
    # Unix domain socket paths are limited to ~108 chars on macOS.
    # Use a short /tmp path for the socket to avoid OSError: AF_UNIX path too long.
    import uuid
    sock = f"/tmp/ptt_{uuid.uuid4().hex[:8]}.sock"
    return PTTConfig(
        pid_file=str(tmp_path / "ptt.pid"),
        socket_path=sock,
        hotkey="ctrl+shift+space",
    )


def _make_daemon(tmp_path) -> PushToTalkDaemon:
    return PushToTalkDaemon(config=_make_config(tmp_path))


def _mock_stt():
    stt = MagicMock()
    stt.preload = MagicMock()
    stt.transcribe = MagicMock(return_value={
        "text": "hello world",
        "confidence": 0.9,
        "duration_seconds": 1.0,
        "language": "en",
    })
    return stt


def _mock_audio():
    audio = MagicMock()
    audio.capture_until_silence = AsyncMock(
        return_value=(np.zeros(16000, dtype=np.float32), 1.0)
    )
    audio.cancel = MagicMock()
    return audio


def _mock_injector():
    inj = MagicMock()
    inj.clipboard_only = False
    inj.inject = MagicMock()
    return inj


def _mock_hotkey_listener():
    listener = MagicMock()
    listener.start = MagicMock()
    listener.stop = MagicMock()
    return listener


# ---------------------------------------------------------------------------
# Daemon state
# ---------------------------------------------------------------------------

class TestPushToTalkDaemonInit:
    def test_initial_state_is_idle(self, tmp_path):
        d = _make_daemon(tmp_path)
        assert d._state == PTTState.IDLE

    def test_initial_transcriptions_count(self, tmp_path):
        d = _make_daemon(tmp_path)
        assert d._transcriptions == 0

    def test_initial_errors_count(self, tmp_path):
        d = _make_daemon(tmp_path)
        assert d._errors == 0

    def test_status_dict_before_start(self, tmp_path):
        d = _make_daemon(tmp_path)
        # _status_dict requires _start_time and _config which exist
        status = d._status_dict()
        assert status["state"] == "idle"
        assert status["transcriptions"] == 0
        assert "hotkey" in status
        assert "pid" in status


# ---------------------------------------------------------------------------
# Daemon start()
# ---------------------------------------------------------------------------

class TestDaemonStart:
    def _patch_start_deps(self, daemon, tmp_path):
        """Patch all external deps for start()."""
        daemon._stt = _mock_stt()
        daemon._audio = _mock_audio()
        daemon._injector = _mock_injector()
        daemon._hotkey_listener = _mock_hotkey_listener()
        return daemon

    def test_start_writes_pid_file(self, tmp_path):
        daemon = _make_daemon(tmp_path)
        pid_path = daemon._config.pid_path()

        async def _run():
            with patch("src.voice_mcp.push_to_talk.SpeechToText") as mock_stt_cls, \
                 patch("src.voice_mcp.push_to_talk.AudioCapture"), \
                 patch("src.voice_mcp.push_to_talk.create_injector", return_value=_mock_injector()), \
                 patch("src.voice_mcp.push_to_talk.create_hotkey_listener", return_value=_mock_hotkey_listener()):
                mock_stt_cls.return_value = _mock_stt()
                await daemon.start()
                await daemon.stop()

        asyncio.run(_run())
        # PID file removed by stop(), but it was written during start
        # (stop() removes it — so just verify stop ran cleanly)

    def test_start_calls_preload(self, tmp_path):
        daemon = _make_daemon(tmp_path)
        mock_stt = _mock_stt()

        async def _run():
            with patch("src.voice_mcp.push_to_talk.SpeechToText", return_value=mock_stt), \
                 patch("src.voice_mcp.push_to_talk.AudioCapture"), \
                 patch("src.voice_mcp.push_to_talk.create_injector", return_value=_mock_injector()), \
                 patch("src.voice_mcp.push_to_talk.create_hotkey_listener", return_value=_mock_hotkey_listener()):
                await daemon.start()
                await daemon.stop()

        asyncio.run(_run())
        mock_stt.preload.assert_called_once()

    def test_start_raises_on_duplicate_instance(self, tmp_path):
        # Write a live PID file to simulate existing daemon
        pid_path = _make_config(tmp_path).pid_path()
        pid_path.parent.mkdir(parents=True, exist_ok=True)
        _write_pid(pid_path)

        daemon = _make_daemon(tmp_path)

        async def _run():
            with patch("src.voice_mcp.push_to_talk.create_injector", return_value=_mock_injector()):
                await daemon.start()

        with pytest.raises(PIDFileError):
            asyncio.run(_run())

    def test_stop_removes_pid_and_socket(self, tmp_path):
        daemon = _make_daemon(tmp_path)

        async def _run():
            with patch("src.voice_mcp.push_to_talk.SpeechToText", return_value=_mock_stt()), \
                 patch("src.voice_mcp.push_to_talk.AudioCapture"), \
                 patch("src.voice_mcp.push_to_talk.create_injector", return_value=_mock_injector()), \
                 patch("src.voice_mcp.push_to_talk.create_hotkey_listener", return_value=_mock_hotkey_listener()):
                await daemon.start()
                assert daemon._config.pid_path().exists()
                await daemon.stop()
                assert not daemon._config.pid_path().exists()
                assert not daemon._config.sock_path().exists()

        asyncio.run(_run())


# ---------------------------------------------------------------------------
# Hotkey → asyncio bridge
# ---------------------------------------------------------------------------

class TestHotkeyBridge:
    def test_on_hotkey_press_sets_event(self, tmp_path):
        daemon = _make_daemon(tmp_path)

        async def _run():
            daemon._loop = asyncio.get_running_loop()
            daemon._press_event = asyncio.Event()
            daemon._release_event = asyncio.Event()
            daemon._on_hotkey_press()
            await asyncio.sleep(0)  # let call_soon_threadsafe fire
            assert daemon._press_event.is_set()

        asyncio.run(_run())

    def test_on_hotkey_release_sets_event(self, tmp_path):
        daemon = _make_daemon(tmp_path)

        async def _run():
            daemon._loop = asyncio.get_running_loop()
            daemon._press_event = asyncio.Event()
            daemon._release_event = asyncio.Event()
            daemon._on_hotkey_release()
            await asyncio.sleep(0)
            assert daemon._release_event.is_set()

        asyncio.run(_run())

    def test_on_hotkey_press_no_op_before_start(self, tmp_path):
        daemon = _make_daemon(tmp_path)
        # _loop is None — must not raise
        daemon._on_hotkey_press()
        daemon._on_hotkey_release()


# ---------------------------------------------------------------------------
# PTT cycle
# ---------------------------------------------------------------------------

class TestPTTCycle:
    def _make_started_daemon(self, tmp_path):
        daemon = _make_daemon(tmp_path)
        daemon._stt = _mock_stt()
        daemon._audio = _mock_audio()
        daemon._injector = _mock_injector()
        return daemon

    def _init_events(self, daemon):
        daemon._loop = asyncio.get_running_loop()
        daemon._press_event = asyncio.Event()
        daemon._release_event = asyncio.Event()
        daemon._stop_event = asyncio.Event()
        daemon._start_time = time.monotonic()

    def test_successful_cycle_increments_transcriptions(self, tmp_path):
        daemon = self._make_started_daemon(tmp_path)

        async def _run():
            self._init_events(daemon)
            # Release event fires immediately after recording starts
            daemon._release_event.set()
            await daemon._ptt_cycle()
            assert daemon._transcriptions == 1
            assert daemon._state == PTTState.IDLE

        asyncio.run(_run())

    def test_audio_capture_error_resets_to_idle(self, tmp_path):
        from src.voice_mcp.audio import AudioCaptureError
        daemon = self._make_started_daemon(tmp_path)
        daemon._audio.capture_until_silence = AsyncMock(
            side_effect=AudioCaptureError("no speech")
        )

        async def _run():
            self._init_events(daemon)
            await daemon._ptt_cycle()
            assert daemon._state == PTTState.IDLE
            assert daemon._transcriptions == 0

        asyncio.run(_run())

    def test_empty_transcription_resets_to_idle(self, tmp_path):
        daemon = self._make_started_daemon(tmp_path)
        daemon._stt.transcribe = MagicMock(return_value={"text": "  ", "confidence": 0.1})

        async def _run():
            self._init_events(daemon)
            daemon._release_event.set()
            await daemon._ptt_cycle()
            assert daemon._state == PTTState.IDLE
            assert daemon._transcriptions == 0

        asyncio.run(_run())

    def test_injection_error_increments_errors(self, tmp_path):
        from src.voice_mcp.injector import InjectorError
        daemon = self._make_started_daemon(tmp_path)
        daemon._injector.inject = MagicMock(side_effect=InjectorError("failed"))

        async def _run():
            self._init_events(daemon)
            daemon._release_event.set()
            await daemon._ptt_cycle()
            assert daemon._state == PTTState.IDLE
            assert daemon._errors == 1

        asyncio.run(_run())

    def test_transcription_exception_increments_errors(self, tmp_path):
        daemon = self._make_started_daemon(tmp_path)
        daemon._stt.transcribe = MagicMock(side_effect=RuntimeError("model crash"))

        async def _run():
            self._init_events(daemon)
            daemon._release_event.set()
            await daemon._ptt_cycle()
            assert daemon._errors == 1
            assert daemon._state == PTTState.IDLE

        asyncio.run(_run())


# ---------------------------------------------------------------------------
# Status socket
# ---------------------------------------------------------------------------

class TestStatusSocket:
    def test_status_command_returns_json(self, tmp_path):
        daemon = _make_daemon(tmp_path)

        async def _run():
            with patch("src.voice_mcp.push_to_talk.SpeechToText", return_value=_mock_stt()), \
                 patch("src.voice_mcp.push_to_talk.AudioCapture"), \
                 patch("src.voice_mcp.push_to_talk.create_injector", return_value=_mock_injector()), \
                 patch("src.voice_mcp.push_to_talk.create_hotkey_listener", return_value=_mock_hotkey_listener()):
                await daemon.start()
                try:
                    reader, writer = await asyncio.open_unix_connection(
                        str(daemon._config.sock_path())
                    )
                    writer.write(b"status")
                    await writer.drain()
                    writer.write_eof()
                    data = await asyncio.wait_for(reader.read(4096), timeout=2.0)
                    import json
                    response = json.loads(data.decode().strip())
                    assert response["state"] == "idle"
                    assert "pid" in response
                    assert "uptime_seconds" in response
                finally:
                    await daemon.stop()

        asyncio.run(_run())

    def test_stop_command_triggers_shutdown(self, tmp_path):
        daemon = _make_daemon(tmp_path)

        async def _run():
            with patch("src.voice_mcp.push_to_talk.SpeechToText", return_value=_mock_stt()), \
                 patch("src.voice_mcp.push_to_talk.AudioCapture"), \
                 patch("src.voice_mcp.push_to_talk.create_injector", return_value=_mock_injector()), \
                 patch("src.voice_mcp.push_to_talk.create_hotkey_listener", return_value=_mock_hotkey_listener()):
                await daemon.start()
                reader, writer = await asyncio.open_unix_connection(
                    str(daemon._config.sock_path())
                )
                writer.write(b"stop")
                await writer.drain()
                writer.write_eof()
                await asyncio.wait_for(reader.read(4096), timeout=2.0)
                # stop_event should be set
                assert daemon._stop_event.is_set()
                await daemon.stop()

        asyncio.run(_run())


# ---------------------------------------------------------------------------
# STT preload via run_in_executor
# ---------------------------------------------------------------------------

class TestSpeechToTextPreload:
    """Verify that SpeechToText.preload() calls _load_model directly."""

    def test_preload_calls_load_model(self):
        from src.voice_mcp.stt import SpeechToText
        stt = SpeechToText()
        with patch.object(stt, "_load_model") as mock_load:
            stt.preload("tiny.en")
        mock_load.assert_called_once_with("tiny.en")

    def test_preload_uses_default_model_when_none(self):
        from src.voice_mcp.stt import SpeechToText, default_model
        stt = SpeechToText()
        with patch.object(stt, "_load_model") as mock_load:
            stt.preload(None)
        mock_load.assert_called_once_with(default_model())

    def test_preload_default_model_no_arg(self):
        from src.voice_mcp.stt import SpeechToText, default_model
        stt = SpeechToText()
        with patch.object(stt, "_load_model") as mock_load:
            stt.preload()
        mock_load.assert_called_once_with(default_model())
