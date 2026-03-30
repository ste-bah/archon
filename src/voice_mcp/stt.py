"""Speech-to-text via faster-whisper with platform-aware model selection."""

import logging
import platform
import time
from typing import Any

import numpy as np

logger = logging.getLogger("voice-mcp.stt")

_APPLE_SILICON_DEFAULT = "small.en"
_CPU_DEFAULT = "base.en"

_MODEL_RAM_MB = {
    "tiny.en": 273,
    "base.en": 388,
    "small.en": 852,
    "medium.en": 2100,
}

_VALID_MODELS = frozenset(_MODEL_RAM_MB.keys())


class STTError(Exception):
    """Raised when speech-to-text fails."""
    pass


def detect_platform() -> str:
    """Detect platform for model selection.

    Returns: "apple_silicon" | "macos_intel" | "linux" | "other"
    """
    system = platform.system()
    if system == "Darwin":
        machine = platform.machine()
        if machine == "arm64":
            return "apple_silicon"
        return "macos_intel"
    if system == "Linux":
        return "linux"
    return "other"


def default_model() -> str:
    """Return the default whisper model for the current platform."""
    if detect_platform() == "apple_silicon":
        return _APPLE_SILICON_DEFAULT
    return _CPU_DEFAULT


class SpeechToText:
    """Wrapper around faster-whisper for local speech-to-text.

    Loads model lazily on first transcribe() call.
    """

    def __init__(self) -> None:
        self._model: Any = None
        self._model_name: str | None = None

    @property
    def model_loaded(self) -> str | None:
        return self._model_name

    @property
    def model_ram_mb(self) -> int | None:
        if self._model_name is None:
            return None
        return _MODEL_RAM_MB.get(self._model_name)

    def preload(self, model_name: str | None = None) -> None:
        """Eagerly load the whisper model so the first transcription has no delay.

        Safe to call from a thread pool executor (blocking I/O).
        """
        self._load_model(model_name or default_model())

    def _load_model(self, model_name: str) -> None:
        if model_name not in _VALID_MODELS:
            raise STTError(
                f"Invalid model '{model_name}'. "
                f"Valid models: {', '.join(sorted(_VALID_MODELS))}"
            )
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise STTError(
                "faster-whisper not installed. Run: pip install faster-whisper"
            )

        logger.info("Loading whisper model '%s'...", model_name)
        start = time.monotonic()
        self._model = WhisperModel(model_name, device="cpu", compute_type="int8")
        elapsed = time.monotonic() - start
        self._model_name = model_name
        logger.info("Model '%s' loaded in %.1fs", model_name, elapsed)

    def transcribe(
        self,
        audio: np.ndarray,
        language: str = "en",
        model: str | None = None,
    ) -> dict[str, Any]:
        """Transcribe audio to text.

        Args:
            audio: float32 numpy array at 16kHz mono.
            language: Language code (default "en").
            model: Model name override.

        Returns:
            {"text": str, "duration_seconds": float, "confidence": float, "language": str}
        """
        target_model = model or (self._model_name or default_model())

        # Short audio check BEFORE model load
        duration_seconds = len(audio) / 16000.0
        if duration_seconds < 0.1:
            return {
                "text": "",
                "duration_seconds": duration_seconds,
                "confidence": 0.0,
                "language": language,
            }

        if self._model is None or self._model_name != target_model:
            self._load_model(target_model)

        if audio.ndim != 1:
            raise STTError("Audio must be 1-D float32 array (mono)")
        if audio.dtype != np.float32:
            raise STTError(f"Audio dtype must be float32, got {audio.dtype}")

        logger.info("Transcribing %.1fs of audio with '%s'...", duration_seconds, self._model_name)
        start = time.monotonic()
        segments, info = self._model.transcribe(
            audio,
            language=language,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(
                threshold=0.5,
                min_speech_duration_ms=250,
                min_silence_duration_ms=500,
            ),
        )
        segment_list = list(segments)
        elapsed = time.monotonic() - start

        text = " ".join(seg.text.strip() for seg in segment_list).strip()
        avg_logprob = (
            sum(seg.avg_logprob for seg in segment_list) / len(segment_list)
            if segment_list
            else -1.0
        )
        confidence = max(0.0, min(1.0, 1.0 + avg_logprob))

        logger.info(
            "Transcription: '%.60s%s' (%.1fs, confidence=%.2f)",
            text, "..." if len(text) > 60 else "", elapsed, confidence,
        )

        return {
            "text": text,
            "duration_seconds": duration_seconds,
            "confidence": confidence,
            "language": info.language if info.language else language,
        }
