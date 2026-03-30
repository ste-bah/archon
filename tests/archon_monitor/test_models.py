"""Tests for archon monitor data models."""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from archon_monitor.models import (
    ItemState,
    MonitorEvent,
    TrackType,
    TrackedItem,
)


class TestTrackedItem:
    def test_create_pid_item(self):
        item = TrackedItem(
            item_id="abc123",
            track_type=TrackType.PID,
            label="pytest run",
            target="12345",
        )
        assert item.state == ItemState.RUNNING
        assert item.error_count == 0
        assert item.exit_code is None

    def test_create_log_item(self):
        item = TrackedItem(
            item_id="def456",
            track_type=TrackType.LOG,
            label="build log",
            target="/tmp/build.log",
            patterns=[r"\bERROR\b"],
        )
        assert item.track_type == TrackType.LOG
        assert len(item.patterns) == 1

    def test_is_stale_false_when_recent(self):
        item = TrackedItem(
            item_id="test",
            track_type=TrackType.PID,
            label="test",
            target="1",
            stale_threshold_seconds=300,
        )
        assert item.is_stale() is False

    def test_is_stale_true_when_old(self):
        old_time = datetime.now(timezone.utc) - timedelta(seconds=600)
        item = TrackedItem(
            item_id="test",
            track_type=TrackType.PID,
            label="test",
            target="1",
            created_at=old_time,
            stale_threshold_seconds=300,
        )
        assert item.is_stale() is True

    def test_is_stale_uses_last_activity(self):
        old_create = datetime.now(timezone.utc) - timedelta(seconds=600)
        recent_activity = datetime.now(timezone.utc) - timedelta(seconds=10)
        item = TrackedItem(
            item_id="test",
            track_type=TrackType.PID,
            label="test",
            target="1",
            created_at=old_create,
            last_activity=recent_activity,
            stale_threshold_seconds=300,
        )
        assert item.is_stale() is False

    def test_to_dict_roundtrip(self):
        item = TrackedItem(
            item_id="abc",
            track_type=TrackType.LOG,
            label="test log",
            target="/tmp/test.log",
            patterns=[r"\bERROR\b"],
            metadata={"pipeline_id": "p123"},
        )
        d = item.to_dict()
        restored = TrackedItem.from_dict(d)
        assert restored.item_id == item.item_id
        assert restored.track_type == item.track_type
        assert restored.label == item.label
        assert restored.target == item.target
        assert restored.patterns == item.patterns
        assert restored.metadata == item.metadata

    def test_to_dict_serializable(self):
        import json
        item = TrackedItem(
            item_id="test",
            track_type=TrackType.PID,
            label="test",
            target="123",
        )
        # Should not raise
        json.dumps(item.to_dict())

    def test_new_id_generates_short_uuid(self):
        id1 = TrackedItem.new_id()
        id2 = TrackedItem.new_id()
        assert len(id1) == 8
        assert id1 != id2

    def test_from_dict_with_minimal_data(self):
        item = TrackedItem.from_dict({
            "item_id": "min",
            "track_type": "pid",
            "label": "minimal",
            "target": "1",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        assert item.state == ItemState.RUNNING
        assert item.error_count == 0


class TestMonitorEvent:
    def test_create_event(self):
        event = MonitorEvent(
            item_id="abc",
            event_type="pattern_match",
            severity="error",
            category="test_failure",
            message="Test failed: test_login",
            source="/tmp/pytest.log",
            detail="FAILED tests/test_login.py::test_login_success",
        )
        assert event.severity == "error"

    def test_to_dict_serializable(self):
        import json
        event = MonitorEvent(
            item_id="abc",
            event_type="exit",
            severity="info",
            category="process_exit",
            message="Process exited",
        )
        json.dumps(event.to_dict())
