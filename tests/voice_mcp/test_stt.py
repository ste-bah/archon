"""Tests for speech-to-text module — platform detection, model selection, transcription."""

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from src.voice_mcp.stt import (
    STTError,
    SpeechToText,
    _APPLE_SILICON_DEFAULT,
    _CPU_DEFAULT,
    _MODEL_RAM_MB,
    _VALID_MODELS,
    default_model,
    detect_platform,
)


class TestDetectPlatform:
    @patch("src.voice_mcp.stt.platform")
    def test_apple_silicon(self, mock_platform):
        mock_platform.system.return_value = "Darwin"
        mock_platform.machine.return_value = "arm64"
        assert detect_platform() == "apple_silicon"

    @patch("src.voice_mcp.stt.platform")
    def test_macos_intel(self, mock_platform):
        mock_platform.system.return_value = "Darwin"
        mock_platform.machine.return_value = "x86_64"
        assert detect_platform() == "macos_intel"

    @patch("src.voice_mcp.stt.platform")
    def test_linux(self, mock_platform):
        mock_platform.system.return_value = "Linux"
        mock_platform.machine.return_value = "x86_64"
        assert detect_platform() == "linux"

    @patch("src.voice_mcp.stt.platform")
    def test_other(self, mock_platform):
        mock_platform.system.return_value = "Windows"
        mock_platform.machine.return_value = "AMD64"
        assert detect_platform() == "other"


class TestDefaultModel:
    @patch("src.voice_mcp.stt.detect_platform", return_value="apple_silicon")
    def test_apple_silicon(self, _):
        assert default_model() == "small.en"

    @patch("src.voice_mcp.stt.detect_platform", return_value="linux")
    def test_linux(self, _):
        assert default_model() == "base.en"

    @patch("src.voice_mcp.stt.detect_platform", return_value="macos_intel")
    def test_macos_intel(self, _):
        assert default_model() == "base.en"

    @patch("src.voice_mcp.stt.detect_platform", return_value="other")
    def test_other(self, _):
        assert default_model() == "base.en"


class TestSpeechToText:
    def test_model_loaded_none_initially(self):
        stt = SpeechToText()
        assert stt.model_loaded is None

    def test_model_ram_mb_none_initially(self):
        stt = SpeechToText()
        assert stt.model_ram_mb is None

    def test_load_invalid_model_raises(self):
        stt = SpeechToText()
        with pytest.raises(STTError, match="Invalid model"):
            stt._load_model("nonexistent")

    @patch.dict("sys.modules", {"faster_whisper": None})
    def test_load_model_no_faster_whisper(self):
        stt = SpeechToText()
        with pytest.raises(STTError, match="faster-whisper not installed"):
            stt._load_model("small.en")

    def test_transcribe_short_audio_returns_empty(self):
        stt = SpeechToText()
        # Very short audio (< 0.1s at 16kHz = < 1600 samples)
        audio = np.zeros(100, dtype=np.float32)
        result = stt.transcribe(audio)
        assert result["text"] == ""
        assert result["confidence"] == 0.0
        assert result["duration_seconds"] < 0.1

    def test_transcribe_rejects_non_float32(self):
        stt = SpeechToText()
        stt._model = MagicMock()
        stt._model_name = "small.en"
        audio = np.zeros(16000, dtype=np.int16)
        with pytest.raises(STTError, match="float32"):
            stt.transcribe(audio)

    def test_transcribe_rejects_2d_audio(self):
        stt = SpeechToText()
        stt._model = MagicMock()
        stt._model_name = "small.en"
        audio = np.zeros((16000, 2), dtype=np.float32)
        with pytest.raises(STTError, match="1-D"):
            stt.transcribe(audio)

    def test_transcribe_with_mock_model(self):
        stt = SpeechToText()
        mock_model = MagicMock()
        mock_segment = MagicMock()
        mock_segment.text = " hello world "
        mock_segment.avg_logprob = -0.2
        mock_info = MagicMock()
        mock_info.language = "en"
        mock_model.transcribe.return_value = ([mock_segment], mock_info)
        stt._model = mock_model
        stt._model_name = "small.en"

        audio = np.random.randn(32000).astype(np.float32)  # 2 seconds
        result = stt.transcribe(audio)
        assert result["text"] == "hello world"
        assert 0.0 <= result["confidence"] <= 1.0
        assert result["language"] == "en"
        assert abs(result["duration_seconds"] - 2.0) < 0.01

    def test_confidence_mapping_perfect(self):
        stt = SpeechToText()
        mock_seg = MagicMock()
        mock_seg.text = "test"
        mock_seg.avg_logprob = 0.0  # perfect
        mock_info = MagicMock()
        mock_info.language = "en"
        stt._model = MagicMock()
        stt._model.transcribe.return_value = ([mock_seg], mock_info)
        stt._model_name = "small.en"

        result = stt.transcribe(np.zeros(16000, dtype=np.float32))
        assert result["confidence"] == 1.0

    def test_confidence_mapping_low(self):
        stt = SpeechToText()
        mock_seg = MagicMock()
        mock_seg.text = "test"
        mock_seg.avg_logprob = -1.0  # very low
        mock_info = MagicMock()
        mock_info.language = "en"
        stt._model = MagicMock()
        stt._model.transcribe.return_value = ([mock_seg], mock_info)
        stt._model_name = "small.en"

        result = stt.transcribe(np.zeros(16000, dtype=np.float32))
        assert result["confidence"] == 0.0

    def test_model_ram_mb_values(self):
        assert _MODEL_RAM_MB["tiny.en"] == 273
        assert _MODEL_RAM_MB["base.en"] == 388
        assert _MODEL_RAM_MB["small.en"] == 852
        assert _MODEL_RAM_MB["medium.en"] == 2100

    def test_valid_models(self):
        assert "tiny.en" in _VALID_MODELS
        assert "base.en" in _VALID_MODELS
        assert "small.en" in _VALID_MODELS
        assert "medium.en" in _VALID_MODELS

    def test_lazy_load_on_transcribe(self):
        stt = SpeechToText()
        mock_model_cls = MagicMock()
        mock_seg = MagicMock(text="test", avg_logprob=-0.1)
        mock_info = MagicMock(language="en")
        mock_model_cls.return_value.transcribe.return_value = ([mock_seg], mock_info)

        with patch.dict("sys.modules", {"faster_whisper": MagicMock(WhisperModel=mock_model_cls)}):
            audio = np.zeros(16000, dtype=np.float32)
            result = stt.transcribe(audio, model="tiny.en")
        assert stt._model_name == "tiny.en"

    def test_model_reload_on_different_name(self):
        stt = SpeechToText()
        stt._model = MagicMock()
        stt._model_name = "base.en"

        mock_model_cls = MagicMock()
        mock_seg = MagicMock(text="hi", avg_logprob=-0.1)
        mock_info = MagicMock(language="en")
        mock_model_cls.return_value.transcribe.return_value = ([mock_seg], mock_info)

        with patch.dict("sys.modules", {"faster_whisper": MagicMock(WhisperModel=mock_model_cls)}):
            stt.transcribe(np.zeros(16000, dtype=np.float32), model="small.en")
        assert stt._model_name == "small.en"
