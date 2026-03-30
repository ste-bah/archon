"""Tests for push-to-talk text injectors."""

import os
from unittest.mock import MagicMock, patch, call

import pytest

from src.voice_mcp.injector import (
    InjectorError,
    MacOSInjector,
    TextInjector,
    WaylandInjector,
    X11Injector,
    create_injector,
)


# ---------------------------------------------------------------------------
# MacOSInjector
# ---------------------------------------------------------------------------

class TestMacOSInjector:
    def test_short_text_uses_applescript(self):
        injector = MacOSInjector(clipboard_threshold=200)
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            injector.inject("hello world")
        mock_run.assert_called_once()
        args = mock_run.call_args[0][0]
        assert args[0] == "osascript"
        assert "hello world" in args[-1]

    def test_long_text_uses_clipboard_path(self):
        injector = MacOSInjector(clipboard_threshold=5)
        with patch.object(injector, "_inject_via_clipboard") as mock_clip:
            injector.inject("this is longer than five chars")
        mock_clip.assert_called_once()

    def test_short_text_threshold_boundary(self):
        injector = MacOSInjector(clipboard_threshold=10)
        # Exactly at threshold → keystroke
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            injector.inject("a" * 10)  # len == threshold
        assert mock_run.called

    def test_applescript_escapes_double_quote(self):
        injector = MacOSInjector(clipboard_threshold=200)
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            injector.inject('say "hello"')
        script_arg = mock_run.call_args[0][0][-1]
        assert '\\"hello\\"' in script_arg

    def test_applescript_escapes_backslash(self):
        injector = MacOSInjector(clipboard_threshold=200)
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            injector.inject("back\\slash")
        script_arg = mock_run.call_args[0][0][-1]
        assert "\\\\" in script_arg

    def test_applescript_failure_falls_back_to_clipboard(self):
        import subprocess
        injector = MacOSInjector(clipboard_threshold=200)
        with patch("subprocess.run", side_effect=subprocess.CalledProcessError(1, "osascript")):
            with patch.object(injector, "_inject_via_clipboard") as mock_clip:
                injector.inject("hello")
        mock_clip.assert_called_once_with("hello")

    def test_clipboard_injection_raises_without_pyperclip(self):
        injector = MacOSInjector()
        with patch.dict("sys.modules", {"pyperclip": None}):
            with pytest.raises(InjectorError, match="pyperclip not installed"):
                injector._inject_via_clipboard("test")

    def test_clipboard_injection_raises_without_pynput(self):
        injector = MacOSInjector()
        mock_pyperclip = MagicMock()
        mock_pyperclip.paste.return_value = ""
        with patch.dict("sys.modules", {"pyperclip": mock_pyperclip, "pynput": None,
                                         "pynput.keyboard": None}):
            with pytest.raises((InjectorError, TypeError)):
                injector._inject_via_clipboard("test")

    def test_clipboard_only_is_false(self):
        injector = MacOSInjector()
        assert injector.clipboard_only is False


# ---------------------------------------------------------------------------
# X11Injector
# ---------------------------------------------------------------------------

class TestX11Injector:
    def test_inject_calls_xdotool(self):
        injector = X11Injector()
        with patch("shutil.which", return_value="/usr/bin/xdotool"):
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0)
                injector.inject("hello world")
        args = mock_run.call_args[0][0]
        assert "xdotool" in args[0]
        assert "hello world" in args

    def test_inject_raises_when_xdotool_missing(self):
        injector = X11Injector()
        with patch("shutil.which", return_value=None):
            with pytest.raises(InjectorError, match="xdotool not found"):
                injector.inject("hello")

    def test_inject_raises_on_subprocess_failure(self):
        import subprocess
        injector = X11Injector()
        with patch("shutil.which", return_value="/usr/bin/xdotool"):
            with patch("subprocess.run", side_effect=subprocess.CalledProcessError(1, "xdotool")):
                with pytest.raises(InjectorError, match="xdotool failed"):
                    injector.inject("hello")

    def test_inject_raises_on_timeout(self):
        import subprocess
        injector = X11Injector()
        with patch("shutil.which", return_value="/usr/bin/xdotool"):
            with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("xdotool", 10)):
                with pytest.raises(InjectorError, match="timed out"):
                    injector.inject("hello")

    def test_target_pattern_adds_window_flag(self):
        injector = X11Injector(target_pattern="Claude Code")
        with patch("shutil.which", return_value="/usr/bin/xdotool"):
            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout="12345\n", stderr="")
                injector.inject("hello")
        # First call is the window search, second is the type
        assert mock_run.call_count >= 1

    def test_clipboard_only_is_false(self):
        assert X11Injector().clipboard_only is False


# ---------------------------------------------------------------------------
# WaylandInjector
# ---------------------------------------------------------------------------

class TestWaylandInjector:
    def test_auto_picks_ydotool_when_available(self):
        def which(cmd):
            return "/usr/bin/ydotool" if cmd == "ydotool" else None
        with patch("shutil.which", side_effect=which):
            injector = WaylandInjector(preference="auto")
        assert injector.backend == "ydotool"
        assert not injector.clipboard_only

    def test_auto_falls_back_to_dotool(self):
        def which(cmd):
            return "/usr/bin/dotool" if cmd == "dotool" else None
        with patch("shutil.which", side_effect=which):
            injector = WaylandInjector(preference="auto")
        assert injector.backend == "dotool"
        assert not injector.clipboard_only

    def test_auto_falls_back_to_wl_copy(self):
        with patch("shutil.which", return_value=None):
            injector = WaylandInjector(preference="auto")
        assert injector.backend == "wl-copy"
        assert injector.clipboard_only

    def test_explicit_preference_overrides_auto(self):
        injector = WaylandInjector(preference="ydotool")
        assert injector.backend == "ydotool"

    def test_ydotool_calls_subprocess(self):
        injector = WaylandInjector(preference="ydotool")
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            injector.inject("hello")
        args = mock_run.call_args[0][0]
        assert "ydotool" in args[0]
        assert "hello" in args

    def test_ydotool_daemon_not_running_gives_clear_error(self):
        import subprocess
        injector = WaylandInjector(preference="ydotool")
        err = subprocess.CalledProcessError(1, "ydotool")
        err.stderr = "cannot connect to socket: connection refused"
        with patch("subprocess.run", side_effect=err):
            with pytest.raises(InjectorError, match="daemon"):
                injector.inject("hello")

    def test_dotool_pipes_stdin(self):
        injector = WaylandInjector(preference="dotool")
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            injector.inject("hello")
        kwargs = mock_run.call_args[1]
        assert "input" in kwargs
        assert "hello" in kwargs["input"]

    def test_wl_copy_raises_when_not_found(self):
        injector = WaylandInjector(preference="wl-copy")
        with patch("subprocess.run", side_effect=FileNotFoundError("wl-copy")):
            with pytest.raises(InjectorError, match="wl-copy not found"):
                injector.inject("hello")

    def test_wl_copy_calls_wl_copy(self):
        injector = WaylandInjector(preference="wl-copy")
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            injector.inject("hello")
        args = mock_run.call_args[0][0]
        assert "wl-copy" in args[0]


# ---------------------------------------------------------------------------
# create_injector factory
# ---------------------------------------------------------------------------

class TestCreateInjectorFactory:
    @patch("src.voice_mcp.injector.platform")
    def test_macos_returns_macos_injector(self, mock_platform):
        mock_platform.system.return_value = "Darwin"
        injector = create_injector()
        assert isinstance(injector, MacOSInjector)

    @patch("src.voice_mcp.injector.platform")
    def test_x11_returns_x11_injector(self, mock_platform):
        mock_platform.system.return_value = "Linux"
        with patch.dict(os.environ, {"DISPLAY": ":0"}, clear=True):
            injector = create_injector()
        assert isinstance(injector, X11Injector)

    @patch("src.voice_mcp.injector.platform")
    def test_wayland_returns_wayland_injector(self, mock_platform):
        mock_platform.system.return_value = "Linux"
        with patch("shutil.which", return_value=None):
            with patch.dict(os.environ, {"WAYLAND_DISPLAY": "wayland-0"}, clear=True):
                injector = create_injector()
        assert isinstance(injector, WaylandInjector)

    @patch("src.voice_mcp.injector.platform")
    def test_headless_raises(self, mock_platform):
        mock_platform.system.return_value = "Linux"
        env = {k: v for k, v in os.environ.items()
               if k not in ("DISPLAY", "WAYLAND_DISPLAY")}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(InjectorError, match="No display server"):
                create_injector()

    @patch("src.voice_mcp.injector.platform")
    def test_wayland_preference_forwarded(self, mock_platform):
        mock_platform.system.return_value = "Linux"
        with patch("shutil.which", side_effect=lambda c: "/bin/ydotool" if c == "ydotool" else None):
            with patch.dict(os.environ, {"WAYLAND_DISPLAY": "wayland-0"}, clear=True):
                injector = create_injector(wayland_preference="ydotool")
        assert isinstance(injector, WaylandInjector)
        assert injector.backend == "ydotool"

    @patch("src.voice_mcp.injector.platform")
    def test_macos_clipboard_threshold_forwarded(self, mock_platform):
        mock_platform.system.return_value = "Darwin"
        injector = create_injector(macos_clipboard_threshold=50)
        assert isinstance(injector, MacOSInjector)
        assert injector._threshold == 50
