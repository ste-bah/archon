"""Push-to-talk daemon configuration."""

from __future__ import annotations

import dataclasses
import json
import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("voice-mcp.ptt")

_DEFAULT_CONFIG_PATH = Path.home() / ".archon" / "ptt.json"
_DEFAULT_PTT_DIR = Path.home() / ".archon" / "ptt"


@dataclass
class PTTConfig:
    """Configuration for the push-to-talk daemon.

    All path fields accept ~ for home directory expansion.
    """

    # Hotkey: "modifier+modifier+key", e.g. "ctrl+shift+space"
    hotkey: str = "ctrl+shift+space"

    # Whisper model name; None = platform default (base.en / small.en)
    model: str | None = None

    # BCP-47 language code passed to Whisper
    language: str = "en"

    # Paths for singleton enforcement and status queries
    pid_file: str = str(_DEFAULT_PTT_DIR / "daemon.pid")
    socket_path: str = str(_DEFAULT_PTT_DIR / "daemon.sock")

    # Optional window-title pattern to target for injection.
    # None = inject into whatever window currently has focus.
    target_app_pattern: str | None = None

    # Wayland injector tool preference: "auto", "ydotool", "dotool", "wl-copy"
    wayland_injector: str = "auto"

    # macOS: use AppleScript keystroke for texts shorter than this;
    # longer texts use clipboard+Cmd+V to avoid timeout issues.
    macos_clipboard_threshold: int = 200

    def pid_path(self) -> Path:
        return Path(self.pid_file).expanduser()

    def sock_path(self) -> Path:
        return Path(self.socket_path).expanduser()


def load_config(path: Path | None = None) -> PTTConfig:
    """Load PTTConfig from a JSON file, falling back to defaults on any error.

    Unknown keys in the JSON are silently ignored to allow forward compatibility.
    """
    config_path = path or _DEFAULT_CONFIG_PATH
    if not config_path.exists():
        return PTTConfig()
    try:
        data = json.loads(config_path.read_text())
        known = {f.name for f in dataclasses.fields(PTTConfig)}
        filtered = {k: v for k, v in data.items() if k in known}
        return PTTConfig(**filtered)
    except Exception as exc:
        logger.warning(
            "Failed to load PTT config from %s: %s — using defaults", config_path, exc
        )
        return PTTConfig()
