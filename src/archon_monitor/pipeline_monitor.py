"""Pipeline monitor — tracks god-code pipeline progress and emits notifications.

Reads pipeline-checkpoint.json, detects progress milestones,
emits MonitorEvent for notifications.
"""

import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .models import MonitorEvent

logger = logging.getLogger(__name__)

CHECKPOINT_FILE = Path(".god-agent/pipeline-checkpoint.json")
STALE_THRESHOLD_SECONDS = 600  # 10 minutes without progress = stale
MILESTONE_PERCENTAGES = [25, 50, 75, 100]


@dataclass
class PipelineState:
    pipeline_id: str
    total_agents: int
    completed_agents: int
    current_agent: str
    phase: str
    started_at: float
    last_updated: float
    status: str  # "running", "completed", "failed"

    @property
    def progress_percent(self) -> int:
        if self.total_agents == 0:
            return 0
        return round((self.completed_agents / self.total_agents) * 100)

    @property
    def is_stale(self) -> bool:
        return (time.time() - self.last_updated) > STALE_THRESHOLD_SECONDS


def read_pipeline_checkpoint(path: Path = CHECKPOINT_FILE) -> Optional[PipelineState]:
    """Read pipeline-checkpoint.json and return current state."""
    if not path.exists():
        return None

    try:
        data = json.loads(path.read_text())
        return PipelineState(
            pipeline_id=data.get("pipelineId", data.get("pipeline_id", "unknown")),
            total_agents=data.get("totalAgents", data.get("total_agents", 0)),
            completed_agents=data.get("completedAgents", data.get("completed_agents", 0)),
            current_agent=data.get("currentAgent", data.get("current_agent", "")),
            phase=data.get("phase", "unknown"),
            started_at=data.get("startedAt", data.get("started_at", time.time())),
            last_updated=data.get("lastUpdated", data.get("last_updated", time.time())),
            status=data.get("status", "running"),
        )
    except (json.JSONDecodeError, OSError, KeyError) as e:
        logger.warning(f"Failed to read pipeline checkpoint: {e}")
        return None


class PipelineMonitor:
    """Monitors god-code pipeline progress and emits milestone events."""

    def __init__(self, checkpoint_path: Path = CHECKPOINT_FILE):
        self._path = checkpoint_path
        self._last_milestone = 0
        self._last_pipeline_id: Optional[str] = None
        self._reported_failure = False
        self._reported_stale = False

    def check(self) -> list[MonitorEvent]:
        """Check pipeline state and return any new events.

        Called periodically (e.g., every 30 seconds) by the monitor daemon.
        """
        state = read_pipeline_checkpoint(self._path)
        if state is None:
            return []

        events = []

        # New pipeline started
        if state.pipeline_id != self._last_pipeline_id:
            self._last_pipeline_id = state.pipeline_id
            self._last_milestone = 0
            self._reported_failure = False
            self._reported_stale = False
            events.append(MonitorEvent(
                item_id=state.pipeline_id,
                event_type="state_change",
                severity="info",
                category="pipeline_progress",
                message=f"Pipeline started: {state.pipeline_id} ({state.total_agents} agents)",
            ))

        # Progress milestones
        pct = state.progress_percent
        for milestone in MILESTONE_PERCENTAGES:
            if pct >= milestone > self._last_milestone:
                self._last_milestone = milestone
                severity = "info" if milestone < 100 else "info"
                events.append(MonitorEvent(
                    item_id=state.pipeline_id,
                    event_type="state_change",
                    severity=severity,
                    category="pipeline_progress",
                    message=f"Pipeline {milestone}% complete ({state.completed_agents}/{state.total_agents}). Current: {state.current_agent}",
                ))

        # Pipeline completed
        if state.status == "completed" and self._last_milestone < 100:
            self._last_milestone = 100
            events.append(MonitorEvent(
                item_id=state.pipeline_id,
                event_type="state_change",
                severity="info",
                category="pipeline_progress",
                message=f"Pipeline completed: {state.pipeline_id}",
            ))

        # Pipeline failed
        if state.status == "failed" and not self._reported_failure:
            self._reported_failure = True
            events.append(MonitorEvent(
                item_id=state.pipeline_id,
                event_type="state_change",
                severity="error",
                category="pipeline_failure",
                message=f"Pipeline FAILED at agent '{state.current_agent}' ({state.progress_percent}%)",
                detail=f"Phase: {state.phase}, Agent: {state.current_agent}",
            ))

        # Stale detection
        if state.is_stale and state.status == "running" and not self._reported_stale:
            self._reported_stale = True
            events.append(MonitorEvent(
                item_id=state.pipeline_id,
                event_type="stale",
                severity="warning",
                category="pipeline_progress",
                message=f"Pipeline appears stale (no progress for {STALE_THRESHOLD_SECONDS}s). Last agent: {state.current_agent}",
            ))

        return events
