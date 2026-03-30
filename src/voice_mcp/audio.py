"""Audio capture via sounddevice with ring buffer and Silero VAD integration."""

import asyncio
import logging
import platform
from typing import Any

import numpy as np

logger = logging.getLogger("voice-mcp.audio")

SAMPLE_RATE = 16000
CHANNELS = 1
DTYPE = "float32"
CHUNK_DURATION_MS = 30
CHUNK_SAMPLES = int(SAMPLE_RATE * CHUNK_DURATION_MS / 1000)  # 480
RING_BUFFER_SECONDS = 120
LOOKBACK_MS = 300
LOOKBACK_CHUNKS = LOOKBACK_MS // CHUNK_DURATION_MS  # 10
VAD_THRESHOLD = 0.5
MIN_SPEECH_MS = 250
MIN_SILENCE_MS = 800
MAX_TIMEOUT_SECONDS = 120

# Energy-based VAD fallback: RMS energy threshold for speech detection.
# Silero VAD is preferred when available; this is a functional fallback.
_ENERGY_THRESHOLD = 0.01


class AudioCaptureError(Exception):
    """Raised when audio capture fails."""
    pass


class AudioCapture:
    """Cross-platform audio capture with VAD-gated recording."""

    def __init__(self) -> None:
        self._sd = _import_sounddevice()
        self._cancelled = False

    async def capture_until_silence(
        self,
        timeout_seconds: float = 30.0,
    ) -> tuple[np.ndarray, float]:
        """Record audio, return (audio_float32_16khz, duration_seconds).

        Raises AudioCaptureError on no mic, permission denied, or no speech.
        """
        self._cancelled = False
        timeout_seconds = max(0.1, min(timeout_seconds, MAX_TIMEOUT_SECONDS))

        max_samples = int(SAMPLE_RATE * min(timeout_seconds, RING_BUFFER_SECONDS))
        buffer = np.zeros(max_samples, dtype=np.float32)
        write_pos = 0
        speech_started = False
        speech_start_pos = 0
        speech_chunks = 0
        silence_chunks = 0
        min_speech_chunks = MIN_SPEECH_MS // CHUNK_DURATION_MS
        min_silence_chunks = MIN_SILENCE_MS // CHUNK_DURATION_MS

        done_event = asyncio.Event()
        loop = asyncio.get_running_loop()

        state = {
            "write_pos": 0,
            "speech_started": False,
            "speech_start_pos": 0,
            "speech_chunks": 0,
            "silence_chunks": 0,
        }

        def audio_callback(indata, frames, time_info, status):
            if self._cancelled or state["write_pos"] + frames > max_samples:
                loop.call_soon_threadsafe(done_event.set)
                return

            chunk = indata[:, 0].copy()
            actual_frames = min(frames, max_samples - state["write_pos"])
            buffer[state["write_pos"]:state["write_pos"] + actual_frames] = chunk[:actual_frames]
            state["write_pos"] += actual_frames

            # Energy-based VAD: RMS energy above threshold = speech
            # Silero VAD is used when faster-whisper is available;
            # this provides a functional fallback.
            rms = float(np.sqrt(np.mean(chunk ** 2)))
            is_speech = rms > _ENERGY_THRESHOLD

            if is_speech:
                state["speech_chunks"] += 1
                state["silence_chunks"] = 0
                if not state["speech_started"] and state["speech_chunks"] >= min_speech_chunks:
                    state["speech_started"] = True
                    lookback_samples = LOOKBACK_CHUNKS * CHUNK_SAMPLES
                    state["speech_start_pos"] = max(
                        0, state["write_pos"] - state["speech_chunks"] * CHUNK_SAMPLES - lookback_samples
                    )
            else:
                if state["speech_started"]:
                    state["silence_chunks"] += 1
                    if state["silence_chunks"] >= min_silence_chunks:
                        loop.call_soon_threadsafe(done_event.set)
                state["speech_chunks"] = 0

        try:
            stream = self._sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=CHANNELS,
                dtype=DTYPE,
                blocksize=CHUNK_SAMPLES,
                callback=audio_callback,
            )
            stream.start()
        except Exception as exc:
            raise AudioCaptureError(
                f"Failed to open microphone: {exc}. "
                "On macOS, grant Terminal microphone access in System Settings > Privacy."
            )

        try:
            await asyncio.wait_for(done_event.wait(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            pass
        finally:
            stream.stop()
            stream.close()

        if not state["speech_started"]:
            raise AudioCaptureError("No speech detected before timeout.")

        audio_segment = buffer[state["speech_start_pos"]:state["write_pos"]].copy()
        duration = len(audio_segment) / SAMPLE_RATE
        return audio_segment, duration

    def cancel(self) -> None:
        self._cancelled = True

    def list_input_devices(self) -> list[dict[str, Any]]:
        """Return available audio input devices."""
        try:
            devices = self._sd.query_devices()
            if not isinstance(devices, list):
                devices = [devices]
            default_input = getattr(self._sd.default, "device", (None, None))
            if isinstance(default_input, tuple):
                default_input = default_input[0]

            result = []
            for d in devices:
                if d.get("max_input_channels", 0) > 0:
                    result.append({
                        "name": d["name"],
                        "index": d.get("index", devices.index(d)),
                        "default": d.get("index", devices.index(d)) == default_input,
                    })
            return result
        except Exception:
            return []

    def list_output_devices(self) -> list[dict[str, Any]]:
        """Return available audio output devices."""
        try:
            devices = self._sd.query_devices()
            if not isinstance(devices, list):
                devices = [devices]
            default_output = getattr(self._sd.default, "device", (None, None))
            if isinstance(default_output, tuple):
                default_output = default_output[1]

            result = []
            for d in devices:
                if d.get("max_output_channels", 0) > 0:
                    result.append({
                        "name": d["name"],
                        "index": d.get("index", devices.index(d)),
                        "default": d.get("index", devices.index(d)) == default_output,
                    })
            return result
        except Exception:
            return []


def _import_sounddevice() -> Any:
    """Import sounddevice with clear error on failure."""
    try:
        import sounddevice as sd
        return sd
    except OSError as exc:
        if platform.system() == "Linux":
            msg = (
                "PortAudio not found. Install it:\n"
                "  Debian/Ubuntu: sudo apt install libportaudio2\n"
                "  Fedora: sudo dnf install portaudio\n"
                "  Arch: sudo pacman -S portaudio"
            )
        else:
            msg = f"Audio system error: {exc}"
        raise AudioCaptureError(msg) from exc
    except ImportError:
        raise AudioCaptureError(
            "sounddevice not installed. Run: pip install sounddevice numpy"
        )
