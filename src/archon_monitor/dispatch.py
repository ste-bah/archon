"""Notification dispatch — routes events to OS notifications, bell, tmux, alert queue."""

import json
import logging
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .models import MonitorEvent
from .platform_detect import PlatformCapabilities, detect_platform
from .rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

ALERT_QUEUE_FILE = Path.home() / ".archon" / "alerts" / "pending.json"
MAX_MESSAGE_LENGTH = 200
CONTROL_CHAR_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# Severity → channels
SEVERITY_ROUTING = {
    "info": ["log"],
    "warning": ["log", "bell"],
    "error": ["log", "os_notify", "alert_queue"],
    "critical": ["log", "os_notify", "tmux", "alert_queue"],
}


def sanitize_message(msg: str) -> str:
    """Sanitize a message for safe display in notifications."""
    msg = CONTROL_CHAR_PATTERN.sub("", msg)
    msg = msg.replace("\n", " ").replace("\r", "")
    if len(msg) > MAX_MESSAGE_LENGTH:
        msg = msg[:MAX_MESSAGE_LENGTH - 3] + "..."
    return msg


class NotificationDispatcher:
    """Routes MonitorEvents to notification channels based on severity."""

    def __init__(
        self,
        platform: Optional[PlatformCapabilities] = None,
        rate_limiter: Optional[RateLimiter] = None,
        alert_queue_path: Path = ALERT_QUEUE_FILE,
    ):
        self._platform = platform or detect_platform()
        self._rate_limiter = rate_limiter or RateLimiter()
        self._alert_queue_path = alert_queue_path

    def dispatch(self, event: MonitorEvent) -> dict:
        """Dispatch a monitor event to appropriate channels.

        Returns dict of {channel: "sent"/"rate_limited"/"unavailable"/"error"}.
        """
        channels = SEVERITY_ROUTING.get(event.severity, ["log"])
        results = {}
        message = sanitize_message(event.message)

        for channel in channels:
            is_os = channel == "os_notify"

            if channel != "log" and not self._rate_limiter.should_notify(event.category, is_os):
                results[channel] = "rate_limited"
                continue

            try:
                if channel == "log":
                    logger.info(f"[{event.severity.upper()}] {message}")
                    results[channel] = "sent"

                elif channel == "os_notify":
                    sent = self._send_os_notification(message, event.severity)
                    results[channel] = "sent" if sent else "unavailable"
                    if sent:
                        self._rate_limiter.record_notification(event.category, is_os_notification=True)

                elif channel == "bell":
                    print("\a", end="", flush=True)
                    results[channel] = "sent"
                    self._rate_limiter.record_notification(event.category)

                elif channel == "tmux":
                    sent = self._send_tmux_message(message)
                    results[channel] = "sent" if sent else "unavailable"
                    if sent:
                        self._rate_limiter.record_notification(event.category)

                elif channel == "alert_queue":
                    self._append_to_alert_queue(event)
                    results[channel] = "sent"
                    self._rate_limiter.record_notification(event.category)

            except Exception as e:
                logger.error(f"Failed to dispatch to {channel}: {e}")
                results[channel] = "error"

        return results

    def _send_os_notification(self, message: str, severity: str) -> bool:
        """Send an OS-level notification."""
        binary = self._platform.os_notify_binary
        if not binary:
            return False

        title = f"Archon [{severity.upper()}]"

        try:
            if self._platform.os_name == "darwin":
                # osascript — escape single quotes
                escaped = message.replace("'", "'\\''")
                subprocess.run(
                    [binary, "-e", f'display notification "{escaped}" with title "{title}"'],
                    timeout=5, capture_output=True,
                )
            else:
                # notify-send (Linux)
                urgency = "critical" if severity == "critical" else "normal"
                subprocess.run(
                    [binary, "-u", urgency, title, message],
                    timeout=5, capture_output=True,
                )
            return True
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
            logger.warning(f"OS notification failed: {e}")
            return False

    def _send_tmux_message(self, message: str) -> bool:
        """Send a tmux display-message."""
        if not self._platform.has_tmux or not self._platform.tmux_binary:
            return False

        try:
            subprocess.run(
                [self._platform.tmux_binary, "display-message", f"Archon: {message}"],
                timeout=5, capture_output=True,
            )
            return True
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            return False

    def _append_to_alert_queue(self, event: MonitorEvent) -> None:
        """Append event to the file-based alert queue for SessionStart to read."""
        self._alert_queue_path.parent.mkdir(parents=True, exist_ok=True)

        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "severity": event.severity,
            "message": sanitize_message(event.message),
            "category": event.category,
            "item_id": event.item_id,
        }

        # Append-only: read existing, add new, write back
        pending = []
        if self._alert_queue_path.exists():
            try:
                pending = json.loads(self._alert_queue_path.read_text())
            except (json.JSONDecodeError, OSError):
                pending = []

        pending.append(entry)

        # Cap at 100 pending alerts
        if len(pending) > 100:
            pending = pending[-100:]

        tmp = self._alert_queue_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(pending, indent=2))
        tmp.rename(self._alert_queue_path)

    def read_and_clear_alerts(self) -> list[dict]:
        """Read pending alerts and clear the queue. Called by SessionStart hook."""
        if not self._alert_queue_path.exists():
            return []

        try:
            alerts = json.loads(self._alert_queue_path.read_text())
            self._alert_queue_path.write_text("[]")
            return alerts
        except (json.JSONDecodeError, OSError):
            return []
