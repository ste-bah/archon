"""Platform-aware hotkey listeners for push-to-talk.

Platform routing:
  macOS / X11  → PynputHotkeyListener  (pynput)
  Wayland      → EvdevHotkeyListener   (evdev + /dev/input/event*, needs 'input' group)
  headless     → RuntimeError
"""

from __future__ import annotations

import logging
import os
import platform
import threading
from abc import ABC, abstractmethod
from collections.abc import Callable

logger = logging.getLogger("voice-mcp.ptt.hotkey")


# ---------------------------------------------------------------------------
# Hotkey parsing
# ---------------------------------------------------------------------------

def _parse_hotkey(hotkey_str: str) -> tuple[frozenset[str], str]:
    """Parse "ctrl+shift+space" → (frozenset({"ctrl", "shift"}), "space")."""
    parts = [p.strip().lower() for p in hotkey_str.split("+")]
    if len(parts) < 1:
        raise ValueError(f"Invalid hotkey: {hotkey_str!r}")
    return frozenset(parts[:-1]), parts[-1]


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class HotkeyListener(ABC):
    @abstractmethod
    def start(
        self,
        on_press: Callable[[], None],
        on_release: Callable[[], None],
    ) -> None: ...

    @abstractmethod
    def stop(self) -> None: ...


# ---------------------------------------------------------------------------
# Pynput listener (macOS + X11)
# ---------------------------------------------------------------------------

# Map logical modifier names to sets of pynput Key enum members.
# Populated lazily once pynput is imported.
_PYNPUT_MODIFIER_MAP: dict[str, set] | None = None


def _build_pynput_modifier_map(keyboard_module) -> dict[str, set]:
    k = keyboard_module.Key
    return {
        "ctrl":  {k.ctrl, k.ctrl_l, k.ctrl_r},
        "shift": {k.shift, k.shift_l, k.shift_r},
        "alt":   {k.alt, k.alt_l, k.alt_r},
        "cmd":   {k.cmd, k.cmd_l, k.cmd_r},
        "meta":  {k.cmd, k.cmd_l, k.cmd_r},
        "super": {k.cmd, k.cmd_l, k.cmd_r},
    }


class PynputHotkeyListener(HotkeyListener):
    """Hotkey listener using pynput (macOS + X11)."""

    def __init__(self, hotkey: str) -> None:
        self._modifiers, self._key = _parse_hotkey(hotkey)
        self._listener = None
        self._held_modifiers: set[str] = set()
        self._key_held = False

    def start(
        self,
        on_press: Callable[[], None],
        on_release: Callable[[], None],
    ) -> None:
        try:
            from pynput import keyboard
        except ImportError:
            raise RuntimeError(
                "pynput not installed. Run: pip install pynput"
            )

        modifier_map = _build_pynput_modifier_map(keyboard)

        def _key_char(key) -> str | None:
            try:
                return key.char.lower() if key.char else None
            except AttributeError:
                return key.name.lower() if hasattr(key, "name") else None

        def _modifier_name(key) -> str | None:
            for name, keys in modifier_map.items():
                if key in keys:
                    return name
            return None

        def _on_press(key):
            mod = _modifier_name(key)
            if mod and mod in self._modifiers:
                self._held_modifiers.add(mod)
            elif (
                not self._key_held
                and self._held_modifiers >= self._modifiers
                and _key_char(key) == self._key
            ):
                self._key_held = True
                on_press()

        def _on_release(key):
            mod = _modifier_name(key)
            if mod:
                self._held_modifiers.discard(mod)
            if _key_char(key) == self._key and self._key_held:
                self._key_held = False
                on_release()

        self._listener = keyboard.Listener(
            on_press=_on_press,
            on_release=_on_release,
        )
        self._listener.start()
        logger.info(
            "Pynput hotkey listener active: '%s'",
            "+".join(sorted(self._modifiers)) + "+" + self._key,
        )

    def stop(self) -> None:
        if self._listener:
            self._listener.stop()
            self._listener = None


# ---------------------------------------------------------------------------
# Evdev listener (Linux Wayland)
# ---------------------------------------------------------------------------

# Evdev modifier key name → set of evdev key-name strings (after KEY_ prefix strip)
_EVDEV_MODIFIER_MAP: dict[str, set[str]] = {
    "ctrl":  {"leftctrl",  "rightctrl"},
    "shift": {"leftshift", "rightshift"},
    "alt":   {"leftalt",   "rightalt"},
    "meta":  {"leftmeta",  "rightmeta"},
    "super": {"leftmeta",  "rightmeta"},
}


def _evdev_key_name(code: int) -> str | None:
    """Map an evdev key code to a lowercase name string (without KEY_ prefix)."""
    try:
        import evdev
        name = evdev.ecodes.KEY.get(code, "")
        if isinstance(name, list):
            name = name[0]
        if isinstance(name, str) and name.startswith("KEY_"):
            return name[4:].lower()
    except Exception:
        pass
    return None


def _find_keyboard_devices() -> list:
    """Return all evdev input devices that look like keyboards."""
    try:
        import evdev
    except ImportError:
        raise RuntimeError(
            "evdev not installed. Run: pip install evdev\n"
            "Also add yourself to the 'input' group: sudo usermod -aG input $USER"
        )
    keyboards = []
    for path in evdev.list_devices():
        try:
            dev = evdev.InputDevice(path)
            caps = dev.capabilities()
            key_caps = caps.get(evdev.ecodes.EV_KEY, [])
            # A keyboard must have EV_KEY, KEY_LEFTCTRL, and at least KEY_A
            if (
                evdev.ecodes.KEY_LEFTCTRL in key_caps
                and evdev.ecodes.KEY_A in key_caps
            ):
                keyboards.append(dev)
            else:
                dev.close()
        except (PermissionError, OSError):
            pass
    return keyboards


class EvdevHotkeyListener(HotkeyListener):
    """Hotkey listener using evdev (Linux Wayland).

    Opens all keyboard devices simultaneously and multiplexes with select().
    Requires membership in the 'input' group or root.
    """

    def __init__(self, hotkey: str) -> None:
        self._modifiers, self._key = _parse_hotkey(hotkey)
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(
        self,
        on_press: Callable[[], None],
        on_release: Callable[[], None],
    ) -> None:
        import select
        # _find_keyboard_devices raises RuntimeError if evdev is unavailable
        keyboards = _find_keyboard_devices()
        import evdev  # safe: evdev is available since _find_keyboard_devices succeeded
        if not keyboards:
            raise RuntimeError(
                "No keyboard devices found under /dev/input/. "
                "Ensure you are in the 'input' group and devices exist."
            )

        modifiers = self._modifiers
        target_key = self._key
        held: set[str] = set()
        key_held = False

        def _read_loop():
            nonlocal key_held
            while not self._stop.is_set():
                try:
                    readable, _, _ = select.select(keyboards, [], [], 0.1)
                except (OSError, ValueError):
                    break
                for dev in readable:
                    try:
                        for event in dev.read():
                            if event.type != evdev.ecodes.EV_KEY:
                                continue
                            name = _evdev_key_name(event.code)
                            if name is None:
                                continue
                            pressed = event.value == 1  # 1=down 0=up 2=repeat

                            # Check if it's a tracked modifier
                            for mod, names in _EVDEV_MODIFIER_MAP.items():
                                if name in names:
                                    if mod in modifiers:
                                        if pressed:
                                            held.add(mod)
                                        else:
                                            held.discard(mod)
                                    break
                            else:
                                # Non-modifier key
                                if name == target_key:
                                    if pressed and not key_held and held >= modifiers:
                                        key_held = True
                                        on_press()
                                    elif not pressed and key_held:
                                        key_held = False
                                        on_release()
                    except (OSError, BlockingIOError):
                        pass

            for dev in keyboards:
                try:
                    dev.close()
                except OSError:
                    pass

        self._thread = threading.Thread(
            target=_read_loop, daemon=True, name="evdev-hotkey"
        )
        self._thread.start()
        logger.info(
            "Evdev hotkey listener active on %d keyboard(s): '%s'",
            len(keyboards),
            "+".join(sorted(self._modifiers)) + "+" + self._key,
        )

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1.0)
            self._thread = None


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def detect_display_server() -> str:
    """Detect the display server type.

    Returns one of: "macos", "x11", "wayland", "headless".
    """
    if platform.system() == "Darwin":
        return "macos"
    if os.environ.get("WAYLAND_DISPLAY"):
        return "wayland"
    if os.environ.get("DISPLAY"):
        return "x11"
    return "headless"


def create_hotkey_listener(hotkey: str) -> HotkeyListener:
    """Return the appropriate HotkeyListener for the current platform."""
    display = detect_display_server()
    if display in ("macos", "x11"):
        return PynputHotkeyListener(hotkey)
    if display == "wayland":
        return EvdevHotkeyListener(hotkey)
    raise RuntimeError(
        f"Cannot create hotkey listener: no display server detected "
        f"(DISPLAY and WAYLAND_DISPLAY are unset)."
    )
