"""Rate limiter for notification dispatch.

Prevents notification spam with debounce, per-category cooldown, and daily budgets.
State persists to disk across daemon restarts.
"""

import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

STATE_FILE = Path.home() / ".archon" / "monitor" / "rate-limiter.json"

# Defaults
DEBOUNCE_SECONDS = 2.0
CATEGORY_COOLDOWN_SECONDS = 300.0  # 5 minutes
DAILY_BUDGET = 50
OS_NOTIFY_BUDGET = 10


@dataclass
class RateLimiterState:
    last_fire_time: float = 0.0
    category_last_fire: dict[str, float] = field(default_factory=dict)
    daily_count: int = 0
    daily_os_count: int = 0
    daily_reset_date: str = ""  # YYYY-MM-DD


class RateLimiter:
    """Rate limiter with debounce, per-category cooldown, and daily budget."""

    def __init__(
        self,
        state_file: Path = STATE_FILE,
        debounce: float = DEBOUNCE_SECONDS,
        cooldown: float = CATEGORY_COOLDOWN_SECONDS,
        daily_budget: int = DAILY_BUDGET,
        os_budget: int = OS_NOTIFY_BUDGET,
    ):
        self._state_file = state_file
        self._debounce = debounce
        self._cooldown = cooldown
        self._daily_budget = daily_budget
        self._os_budget = os_budget
        self._state = RateLimiterState()
        self._load_state()

    def should_notify(self, category: str, is_os_notification: bool = False) -> bool:
        """Check if a notification should be dispatched.

        Returns True if allowed, False if rate-limited.
        """
        now = time.time()
        today = time.strftime("%Y-%m-%d")

        # Reset daily counters at midnight
        if self._state.daily_reset_date != today:
            self._state.daily_count = 0
            self._state.daily_os_count = 0
            self._state.daily_reset_date = today

        # Debounce: minimum time between any notifications
        if now - self._state.last_fire_time < self._debounce:
            return False

        # Category cooldown
        last_cat = self._state.category_last_fire.get(category, 0.0)
        if now - last_cat < self._cooldown:
            return False

        # Daily budget
        if self._state.daily_count >= self._daily_budget:
            return False

        # OS notification budget
        if is_os_notification and self._state.daily_os_count >= self._os_budget:
            return False

        return True

    def record_notification(self, category: str, is_os_notification: bool = False) -> None:
        """Record that a notification was sent. Updates counters and timestamps."""
        now = time.time()
        self._state.last_fire_time = now
        self._state.category_last_fire[category] = now
        self._state.daily_count += 1
        if is_os_notification:
            self._state.daily_os_count += 1
        self._save_state()

    def get_stats(self) -> dict:
        """Return current rate limiter state."""
        return {
            "daily_count": self._state.daily_count,
            "daily_os_count": self._state.daily_os_count,
            "daily_budget": self._daily_budget,
            "os_budget": self._os_budget,
            "daily_reset_date": self._state.daily_reset_date,
        }

    def _load_state(self) -> None:
        if not self._state_file.exists():
            return
        try:
            data = json.loads(self._state_file.read_text())
            self._state.last_fire_time = data.get("last_fire_time", 0.0)
            self._state.category_last_fire = data.get("category_last_fire", {})
            self._state.daily_count = data.get("daily_count", 0)
            self._state.daily_os_count = data.get("daily_os_count", 0)
            self._state.daily_reset_date = data.get("daily_reset_date", "")
        except Exception as e:
            logger.warning(f"Failed to load rate limiter state: {e}")

    def _save_state(self) -> None:
        try:
            self._state_file.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "last_fire_time": self._state.last_fire_time,
                "category_last_fire": self._state.category_last_fire,
                "daily_count": self._state.daily_count,
                "daily_os_count": self._state.daily_os_count,
                "daily_reset_date": self._state.daily_reset_date,
            }
            tmp = self._state_file.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(data))
            tmp.rename(self._state_file)
        except Exception as e:
            logger.error(f"Failed to save rate limiter state: {e}")
