"""Tests for TTS engine — backend detection, speak, stop, playback queue."""

import subprocess
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

from src.voice_mcp.tts import (
    DEFAULT_ESPEAK_VOICE,
    DEFAULT_LINUX_VOICE,
    DEFAULT_MACOS_VOICE,
    MACOS_DEFAULT_RATE,
    PlaybackItem,
    TTSEngine,
    TTSError,
    _espeak_ng_available,
    _kokoro_available,
)


class TestKokoroAvailable:
    @patch.dict("sys.modules", {"kokoro": MagicMock()})
    def test_returns_true_when_importable(self):
        assert _kokoro_available() is True

    @patch.dict("sys.modules", {"kokoro": None})
    def test_returns_false_when_not_importable(self):
        assert _kokoro_available() is False


class TestEspeakNgAvailable:
    @patch("src.voice_mcp.tts.subprocess.run")
    def test_returns_true_when_exists(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        assert _espeak_ng_available() is True

    @patch("src.voice_mcp.tts.subprocess.run", side_effect=FileNotFoundError)
    def test_returns_false_when_missing(self, _):
        assert _espeak_ng_available() is False

    @patch("src.voice_mcp.tts.subprocess.run", side_effect=subprocess.TimeoutExpired("cmd", 5))
    def test_returns_false_on_timeout(self, _):
        assert _espeak_ng_available() is False


class TestDetectBackend:
    @patch("src.voice_mcp.tts.platform")
    def test_macos_returns_say(self, mock_platform):
        mock_platform.system.return_value = "Darwin"
        engine = TTSEngine.__new__(TTSEngine)
        engine._platform = "Darwin"
        assert engine._detect_backend() == "say"

    @patch("src.voice_mcp.tts._kokoro_available", return_value=True)
    @patch("src.voice_mcp.tts._espeak_ng_available", return_value=True)
    def test_linux_kokoro_plus_espeak(self, _, __):
        engine = TTSEngine.__new__(TTSEngine)
        engine._platform = "Linux"
        assert engine._detect_backend() == "kokoro"

    @patch("src.voice_mcp.tts._kokoro_available", return_value=False)
    @patch("src.voice_mcp.tts._espeak_ng_available", return_value=True)
    def test_linux_espeak_only(self, _, __):
        engine = TTSEngine.__new__(TTSEngine)
        engine._platform = "Linux"
        assert engine._detect_backend() == "espeak-ng"

    @patch("src.voice_mcp.tts._kokoro_available", return_value=False)
    @patch("src.voice_mcp.tts._espeak_ng_available", return_value=False)
    def test_linux_nothing(self, _, __):
        engine = TTSEngine.__new__(TTSEngine)
        engine._platform = "Linux"
        assert engine._detect_backend() == "none"

    def test_unsupported_platform(self):
        engine = TTSEngine.__new__(TTSEngine)
        engine._platform = "Windows"
        assert engine._detect_backend() == "none"


class TestTTSEngineSpeak:
    def _make_engine(self, backend="say"):
        engine = TTSEngine.__new__(TTSEngine)
        engine._platform = "Darwin" if backend == "say" else "Linux"
        engine._backend = backend
        engine._kokoro_pipeline = None
        engine._queue = __import__("queue").Queue()
        engine._current = None
        engine._lock = threading.Lock()
        engine._worker = threading.Thread(target=engine._playback_worker, daemon=True)
        engine._worker.start()
        return engine

    def test_speak_returns_immediately(self):
        engine = self._make_engine("say")
        # Don't let the worker actually run _play_say
        with patch.object(engine, "_play_item"):
            result = engine.speak("hello")
        assert result["status"] == "speaking"
        assert result["id"].startswith("tts-")
        assert result["backend"] == "say"
        engine.shutdown()

    def test_speak_no_backend(self):
        engine = self._make_engine("none")
        engine._backend = "none"
        engine._platform = "Linux"
        result = engine.speak("hello")
        assert result["error"] == "tts_unavailable"
        engine.shutdown()

    def test_speak_empty_text(self):
        engine = self._make_engine("say")
        result = engine.speak("")
        assert result["error"] == "empty_text"
        engine.shutdown()

    def test_speak_whitespace_only(self):
        engine = self._make_engine("say")
        result = engine.speak("   ")
        assert result["error"] == "empty_text"
        engine.shutdown()

    def test_speak_truncates_long_text(self):
        engine = self._make_engine("say")
        items = []
        orig_put = engine._queue.put
        def capture_put(item):
            if item is not None:
                items.append(item)
            orig_put(item)
        engine._queue.put = capture_put

        with patch.object(engine, "_play_item"):
            engine.speak("x" * 10000)
        assert len(items) > 0
        assert len(items[0].text) == 5000
        engine.shutdown()

    def test_speak_clamps_speed(self):
        engine = self._make_engine("say")
        items = []
        orig_put = engine._queue.put
        def capture_put(item):
            if item is not None:
                items.append(item)
            orig_put(item)
        engine._queue.put = capture_put

        with patch.object(engine, "_play_item"):
            engine.speak("hi", speed=0.1)  # below 0.25
            engine.speak("hi", speed=10.0)  # above 4.0
        assert items[0].speed == 0.25
        assert items[1].speed == 4.0
        engine.shutdown()

    def test_speak_default_voice_macos(self):
        engine = self._make_engine("say")
        items = []
        orig_put = engine._queue.put
        def capture_put(item):
            if item is not None:
                items.append(item)
            orig_put(item)
        engine._queue.put = capture_put

        with patch.object(engine, "_play_item"):
            engine.speak("hi", voice="default")
        assert items[0].voice == DEFAULT_MACOS_VOICE
        engine.shutdown()


class TestTTSEngineStop:
    def _make_engine(self, backend="say"):
        engine = TTSEngine.__new__(TTSEngine)
        engine._platform = "Darwin"
        engine._backend = backend
        engine._kokoro_pipeline = None
        engine._queue = __import__("queue").Queue()
        engine._current = None
        engine._lock = threading.Lock()
        engine._worker = threading.Thread(target=engine._playback_worker, daemon=True)
        engine._worker.start()
        return engine

    def test_stop_when_nothing_playing(self):
        engine = self._make_engine()
        result = engine.stop()
        assert result["status"] == "stopped"
        assert result["cancelled_id"] is None
        engine.shutdown()

    def test_stop_cancels_current(self):
        engine = self._make_engine()
        item = PlaybackItem(id="tts-123", text="hello", voice="Samantha", speed=1.0)
        with engine._lock:
            engine._current = item
        with patch.object(engine, "_cancel_current_playback"):
            result = engine.stop()
        assert result["cancelled_id"] == "tts-123"
        engine.shutdown()


class TestPlaySay:
    def test_calls_subprocess_popen(self):
        engine = TTSEngine.__new__(TTSEngine)
        engine._backend = "say"
        item = PlaybackItem(id="t1", text="hello", voice="Samantha", speed=1.0)

        with patch("src.voice_mcp.tts.subprocess.Popen") as mock_popen:
            mock_proc = MagicMock()
            mock_popen.return_value = mock_proc
            engine._play_say(item)

        mock_popen.assert_called_once_with(
            ["say", "-v", "Samantha", "-r", "200", "hello"]
        )

    def test_speed_multiplier(self):
        engine = TTSEngine.__new__(TTSEngine)
        item = PlaybackItem(id="t1", text="hi", voice="Alex", speed=2.0)

        with patch("src.voice_mcp.tts.subprocess.Popen") as mock_popen:
            mock_popen.return_value = MagicMock()
            engine._play_say(item)

        args = mock_popen.call_args[0][0]
        assert "-r" in args
        rate_idx = args.index("-r") + 1
        assert args[rate_idx] == "400"  # 200 * 2.0


class TestPlayEspeak:
    def test_calls_subprocess_popen(self):
        engine = TTSEngine.__new__(TTSEngine)
        item = PlaybackItem(id="t1", text="hello", voice="en", speed=1.0)

        with patch("src.voice_mcp.tts.subprocess.Popen") as mock_popen:
            mock_popen.return_value = MagicMock()
            engine._play_espeak(item)

        mock_popen.assert_called_once_with(
            ["espeak-ng", "-v", "en", "-s", "175", "hello"]
        )

    def test_speed_multiplier(self):
        engine = TTSEngine.__new__(TTSEngine)
        item = PlaybackItem(id="t1", text="hi", voice="en", speed=2.0)

        with patch("src.voice_mcp.tts.subprocess.Popen") as mock_popen:
            mock_popen.return_value = MagicMock()
            engine._play_espeak(item)

        args = mock_popen.call_args[0][0]
        assert "-s" in args
        speed_idx = args.index("-s") + 1
        assert args[speed_idx] == "350"  # 175 * 2.0


class TestCancelPlayback:
    def test_terminates_subprocess(self):
        engine = TTSEngine.__new__(TTSEngine)
        engine._backend = "say"
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None  # still running
        item = PlaybackItem(id="t1", text="hi", voice="v", speed=1.0, process=mock_proc)
        engine._current = item

        engine._cancel_current_playback()
        mock_proc.terminate.assert_called_once()

    def test_kills_if_terminate_times_out(self):
        engine = TTSEngine.__new__(TTSEngine)
        engine._backend = "say"
        mock_proc = MagicMock()
        mock_proc.poll.return_value = None
        mock_proc.wait.side_effect = subprocess.TimeoutExpired("say", 2)
        item = PlaybackItem(id="t1", text="hi", voice="v", speed=1.0, process=mock_proc)
        engine._current = item

        engine._cancel_current_playback()
        mock_proc.kill.assert_called_once()


class TestPlaybackItem:
    def test_defaults(self):
        item = PlaybackItem(id="t1", text="hi", voice="v", speed=1.0)
        assert item.process is None
        assert item.cancelled is False
