"""Voice MCP Server — FastMCP server with voice_listen, voice_speak, voice_status, voice_stop."""

import asyncio
import logging
import sys
import time
from typing import Any

from .audio import AudioCapture, AudioCaptureError, MAX_TIMEOUT_SECONDS
from .stt import STTError, SpeechToText, detect_platform
from .tts import TTSEngine, TTSError

logger = logging.getLogger("voice-mcp")

_audio: AudioCapture | None = None
_stt: SpeechToText | None = None
_tts: TTSEngine | None = None
_state_lock = asyncio.Lock()

# NOTE: These functions are registered as MCP tools at deploy time via FastMCP
# decorators. They are plain async functions here for testability without
# requiring the mcp package installed.


class VoiceState:
    IDLE = "idle"
    LISTENING = "listening"
    TRANSCRIBING = "transcribing"
    SPEAKING = "speaking"

    def __init__(self) -> None:
        self.current: str = self.IDLE
        self.error: str | None = None


_state = VoiceState()


def _get_audio() -> AudioCapture:
    global _audio
    if _audio is None:
        _audio = AudioCapture()
    return _audio


def _get_stt() -> SpeechToText:
    global _stt
    if _stt is None:
        _stt = SpeechToText()
    return _stt


def _get_tts() -> TTSEngine:
    global _tts
    if _tts is None:
        _tts = TTSEngine()
    return _tts


async def voice_listen(
    timeout_seconds: float = 30.0,
    language: str = "en",
    model: str | None = None,
) -> dict[str, Any]:
    """Listen for voice input and return transcribed text.

    Audio never leaves this process — only text is returned.
    """
    timeout_seconds = max(0.1, min(timeout_seconds, MAX_TIMEOUT_SECONDS))

    try:
        audio_cap = _get_audio()
    except AudioCaptureError as exc:
        return {"error": "audio_unavailable", "message": str(exc)}

    async with _state_lock:
        _state.current = VoiceState.LISTENING
        _state.error = None

    try:
        audio, duration = await audio_cap.capture_until_silence(
            timeout_seconds=timeout_seconds,
        )
    except AudioCaptureError as exc:
        async with _state_lock:
            _state.current = VoiceState.IDLE
            _state.error = str(exc)
        return {"error": "microphone_unavailable", "message": str(exc)}

    if duration < 0.1:
        async with _state_lock:
            _state.current = VoiceState.IDLE
        return {"text": "", "duration_seconds": 0.0, "confidence": 0.0}

    async with _state_lock:
        _state.current = VoiceState.TRANSCRIBING
    try:
        stt = _get_stt()
        result = stt.transcribe(audio, language=language, model=model)
    except STTError as exc:
        async with _state_lock:
            _state.current = VoiceState.IDLE
            _state.error = str(exc)
        return {"error": "stt_unavailable", "message": str(exc)}

    async with _state_lock:
        _state.current = VoiceState.IDLE
    return result


async def voice_speak(
    text: str,
    voice: str = "default",
    speed: float = 1.0,
    wait: bool = False,
) -> dict[str, Any]:
    """Convert text to speech and play audio.

    Non-blocking by default. Set wait=True to block until done.
    Audio never crosses the MCP boundary.
    """
    try:
        tts = _get_tts()
    except Exception as exc:
        return {"error": "tts_init_failed", "message": str(exc)}

    result = tts.speak(text=text, voice=voice, speed=speed)

    if "error" in result:
        return result

    if wait:
        playback_id = result["id"]
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            # Wait until our item has been processed: it's no longer current
            # AND the queue has drained past it (or is empty)
            current = tts.current_id
            speaking = tts.is_speaking
            if current != playback_id and not speaking:
                break
            await asyncio.sleep(0.1)
        result["status"] = "completed"

    async with _state_lock:
        _state.current = VoiceState.SPEAKING if tts.is_speaking else VoiceState.IDLE
    return result


async def voice_stop() -> dict[str, Any]:
    """Stop current audio playback and clear queue."""
    tts = _tts
    if tts is None:
        return {"status": "stopped", "cancelled_id": None}

    result = tts.stop()
    async with _state_lock:
        _state.current = VoiceState.IDLE
    return result


async def voice_status() -> dict[str, Any]:
    """Get current voice I/O status."""
    stt = _stt
    tts = _tts
    audio = _audio

    input_devices: list[dict] = []
    output_devices: list[dict] = []
    if audio is not None:
        try:
            input_devices = audio.list_input_devices()
            output_devices = audio.list_output_devices()
        except AudioCaptureError:
            pass
    else:
        try:
            temp = AudioCapture()
            input_devices = temp.list_input_devices()
            output_devices = temp.list_output_devices()
        except AudioCaptureError:
            pass

    tts_info = {
        "tts_backend": tts.backend if tts else None,
        "tts_speaking": tts.is_speaking if tts else False,
        "tts_current_id": tts.current_id if tts else None,
    }

    return {
        "state": _state.current,
        "model_loaded": stt.model_loaded if stt else None,
        "model_ram_mb": stt.model_ram_mb if stt else None,
        "input_devices": input_devices,
        "output_devices": output_devices,
        "platform": detect_platform(),
        "error": _state.error,
        **tts_info,
    }
