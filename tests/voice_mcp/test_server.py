"""Tests for Voice MCP server tools — voice_listen, voice_speak, voice_status, voice_stop."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from src.voice_mcp.server import VoiceState, voice_listen, voice_speak, voice_status, voice_stop


def run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class TestVoiceState:
    def test_initial_state(self):
        state = VoiceState()
        assert state.current == VoiceState.IDLE
        assert state.error is None

    def test_state_values(self):
        assert VoiceState.IDLE == "idle"
        assert VoiceState.LISTENING == "listening"
        assert VoiceState.TRANSCRIBING == "transcribing"
        assert VoiceState.SPEAKING == "speaking"


class TestVoiceListen:
    @patch("src.voice_mcp.server._get_audio")
    def test_audio_unavailable(self, mock_get_audio):
        from src.voice_mcp.audio import AudioCaptureError
        mock_get_audio.side_effect = AudioCaptureError("No mic")
        result = run_async(voice_listen())
        assert result["error"] == "audio_unavailable"

    @patch("src.voice_mcp.server._get_stt")
    @patch("src.voice_mcp.server._get_audio")
    def test_no_speech_detected(self, mock_get_audio, mock_get_stt):
        from src.voice_mcp.audio import AudioCaptureError
        mock_audio = MagicMock()
        mock_audio.capture_until_silence = AsyncMock(
            side_effect=AudioCaptureError("No speech detected before timeout.")
        )
        mock_get_audio.return_value = mock_audio
        result = run_async(voice_listen())
        assert result["error"] == "microphone_unavailable"

    @patch("src.voice_mcp.server._get_stt")
    @patch("src.voice_mcp.server._get_audio")
    def test_successful_transcription(self, mock_get_audio, mock_get_stt):
        mock_audio = MagicMock()
        audio_data = np.zeros(32000, dtype=np.float32)
        mock_audio.capture_until_silence = AsyncMock(return_value=(audio_data, 2.0))
        mock_get_audio.return_value = mock_audio

        mock_stt = MagicMock()
        mock_stt.transcribe.return_value = {
            "text": "hello world",
            "duration_seconds": 2.0,
            "confidence": 0.9,
            "language": "en",
        }
        mock_get_stt.return_value = mock_stt

        result = run_async(voice_listen())
        assert result["text"] == "hello world"
        assert result["confidence"] == 0.9

    @patch("src.voice_mcp.server._get_stt")
    @patch("src.voice_mcp.server._get_audio")
    def test_stt_unavailable(self, mock_get_audio, mock_get_stt):
        from src.voice_mcp.stt import STTError
        mock_audio = MagicMock()
        mock_audio.capture_until_silence = AsyncMock(
            return_value=(np.zeros(16000, dtype=np.float32), 1.0)
        )
        mock_get_audio.return_value = mock_audio

        mock_stt = MagicMock()
        mock_stt.transcribe.side_effect = STTError("faster-whisper not installed")
        mock_get_stt.return_value = mock_stt

        result = run_async(voice_listen())
        assert result["error"] == "stt_unavailable"

    @patch("src.voice_mcp.server._get_stt")
    @patch("src.voice_mcp.server._get_audio")
    def test_very_short_audio(self, mock_get_audio, mock_get_stt):
        mock_audio = MagicMock()
        short_audio = np.zeros(100, dtype=np.float32)
        mock_audio.capture_until_silence = AsyncMock(return_value=(short_audio, 0.006))
        mock_get_audio.return_value = mock_audio

        result = run_async(voice_listen())
        assert result["text"] == ""
        assert result["duration_seconds"] == 0.0

    @patch("src.voice_mcp.server._get_stt")
    @patch("src.voice_mcp.server._get_audio")
    def test_timeout_clamped(self, mock_get_audio, mock_get_stt):
        mock_audio = MagicMock()
        mock_audio.capture_until_silence = AsyncMock(
            return_value=(np.zeros(16000, dtype=np.float32), 1.0)
        )
        mock_get_audio.return_value = mock_audio
        mock_stt = MagicMock()
        mock_stt.transcribe.return_value = {
            "text": "ok", "duration_seconds": 1.0,
            "confidence": 0.9, "language": "en",
        }
        mock_get_stt.return_value = mock_stt

        # Should not raise even with extreme timeout values
        result = run_async(voice_listen(timeout_seconds=999))
        assert "text" in result or "error" in result


class TestVoiceSpeak:
    @patch("src.voice_mcp.server._get_tts")
    def test_successful_speak(self, mock_get_tts):
        mock_tts = MagicMock()
        mock_tts.speak.return_value = {
            "status": "speaking", "id": "tts-123", "backend": "say",
        }
        mock_tts.is_speaking = True
        mock_get_tts.return_value = mock_tts

        result = run_async(voice_speak("hello"))
        assert result["status"] == "speaking"
        assert result["id"] == "tts-123"

    @patch("src.voice_mcp.server._get_tts")
    def test_empty_text(self, mock_get_tts):
        mock_tts = MagicMock()
        mock_tts.speak.return_value = {"error": "empty_text", "message": "No text provided."}
        mock_get_tts.return_value = mock_tts

        result = run_async(voice_speak(""))
        assert result["error"] == "empty_text"

    @patch("src.voice_mcp.server._get_tts")
    def test_tts_init_failed(self, mock_get_tts):
        mock_get_tts.side_effect = Exception("init failed")
        result = run_async(voice_speak("hello"))
        assert result["error"] == "tts_init_failed"


class TestVoiceStop:
    @patch("src.voice_mcp.server._tts", None)
    def test_stop_no_tts(self):
        result = run_async(voice_stop())
        assert result["status"] == "stopped"
        assert result["cancelled_id"] is None

    @patch("src.voice_mcp.server._tts")
    def test_stop_with_tts(self, mock_tts):
        mock_tts.stop.return_value = {"status": "stopped", "cancelled_id": "tts-456"}
        result = run_async(voice_stop())
        assert result["status"] == "stopped"


class TestVoiceStatus:
    @patch("src.voice_mcp.server._tts", None)
    @patch("src.voice_mcp.server._stt", None)
    @patch("src.voice_mcp.server._audio", None)
    @patch("src.voice_mcp.server._state")
    def test_status_idle(self, mock_state):
        mock_state.current = "idle"
        mock_state.error = None

        # Mock AudioCapture to avoid sounddevice import
        with patch("src.voice_mcp.server.AudioCapture") as MockAC:
            mock_ac = MagicMock()
            mock_ac.list_input_devices.return_value = []
            mock_ac.list_output_devices.return_value = []
            MockAC.return_value = mock_ac

            result = run_async(voice_status())

        assert result["state"] == "idle"
        assert result["model_loaded"] is None
        assert result["tts_backend"] is None
        assert "platform" in result

    @patch("src.voice_mcp.server._state")
    def test_status_with_loaded_model(self, mock_state):
        mock_state.current = "idle"
        mock_state.error = None

        import src.voice_mcp.server as srv
        old_stt = srv._stt
        old_audio = srv._audio
        old_tts = srv._tts

        mock_stt = MagicMock()
        mock_stt.model_loaded = "small.en"
        mock_stt.model_ram_mb = 852
        srv._stt = mock_stt

        mock_audio = MagicMock()
        mock_audio.list_input_devices.return_value = [{"name": "Mic", "index": 0, "default": True}]
        mock_audio.list_output_devices.return_value = []
        srv._audio = mock_audio

        mock_tts = MagicMock()
        mock_tts.backend = "say"
        mock_tts.is_speaking = False
        mock_tts.current_id = None
        srv._tts = mock_tts

        try:
            result = run_async(voice_status())
            assert result["model_loaded"] == "small.en"
            assert result["model_ram_mb"] == 852
            assert result["tts_backend"] == "say"
            assert len(result["input_devices"]) == 1
        finally:
            srv._stt = old_stt
            srv._audio = old_audio
            srv._tts = old_tts
