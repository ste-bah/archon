"""Tests for notification dispatch system."""

import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from archon_monitor.dispatch import (
    NotificationDispatcher,
    SEVERITY_ROUTING,
    sanitize_message,
)
from archon_monitor.models import MonitorEvent
from archon_monitor.platform_detect import PlatformCapabilities
from archon_monitor.rate_limiter import RateLimiter


@pytest.fixture
def mock_platform():
    return PlatformCapabilities(
        os_name="darwin",
        os_notify_binary=None,  # Don't actually send OS notifications in tests
        has_tmux=False,
        tmux_binary=None,
        has_terminal_bell=True,
    )


@pytest.fixture
def rate_limiter(tmp_path):
    return RateLimiter(
        state_file=tmp_path / "rate.json",
        debounce=0.0,  # No debounce in tests
        cooldown=0.0,  # No cooldown in tests
        daily_budget=100,
        os_budget=10,
    )


@pytest.fixture
def dispatcher(mock_platform, rate_limiter, tmp_path):
    return NotificationDispatcher(
        platform=mock_platform,
        rate_limiter=rate_limiter,
        alert_queue_path=tmp_path / "alerts" / "pending.json",
    )


@pytest.fixture
def make_event():
    def _make(severity="error", category="test_failure", message="Test failed"):
        return MonitorEvent(
            item_id="abc",
            event_type="pattern_match",
            severity=severity,
            category=category,
            message=message,
        )
    return _make


class TestSanitizeMessage:
    def test_strips_control_chars(self):
        assert sanitize_message("hello\x00world") == "helloworld"

    def test_replaces_newlines(self):
        assert sanitize_message("line1\nline2") == "line1 line2"

    def test_truncates_long_message(self):
        result = sanitize_message("x" * 300)
        assert len(result) == 200
        assert result.endswith("...")

    def test_short_message_unchanged(self):
        assert sanitize_message("hello") == "hello"

    def test_empty_message(self):
        assert sanitize_message("") == ""


class TestSeverityRouting:
    def test_info_goes_to_log_only(self):
        assert SEVERITY_ROUTING["info"] == ["log"]

    def test_warning_goes_to_log_and_bell(self):
        assert "bell" in SEVERITY_ROUTING["warning"]

    def test_error_goes_to_os_notify(self):
        assert "os_notify" in SEVERITY_ROUTING["error"]

    def test_critical_goes_to_all(self):
        channels = SEVERITY_ROUTING["critical"]
        assert "log" in channels
        assert "os_notify" in channels
        assert "tmux" in channels
        assert "alert_queue" in channels


class TestDispatcher:
    def test_info_dispatches_to_log(self, dispatcher, make_event):
        result = dispatcher.dispatch(make_event(severity="info"))
        assert result["log"] == "sent"
        assert "os_notify" not in result

    def test_error_dispatches_to_alert_queue(self, dispatcher, make_event):
        result = dispatcher.dispatch(make_event(severity="error"))
        assert result["alert_queue"] == "sent"

    def test_os_notify_unavailable(self, dispatcher, make_event):
        result = dispatcher.dispatch(make_event(severity="error"))
        assert result["os_notify"] == "unavailable"

    def test_critical_dispatches_to_multiple(self, dispatcher, make_event):
        result = dispatcher.dispatch(make_event(severity="critical"))
        assert "log" in result
        assert "alert_queue" in result


class TestRateLimiting:
    def test_debounce_blocks_rapid_fire(self, mock_platform, tmp_path):
        limiter = RateLimiter(
            state_file=tmp_path / "rate.json",
            debounce=10.0,  # 10 second debounce
            cooldown=0.0,
            daily_budget=100,
            os_budget=10,
        )
        dispatcher = NotificationDispatcher(
            platform=mock_platform,
            rate_limiter=limiter,
            alert_queue_path=tmp_path / "alerts.json",
        )
        event = MonitorEvent(
            item_id="x", event_type="test", severity="error",
            category="test", message="first",
        )
        result1 = dispatcher.dispatch(event)
        assert result1.get("alert_queue") == "sent"

        # Second dispatch should be rate-limited
        event2 = MonitorEvent(
            item_id="y", event_type="test", severity="error",
            category="test", message="second",
        )
        result2 = dispatcher.dispatch(event2)
        assert result2.get("alert_queue") == "rate_limited"

    def test_category_cooldown(self, mock_platform, tmp_path):
        limiter = RateLimiter(
            state_file=tmp_path / "rate.json",
            debounce=0.0,
            cooldown=10.0,  # 10 second cooldown per category
            daily_budget=100,
            os_budget=10,
        )
        dispatcher = NotificationDispatcher(
            platform=mock_platform,
            rate_limiter=limiter,
            alert_queue_path=tmp_path / "alerts.json",
        )
        event = MonitorEvent(
            item_id="x", event_type="test", severity="error",
            category="same_category", message="first",
        )
        dispatcher.dispatch(event)

        # Same category within cooldown
        event2 = MonitorEvent(
            item_id="y", event_type="test", severity="error",
            category="same_category", message="second",
        )
        result = dispatcher.dispatch(event2)
        assert result.get("alert_queue") == "rate_limited"

    def test_daily_budget_enforced(self, mock_platform, tmp_path):
        limiter = RateLimiter(
            state_file=tmp_path / "rate.json",
            debounce=0.0,
            cooldown=0.0,
            daily_budget=2,  # Very low budget
            os_budget=10,
        )
        dispatcher = NotificationDispatcher(
            platform=mock_platform,
            rate_limiter=limiter,
            alert_queue_path=tmp_path / "alerts.json",
        )
        for i in range(3):
            event = MonitorEvent(
                item_id=str(i), event_type="test", severity="error",
                category=f"cat-{i}", message=f"msg-{i}",
            )
            dispatcher.dispatch(event)

        stats = limiter.get_stats()
        assert stats["daily_count"] <= 2


class TestAlertQueue:
    def test_alerts_written_to_file(self, dispatcher, make_event, tmp_path):
        dispatcher.dispatch(make_event(severity="error"))
        queue_file = tmp_path / "alerts" / "pending.json"
        assert queue_file.exists()
        alerts = json.loads(queue_file.read_text())
        assert len(alerts) == 1
        assert alerts[0]["severity"] == "error"

    def test_read_and_clear(self, dispatcher, make_event):
        dispatcher.dispatch(make_event(severity="error"))
        dispatcher.dispatch(make_event(severity="critical"))

        alerts = dispatcher.read_and_clear_alerts()
        assert len(alerts) == 2

        # Queue should be empty now
        alerts2 = dispatcher.read_and_clear_alerts()
        assert len(alerts2) == 0

    def test_queue_capped_at_100(self, dispatcher, tmp_path):
        for i in range(120):
            event = MonitorEvent(
                item_id=str(i), event_type="test", severity="error",
                category=f"cat-{i}", message=f"msg-{i}",
            )
            dispatcher.dispatch(event)

        queue_file = tmp_path / "alerts" / "pending.json"
        alerts = json.loads(queue_file.read_text())
        assert len(alerts) <= 100

    def test_empty_queue_returns_empty(self, dispatcher):
        assert dispatcher.read_and_clear_alerts() == []


class TestRateLimiterPersistence:
    def test_state_survives_restart(self, tmp_path):
        state_file = tmp_path / "rate.json"
        limiter1 = RateLimiter(state_file=state_file, debounce=0, cooldown=0, daily_budget=100)
        limiter1.record_notification("test")
        limiter1.record_notification("test2")

        # New instance should load persisted state
        limiter2 = RateLimiter(state_file=state_file, debounce=0, cooldown=0, daily_budget=100)
        stats = limiter2.get_stats()
        assert stats["daily_count"] == 2
