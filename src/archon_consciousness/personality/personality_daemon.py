"""Singleton multi-session personality daemon.

One global daemon scans all sessions/*/events.jsonl, maintains per-session
state via tested AgentSelfModel + FastChannel, writes per-session cache files.

Started by first session, reused by all subsequent sessions.
Self-terminates when no active sessions remain.

ALL business logic delegated to tested modules. This is orchestration only.
"""

import json
import logging
import os
import signal as sig
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.archon_consciousness.personality.agent_self_model import AgentSelfModel
from src.archon_consciousness.personality.appraisal_engine import AppraisalEngine
from src.archon_consciousness.personality.fast_channel import FastChannel
from src.archon_consciousness.personality.metacognitive_monitor import MetacognitiveMonitor
from src.archon_consciousness.personality.signal_collector import SignalCollector

logger = logging.getLogger(__name__)


class DaemonState:
    """Per-session state container."""

    def __init__(self, client: Any, lance: Any = None, session_id: str = ""):
        self.client = client
        self.collector = SignalCollector(client=client, lance=lance)
        self.engine = AppraisalEngine()
        self.model = AgentSelfModel(
            collector=self.collector, engine=self.engine,
            client=client, lance=lance,
        )
        self.fast_channel = FastChannel(lance=lance, client=client)
        self.monitor = MetacognitiveMonitor(
            fast=self.fast_channel, client=client, session_id=session_id,
        )
        self.action_count: int = 0
        self.correction_count: int = 0
        self.mood_valence: float = 0.0
        self.cache_path: str = ""
        self.interrupt_path: str = ""


def process_event(state: DaemonState, event: dict) -> dict:
    """Process a single tool event. Delegates to tested modules."""
    tool = event.get("tool", "unknown")
    target = event.get("target", "")
    error = event.get("error", "")

    state.action_count += 1

    if tool in ("Write", "Edit", "MultiEdit"):
        state.collector._total_interactions += 1
    elif tool == "Bash":
        state.collector._total_interactions += 1
        if any(kw in target.lower() for kw in ("pytest", "vitest", "npm test")):
            state.collector.record_success()

    fast_result = state.fast_channel.check(tool, target, error)

    interrupt = None
    if fast_result.episode_similarity > 0.85:
        interrupt = {"trigger": "episode_match", "detail": fast_result.episode_match or ""}
    elif fast_result.rule_violation:
        interrupt = {"trigger": "rule_violation", "detail": fast_result.rule_violation}
    elif fast_result.anomaly_type:
        interrupt = {"trigger": f"anomaly_{fast_result.anomaly_type}", "detail": target}

    if interrupt and state.interrupt_path:
        _write_file_atomic(state.interrupt_path, interrupt)

    return {"processed": True, "fast_channel_ran": True, "interrupt": interrupt}


def process_correction(state: DaemonState, correction: dict) -> None:
    """Process a self-reported correction."""
    state.correction_count += 1
    state.collector.record_correction()
    if state.correction_count >= 3:
        try:
            state.collector.set_user_state("frustrated")
        except ValueError:
            pass


def compute_state_update(state: DaemonState) -> dict:
    """Compute state via tested AgentSelfModel.process_turn()."""
    state_obj, hints_obj = state.model.process_turn(
        turn_number=state.action_count,
        session_id="daemon",
    )
    state.mood_valence = state_obj.mood_valence

    cache_data = {
        "state": state_obj.primary_state,
        "mood_valence": state_obj.mood_valence,
        "hints": {
            "validation_level": hints_obj.validation_level,
            "response_verbosity": hints_obj.response_verbosity,
            "exploration_mode": hints_obj.exploration_mode,
            "influence_weight": hints_obj.influence_weight,
            "should_present_options": hints_obj.should_present_options,
            "should_retrieve_episodes": hints_obj.should_retrieve_episodes,
            "should_verify_values": hints_obj.should_verify_values,
        },
        "correction_count": state.correction_count,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "consecutive_state_count": state.model._consecutive_state_count,
    }

    if state.cache_path:
        _write_file_atomic(state.cache_path, cache_data)

    return cache_data


def should_stay_alive(sessions_dir: str) -> bool:
    """Check if any active sessions exist.

    Active = events.jsonl modified in last hour OR directory created in last 5 min.
    """
    now = time.time()
    try:
        sessions_path = Path(sessions_dir)
        if not sessions_path.exists():
            return False
        for session_dir in sessions_path.iterdir():
            if not session_dir.is_dir():
                continue
            events_file = session_dir / "events.jsonl"
            if events_file.exists() and (now - events_file.stat().st_mtime) < 3600:
                return True
            if (now - session_dir.stat().st_mtime) < 300:
                return True
    except (FileNotFoundError, OSError):
        pass
    return False


def detect_behavioral_gaps(events: list[dict]) -> list[dict]:
    """Detect knowledge gaps from tool call patterns. 3 heuristics."""
    import re
    from collections import Counter

    gaps = []

    # 1. 3+ web searches on similar topic
    search_targets = [
        ev.get("target", "").lower()
        for ev in events if ev.get("tool") in ("WebSearch", "WebFetch")
    ]
    if len(search_targets) >= 3:
        all_words = []
        for target in search_targets:
            words = re.split(r'[\s/\-_?&=.]+', target)
            words = [w for w in words if len(w) > 3 and w not in (
                "http", "https", "www", "docs", "com", "org", "python",
                "html", "index", "page")]
            all_words.extend(words)
        if all_words:
            common = Counter(all_words).most_common(1)
            if common and common[0][1] >= 2:
                gaps.append({
                    "signal_type": "knowledge_gap",
                    "topic": common[0][0],
                    "confidence": 0.3,
                })

    # 2. 5+ reads in unfamiliar directory before editing
    read_dirs = []
    first_edit_seen = False
    for ev in events:
        if ev.get("tool") == "Read" and not first_edit_seen:
            target = ev.get("target", "")
            dir_name = "/".join(target.split("/")[:-1]) if "/" in target else ""
            if dir_name:
                read_dirs.append(dir_name)
        elif ev.get("tool") in ("Write", "Edit", "MultiEdit"):
            first_edit_seen = True
    if len(read_dirs) >= 5:
        most_read = Counter(read_dirs).most_common(1)
        if most_read and most_read[0][1] >= 3:
            gaps.append({
                "signal_type": "repeated_unfamiliarity",
                "topic": f"codebase exploration: {most_read[0][0]}",
                "confidence": 0.3,
            })

    # 3. Edit→test-fail cycle
    edit_fail_counts: dict[str, int] = {}
    last_edited = ""
    for ev in events:
        if ev.get("tool") in ("Edit", "Write") and ev.get("target", "").endswith(".py"):
            last_edited = ev.get("target", "")
        elif ev.get("tool") == "Bash" and ev.get("exit_code", 0) != 0:
            target = ev.get("target", "").lower()
            if ("pytest" in target or "vitest" in target) and last_edited:
                edit_fail_counts[last_edited] = edit_fail_counts.get(last_edited, 0) + 1
    for file_path, count in edit_fail_counts.items():
        if count >= 3:
            basename = file_path.split("/")[-1].replace(".py", "").replace("_", " ")
            gaps.append({
                "signal_type": "prediction_failure",
                "topic": basename,
                "confidence": 0.4,
            })

    return gaps


class MultiSessionDaemon:
    """Singleton daemon that manages multiple sessions.

    Scans sessions_dir for session directories, processes events
    per-session, writes per-session cache files.
    """

    def __init__(self, sessions_dir: str, client: Any = None, lance: Any = None):
        self.sessions_dir = sessions_dir
        self.client = client
        self.lance = lance
        self.session_states: dict[str, DaemonState] = {}
        self.file_positions: dict[str, int] = {}
        self.correction_positions: dict[str, int] = {}

    def poll_once(self) -> None:
        """One poll iteration: scan sessions, process new events."""
        sessions_path = Path(self.sessions_dir)
        if not sessions_path.exists():
            return

        active_sids = set()
        for session_dir in sessions_path.iterdir():
            if not session_dir.is_dir():
                continue
            sid = session_dir.name
            active_sids.add(sid)

            # Initialize state for new sessions
            if sid not in self.session_states:
                self.session_states[sid] = DaemonState(
                    client=self.client or _MinimalClient(),
                    lance=self.lance,
                    session_id=sid,
                )
                self.session_states[sid].cache_path = str(session_dir / "state.json")
                self.session_states[sid].interrupt_path = str(session_dir / "interrupt.json")
                self.file_positions[sid] = 0
                self.correction_positions[sid] = 0

            state = self.session_states[sid]

            # Read new events
            events_file = str(session_dir / "events.jsonl")
            new_events, new_pos = _read_new_lines(events_file, self.file_positions[sid])
            self.file_positions[sid] = new_pos
            for event in new_events:
                process_event(state, event)

            # Read new corrections
            corr_file = str(session_dir / "corrections.jsonl")
            new_corr, new_corr_pos = _read_new_lines(corr_file, self.correction_positions[sid])
            self.correction_positions[sid] = new_corr_pos
            for corr in new_corr:
                process_correction(state, corr)

            # Compute state update every 5 NEW events (not every poll)
            if new_events and state.action_count > 0 and state.action_count % 5 == 0:
                compute_state_update(state)

        # Clean up removed sessions
        for sid in list(self.session_states.keys()):
            if sid not in active_sids:
                del self.session_states[sid]
                self.file_positions.pop(sid, None)
                self.correction_positions.pop(sid, None)

    def run(self, poll_interval: float = 0.05, pid_file: str = "") -> None:
        """Main daemon loop. Runs until no active sessions remain."""
        running = [True]
        idle_checks = 0
        iteration = 0
        lifecycle_interval = int(60.0 / poll_interval)  # check every ~60s

        def handle_signal(signum, frame):
            running[0] = False

        sig.signal(sig.SIGTERM, handle_signal)
        sig.signal(sig.SIGINT, handle_signal)

        logger.info("Personality daemon started (singleton, sessions_dir=%s)", self.sessions_dir)

        while running[0]:
            self.poll_once()
            iteration += 1

            # Lifecycle check every ~60 seconds
            if iteration % lifecycle_interval == 0:
                if should_stay_alive(self.sessions_dir):
                    idle_checks = 0
                else:
                    idle_checks += 1
                    if idle_checks >= 5:  # 5 min grace
                        logger.info("No active sessions — shutting down")
                        break

            time.sleep(poll_interval)

        # Final state update for all sessions
        for sid, state in self.session_states.items():
            if state.action_count > 0:
                compute_state_update(state)

        # Cleanup PID file
        if pid_file:
            try:
                os.remove(pid_file)
            except OSError:
                pass

        logger.info("Personality daemon stopped (processed %d sessions)",
                     len(self.session_states))


class _MinimalClient:
    """Fallback in-memory client when FalkorDB unavailable."""

    def __init__(self):
        self._store: dict = {}

    def store_memory(self, **kw):
        self._store[kw.get("name", "")] = kw
        return {"success": True}

    def get_memory(self, name):
        return self._store.get(name)

    def list_by_type(self, t):
        return [v for v in self._store.values() if v.get("memory_type") == t]

    def search_memories(self, query, **kw):
        return []


def _read_new_lines(path: str, position: int) -> tuple[list[dict], int]:
    """Read new complete lines from JSONL starting at position."""
    if not path or not os.path.exists(path):
        return [], position
    entries = []
    try:
        with open(path) as f:
            f.seek(position)
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
            new_pos = f.tell()
    except OSError:
        return [], position
    return entries, new_pos


def _write_file_atomic(path: str, data: dict) -> None:
    """Atomic write via temp + rename."""
    dir_name = os.path.dirname(path) or "."
    try:
        os.makedirs(dir_name, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(data, f)
            os.replace(tmp, path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
    except Exception:
        logger.warning("Failed to write: %s", path)
