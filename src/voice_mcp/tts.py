"""Text-to-speech with platform-specific backends.

macOS: subprocess call to `say` command (always available).
Linux: Kokoro-82M via kokoro Python package, fallback to espeak-ng.
"""

import itertools
import logging
import platform
import queue
import subprocess
import threading
import time
from dataclasses import dataclass
from typing import Any

_id_counter = itertools.count()

logger = logging.getLogger("voice-mcp.tts")

def _is_wsl() -> bool:
    """Detect if running under Windows Subsystem for Linux."""
    try:
        with open("/proc/version", "r") as f:
            return "microsoft" in f.read().lower()
    except OSError:
        return False


DEFAULT_MACOS_VOICE = "Samantha"
DEFAULT_LINUX_VOICE = "af_heart"
DEFAULT_ESPEAK_VOICE = "en"
DEFAULT_SPEED = 1.0
MACOS_DEFAULT_RATE = 200
KOKORO_SAMPLE_RATE = 24000


@dataclass
class PlaybackItem:
    """An item in the playback queue."""
    id: str
    text: str
    voice: str
    speed: float
    process: subprocess.Popen | None = None
    cancelled: bool = False


class TTSError(Exception):
    """Raised when text-to-speech fails."""
    pass


class TTSEngine:
    """Platform-aware text-to-speech engine.

    macOS: `say` command. Linux: Kokoro-82M or espeak-ng fallback.
    Non-blocking playback via background worker thread.
    """

    def __init__(self) -> None:
        self._platform = platform.system()
        self._backend: str = self._detect_backend()
        self._kokoro_pipeline: Any = None
        self._queue: queue.Queue[PlaybackItem | None] = queue.Queue()
        self._current: PlaybackItem | None = None
        self._lock = threading.Lock()
        self._worker = threading.Thread(
            target=self._playback_worker, daemon=True, name="tts-worker"
        )
        self._worker.start()
        logger.info("TTS engine: platform=%s, backend=%s", self._platform, self._backend)

    @property
    def backend(self) -> str:
        return self._backend

    def _detect_backend(self) -> str:
        if self._platform == "Darwin":
            return "say"
        if self._platform == "Linux":
            if _kokoro_available() and _espeak_ng_available():
                return "kokoro"
            if _espeak_ng_available():
                logger.warning("Kokoro unavailable, falling back to espeak-ng.")
                return "espeak-ng"
            logger.error("No TTS backend on Linux. Install espeak-ng.")
            return "none"
        return "none"

    def speak(
        self,
        text: str,
        voice: str = "default",
        speed: float = DEFAULT_SPEED,
    ) -> dict[str, Any]:
        """Queue text for speech. Non-blocking, returns immediately."""
        if self._backend == "none":
            return {
                "error": "tts_unavailable",
                "message": self._no_backend_message(),
            }

        if not text or not text.strip():
            return {"error": "empty_text", "message": "No text provided."}

        text = text[:5000]
        speed = max(0.25, min(4.0, speed))

        if voice == "default":
            voice = self._default_voice()

        item = PlaybackItem(
            id=f"tts-{int(time.time() * 1000)}-{next(_id_counter)}",
            text=text,
            voice=voice,
            speed=speed,
        )
        self._queue.put(item)

        return {"status": "speaking", "id": item.id, "backend": self._backend}

    def stop(self) -> dict[str, Any]:
        """Cancel current playback and clear queue."""
        cancelled_id = None

        while not self._queue.empty():
            try:
                queued = self._queue.get_nowait()
                if queued is not None:
                    queued.cancelled = True
            except queue.Empty:
                break

        with self._lock:
            if self._current is not None and not self._current.cancelled:
                self._current.cancelled = True
                cancelled_id = self._current.id
                self._cancel_current_playback()

        return {"status": "stopped", "cancelled_id": cancelled_id}

    @property
    def is_speaking(self) -> bool:
        with self._lock:
            has_current = self._current is not None
        return has_current or not self._queue.empty()

    @property
    def current_id(self) -> str | None:
        with self._lock:
            return self._current.id if self._current else None

    def _default_voice(self) -> str:
        if self._backend == "say":
            return DEFAULT_MACOS_VOICE
        if self._backend == "kokoro":
            return DEFAULT_LINUX_VOICE
        return DEFAULT_ESPEAK_VOICE

    def _no_backend_message(self) -> str:
        if self._platform == "Linux":
            return (
                "No TTS backend available. Install espeak-ng:\n"
                "  Debian/Ubuntu: sudo apt install espeak-ng\n"
                "  Fedora: sudo dnf install espeak-ng\n"
                "For higher quality: pip install kokoro>=0.9.4 soundfile"
            )
        return "No TTS backend available for this platform."

    def _playback_worker(self) -> None:
        while True:
            item = self._queue.get()
            if item is None:
                break
            if item.cancelled:
                continue
            with self._lock:
                self._current = item
            try:
                if not item.cancelled:
                    self._play_item(item)
            except Exception:
                logger.exception("TTS playback error for %s", item.id)
            finally:
                with self._lock:
                    self._current = None

    def _play_item(self, item: PlaybackItem) -> None:
        if self._backend == "say":
            self._play_say(item)
        elif self._backend == "kokoro":
            self._play_kokoro(item)
        elif self._backend == "espeak-ng":
            self._play_espeak(item)

    def _play_say(self, item: PlaybackItem) -> None:
        rate = int(MACOS_DEFAULT_RATE * item.speed)
        cmd = ["say", "-v", item.voice, "-r", str(rate), item.text]
        try:
            proc = subprocess.Popen(cmd)
            item.process = proc
            proc.wait()
        except FileNotFoundError:
            logger.error("`say` command not found.")
        except Exception:
            logger.exception("Error running `say`")

    def _play_kokoro(self, item: PlaybackItem) -> None:
        try:
            if self._kokoro_pipeline is None:
                import torch
                # Force CPU on WSL — CUDA reports available but kernels fail
                if not torch.cuda.is_available() or _is_wsl():
                    torch.set_default_device("cpu")
                from kokoro import KPipeline
                self._kokoro_pipeline = KPipeline(lang_code="a")

            import sounddevice as sd

            for _, _, audio in self._kokoro_pipeline(
                item.text, voice=item.voice, speed=item.speed
            ):
                if item.cancelled:
                    return
                sd.play(audio, KOKORO_SAMPLE_RATE)
                sd.wait()
                if item.cancelled:
                    sd.stop()
                    return
        except ImportError as exc:
            logger.error("Kokoro import failed: %s. Falling back to espeak-ng.", exc)
            self._backend = "espeak-ng"
            self._play_espeak(item)
        except Exception:
            logger.exception("Kokoro playback error. Falling back to espeak-ng.")
            self._backend = "espeak-ng"
            self._play_espeak(item)

    def _play_espeak(self, item: PlaybackItem) -> None:
        speed_wpm = int(175 * item.speed)
        cmd = ["espeak-ng", "-v", item.voice, "-s", str(speed_wpm), item.text]
        try:
            proc = subprocess.Popen(cmd)
            item.process = proc
            proc.wait()
        except FileNotFoundError:
            logger.error("espeak-ng not found. Install: sudo apt install espeak-ng")
        except Exception:
            logger.exception("Error running espeak-ng")

    def _cancel_current_playback(self) -> None:
        item = self._current
        if item is None:
            return
        if item.process is not None and item.process.poll() is None:
            try:
                item.process.terminate()
                item.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                item.process.kill()
            except Exception:
                logger.exception("Error killing TTS subprocess")
        if self._backend == "kokoro":
            try:
                import sounddevice as sd
                sd.stop()
            except Exception:
                pass

    def shutdown(self) -> None:
        self.stop()
        self._queue.put(None)
        self._worker.join(timeout=5)


def _kokoro_available() -> bool:
    try:
        import kokoro  # noqa: F401
        return True
    except ImportError:
        return False


def _espeak_ng_available() -> bool:
    try:
        result = subprocess.run(
            ["espeak-ng", "--version"],
            capture_output=True, timeout=5,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
