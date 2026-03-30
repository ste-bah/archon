"""Push-to-talk singleton daemon.

State machine: IDLE → RECORDING → TRANSCRIBING → INJECTING → IDLE

Hold hotkey to record; release to stop (VAD may stop earlier).
Transcription is dropped (not queued) if already busy when hotkey is pressed.

Run as:  python3 -m src.voice_mcp.push_to_talk
Control: send "status" or "stop" to the Unix socket at ~/.archon/ptt/daemon.sock
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys
import time
from enum import Enum
from pathlib import Path

from .audio import AudioCapture, AudioCaptureError
from .hotkey import create_hotkey_listener
from .injector import InjectorError, TextInjector, create_injector
from .ptt_config import PTTConfig, load_config
from .stt import SpeechToText, default_model

logger = logging.getLogger("voice-mcp.ptt")

_SOCKET_BUFSIZE = 4096


class PTTState(str, Enum):
    IDLE = "idle"
    RECORDING = "recording"
    TRANSCRIBING = "transcribing"
    INJECTING = "injecting"


# ---------------------------------------------------------------------------
# PID-file singleton helpers
# ---------------------------------------------------------------------------

class PIDFileError(Exception):
    """Another PTT daemon is already running."""


def _write_pid(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(os.getpid()))


def _read_pid(path: Path) -> int | None:
    try:
        return int(path.read_text().strip())
    except (FileNotFoundError, ValueError):
        return None


def _process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def check_singleton(pid_path: Path) -> None:
    """Raise PIDFileError if another instance is running; clean stale file."""
    existing = _read_pid(pid_path)
    if existing is not None and _process_alive(existing):
        raise PIDFileError(
            f"PTT daemon already running (PID {existing}). "
            f"Stop it first or delete {pid_path}."
        )
    pid_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Daemon
# ---------------------------------------------------------------------------

class PushToTalkDaemon:
    """Singleton push-to-talk daemon.

    Thread model:
      - asyncio event loop: state machine, socket server, audio coordination
      - hotkey listener thread: fires _on_hotkey_press / _on_hotkey_release
        via loop.call_soon_threadsafe (safe cross-thread bridge)
      - executor thread: Whisper transcription (CPU-bound, must not block loop)
    """

    def __init__(self, config: PTTConfig | None = None) -> None:
        self._config = config or load_config()
        self._state = PTTState.IDLE
        self._start_time = time.monotonic()
        self._transcriptions = 0
        self._errors = 0
        self._clipboard_only = False

        # asyncio primitives (set in start())
        self._press_event: asyncio.Event | None = None
        self._release_event: asyncio.Event | None = None
        self._stop_event: asyncio.Event | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

        # Components
        self._stt: SpeechToText | None = None
        self._audio: AudioCapture | None = None
        self._injector: TextInjector | None = None
        self._hotkey_listener = None
        self._socket_server = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Initialize components and pre-load the Whisper model."""
        self._loop = asyncio.get_running_loop()
        self._press_event = asyncio.Event()
        self._release_event = asyncio.Event()
        self._stop_event = asyncio.Event()

        # Singleton gate
        pid_path = self._config.pid_path()
        check_singleton(pid_path)
        _write_pid(pid_path)
        logger.info("PTT daemon started (PID %d)", os.getpid())

        # Injector
        self._injector = create_injector(
            wayland_preference=self._config.wayland_injector,
            target_pattern=self._config.target_app_pattern,
            macos_clipboard_threshold=self._config.macos_clipboard_threshold,
        )
        self._clipboard_only = self._injector.clipboard_only

        # Pre-load Whisper model in executor to avoid blocking the loop
        self._stt = SpeechToText()
        model_name = self._config.model or default_model()
        logger.info("Pre-loading Whisper model '%s'...", model_name)
        await self._loop.run_in_executor(None, self._stt.preload, model_name)
        logger.info("Whisper model ready")

        # Audio
        self._audio = AudioCapture()

        # Hotkey listener (starts its own thread)
        self._hotkey_listener = create_hotkey_listener(self._config.hotkey)
        self._hotkey_listener.start(
            on_press=self._on_hotkey_press,
            on_release=self._on_hotkey_release,
        )

        # Status/control socket
        await self._start_socket_server()

    async def stop(self) -> None:
        """Graceful shutdown: stop hotkey, socket, audio, remove PID/socket files."""
        if self._stop_event:
            self._stop_event.set()
        if self._hotkey_listener:
            self._hotkey_listener.stop()
        if self._socket_server:
            self._socket_server.close()
            try:
                await self._socket_server.wait_closed()
            except Exception:
                pass
        if self._audio:
            self._audio.cancel()
        self._config.sock_path().unlink(missing_ok=True)
        self._config.pid_path().unlink(missing_ok=True)
        logger.info("PTT daemon stopped")

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    async def run_forever(self) -> None:
        """Process hotkey events until stop() is called."""
        assert self._stop_event and self._press_event

        while not self._stop_event.is_set():
            # Wait for either hotkey press or stop signal
            press_task = asyncio.create_task(self._press_event.wait())
            stop_task = asyncio.create_task(self._stop_event.wait())
            await asyncio.wait({press_task, stop_task}, return_when=asyncio.FIRST_COMPLETED)
            press_task.cancel()
            stop_task.cancel()

            if self._stop_event.is_set():
                break

            self._press_event.clear()

            if self._state != PTTState.IDLE:
                # Busy — drop this press
                logger.debug("Hotkey pressed while %s — ignoring", self._state.value)
                continue

            await self._ptt_cycle()

    # ------------------------------------------------------------------
    # Hotkey → asyncio bridge (called from listener thread)
    # ------------------------------------------------------------------

    def _on_hotkey_press(self) -> None:
        if self._loop and self._press_event:
            self._loop.call_soon_threadsafe(self._press_event.set)

    def _on_hotkey_release(self) -> None:
        if self._loop and self._release_event:
            self._loop.call_soon_threadsafe(self._release_event.set)

    # ------------------------------------------------------------------
    # PTT cycle: record → transcribe → inject
    # ------------------------------------------------------------------

    async def _ptt_cycle(self) -> None:
        assert self._audio and self._stt and self._injector and self._release_event

        self._state = PTTState.RECORDING
        logger.debug("Recording started")

        # release_watcher: when key is released, gracefully cancel audio via
        # its own cancel flag (not asyncio task cancellation) so partial
        # speech already in the buffer is preserved.
        async def _watch_release():
            await self._release_event.wait()
            self._audio.cancel()

        release_watcher = asyncio.create_task(_watch_release())
        try:
            audio, duration = await self._audio.capture_until_silence(timeout_seconds=30.0)
        except AudioCaptureError as exc:
            logger.debug("Audio capture ended early: %s", exc)
            self._state = PTTState.IDLE
            return
        finally:
            self._release_event.clear()
            release_watcher.cancel()
            try:
                await release_watcher
            except asyncio.CancelledError:
                pass

        self._state = PTTState.TRANSCRIBING
        logger.debug("Transcribing %.1fs of audio", duration)

        try:
            result = await self._loop.run_in_executor(
                None,
                lambda: self._stt.transcribe(
                    audio,
                    language=self._config.language,
                    model=self._config.model,
                ),
            )
        except Exception as exc:
            logger.error("Transcription failed: %s", exc)
            self._errors += 1
            self._state = PTTState.IDLE
            return

        text = result.get("text", "").strip()
        if not text:
            logger.debug("Empty transcription — silence or noise")
            self._state = PTTState.IDLE
            return

        self._state = PTTState.INJECTING
        display = text[:60] + ("..." if len(text) > 60 else "")
        logger.info("Injecting: '%s'", display)

        try:
            await self._loop.run_in_executor(None, self._injector.inject, text)
            self._transcriptions += 1
        except InjectorError as exc:
            logger.error("Injection failed: %s", exc)
            self._errors += 1
        except Exception as exc:
            logger.error("Unexpected injection error: %s", exc)
            self._errors += 1

        self._state = PTTState.IDLE

    # ------------------------------------------------------------------
    # Status socket
    # ------------------------------------------------------------------

    def _status_dict(self) -> dict:
        return {
            "state": self._state.value,
            "uptime_seconds": round(time.monotonic() - self._start_time, 1),
            "transcriptions": self._transcriptions,
            "errors": self._errors,
            "model": self._config.model or default_model(),
            "hotkey": self._config.hotkey,
            "clipboard_only": self._clipboard_only,
            "pid": os.getpid(),
        }

    async def _start_socket_server(self) -> None:
        sock_path = self._config.sock_path()
        sock_path.parent.mkdir(parents=True, exist_ok=True)
        sock_path.unlink(missing_ok=True)

        async def _handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
            try:
                data = await asyncio.wait_for(reader.read(_SOCKET_BUFSIZE), timeout=2.0)
                command = data.decode(errors="replace").strip()
                if command == "status":
                    reply = json.dumps(self._status_dict())
                elif command == "stop":
                    reply = json.dumps({"ok": True, "message": "stopping"})
                    writer.write((reply + "\n").encode())
                    await writer.drain()
                    if self._stop_event:
                        self._stop_event.set()
                    return
                else:
                    reply = json.dumps({"error": f"unknown command: {command!r}"})
                writer.write((reply + "\n").encode())
                await writer.drain()
            except Exception:
                pass
            finally:
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass

        self._socket_server = await asyncio.start_unix_server(
            _handle, path=str(sock_path)
        )
        logger.info("Status socket: %s", sock_path)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def _run(config: PTTConfig | None = None) -> None:
    daemon = PushToTalkDaemon(config)
    loop = asyncio.get_running_loop()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: loop.create_task(daemon.stop()))

    try:
        await daemon.start()
    except Exception as exc:
        logger.error("Startup failed: %s", exc)
        sys.exit(1)

    await daemon.run_forever()
    # run_forever() exits when stop_event fires (signal or socket "stop" command)
    await daemon.stop()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    asyncio.run(_run())
