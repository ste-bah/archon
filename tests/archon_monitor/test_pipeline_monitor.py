"""Tests for pipeline monitor."""

import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
from archon_monitor.pipeline_monitor import PipelineMonitor, read_pipeline_checkpoint, PipelineState


def write_checkpoint(path, **kwargs):
    defaults = {
        "pipelineId": "pipe-001",
        "totalAgents": 48,
        "completedAgents": 0,
        "currentAgent": "task-analyzer",
        "phase": "understanding",
        "startedAt": time.time(),
        "lastUpdated": time.time(),
        "status": "running",
    }
    defaults.update(kwargs)
    path.write_text(json.dumps(defaults))


class TestReadCheckpoint:
    def test_reads_valid_checkpoint(self, tmp_path):
        cp = tmp_path / "checkpoint.json"
        write_checkpoint(cp)
        state = read_pipeline_checkpoint(cp)
        assert state is not None
        assert state.pipeline_id == "pipe-001"
        assert state.total_agents == 48

    def test_missing_file_returns_none(self, tmp_path):
        assert read_pipeline_checkpoint(tmp_path / "nope.json") is None

    def test_corrupt_json_returns_none(self, tmp_path):
        cp = tmp_path / "bad.json"
        cp.write_text("NOT JSON {{{")
        assert read_pipeline_checkpoint(cp) is None

    def test_progress_percent(self):
        state = PipelineState(
            pipeline_id="p", total_agents=48, completed_agents=12,
            current_agent="a", phase="p", started_at=0, last_updated=0, status="running",
        )
        assert state.progress_percent == 25

    def test_progress_zero_agents(self):
        state = PipelineState(
            pipeline_id="p", total_agents=0, completed_agents=0,
            current_agent="", phase="", started_at=0, last_updated=0, status="running",
        )
        assert state.progress_percent == 0

    def test_is_stale(self):
        state = PipelineState(
            pipeline_id="p", total_agents=48, completed_agents=0,
            current_agent="a", phase="p", started_at=0,
            last_updated=time.time() - 700, status="running",
        )
        assert state.is_stale is True

    def test_not_stale(self):
        state = PipelineState(
            pipeline_id="p", total_agents=48, completed_agents=0,
            current_agent="a", phase="p", started_at=0,
            last_updated=time.time(), status="running",
        )
        assert state.is_stale is False


class TestPipelineMonitor:
    def test_new_pipeline_event(self, tmp_path):
        cp = tmp_path / "cp.json"
        write_checkpoint(cp)
        monitor = PipelineMonitor(cp)
        events = monitor.check()
        assert len(events) == 1
        assert events[0].event_type == "state_change"
        assert "started" in events[0].message

    def test_25_percent_milestone(self, tmp_path):
        cp = tmp_path / "cp.json"
        write_checkpoint(cp)
        monitor = PipelineMonitor(cp)
        monitor.check()  # start event

        write_checkpoint(cp, completedAgents=12)  # 25%
        events = monitor.check()
        assert any("25%" in e.message for e in events)

    def test_50_percent_milestone(self, tmp_path):
        cp = tmp_path / "cp.json"
        write_checkpoint(cp)
        monitor = PipelineMonitor(cp)
        monitor.check()

        write_checkpoint(cp, completedAgents=24)  # 50%
        events = monitor.check()
        assert any("50%" in e.message for e in events)

    def test_100_percent_milestone(self, tmp_path):
        cp = tmp_path / "cp.json"
        write_checkpoint(cp)
        monitor = PipelineMonitor(cp)
        monitor.check()

        write_checkpoint(cp, completedAgents=48, status="completed")
        events = monitor.check()
        milestone_msgs = [e.message for e in events]
        assert any("100%" in m or "completed" in m.lower() for m in milestone_msgs)

    def test_failure_event(self, tmp_path):
        cp = tmp_path / "cp.json"
        write_checkpoint(cp)
        monitor = PipelineMonitor(cp)
        monitor.check()

        write_checkpoint(cp, completedAgents=10, status="failed", currentAgent="code-generator")
        events = monitor.check()
        failure_events = [e for e in events if e.category == "pipeline_failure"]
        assert len(failure_events) == 1
        assert failure_events[0].severity == "error"
        assert "code-generator" in failure_events[0].message

    def test_failure_not_repeated(self, tmp_path):
        cp = tmp_path / "cp.json"
        write_checkpoint(cp)
        monitor = PipelineMonitor(cp)
        monitor.check()

        write_checkpoint(cp, status="failed")
        monitor.check()  # first failure
        events = monitor.check()  # second check — should NOT re-report
        failure_events = [e for e in events if e.category == "pipeline_failure"]
        assert len(failure_events) == 0

    def test_stale_detection(self, tmp_path):
        cp = tmp_path / "cp.json"
        write_checkpoint(cp, lastUpdated=time.time() - 700)
        monitor = PipelineMonitor(cp)
        events = monitor.check()  # start event + stale detection on first check
        stale_events = [e for e in events if e.event_type == "stale"]
        assert len(stale_events) == 1
        assert stale_events[0].severity == "warning"

        # Second check should NOT re-report stale
        events2 = monitor.check()
        stale2 = [e for e in events2 if e.event_type == "stale"]
        assert len(stale2) == 0

    def test_new_pipeline_resets_state(self, tmp_path):
        cp = tmp_path / "cp.json"
        write_checkpoint(cp, pipelineId="pipe-001")
        monitor = PipelineMonitor(cp)
        monitor.check()

        write_checkpoint(cp, pipelineId="pipe-002")
        events = monitor.check()
        assert any("started" in e.message and "pipe-002" in e.message for e in events)

    def test_no_events_when_no_checkpoint(self, tmp_path):
        monitor = PipelineMonitor(tmp_path / "nonexistent.json")
        assert monitor.check() == []
