"""Platform-aware text injection for push-to-talk.

Platform routing:
  macOS         → MacOSInjector   (AppleScript keystroke / clipboard+Cmd+V)
  X11           → X11Injector     (xdotool)
  Wayland       → WaylandInjector (ydotool → dotool → wl-copy fallback)
"""

from __future__ import annotations

import logging
import os
import platform
import shutil
import subprocess
from abc import ABC, abstractmethod

logger = logging.getLogger("voice-mcp.ptt.injector")

_CLIPBOARD_ONLY_WARNING = (
    "No auto-injection tool found (tried ydotool, dotool). "
    "Text will be copied to clipboard only — paste manually with Ctrl+V."
)


class InjectorError(Exception):
    """Raised when text injection fails and no fallback is available."""


class TextInjector(ABC):
    @property
    def clipboard_only(self) -> bool:
        """True if text is only copied to clipboard (user must paste manually)."""
        return False

    @abstractmethod
    def inject(self, text: str) -> None: ...


# ---------------------------------------------------------------------------
# macOS
# ---------------------------------------------------------------------------

class MacOSInjector(TextInjector):
    """macOS text injection.

    Short texts (≤ threshold chars): AppleScript keystroke — no clipboard clobber.
    Long texts (> threshold chars): pyperclip save/set/Cmd+V/restore.
    """

    def __init__(self, clipboard_threshold: int = 200) -> None:
        self._threshold = clipboard_threshold

    def inject(self, text: str) -> None:
        if len(text) <= self._threshold:
            self._inject_via_keystroke(text)
        else:
            self._inject_via_clipboard(text)

    def _inject_via_keystroke(self, text: str) -> None:
        # Escape backslash and double-quote for AppleScript string literal
        escaped = text.replace("\\", "\\\\").replace('"', '\\"')
        script = f'tell application "System Events" to keystroke "{escaped}"'
        try:
            subprocess.run(
                ["osascript", "-e", script],
                check=True, capture_output=True, timeout=5,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as exc:
            logger.warning("AppleScript keystroke failed, trying clipboard: %s", exc)
            self._inject_via_clipboard(text)

    def _inject_via_clipboard(self, text: str) -> None:
        import time
        try:
            import pyperclip
        except ImportError:
            raise InjectorError(
                "pyperclip not installed. Run: pip install pyperclip"
            )
        try:
            from pynput.keyboard import Controller, Key
        except ImportError:
            raise InjectorError(
                "pynput not installed. Run: pip install pynput"
            )
        saved = pyperclip.paste()
        try:
            pyperclip.copy(text)
            time.sleep(0.05)
            kb = Controller()
            with kb.pressed(Key.cmd):
                kb.tap("v")
            time.sleep(0.05)
        finally:
            time.sleep(0.1)  # Let paste complete before restoring clipboard
            pyperclip.copy(saved)


# ---------------------------------------------------------------------------
# X11
# ---------------------------------------------------------------------------

class X11Injector(TextInjector):
    """X11 text injection via xdotool."""

    def __init__(self, target_pattern: str | None = None) -> None:
        self._target_pattern = target_pattern

    def inject(self, text: str) -> None:
        if not shutil.which("xdotool"):
            raise InjectorError(
                "xdotool not found. Install it:\n"
                "  Debian/Ubuntu: sudo apt install xdotool\n"
                "  Fedora:        sudo dnf install xdotool\n"
                "  Arch:          sudo pacman -S xdotool"
            )
        window_args: list[str] = []
        if self._target_pattern:
            wid = self._find_window(self._target_pattern)
            if wid:
                window_args = ["--window", wid]

        cmd = ["xdotool", "type", *window_args, "--clearmodifiers", "--delay", "0", "--", text]
        try:
            subprocess.run(cmd, check=True, timeout=10)
        except subprocess.CalledProcessError as exc:
            raise InjectorError(f"xdotool failed (exit {exc.returncode})") from exc
        except subprocess.TimeoutExpired:
            raise InjectorError("xdotool timed out after 10 seconds")

    def _find_window(self, pattern: str) -> str | None:
        try:
            result = subprocess.run(
                ["xdotool", "search", "--name", pattern],
                capture_output=True, text=True, timeout=3,
            )
            lines = result.stdout.strip().splitlines()
            return lines[-1] if lines else None
        except Exception:
            return None


# ---------------------------------------------------------------------------
# Wayland
# ---------------------------------------------------------------------------

class WaylandInjector(TextInjector):
    """Wayland text injection via ydotool, dotool, or wl-copy (clipboard-only fallback)."""

    def __init__(
        self,
        preference: str = "auto",
        target_pattern: str | None = None,
    ) -> None:
        self._preference = preference
        self._target_pattern = target_pattern
        self._backend: str = self._resolve_backend(preference)
        self._is_clipboard_only = (self._backend == "wl-copy")

        if self._is_clipboard_only:
            logger.warning(_CLIPBOARD_ONLY_WARNING)

    @staticmethod
    def _resolve_backend(preference: str) -> str:
        if preference != "auto":
            return preference
        if shutil.which("ydotool"):
            return "ydotool"
        if shutil.which("dotool"):
            return "dotool"
        return "wl-copy"

    @property
    def backend(self) -> str:
        return self._backend

    @property
    def clipboard_only(self) -> bool:
        return self._is_clipboard_only

    def inject(self, text: str) -> None:
        if self._backend == "ydotool":
            self._via_ydotool(text)
        elif self._backend == "dotool":
            self._via_dotool(text)
        else:
            self._via_wl_copy(text)

    def _via_ydotool(self, text: str) -> None:
        try:
            subprocess.run(
                ["ydotool", "type", "--", text],
                check=True, capture_output=True, text=True, timeout=10,
            )
        except FileNotFoundError:
            raise InjectorError("ydotool binary not found in PATH")
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or "").lower()
            if "socket" in stderr or "daemon" in stderr or "connect" in stderr:
                raise InjectorError(
                    "ydotoold daemon is not running. Start it:\n"
                    "  systemctl --user start ydotool"
                ) from exc
            raise InjectorError(f"ydotool failed: {exc.stderr}") from exc
        except subprocess.TimeoutExpired:
            raise InjectorError("ydotool timed out after 10 seconds")

    def _via_dotool(self, text: str) -> None:
        try:
            subprocess.run(
                ["dotool"],
                input=f"type {text}\n",
                text=True, check=True, timeout=10,
            )
        except FileNotFoundError:
            raise InjectorError("dotool binary not found in PATH")
        except subprocess.CalledProcessError as exc:
            raise InjectorError(f"dotool failed (exit {exc.returncode})") from exc
        except subprocess.TimeoutExpired:
            raise InjectorError("dotool timed out after 10 seconds")

    def _via_wl_copy(self, text: str) -> None:
        try:
            subprocess.run(["wl-copy", "--", text], check=True, timeout=5)
            logger.info("Text copied to clipboard (Wayland clipboard-only mode — paste with Ctrl+V)")
        except FileNotFoundError:
            raise InjectorError(
                "wl-copy not found. Install wl-clipboard:\n"
                "  Debian/Ubuntu: sudo apt install wl-clipboard"
            )
        except subprocess.CalledProcessError as exc:
            raise InjectorError(f"wl-copy failed (exit {exc.returncode})") from exc


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_injector(
    *,
    wayland_preference: str = "auto",
    target_pattern: str | None = None,
    macos_clipboard_threshold: int = 200,
) -> TextInjector:
    """Return the appropriate TextInjector for the current platform."""
    system = platform.system()

    if system == "Darwin":
        return MacOSInjector(clipboard_threshold=macos_clipboard_threshold)

    if os.environ.get("WAYLAND_DISPLAY"):
        return WaylandInjector(
            preference=wayland_preference,
            target_pattern=target_pattern,
        )

    if os.environ.get("DISPLAY"):
        return X11Injector(target_pattern=target_pattern)

    raise InjectorError(
        "No display server detected (DISPLAY and WAYLAND_DISPLAY are unset). "
        "Cannot inject text."
    )
