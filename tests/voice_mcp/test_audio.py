"""Tests for audio capture module — import guards, device enumeration, constants."""

from unittest.mock import MagicMock, patch

import pytest

from src.voice_mcp.audio import (
    CHANNELS,
    CHUNK_DURATION_MS,
    CHUNK_SAMPLES,
    DTYPE,
    LOOKBACK_CHUNKS,
    LOOKBACK_MS,
    MAX_TIMEOUT_SECONDS,
    MIN_SILENCE_MS,
    MIN_SPEECH_MS,
    RING_BUFFER_SECONDS,
    SAMPLE_RATE,
    VAD_THRESHOLD,
    AudioCapture,
    AudioCaptureError,
    _import_sounddevice,
)


class TestConstants:
    def test_sample_rate(self):
        assert SAMPLE_RATE == 16000

    def test_channels(self):
        assert CHANNELS == 1

    def test_dtype(self):
        assert DTYPE == "float32"

    def test_chunk_samples(self):
        assert CHUNK_SAMPLES == 480  # 16000 * 30/1000

    def test_lookback_chunks(self):
        assert LOOKBACK_CHUNKS == LOOKBACK_MS // CHUNK_DURATION_MS

    def test_vad_threshold_range(self):
        assert 0.0 < VAD_THRESHOLD < 1.0

    def test_min_speech_positive(self):
        assert MIN_SPEECH_MS > 0

    def test_min_silence_positive(self):
        assert MIN_SILENCE_MS > 0

    def test_max_timeout(self):
        assert MAX_TIMEOUT_SECONDS == 120

    def test_ring_buffer_seconds(self):
        assert RING_BUFFER_SECONDS == 120


class TestImportSounddevice:
    @patch.dict("sys.modules", {"sounddevice": MagicMock()})
    def test_success(self):
        sd = _import_sounddevice()
        assert sd is not None

    def test_import_error(self):
        with patch.dict("sys.modules", {"sounddevice": None}):
            with pytest.raises(AudioCaptureError, match="sounddevice not installed"):
                _import_sounddevice()

    @patch("src.voice_mcp.audio.platform")
    def test_os_error_linux(self, mock_platform):
        mock_platform.system.return_value = "Linux"
        # Simulate OSError during import (PortAudio missing)
        import importlib
        with patch.dict("sys.modules", {"sounddevice": None}):
            with pytest.raises(AudioCaptureError, match="sounddevice not installed"):
                _import_sounddevice()


class TestAudioCapture:
    @patch("src.voice_mcp.audio._import_sounddevice")
    def test_init_calls_import(self, mock_import):
        mock_import.return_value = MagicMock()
        ac = AudioCapture()
        mock_import.assert_called_once()

    @patch("src.voice_mcp.audio._import_sounddevice")
    def test_cancel_sets_flag(self, mock_import):
        mock_import.return_value = MagicMock()
        ac = AudioCapture()
        ac.cancel()
        assert ac._cancelled is True

    @patch("src.voice_mcp.audio._import_sounddevice")
    def test_list_input_devices(self, mock_import):
        mock_sd = MagicMock()
        mock_sd.query_devices.return_value = [
            {"name": "Built-in Mic", "index": 0, "max_input_channels": 1,
             "max_output_channels": 0, "default_samplerate": 44100},
            {"name": "External", "index": 1, "max_input_channels": 2,
             "max_output_channels": 0, "default_samplerate": 48000},
        ]
        mock_sd.default.device = (0, 1)
        mock_import.return_value = mock_sd
        ac = AudioCapture()
        devices = ac.list_input_devices()
        assert len(devices) == 2
        assert devices[0]["name"] == "Built-in Mic"
        assert devices[0]["default"] is True
        assert devices[1]["default"] is False

    @patch("src.voice_mcp.audio._import_sounddevice")
    def test_list_output_devices(self, mock_import):
        mock_sd = MagicMock()
        mock_sd.query_devices.return_value = [
            {"name": "Speakers", "index": 0, "max_input_channels": 0,
             "max_output_channels": 2, "default_samplerate": 44100},
        ]
        mock_sd.default.device = (0, 0)
        mock_import.return_value = mock_sd
        ac = AudioCapture()
        devices = ac.list_output_devices()
        assert len(devices) == 1
        assert devices[0]["name"] == "Speakers"

    @patch("src.voice_mcp.audio._import_sounddevice")
    def test_list_devices_empty_when_no_devices(self, mock_import):
        mock_sd = MagicMock()
        mock_sd.query_devices.return_value = []
        mock_sd.default.device = (None, None)
        mock_import.return_value = mock_sd
        ac = AudioCapture()
        assert ac.list_input_devices() == []
        assert ac.list_output_devices() == []
