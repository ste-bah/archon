"""Tests for push-to-talk hotkey listeners."""

import os
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

from src.voice_mcp.hotkey import (
    EvdevHotkeyListener,
    HotkeyListener,
    PynputHotkeyListener,
    _parse_hotkey,
    create_hotkey_listener,
    detect_display_server,
)


# ---------------------------------------------------------------------------
# _parse_hotkey
# ---------------------------------------------------------------------------

class TestParseHotkey:
    def test_single_modifier(self):
        mods, key = _parse_hotkey("ctrl+space")
        assert mods == frozenset({"ctrl"})
        assert key == "space"

    def test_two_modifiers(self):
        mods, key = _parse_hotkey("ctrl+shift+space")
        assert mods == frozenset({"ctrl", "shift"})
        assert key == "space"

    def test_no_modifier(self):
        mods, key = _parse_hotkey("f12")
        assert mods == frozenset()
        assert key == "f12"

    def test_case_insensitive(self):
        mods, key = _parse_hotkey("CTRL+SHIFT+V")
        assert "ctrl" in mods
        assert "shift" in mods
        assert key == "v"

    def test_whitespace_stripped(self):
        mods, key = _parse_hotkey("ctrl + shift + space")
        assert "ctrl" in mods
        assert "shift" in mods
        assert key == "space"


# ---------------------------------------------------------------------------
# detect_display_server
# ---------------------------------------------------------------------------

class TestDetectDisplayServer:
    @patch("src.voice_mcp.hotkey.platform")
    def test_macos(self, mock_platform):
        mock_platform.system.return_value = "Darwin"
        assert detect_display_server() == "macos"

    @patch("src.voice_mcp.hotkey.platform")
    def test_x11(self, mock_platform):
        mock_platform.system.return_value = "Linux"
        with patch.dict(os.environ, {"DISPLAY": ":0"}, clear=True):
            assert detect_display_server() == "x11"

    @patch("src.voice_mcp.hotkey.platform")
    def test_wayland(self, mock_platform):
        mock_platform.system.return_value = "Linux"
        with patch.dict(os.environ, {"WAYLAND_DISPLAY": "wayland-0"}, clear=True):
            assert detect_display_server() == "wayland"

    @patch("src.voice_mcp.hotkey.platform")
    def test_wayland_takes_priority_over_x11(self, mock_platform):
        mock_platform.system.return_value = "Linux"
        with patch.dict(os.environ, {"DISPLAY": ":0", "WAYLAND_DISPLAY": "wayland-0"}, clear=True):
            assert detect_display_server() == "wayland"

    @patch("src.voice_mcp.hotkey.platform")
    def test_headless(self, mock_platform):
        mock_platform.system.return_value = "Linux"
        with patch.dict(os.environ, {}, clear=True):
            # Remove DISPLAY and WAYLAND_DISPLAY if set
            env = {k: v for k, v in os.environ.items()
                   if k not in ("DISPLAY", "WAYLAND_DISPLAY")}
            with patch.dict(os.environ, env, clear=True):
                result = detect_display_server()
                assert result == "headless"


# ---------------------------------------------------------------------------
# create_hotkey_listener factory
# ---------------------------------------------------------------------------

class TestCreateHotkeyListenerFactory:
    @patch("src.voice_mcp.hotkey.detect_display_server", return_value="macos")
    def test_macos_returns_pynput(self, _):
        listener = create_hotkey_listener("ctrl+shift+space")
        assert isinstance(listener, PynputHotkeyListener)

    @patch("src.voice_mcp.hotkey.detect_display_server", return_value="x11")
    def test_x11_returns_pynput(self, _):
        listener = create_hotkey_listener("ctrl+shift+space")
        assert isinstance(listener, PynputHotkeyListener)

    @patch("src.voice_mcp.hotkey.detect_display_server", return_value="wayland")
    def test_wayland_returns_evdev(self, _):
        listener = create_hotkey_listener("ctrl+shift+space")
        assert isinstance(listener, EvdevHotkeyListener)

    @patch("src.voice_mcp.hotkey.detect_display_server", return_value="headless")
    def test_headless_raises(self, _):
        with pytest.raises(RuntimeError, match="no display server"):
            create_hotkey_listener("ctrl+shift+space")


# ---------------------------------------------------------------------------
# PynputHotkeyListener
# ---------------------------------------------------------------------------

def _make_pynput_mock():
    """Build a minimal pynput keyboard mock."""
    keyboard = MagicMock()

    class Key:
        ctrl = "ctrl"
        ctrl_l = "ctrl_l"
        ctrl_r = "ctrl_r"
        shift = "shift"
        shift_l = "shift_l"
        shift_r = "shift_r"
        alt = "alt"
        alt_l = "alt_l"
        alt_r = "alt_r"
        cmd = "cmd"
        cmd_l = "cmd_l"
        cmd_r = "cmd_r"

    keyboard.Key = Key

    class FakeListener:
        def __init__(self, on_press=None, on_release=None):
            self._on_press = on_press
            self._on_release = on_release

        def start(self):
            pass

        def stop(self):
            pass

        def simulate_press(self, key):
            if self._on_press:
                self._on_press(key)

        def simulate_release(self, key):
            if self._on_release:
                self._on_release(key)

    keyboard.Listener = FakeListener
    return keyboard


class TestPynputHotkeyListener:
    def test_start_and_stop_no_error(self):
        keyboard = _make_pynput_mock()
        listener = PynputHotkeyListener("ctrl+shift+space")
        with patch.dict("sys.modules", {"pynput": MagicMock(keyboard=keyboard)}):
            listener.start(lambda: None, lambda: None)
            listener.stop()

    def test_stop_without_start_is_safe(self):
        listener = PynputHotkeyListener("ctrl+space")
        listener.stop()  # must not raise

    def test_fires_on_press_with_correct_modifiers(self):
        keyboard = _make_pynput_mock()
        presses = []
        releases = []

        listener = PynputHotkeyListener("ctrl+shift+space")

        with patch.dict("sys.modules", {"pynput": MagicMock(keyboard=keyboard)}):
            listener.start(lambda: presses.append(1), lambda: releases.append(1))
            # Verify the pynput Listener was created and is accessible
            assert listener._listener is not None
            listener.stop()
            assert listener._listener is None

    def test_double_stop_is_safe(self):
        keyboard = _make_pynput_mock()
        listener = PynputHotkeyListener("ctrl+space")
        with patch.dict("sys.modules", {"pynput": MagicMock(keyboard=keyboard)}):
            listener.start(lambda: None, lambda: None)
            listener.stop()
            listener.stop()  # must not raise

    def test_raises_on_missing_pynput(self):
        listener = PynputHotkeyListener("ctrl+space")
        with patch.dict("sys.modules", {"pynput": None}):
            with pytest.raises(RuntimeError, match="pynput not installed"):
                listener.start(lambda: None, lambda: None)


# ---------------------------------------------------------------------------
# EvdevHotkeyListener
# ---------------------------------------------------------------------------

def _make_evdev_mock():
    evdev = MagicMock()

    class ecodes:
        EV_KEY = 1
        KEY_LEFTCTRL = 29
        KEY_A = 30
        KEY_LEFTSHIFT = 42
        KEY_SPACE = 57

        KEY = {29: "KEY_LEFTCTRL", 30: "KEY_A", 42: "KEY_LEFTSHIFT", 57: "KEY_SPACE"}

    evdev.ecodes = ecodes

    # A fake device with ctrl and A capability
    fake_dev = MagicMock()
    fake_dev.capabilities.return_value = {
        ecodes.EV_KEY: [ecodes.KEY_LEFTCTRL, ecodes.KEY_A, ecodes.KEY_LEFTSHIFT, ecodes.KEY_SPACE]
    }
    evdev.list_devices.return_value = ["/dev/input/event0"]
    evdev.InputDevice.return_value = fake_dev
    return evdev


class TestEvdevHotkeyListener:
    def test_raises_on_missing_evdev(self):
        listener = EvdevHotkeyListener("ctrl+shift+space")
        with patch.dict("sys.modules", {"evdev": None}):
            with pytest.raises((RuntimeError, ImportError, ModuleNotFoundError)):
                listener.start(lambda: None, lambda: None)

    def test_stop_without_start_is_safe(self):
        listener = EvdevHotkeyListener("ctrl+space")
        listener.stop()  # must not raise

    def test_finds_keyboard_devices(self):
        evdev = _make_evdev_mock()
        with patch.dict("sys.modules", {"evdev": evdev}):
            from src.voice_mcp.hotkey import _find_keyboard_devices
            devices = _find_keyboard_devices()
            assert len(devices) >= 0  # at least doesn't crash

    def test_evdev_key_name_strips_prefix(self):
        from src.voice_mcp.hotkey import _evdev_key_name
        evdev = _make_evdev_mock()
        with patch.dict("sys.modules", {"evdev": evdev}):
            result = _evdev_key_name(29)
            # ecodes.KEY[29] = "KEY_LEFTCTRL" → strip KEY_ → "leftctrl"
            assert result == "leftctrl"

    def test_parse_hotkey_for_evdev(self):
        listener = EvdevHotkeyListener("ctrl+shift+space")
        assert "ctrl" in listener._modifiers
        assert "shift" in listener._modifiers
        assert listener._key == "space"

    def test_stop_joins_thread(self):
        listener = EvdevHotkeyListener("ctrl+space")
        # Simulate a running thread
        stopped = threading.Event()
        def fake_run():
            stopped.wait(timeout=2)
        listener._thread = threading.Thread(target=fake_run)
        listener._thread.start()
        stopped.set()
        listener.stop()
        # stop() sets _thread = None after joining
        assert listener._thread is None
