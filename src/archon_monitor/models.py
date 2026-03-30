"""Data models for the Archon Monitor system."""

import enum
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Optional


class TrackType(enum.Enum):
    PID = "pid"
    LOG = "log"
    DIRECTORY = "directory"


class ItemState(enum.Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    STALE = "stale"


@dataclass
class TrackedItem:
    item_id: str
    track_type: TrackType
    label: str
    target: str  # PID (as str), log path, or directory path
    state: ItemState = ItemState.RUNNING
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_activity: Optional[datetime] = None
    exit_code: Optional[int] = None
    error_count: int = 0
    last_error: Optional[str] = None
    stale_threshold_seconds: int = 300
    patterns: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    def is_stale(self) -> bool:
        """True if no activity within stale_threshold_seconds."""
        ref = self.last_activity if self.last_activity else self.created_at
        elapsed = (datetime.now(timezone.utc) - ref).total_seconds()
        return elapsed > self.stale_threshold_seconds

    def to_dict(self) -> dict:
        d = {
            "item_id": self.item_id,
            "track_type": self.track_type.value,
            "label": self.label,
            "target": self.target,
            "state": self.state.value,
            "created_at": self.created_at.isoformat(),
            "last_activity": self.last_activity.isoformat() if self.last_activity else None,
            "exit_code": self.exit_code,
            "error_count": self.error_count,
            "last_error": self.last_error,
            "stale_threshold_seconds": self.stale_threshold_seconds,
            "patterns": self.patterns,
            "metadata": self.metadata,
        }
        return d

    @classmethod
    def from_dict(cls, data: dict) -> "TrackedItem":
        return cls(
            item_id=data["item_id"],
            track_type=TrackType(data["track_type"]),
            label=data["label"],
            target=data["target"],
            state=ItemState(data.get("state", "running")),
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else datetime.now(timezone.utc),
            last_activity=datetime.fromisoformat(data["last_activity"]) if data.get("last_activity") else None,
            exit_code=data.get("exit_code"),
            error_count=data.get("error_count", 0),
            last_error=data.get("last_error"),
            stale_threshold_seconds=data.get("stale_threshold_seconds", 300),
            patterns=data.get("patterns", []),
            metadata=data.get("metadata", {}),
        )

    @staticmethod
    def new_id() -> str:
        return str(uuid.uuid4())[:8]


@dataclass
class MonitorEvent:
    """Emitted when a tracked item changes state or matches a pattern."""
    item_id: str
    event_type: str  # "state_change", "pattern_match", "exit", "stale"
    severity: str    # "info", "warning", "error", "critical"
    category: str    # "test_failure", "build_error", "process_exit", "file_change"
    message: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    source: str = ""
    detail: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "item_id": self.item_id,
            "event_type": self.event_type,
            "severity": self.severity,
            "category": self.category,
            "message": self.message,
            "timestamp": self.timestamp.isoformat(),
            "source": self.source,
            "detail": self.detail,
        }
