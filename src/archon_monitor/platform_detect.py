"""Platform detection for notification dispatch."""

import os
import shutil
import sys
from dataclasses import dataclass
from typing import Optional


@dataclass
class PlatformCapabilities:
    os_name: str
    os_notify_binary: Optional[str]
    has_tmux: bool
    tmux_binary: Optional[str]
    has_terminal_bell: bool
    terminal_notifier: Optional[str] = None


_cached: Optional[PlatformCapabilities] = None


def detect_platform() -> PlatformCapabilities:
    """Detect available notification channels."""
    global _cached
    if _cached is not None:
        return _cached

    os_name = "darwin" if sys.platform == "darwin" else "linux"

    # OS notification binary
    os_notify = None
    terminal_notifier = None
    if os_name == "darwin":
        os_notify = "/usr/bin/osascript" if os.path.exists("/usr/bin/osascript") else None
        terminal_notifier = shutil.which("terminal-notifier")
    else:
        os_notify = shutil.which("notify-send")

    # tmux
    has_tmux = bool(os.environ.get("TMUX"))
    tmux_binary = shutil.which("tmux")

    _cached = PlatformCapabilities(
        os_name=os_name,
        os_notify_binary=os_notify,
        has_tmux=has_tmux,
        tmux_binary=tmux_binary,
        has_terminal_bell=True,
        terminal_notifier=terminal_notifier,
    )
    return _cached


def reset_platform_cache() -> None:
    global _cached
    _cached = None
